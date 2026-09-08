// Angular 공통 패널과 React chat-slide 프레임: 인용문 → 원본 → 답글 복귀.
(function () {
  'use strict';
  if (window.__jslChatReplyInstalled) return;
  window.__jslChatReplyInstalled = true;
  const quoteSelector = ':is(.chat-container.chat-window .message_target-message,#chatBody blockquote[data-sentry-component="TargetMessage"])';
  const pending = new Map();
  let seq = 0, current = null, host = null, label = null, back = null, retry = null;
  function request(action, payload) {
    return new Promise(function (resolve) {
      const id = ++seq;
      const timer = setTimeout(function () { pending.delete(id); resolve({ ok: false, reason: 'timeout' }); }, 10000);
      pending.set(id, { timer: timer, resolve: resolve });
      window.dispatchEvent(new CustomEvent('JSL_CHAT_REQ', { detail: { id: id, action: action, payload: Object.assign({ engine: document.getElementById('chatBody') ? 'react' : 'angular' }, payload) } }));
    });
  }
  window.addEventListener('JSL_CHAT_RES', function (event) {
    const d = event.detail || {}, rec = pending.get(d.id);
    if (!rec) return;
    clearTimeout(rec.timer); pending.delete(d.id); rec.resolve(d.result || { ok: false });
  });
  // Shared chat-design.css owns message and quote colors for both renderers.
  function decorate(root) {
    const nodes = [];
    if (root.matches && root.matches(quoteSelector)) nodes.push(root);
    if (root.querySelectorAll) nodes.push.apply(nodes, root.querySelectorAll(quoteSelector));
    nodes.forEach(function (node) {
      if (node.dataset.jslReply) return;
      node.dataset.jslReply = 'true'; node.tabIndex = 0; node.setAttribute('role', 'button');
      node.title = '원본 보기';
      node.setAttribute('aria-label', '원본 보기: ' + node.textContent.trim());
    });
  }
  function ensureUI() {
    if (host) return;
    host = document.createElement('div'); host.id = 'jsl-chat-reply';
    host.style.cssText = 'position:fixed;z-index:100002;width:max-content;max-width:calc(100vw - 24px)';
    const shadow = host.attachShadow({ mode: 'open' });
    const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H6a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h13m-5-5 5 5-5 5"/></svg>';
    shadow.innerHTML = '<style>' +
      ':host{--accent:#b84300;--warm:transparent;--ink:#262626;--muted:#626262;--line:#d5d5d5;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;color:var(--ink)}' +
      '*{box-sizing:border-box}[hidden]{display:none!important}.bar{display:flex;align-items:center;max-width:inherit;gap:0;padding:3px;background:#fff;border:1px solid var(--line);border-radius:28px;box-shadow:0 2px 8px #00000010;animation:appear 140ms ease-out}' +
      'button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;font:inherit;font-weight:500;color:inherit;border:0;background:transparent;cursor:pointer;border-radius:24px;touch-action:manipulation;transition:background-color 140ms ease}button:hover{background:#f4f4f4}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}svg{width:17px;height:17px;flex:none}.back{padding:0 14px 0 9px;white-space:nowrap}.back .icon{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:var(--accent);background:var(--warm)}' +
      '.close{width:44px;flex:none;color:var(--muted)}.close svg{width:15px;height:15px}.status{padding:8px 5px;min-width:0;overflow-wrap:anywhere;font-size:12px;color:var(--muted)}.signal{width:16px;height:16px;margin-left:12px;margin-right:5px;flex:none;border:1.5px solid #e0e4e9;border-top-color:var(--accent);border-radius:50%;animation:spin 700ms linear infinite}.retry{min-width:48px;padding:0 8px;color:var(--accent);font-size:12px;white-space:nowrap}' +
      ':host([data-mode="ready"]) .signal{display:none}:host([data-mode="ready"]) .status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);padding:0}:host([data-mode="error"]) .bar{border-radius:16px}:host([data-mode="error"]) .signal{animation:none;border:0;border-radius:0;background:none;color:var(--muted);font-weight:600;text-align:center}:host([data-mode="error"]) .signal::after{content:"!"}' +
      '@keyframes spin{to{transform:rotate(360deg)}}@keyframes appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.bar,.signal{animation:none}button{transition:none}}' +
      '</style><div class="bar"><span class="signal" aria-hidden="true"></span><span class="status" role="status" aria-live="polite"></span><button class="back" hidden><span class="icon">' + arrow + '</span>답글로 돌아가기</button><button class="retry" hidden>재시도</button><button class="close" aria-label="원본 이동 안내 닫기" title="닫기 · Esc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>';
    label = shadow.querySelector('.status'); back = shadow.querySelector('.back'); retry = shadow.querySelector('.retry');
    back.addEventListener('click', returnToReply);
    retry.addEventListener('click', function () { if (current) activate(current.quote); });
    shadow.querySelector('.close').addEventListener('click', dismiss);
    document.body.appendChild(host);
  }
  function message(panel, id) { return panel.querySelector('.message-content[message_id="' + id + '"],[id="chat-message-' + id + '"]'); }
  function valid(op) {
    if (current !== op || !op.panel.isConnected || !op.reply.isConnected || !op.panel.contains(op.reply)) return false;
    if (op.engine === 'react' && !op.panel.classList.contains(op.roomClass)) return false;
    const r = op.panel.getBoundingClientRect();
    return r.width > 40 && r.left < innerWidth - 40 && r.right > 40 && getComputedStyle(op.panel).visibility !== 'hidden' &&
      getComputedStyle(op.panel).display !== 'none' && Number(getComputedStyle(op.panel).opacity) > 0;
  }
  function place(op) {
    const r = op.container.getBoundingClientRect();
    host.style.maxWidth = Math.max(160, Math.min(r.width - 24, innerWidth - 24)) + 'px';
    const height = host.offsetHeight, width = host.offsetWidth;
    host.style.left = Math.max(12, Math.min(r.right - width - 12, innerWidth - width - 12)) + 'px';
    host.style.top = Math.max(r.top + 8, Math.min(r.bottom, innerHeight) - height - 12) + 'px';
  }
  function state(op, mode, text) {
    host.dataset.mode = mode; label.textContent = text;
    back.hidden = mode !== 'ready'; retry.hidden = mode !== 'error' || op.deleted;
    place(op);
  }
  function clear() {
    if (current) {
      clearInterval(current.poll); clearTimeout(current.highlightTimer);
      if (current.resize) current.resize.disconnect();
      if (current.visibility) current.visibility.disconnect();
      if (current.target) current.target.classList.remove('jsl-reply-highlight');
      current.quote.removeAttribute('data-jsl-reply-active');
    }
    current = null;
    if (host) host.hidden = true;
    request('cancel');
  }
  function dismiss() {
    const quote = current && current.quote;
    if (current && current.engine === 'react' && current.waiting) scrollTo(current, current.reply);
    clear();
    if (quote && quote.isConnected) quote.focus({ preventScroll: true });
  }
  function highlight(op, node) {
    if (op.target) op.target.classList.remove('jsl-reply-highlight');
    clearTimeout(op.highlightTimer);
    op.target = node; node.classList.add('jsl-reply-highlight');
    op.highlightTimer = setTimeout(function () { node.classList.remove('jsl-reply-highlight'); }, 1800);
  }
  function scrollTo(op, node) {
    const container = node.closest('.chat-message-container,#chatBody');
    if (!container) return false;
    // 페이지 전체 대신 채팅 영역의 스크롤만 이동한다.
    container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight * 0.35;
    highlight(op, node);
    return true;
  }
  function fail(op, reason) {
    if (!valid(op)) { if (current === op) clear(); return; }
    op.waiting = false;
    if (op.engine === 'react') scrollTo(op, op.reply);
    op.deleted = reason === 'deleted';
    state(op, 'error', op.deleted ? '삭제된 원본 메시지입니다' : reason === 'changed' ? '채팅방이 변경되었습니다' : '원본을 불러오지 못했어요');
  }
  function returnToReply() {
    const op = current;
    if (!op || !valid(op)) { clear(); return; }
    op.waiting = false;
    clear();
    scrollTo(op, op.reply);
    // 복귀 완료 안내를 계속 남기지 않고 대화에 포커스를 돌려준다.
    op.quote.focus({ preventScroll: true });
  }
  async function activate(quote) {
    if (current && current.quote === quote && current.waiting) return;
    clear();
    const panel = quote.closest('.chat-container.chat-window,#chatBody'), reply = quote.closest('.message-content[message_id],[id^="chat-message-"]');
    const replyId = reply && Number(reply.getAttribute('message_id') || reply.id.slice(13));
    if (!panel || !Number.isSafeInteger(replyId) || replyId <= 0) return;
    const container = reply.closest('.chat-message-container,#chatBody');
    if (!container) return;
    const op = { panel: panel, reply: reply, quote: quote, container: container, replyId: replyId, waiting: true, targetId: null, deadline: 0 };
    op.engine = panel.id === 'chatBody' ? 'react' : 'angular';
    op.roomClass = Array.from(panel.classList).find(function (c) { return /^chatBody-\d+$/.test(c); });
    current = op; ensureUI(); host.hidden = false; quote.setAttribute('data-jsl-reply-active', 'true');
    state(op, 'loading', '원본 찾는 중');
    op.resize = new ResizeObserver(function () { if (valid(op)) place(op); });
    op.resize.observe(container);
    if (op.engine === 'react') {
      // 상위 문서에서 iframe을 숨긴 경우도 교차 영역으로 감지한다.
      op.visibility = new IntersectionObserver(function (entries) {
        if (current === op && !entries[0].isIntersecting) clear();
      });
      op.visibility.observe(panel);
    }
    op.poll = setInterval(function () {
      if (!valid(op)) { if (current === op) clear(); return; }
      if (!op.waiting || !op.targetId) return;
      const node = message(panel, op.targetId);
      if (node) {
        op.waiting = false;
        if (node.matches('.deleted-message') || node.closest('.message-wrapper.deleted-message')) { fail(op, 'deleted'); return; }
        state(op, 'ready', '원본 메시지로 이동했습니다'); scrollTo(op, node);
      } else if (Date.now() > op.deadline) fail(op, 'timeout');
      else if (op.engine === 'react') loadOlder(op);
    }, 250);
    if (quote.querySelector('.deleted-message')) { fail(op, 'deleted'); return; }
    const result = await request('resolveReply', { replyId: replyId });
    if (!valid(op)) { if (current === op) clear(); return; }
    if (!result.ok) { fail(op, result.reason); return; }
    // ID와 방 연결 검증은 MAIN에서 수행한다. 원본 텍스트를 외부로 전송하지 않는다.
    op.deadline = Date.now() + (op.engine === 'react' ? 45000 : 12000);
    state(op, 'loading', '이전 대화 불러오는 중');
    const moved = await request('jump', result);
    if (!valid(op)) { if (current === op) clear(); return; }
    if (!moved.ok) { fail(op, moved.reason); return; }
    op.targetId = result.targetId;
  }
  function loadOlder(op) {
    const now = Date.now();
    if (now < (op.nextLoad || 0)) return;
    op.nextLoad = now + 750;
    const ids = Array.from(op.panel.querySelectorAll('[id^="chat-message-"]')).map(function (node) { return Number(node.id.slice(13)); }).filter(function (id) { return Number.isSafeInteger(id) && id > 0; });
    const oldest = ids.length ? Math.min.apply(null, ids) : 0;
    if (!oldest || oldest > op.replyId) { fail(op, 'unavailable'); return; }
    if (oldest !== op.oldest) { op.oldest = oldest; op.progressAt = now; op.pages = (op.pages || 0) + 1; }
    // 텍스트로 원본을 추정하거나 차단 메시지·React 메시지 캐시를 변경하지 않는다.
    // 기존 스크롤 로더를 사용해 사이트의 표시 방식과 사용자 필터를 유지한다.
    if (oldest < op.targetId || now - op.progressAt > 8000 || op.pages > 30) { fail(op, 'unavailable'); return; }
    op.container.scrollTop = 0;
  }
  function handle(event) {
    const quote = event.target.closest && event.target.closest(quoteSelector);
    if (!quote) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.type === 'click' && document.getSelection().toString().trim()) return;
    event.preventDefault(); event.stopImmediatePropagation(); // 원본의 말풍선 신고 토글과 겹치지 않게 한다.
    activate(quote);
  }
  document.addEventListener('click', handle, true);
  document.addEventListener('keydown', handle, true);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && current) dismiss(); }, true);
  window.addEventListener('popstate', clear);
  window.addEventListener('JSL_CHAT_TOOLS_OPEN', dismiss);
  window.addEventListener('pagehide', clear);
  window.addEventListener('resize', function () { if (current) { if (valid(current)) place(current); else clear(); } });
  const observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) {
        if (node.nodeType === 1 && (node.closest('.chat-ctrl,#chatBody') || node.matches('.chat-ctrl,#chatBody') || node.querySelector('.chat-ctrl,#chatBody'))) decorate(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  decorate(document);
})();
