// 카드 우클릭 빠른 작업. 메뉴를 여는 동안 서버 조회/저장을 하지 않는다.
// 공고는 본문 전용 모달로 표시하고, 자소서 내용은 선택한 카드만 요청한다.
JSL.register('list-menu', function () {
  'use strict';

  var selector = '.scheduler li.resume-node[resume_node_id]';
  var cards = new Map();
  var host, shadow, menu, sub, status, heading, notice, noticeCopy, chat, editor, editorNew;
  var active = null, previousFocus = null, anchorPoint = null, closeTimer = null;
  var dialog = null, noticeBody = null, noticeTitle = null, noticeRequest = null, returnFocus = null;
  var observer = new MutationObserver(function () {
    if (active && (!active.card.isConnected || !onListPage() || !active.card.getClientRects().length)) close();
  });

  function onListPage() { return location.pathname.indexOf('/resume_list') === 0; }
  function positiveId(value) {
    var n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  function cardAt(target) {
    if (!onListPage() || !target || !target.closest) return null;
    var card = target.closest(selector);
    if (!card || card.matches('.ui-sortable-helper, .append-placeholder, .ai-creating')) return null;
    return positiveId(card.getAttribute('resume_node_id')) ? card : null;
  }

  function ensureUI() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'jsl-card-menu';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:100001';
    shadow = host.attachShadow({ mode: 'open' });
    // 사용자 문자열은 아래의 textContent로만 넣는다.
    shadow.innerHTML = '<style>' +
      ':host{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;color:#30363d;font-size:13px}' +
      '*{box-sizing:border-box}.surface{position:fixed;width:258px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;padding:6px;background:#fff;border:1px solid #e0e3e8;border-radius:12px;box-shadow:0 12px 36px #1d273324,0 2px 6px #1d273312}' +
      '[hidden]{display:none!important}.heading{margin:0;padding:8px 10px 10px;color:#717985;font-size:11px;line-height:1.5;border-bottom:1px solid #edf0f3;margin-bottom:5px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.item{display:flex;align-items:center;gap:10px;width:100%;min-height:37px;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:inherit;text-decoration:none;font:inherit;line-height:1.4;text-align:left;cursor:pointer}' +
      '.item:hover,.item:focus-visible{background:#fff3e9;color:#a84400;outline:none}.item:focus-visible{box-shadow:inset 0 0 0 1px #f2b789}.primary{color:#bb4c00;font-weight:600}.icon{width:17px;flex:none;color:#858d98;text-align:center;font-size:15px}.label{flex:1}.hint{font-size:10px;color:#8b929d;white-space:nowrap}.item[aria-disabled="true"]{color:#a1a7af;cursor:default;background:transparent}.item[aria-disabled="true"] .icon{color:inherit}.sep{height:1px;background:#edf0f3;margin:5px 4px}.sub{width:208px}.status{padding:0 10px;color:#777;font-size:11px;line-height:1.6}.status:not(:empty){padding:6px 10px}.copy-toggle[aria-expanded="true"]{background:#f5f6f8}' +
      '</style><div class="surface" role="menu" aria-label="카드 빠른 작업" hidden>' +
      '<p class="heading"></p>' +
      '<a class="item primary" data-action="editor" role="menuitem" tabindex="-1"><span class="icon" aria-hidden="true">↗</span><span class="label">자기소개서 쓰기</span><span class="hint">바로 열기</span></a>' +
      '<a class="item" data-action="editor-new" role="menuitem" tabindex="-1" target="_blank" rel="noopener noreferrer"><span class="icon" aria-hidden="true">＋</span><span class="label">새 탭에서 쓰기</span></a>' +
      '<button class="item" data-action="notice" role="menuitem" tabindex="-1"><span class="icon" aria-hidden="true">▤</span><span class="label">공고 보기</span><span class="hint">본문</span></button>' +
      '<button class="item" data-action="chat" role="menuitem" tabindex="-1"><span class="icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg></span><span class="label">채팅방으로 이동</span></button>' +
      '<div class="sep" role="separator"></div>' +
      '<button class="item copy-toggle" data-action="copy-menu" role="menuitem" tabindex="-1" aria-haspopup="menu" aria-expanded="false" aria-controls="copy-submenu"><span class="icon" aria-hidden="true">⧉</span><span class="label">복사</span><span aria-hidden="true">›</span></button>' +
      '<div class="status" role="status" aria-live="polite"></div></div>' +
      '<div class="surface sub" id="copy-submenu" role="menu" aria-label="복사" hidden>' +
      '<button class="item" data-action="copy-notice" role="menuitem" tabindex="-1">공고 링크 복사</button>' +
      '<button class="item" data-action="copy-content" role="menuitem" tabindex="-1">자기소개서 내용 복사</button></div>';
    document.body.appendChild(host);
    menu = shadow.querySelector('[aria-label="카드 빠른 작업"]');
    sub = shadow.querySelector('.sub');
    status = shadow.querySelector('.status');
    heading = shadow.querySelector('.heading');
    notice = shadow.querySelector('[data-action="notice"]');
    chat = shadow.querySelector('[data-action="chat"]');
    noticeCopy = shadow.querySelector('[data-action="copy-notice"]');
    editor = shadow.querySelector('[data-action="editor"]');
    editorNew = shadow.querySelector('[data-action="editor-new"]');
    shadow.addEventListener('click', activate);
    shadow.addEventListener('auxclick', function (event) {
      if (event.target.closest('a[href]') && event.button === 1) setTimeout(close, 0);
    });
    shadow.addEventListener('keydown', keyboard);
    shadow.addEventListener('pointerover', function (event) {
      var item = event.target.closest('[role="menuitem"]');
      if (!item) return;
      if (item.dataset.action === 'copy-menu') openSub(false);
      else if (menu.contains(item)) hideSub();
    });
  }

  function updateLinks() {
    if (!active) return;
    var info = cards.get(active.id);
    active.editor = location.origin + (info && info.sample ? '/resume?sample=true' : '/resume/' + active.id);
    active.companyId = info && positiveId(info.employmentCompanyId);
    active.notice = active.companyId ? 'https://link.jasoseol.com/recruit/' + active.companyId : null;
    editor.href = editorNew.href = active.editor;
    notice.setAttribute('aria-disabled', String(!active.notice));
    noticeCopy.setAttribute('aria-disabled', String(!active.notice));
    chat.setAttribute('aria-disabled', String(!active.companyId));
    chat.title = active.companyId ? '' : '연결된 채용공고가 없어 채팅방을 열 수 없습니다';
    notice.title = noticeCopy.title = active.notice ? '' : info ? '연결된 채용공고가 없습니다' : '공고 정보를 확인하지 못했습니다';
  }
  function receive(state) {
    if (!state || state.page !== 'list') { if (active) close(); if (!onListPage()) closeNotice(); return; }
    cards.clear();
    (state.resumes || []).forEach(function (r) { cards.set(Number(r.id), r); });
    updateLinks();
  }

  function position() {
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(anchorPoint.x, innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(anchorPoint.y, innerHeight - rect.height - 8)) + 'px';
  }
  function show(card, x, y) {
    close();
    ensureUI();
    previousFocus = document.activeElement;
    var id = positiveId(card.getAttribute('resume_node_id'));
    active = { card: card, id: id, title: (card.querySelector('.name') || card).textContent.trim() };
    anchorPoint = { x: x, y: y };
    heading.textContent = active.title;
    heading.title = active.title;
    status.textContent = '';
    updateLinks();
    menu.hidden = false;
    position();
    items(menu)[0].focus({ preventScroll: true });
    observer.observe(document.body, { childList: true, subtree: true });
    // 이미 로드된 목록 메모리의 조회. HTTP/답변 전문 조회를 하지 않는다.
    JSL.getState().then(function (state) { if (onListPage()) receive(state); });
  }
  function hideSub() {
    if (!sub) return;
    sub.hidden = true;
    shadow.querySelector('.copy-toggle').setAttribute('aria-expanded', 'false');
  }
  function openSub(focus) {
    if (!active) return;
    sub.hidden = false;
    var toggle = shadow.querySelector('.copy-toggle'), rect = menu.getBoundingClientRect();
    var width = sub.offsetWidth, height = sub.offsetHeight;
    var x = rect.right + 5;
    if (x + width > innerWidth - 8) x = rect.left - width - 5;
    sub.style.left = Math.max(8, Math.min(x, innerWidth - width - 8)) + 'px';
    sub.style.top = Math.max(8, Math.min(toggle.getBoundingClientRect().top, innerHeight - height - 8)) + 'px';
    toggle.setAttribute('aria-expanded', 'true');
    if (focus) items(sub)[0].focus();
  }
  function close(restoreFocus) {
    observer.disconnect();
    clearTimeout(closeTimer);
    if (menu) { menu.hidden = true; hideSub(); }
    active = null;
    if (restoreFocus && previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  function items(surface) {
    return Array.from(surface.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])'));
  }
  function keyboard(event) {
    if (!active) return;
    var target = event.target.closest('[role="menuitem"]'), inSub = sub.contains(target);
    var list = items(inSub ? sub : menu), index = list.indexOf(target), next;
    if (event.key === 'Escape') {
      if (inSub || !sub.hidden) { hideSub(); shadow.querySelector('.copy-toggle').focus(); }
      else close(true);
    } else if (event.key === 'Tab') { close(true); return; }
    else if (event.key === 'ArrowRight' && target && target.dataset.action === 'copy-menu') openSub(true);
    else if (event.key === 'ArrowLeft' && inSub) { hideSub(); shadow.querySelector('.copy-toggle').focus(); }
    else if (event.key === 'ArrowDown') next = list[(index + 1) % list.length];
    else if (event.key === 'ArrowUp') next = list[(index - 1 + list.length) % list.length];
    else if (event.key === ' ' && target && target.matches('a[href]')) target.click();
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list[list.length - 1];
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (next) next.focus();
  }
  function copyText(text) {
    function fallback() {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(textarea);
      try { textarea.select(); return document.execCommand('copy'); }
      catch (error) { return false; }
      finally { textarea.remove(); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    } catch (error) { /* 구형 브라우저는 아래 방식 사용 */ }
    return Promise.resolve(fallback());
  }
  function closeNotice() {
    if (noticeRequest) noticeRequest.abort();
    noticeRequest = null;
    if (dialog && dialog.open) dialog.close();
  }
  function safeUrl(value) {
    if (!value || !String(value).trim()) return null;
    try {
      var url = new URL(value, location.origin);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (error) { return null; }
  }
  function renderNotice(html) {
    var parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    var allowed = new Set('P DIV SPAN BR HR H1 H2 H3 H4 H5 H6 STRONG B EM I U S UL OL LI TABLE THEAD TBODY TFOOT TR TD TH BLOCKQUOTE PRE CODE IMG A'.split(' '));
    var blocked = new Set('SCRIPT STYLE IFRAME OBJECT EMBED FORM INPUT BUTTON SELECT TEXTAREA SVG MATH TEMPLATE LINK META'.split(' '));
    function append(source, target) {
      if (source.nodeType === 3) { target.appendChild(document.createTextNode(source.textContent)); return; }
      if (source.nodeType !== 1 || blocked.has(source.tagName)) return;
      var element = allowed.has(source.tagName) ? document.createElement(source.tagName.toLowerCase()) : target;
      if (source.tagName === 'IMG') {
        var src = safeUrl(source.getAttribute('src') || source.getAttribute('data-src'));
        if (!src) return;
        element.src = src;
        element.alt = source.getAttribute('alt') || '채용공고 본문 이미지';
        element.referrerPolicy = 'no-referrer';
        element.addEventListener('error', function () {
          var error = document.createElement('p'); error.textContent = '공고 이미지를 불러오지 못했습니다'; element.replaceWith(error);
        });
      }
      if (source.tagName === 'A') {
        var href = safeUrl(source.getAttribute('href'));
        if (href) { element.href = href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
      }
      if (/^(TD|TH)$/.test(source.tagName)) ['colspan', 'rowspan'].forEach(function (name) {
        var n = Number(source.getAttribute(name));
        if (Number.isInteger(n) && n > 0 && n <= 100) element.setAttribute(name, n);
      });
      Array.from(source.childNodes).forEach(function (child) { append(child, element); });
      if (element !== target) target.appendChild(element);
    }
    noticeBody.replaceChildren();
    Array.from(parsed.body.childNodes).forEach(function (node) { append(node, noticeBody); });
    if (!noticeBody.textContent.trim() && !noticeBody.querySelector('img')) noticeBody.textContent = '등록된 공고 본문이 없습니다';
  }
  function openNotice(selected) {
    if (!selected.companyId) return;
    if (!dialog) {
      var style = document.createElement('style');
      style.textContent = 'dialog{box-sizing:border-box;width:min(900px,calc(100vw - 32px));max-width:none;height:min(900px,calc(100vh - 40px));max-height:calc(100vh - 40px);padding:0;border:1px solid #e3e6eb;border-radius:14px;background:white;color:#30363d;box-shadow:0 24px 80px #0004}dialog::backdrop{background:#18212d88}dialog[open]{display:flex;flex-direction:column}.notice-head{display:flex;gap:16px;align-items:center;padding:18px 22px;border-bottom:1px solid #e8ebef;flex:none}.notice-title{margin:0;flex:1;font-size:16px;line-height:1.5;overflow-wrap:anywhere}.notice-close{font:inherit;font-size:23px;color:#717985;background:transparent;border:0;border-radius:6px;width:36px;height:36px;cursor:pointer}.notice-close:focus-visible{outline:2px solid #e88139}.notice-body{padding:24px;overflow:auto;overscroll-behavior:contain;min-height:0;font-size:14px;line-height:1.7;overflow-wrap:anywhere}.notice-body img{display:block;max-width:100%;height:auto;margin:0 auto 12px}.notice-body table{max-width:100%;border-collapse:collapse}.notice-body td,.notice-body th{border:1px solid #e1e5eb;padding:7px}.notice-body pre{white-space:pre-wrap}.notice-body a{color:#bc5100}';
      shadow.appendChild(style);
      dialog = document.createElement('dialog');
      dialog.setAttribute('aria-labelledby', 'jsl-notice-title');
      dialog.innerHTML = '<header class="notice-head"><h2 class="notice-title" id="jsl-notice-title"></h2><button class="notice-close" aria-label="공고 닫기" autofocus>×</button></header><div class="notice-body" tabindex="0" aria-live="polite"></div>';
      shadow.appendChild(dialog);
      noticeBody = dialog.querySelector('.notice-body');
      noticeTitle = dialog.querySelector('.notice-title');
      dialog.querySelector('.notice-close').addEventListener('click', closeNotice);
      dialog.addEventListener('click', function (event) {
        if (event.target !== dialog) return;
        var r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeNotice();
      });
      dialog.addEventListener('close', function () {
        if (dialog.open) return;
        if (noticeRequest) noticeRequest.abort();
        noticeRequest = null;
        noticeBody.replaceChildren();
        if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      });
    }
    closeNotice();
    returnFocus = document.activeElement;
    noticeTitle.textContent = selected.title + ' · 채용공고';
    noticeBody.textContent = '공고 본문을 불러오는 중…';
    dialog.showModal();
    var request = new AbortController();
    noticeRequest = request;
    fetch('/api/v1/employment_companies/' + selected.companyId + '?skip_read_log=true', { credentials: 'include', signal: request.signal })
      .then(function (response) { if (!response.ok) throw new Error('notice'); return response.json(); })
      .then(function (job) {
        if (noticeRequest !== request || !dialog.open || !onListPage()) return;
        noticeTitle.textContent = job.title || selected.title;
        renderNotice(job.content);
        noticeBody.scrollTop = 0;
      }).catch(function (error) {
        if (noticeRequest === request && dialog.open && error.name !== 'AbortError') noticeBody.textContent = '공고 본문을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요';
      });
  }
  function activate(event) {
    var item = event.target.closest('[data-action]');
    if (!active || !item) return;
    if (item.getAttribute('aria-disabled') === 'true') { event.preventDefault(); return; }
    var action = item.dataset.action;
    if (item.matches('a[href]')) { setTimeout(close, 0); return; }
    event.preventDefault();
    if (action === 'copy-menu') { openSub(true); return; }
    if (action === 'notice') { var selected = active; close(); openNotice(selected); return; }
    var captured = active;
    if (action === 'chat') {
      if (captured.openingChat) return;
      captured.openingChat = true;
      status.textContent = '채팅방을 여는 중…';
      position();
      JSL.action('openListChat', { id: captured.id }).then(function (result) {
        if (active !== captured) return;
        captured.openingChat = false;
        if (result && result.ok) close();
        else { status.textContent = '채팅방을 열지 못했습니다. 페이지를 새로고침해 주세요'; position(); }
      }).catch(function () {
        if (active !== captured) return;
        captured.openingChat = false;
        status.textContent = '채팅방을 열지 못했습니다. 다시 시도해 주세요';
        position();
      });
      return;
    }
    var source = action === 'copy-notice' ? Promise.resolve(active.notice) :
      JSL.action('getListResumeText', { id: active.id }).then(function (r) { return r && r.ok && r.data ? r.data.text : null; });
    source.then(function (text) {
      if (active !== captured) return null;
      if (typeof text !== 'string' || !text.trim()) { status.textContent = '복사할 내용을 읽지 못했습니다'; position(); return null; }
      return copyText(text);
    }).then(function (ok) {
      if (ok === null) return;
      if (active !== captured) return;
      hideSub();
      status.textContent = ok ? '복사했습니다' : '복사하지 못했습니다. 다시 시도해 주세요';
      shadow.querySelector('.copy-toggle').focus({ preventScroll: true });
      position();
      if (ok) closeTimer = setTimeout(function () { close(true); }, 900);
    });
  }

  document.addEventListener('contextmenu', function (event) {
    var card = cardAt(event.target);
    if (!card || event.shiftKey) { close(); return; } // Shift+우클릭은 브라우저 기본 메뉴
    event.preventDefault();
    var rect = card.getBoundingClientRect();
    show(card, event.clientX || rect.left + 12, event.clientY || rect.top + 12);
  });
  document.addEventListener('pointerdown', function (event) {
    if (active && event.composedPath().indexOf(host) < 0) close();
  }, true);
  document.addEventListener('scroll', function (event) {
    if (active && event.composedPath().indexOf(host) < 0) close();
  }, true);
  window.addEventListener('resize', function () { close(); });
  window.addEventListener('blur', function () { close(); });
  window.addEventListener('popstate', function () { close(); if (!onListPage()) closeNotice(); });
  JSL.onState(receive);
  JSL.getState().then(receive);
});
