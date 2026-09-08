// 현재 방의 내 메시지 / 참여 중인 채팅방 빠른 이동. 별도 서버·영구 저장 없음.
(function () {
  'use strict';
  if (window.__jslChatTools) return;
  window.__jslChatTools = true;
  let ctx = null, toolbar = null, overlay = null, ui = null, mode = null;
  let seq = 0, epoch = 0, refreshTimer = null, syncTimer = null, scan = null, anchor = null, angularRoom = 0, syncing = false;
  let items = new Map(), rooms = [], firstDate = '', lastDate = '', locked = [], mineState = 'loading';
  const pending = new Map();
  const resizeObserver = new ResizeObserver(() => position());
  let observedHeader = null;
  const icon = (path) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' + path + '</svg>';
  const mineIcon = icon('<rect x="4" y="3" width="16" height="14" rx="3"/><path d="m8 17-3 4v-5m3-8h8m-8 4h5"/>');
  const roomIcon = icon('<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4 4-4-4 4-4"/>');
  const css = `
    :host{all:initial;display:block;color:#262626;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif}
    :host([hidden]){display:none!important} *{box-sizing:border-box} [hidden]{display:none!important} button,input{font:inherit} button{cursor:pointer;color:inherit} svg{width:17px;height:17px;flex:none}
    button:focus-visible,input:focus-visible{outline:2px solid #b84300;outline-offset:2px} button:disabled{cursor:default;opacity:.55}
    .tools{display:flex;gap:6px;padding:5px 12px;background:#fff;border-top:1px solid #eee}
    .tool{display:flex;align-items:center;justify-content:center;gap:7px;flex:1;min-width:0;min-height:34px;background:transparent;border:0;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap}
    .tool:hover{background:#f1f2f4}.tool[aria-expanded="true"]{background:#fff0e5;color:#a43e00}.tool[aria-expanded="true"] svg{color:#ff6813}
    .panel{display:flex;flex-direction:column;height:100%;background:#fff;border-top:1px solid #d5d5d5;overflow:hidden}
    .heading{display:flex;align-items:center;gap:8px;padding:12px 12px 8px}.heading h2{font-size:15px;line-height:24px;margin:0;flex:1}.back{border:0;background:#f3f3f3;border-radius:6px;width:32px;height:32px;font-size:20px}
    .room-title{margin:0 14px 10px;font-size:12px;color:#626262;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .search{padding:0 12px 10px}.search input{display:block;width:100%;min-width:0;height:38px;border:1px solid #d5d5d5;border-radius:6px;padding:8px 10px;background:#fafafa;color:#262626}
    .summary{padding:0 14px 9px;color:#626262;font-size:11px;line-height:1.6;border-bottom:1px solid #eee;white-space:pre-line}
    .summary-count{font-size:12px;color:#4b4b4b}
    .summary-range{display:block;margin:7px 0 5px;font-size:13px;font-weight:650;color:#262626;line-height:1.55;white-space:normal}
    .summary-range-label{display:block;margin-bottom:2px;font-size:11px;font-weight:500;color:#666}
    .summary-note{font-size:11px;color:#737373}
    .results{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:4px 12px 16px;scrollbar-width:thin;scrollbar-color:#999 transparent}
    .day{position:sticky;top:-4px;margin:0;padding:12px 2px 7px;background:#fff;color:#626262;font-size:11px;font-weight:500;z-index:1}
    .message{display:block;width:100%;margin:0 0 8px;padding:11px 12px;text-align:left;border:1px solid #e2e3e5;border-radius:8px;background:#eceef1}
    .message:hover{border-color:#b9bfc6;background:#e5e8ec}.message .body{display:block;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}
    .meta{display:flex;justify-content:space-between;gap:8px;margin-top:8px;color:#626262;font-size:11px}.jump{color:#a43e00}.deleted{color:#777}
    .room{display:flex;align-items:center;gap:10px;width:100%;min-height:58px;padding:10px 3px;text-align:left;background:#fff;border:0;border-bottom:1px solid #eee}
    .room:hover{background:#f5f5f5}.room[aria-current="true"]{color:#a43e00}.room-symbol{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:8px;background:#eceef1;font-weight:700;color:#626262}.room[aria-current="true"] .room-symbol{background:#fff0e5;color:#b84300}
    .room-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.badge{flex:none;border-radius:4px;background:#fff0e5;color:#a43e00;padding:2px 5px;font-size:11px}.current{font-size:11px;white-space:nowrap;color:#a43e00}
    .empty{margin:24px 0;padding:22px 12px;border:1px dashed #c9cdd2;border-radius:8px;text-align:center;color:#626262;white-space:pre-line;line-height:1.8}
    .bottom{padding:10px 12px 12px;border-top:1px solid #e5e5e5;background:#fff}.more{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-height:38px;background:#fff;border:1px solid #d5d5d5;border-radius:6px;font-weight:600}.more:hover{background:#f5f5f5}.more[data-scanning="true"]{color:#a43e00;border-color:#e9bea2}
    .status{margin:0 0 8px;font-size:11px;color:#626262;line-height:1.6;white-space:pre-line}.status:empty{display:none}
    .panel[data-mode="mine"] .summary{border-bottom:0}
    .panel[data-mode="mine"] .bottom{flex:none;padding:0 12px 12px;border-top:0;border-bottom:1px solid #eee}
    .panel[data-mode="mine"] .more{min-height:42px;background:#fff0e5;border-color:#efbc99;color:#a43e00;font-weight:650}
    .panel[data-mode="mine"] .more:hover{background:#ffe6d5;border-color:#df9f74}
    .panel[data-mode="mine"] .more[data-scanning="true"]{background:#fff;border-color:#df9f74}
    @media(prefers-reduced-motion:no-preference){.tool,.message,.room{transition:background-color 100ms}}
  `;
  function request(action, payload) {
    return new Promise(resolve => {
      const id = ++seq, timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, reason: 'timeout' }); }, 4000);
      pending.set(id, { resolve, timer });
      window.dispatchEvent(new CustomEvent('JSL_CHAT_TOOLS_REQ', { detail: { id, action, payload } }));
    });
  }
  window.addEventListener('JSL_CHAT_TOOLS_RES', event => {
    const d = event.detail || {}, rec = pending.get(d.id);
    if (!rec) return;
    clearTimeout(rec.timer); pending.delete(d.id); rec.resolve(d.result || { ok: false });
  });
  function currentContext() {
    const react = document.getElementById('chatBody');
    if (react) {
      const room = Array.from(react.classList).find(c => /^chatBody-\d+$/.test(c));
      const head = document.querySelector('[data-sentry-component="ChatHeader"]');
      if (room && head) return { panel: react, container: react, header: head, chatId: Number(room.slice(9)), frame: head.parentElement };
    }
    const panel = document.querySelector('.chat-container.chat-window');
    const head = panel && panel.querySelector('.chat-window-head');
    const container = panel && panel.querySelector('.chat-message-container');
    // Angular 방 ID는 MAIN의 참여 방 응답에서 얻는 대신 DOM에 이미 있는 컨테이너 클래스를 쓴다.
    // 기존 Angular는 고정 ID를 노출하지 않으므로 MAIN의 context 요청으로 보완한다.
    if (head && container) return { panel, container, header: head, chatId: angularRoom, frame: panel };
    return null;
  }
  function visible(c) {
    if (!c || !c.panel.isConnected) return false;
    const r = c.panel.getBoundingClientRect(), s = getComputedStyle(c.panel);
    return r.width > 40 && r.height > 40 && r.right > 0 && r.left < innerWidth && s.display !== 'none' && s.visibility !== 'hidden';
  }
  function valid(ticket) { const now = currentContext(); return mode && ticket === epoch && visible(ctx) && now?.panel === ctx.panel && now.chatId === ctx.chatId; }
  function ensureUI() {
    if (toolbar) return;
    toolbar = document.createElement('div'); toolbar.id = 'jsl-chat-tools';
    const sh = toolbar.attachShadow({ mode: 'open' });
    sh.innerHTML = '<style>' + css + '</style><nav class="tools" aria-label="채팅 도구"><button class="tool" data-mode="mine" aria-expanded="false">' + mineIcon + '내 메시지</button><button class="tool" data-mode="rooms" aria-expanded="false">' + roomIcon + '빠른 이동</button></nav>';
    sh.addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) mode === b.dataset.mode ? close() : open(b.dataset.mode); });
    overlay = document.createElement('div'); overlay.id = 'jsl-chat-tools-panel'; overlay.hidden = true;
    overlay.style.cssText = 'position:fixed;z-index:100003;min-width:0;';
    ui = overlay.attachShadow({ mode: 'open' });
    ui.innerHTML = '<style>' + css + '</style><section class="panel" role="region" aria-label="채팅 도구 목록"><div class="heading"><button class="back" aria-label="대화로 돌아가기">‹</button><h2></h2></div><p class="room-title"></p><div class="search"><input type="search" autocomplete="off" spellcheck="false"></div><div class="summary"></div><div class="results"></div><div class="bottom"><p class="status" role="status" aria-live="polite"></p><button class="more"></button></div></section>';
    ui.querySelector('.back').onclick = () => close();
    ui.querySelector('input').oninput = () => render();
    ui.querySelector('.more').onclick = () => mode === 'rooms' ? loadRooms() : scan ? stopScan('탐색을 멈췄습니다.') : mineState !== 'ready' ? collect(epoch) : loadOlder();
    ui.querySelector('.results').onclick = e => {
      const b = e.target.closest('button[data-id]');
      if (b) mode === 'mine' ? jump(Number(b.dataset.id)) : switchRoom(Number(b.dataset.id));
    };
    ui.querySelector('.results').onkeydown = e => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const buttons = [...ui.querySelectorAll('.results button')], index = buttons.indexOf(ui.activeElement);
      const next = buttons[index + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
    };
    document.body.appendChild(overlay);
  }
  function status(text) { if (ui) ui.querySelector('.status').textContent = text; }
  function lockNative() {
    for (const el of ctx.frame.children) {
      if (el === ctx.header || el === overlay || el.contains(toolbar)) continue;
      locked.push({ el, inert: el.inert }); el.inert = true;
    }
  }
  function unlockNative() { locked.forEach(({ el, inert }) => { el.inert = inert; }); locked = []; }
  function position() {
    if (!mode || !visible(ctx)) return;
    const r = ctx.container.getBoundingClientRect(), top = toolbar.getBoundingClientRect().bottom;
    const bottom = Math.min(innerHeight, ctx.frame.getBoundingClientRect().bottom);
    Object.assign(overlay.style, { left: Math.max(0, r.left) + 'px', top: top + 'px', width: Math.min(r.width, innerWidth - r.left) + 'px', height: Math.max(0, bottom - top) + 'px' });
  }
  function captureAnchor() {
    const c = ctx.container, top = c.getBoundingClientRect().top;
    const nodes = [...c.querySelectorAll('[id^="chat-message-"],.message-content[message_id]')];
    const node = nodes.find(n => n.getBoundingClientRect().bottom > top);
    return { node, offset: node ? node.getBoundingClientRect().top - top : 0, scrollTop: c.scrollTop, container: c };
  }
  function restoreAnchor() {
    if (!anchor || !anchor.container.isConnected) return;
    if (anchor.node?.isConnected) anchor.container.scrollTop += anchor.node.getBoundingClientRect().top - anchor.container.getBoundingClientRect().top - anchor.offset;
    else anchor.container.scrollTop = anchor.scrollTop;
  }
  function close(focus = true, restore = true) {
    const previous = mode;
    epoch++; if (scan) scan.cancelled = true; scan = null;
    if (restore) restoreAnchor(); anchor = null; mode = null; unlockNative();
    if (overlay) overlay.hidden = true;
    if (toolbar) toolbar.shadowRoot.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-expanded', 'false'));
    items.clear(); rooms = []; firstDate = lastDate = ''; mineState = 'loading';
    if (ui) { ui.querySelector('.results').replaceChildren(); status(''); }
    if (focus && previous && toolbar?.isConnected) toolbar.shadowRoot.querySelector('[data-mode="' + previous + '"]').focus();
  }
  async function open(next) {
    close(false);
    if (!visible(ctx)) return;
    mode = next; const ticket = ++epoch;
    ensureUI(); overlay.hidden = false; anchor = captureAnchor(); lockNative();
    // 탐색 버튼은 조회 범위 바로 다음에 둔다. 키보드 읽기 순서도 시각적 순서와 맞춘다.
    const panel = ui.querySelector('.panel'), actions = ui.querySelector('.bottom');
    panel.dataset.mode = next;
    if (next === 'mine') panel.insertBefore(actions, ui.querySelector('.results'));
    else panel.appendChild(actions);
    // 원본 이동 안내와 탐색이 동시에 스크롤을 조작하지 않게 한다.
    window.dispatchEvent(new CustomEvent('JSL_CHAT_TOOLS_OPEN'));
    toolbar.shadowRoot.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.mode === mode)));
    ui.querySelector('h2').textContent = next === 'mine' ? '내 메시지' : '채팅방 빠른 이동';
    const title = ctx.header.querySelector('a[href*="/companies/"],.chat-head-title');
    ui.querySelector('.room-title').textContent = title?.textContent.trim() || '현재 채팅방';
    const input = ui.querySelector('input'); input.value = ''; input.placeholder = next === 'mine' ? '내 메시지 내용 검색' : '참여 중인 채팅방 검색'; input.setAttribute('aria-label', input.placeholder);
    ui.querySelector('.more').disabled = false; ui.querySelector('.more').dataset.scanning = 'false';
    position(); render(); input.focus(); status('불러오는 중…');
    if (next === 'mine') { const ok = await collect(ticket); if (valid(ticket)) status(ok ? '' : '메시지를 읽지 못했습니다. 확장 프로그램과 페이지를 새로고침해 주세요.'); }
    else await loadRooms();
  }
  function formatDay(value) {
    const d = new Date(value);
    return value && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '현재 불러온 대화';
  }
  function render() {
    if (!mode || !ui) return;
    const query = ui.querySelector('input').value.trim().toLocaleLowerCase(), results = ui.querySelector('.results');
    const scroll = results.scrollTop, fragment = document.createDocumentFragment();
    let count = 0;
    if (mode === 'mine') {
      let day = '';
      const sorted = [...items.values()].sort((a, b) => b.id - a.id);
      for (const m of sorted) {
        if (query && !m.text.toLocaleLowerCase().includes(query)) continue;
        const date = formatDay(m.date);
        if (date !== day) { const heading = document.createElement('h3'); heading.className = 'day'; heading.textContent = date; fragment.appendChild(heading); day = date; }
        const b = document.createElement('button'); b.className = 'message'; b.dataset.id = m.id;
        const body = document.createElement('span'); body.className = 'body' + (m.deleted ? ' deleted' : ''); body.textContent = m.text;
        const meta = document.createElement('span'); meta.className = 'meta';
        const time = document.createElement('span'), jump = document.createElement('span');
        time.textContent = m.date && !Number.isNaN(new Date(m.date).valueOf()) ? new Date(m.date).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        jump.className = 'jump'; jump.textContent = '대화에서 보기 ↗'; meta.append(time, jump); b.append(body, meta); fragment.appendChild(b); count++;
      }
      const summary = ui.querySelector('.summary');
      const total = document.createElement('div'); total.className = 'summary-count';
      total.textContent = '확인한 내 메시지 ' + items.size + '개' + (query ? ' · 검색 ' + count + '개' : '');
      const range = document.createElement('div'); range.className = 'summary-range';
      const label = document.createElement('span'); label.className = 'summary-range-label'; label.textContent = '조회한 대화 기간';
      range.append(label, document.createTextNode(firstDate ? formatDay(firstDate) + ' ~ ' + formatDay(lastDate) : '현재 불러온 대화 기준'));
      const note = document.createElement('div'); note.className = 'summary-note'; note.textContent = '전체 기록이 아닐 수 있습니다';
      summary.replaceChildren(total, range, note);
      if (mineState !== 'ready') ui.querySelector('.summary').textContent = mineState === 'loading' ? '현재 대화를 확인하는 중…' : '메시지 확인 범위를 읽을 수 없습니다.';
    } else {
      for (const room of rooms) {
        if (query && !room.title.toLocaleLowerCase().includes(query)) continue;
        const b = document.createElement('button'); b.className = 'room'; b.dataset.id = room.id; b.setAttribute('aria-current', String(room.id === ctx.chatId));
        const symbol = document.createElement('span'); symbol.className = 'room-symbol'; symbol.textContent = room.title.slice(0, 1);
        const name = document.createElement('span'); name.className = 'room-name'; name.textContent = room.title; name.title = room.title;
        b.append(symbol, name);
        if (room.id === ctx.chatId || room.unread) { const tag = document.createElement('span'); tag.className = room.id === ctx.chatId ? 'current' : 'badge'; tag.textContent = room.id === ctx.chatId ? '현재 방' : String(Math.min(room.unread, 99)) + (room.unread > 99 ? '+' : ''); b.appendChild(tag); }
        fragment.appendChild(b); count++;
      }
      ui.querySelector('.summary').textContent = '참여 중인 방 ' + rooms.length + '개' + (query ? ' · 검색 ' + count + '개' : '') + ' · 선택하면 바로 이동';
    }
    if (!count) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = mode === 'mine' && mineState !== 'ready' ? (mineState === 'loading' ? '내 메시지를 불러오는 중입니다.' : '메시지를 불러오지 못했습니다.\n다시 불러오거나 대화로 돌아가 주세요.') : query ? '검색 결과가 없습니다.' : mode === 'mine' ? '현재 확인한 대화에는 내 메시지가 없습니다.\n이전 메시지를 더 찾아보세요.' : '불러온 채팅방이 없습니다.\n목록을 새로고침해 주세요.'; fragment.appendChild(empty); }
    results.replaceChildren(fragment); results.scrollTop = scroll;
    ui.querySelector('.more').textContent = mode === 'rooms' ? '방 목록 새로고침' : scan ? '탐색 멈추기' : mineState === 'error' ? '다시 불러오기' : '이전 메시지 더 찾기';
    ui.querySelector('.more').disabled = mode === 'mine' && mineState === 'loading';
  }
  async function collect(ticket) {
    const result = await request('mine', { chatId: ctx.chatId });
    if (!valid(ticket)) return false;
    if (!result.ok) { mineState = 'error'; items.clear(); render(); status('메시지를 읽지 못했습니다. 확장 프로그램과 페이지를 새로고침해 주세요.'); return false; }
    if (mineState !== 'ready') status('');
    mineState = 'ready';
    result.messages.forEach(m => items.set(m.id, m));
    if (result.firstDate && (!firstDate || result.firstDate < firstDate)) firstDate = result.firstDate;
    if (result.lastDate && (!lastDate || result.lastDate > lastDate)) lastDate = result.lastDate;
    render(); return result;
  }
  async function loadRooms() {
    const ticket = epoch;
    status('참여 중인 방을 불러오는 중…');
    const result = await request('rooms', { chatId: ctx.chatId });
    if (!valid(ticket)) return;
    rooms = result.ok ? result.rooms : [];
    render(); status(result.ok ? '' : '방 목록을 읽지 못했습니다. 확장 프로그램과 페이지를 새로고침해 주세요.');
  }
  async function switchRoom(id) {
    if (id === ctx.chatId) { close(); return; }
    const ticket = epoch, from = ctx.chatId;
    stopScan(''); status('채팅방으로 이동하는 중…');
    const result = await request('switch', { chatId: from, targetId: id });
    if (ticket !== epoch) return;
    if (!result.ok) { status('채팅방을 열지 못했습니다. 목록을 새로고침한 뒤 다시 선택해 주세요.'); return; }
    // 성공 응답만으로 완료로 간주하지 않고 실제 방 ID 변경을 기다린다.
    const deadline = Date.now() + 6000;
    while (ticket === epoch && Date.now() < deadline) {
      if (currentContext()?.chatId === id) { close(false, false); sync(); return; }
      await new Promise(r => setTimeout(r, 100));
    }
    if (ticket === epoch) status('방 전환을 확인하지 못했습니다. 다시 선택해 주세요.');
  }
  function findMessage(id) { return ctx.container.querySelector('[id="chat-message-' + id + '"],.message-content[message_id="' + id + '"]'); }
  function jump(id) {
    const node = findMessage(id);
    if (!node) { status('이 메시지가 화면에서 내려갔습니다. 내 메시지를 다시 열어 목록을 갱신해 주세요.'); return; }
    const container = ctx.container; close(false, false);
    container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight * .3;
    node.classList.add('jsl-reply-highlight'); setTimeout(() => node.classList.remove('jsl-reply-highlight'), 1800);
    const oldTab = node.getAttribute('tabindex'); node.tabIndex = -1; node.focus({ preventScroll: true });
    node.addEventListener('blur', () => oldTab == null ? node.removeAttribute('tabindex') : node.setAttribute('tabindex', oldTab), { once: true });
  }
  function stopScan(text) {
    if (scan) scan.cancelled = true;
    scan = null; if (ui) { ui.querySelector('.more').dataset.scanning = 'false'; status(text); render(); }
    restoreAnchor();
  }
  async function loadOlder() {
    const ticket = epoch, op = { cancelled: false }; scan = op;
    ui.querySelector('.more').dataset.scanning = 'true'; render();
    let result = await collect(ticket), oldest = result && Math.min(...result.ids), pages = 0, progressAt = Date.now(), start = Date.now();
    if (!valid(ticket) || scan !== op) return;
    if (!result || !result.ids.length) { stopScan('대화를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
    while (valid(ticket) && scan === op && !op.cancelled) {
      if (Date.now() - start > 45000 || pages >= 30) { stopScan('이번 탐색을 마쳤습니다. 더 찾으려면 다시 눌러 주세요.'); return; }
      if (Date.now() - progressAt > 8000) { stopScan('더 이전 대화를 불러오지 못했습니다. 대화의 시작이거나 로딩이 지연될 수 있습니다.'); return; }
      status('이전 대화 탐색 중 · ' + pages + '회 추가 로딩 · 내 메시지 ' + items.size + '개');
      // 스크롤 0에 머무를 때도 원본 로더가 다시 관찰할 수 있도록 작은 왕복을 허용한다.
      if (ctx.container.scrollTop === 0) { ctx.container.scrollTop = 1; await new Promise(r => setTimeout(r, 80)); }
      if (!valid(ticket) || scan !== op) return;
      ctx.container.scrollTop = 0;
      await new Promise(r => setTimeout(r, 750));
      if (!valid(ticket) || scan !== op) return;
      result = await collect(ticket);
      if (!valid(ticket) || scan !== op) return;
      if (!result) { stopScan('대화를 읽지 못해 탐색을 멈췄습니다.'); return; }
      const next = Math.min(...result.ids);
      if (next < oldest) { oldest = next; pages++; progressAt = Date.now(); }
    }
  }
  async function sync() {
    syncTimer = null;
    if (syncing) { scheduleSync(); return; }
    syncing = true;
    try {
    if (!document.getElementById('chatBody') && document.querySelector('.chat-container.chat-window')) {
      const result = await request('context', {});
      angularRoom = result.ok ? result.chatId : 0;
    }
    const next = currentContext();
    if (!visible(next) || !next.chatId) { close(false); toolbar?.remove(); resizeObserver.disconnect(); observedHeader = null; ctx = null; return; }
    if (ctx && (next.panel !== ctx.panel || next.chatId !== ctx.chatId)) close(false, false);
    ctx = next; ensureUI();
    if (toolbar.parentElement !== ctx.header) ctx.header.appendChild(toolbar);
    if (observedHeader !== ctx.header) { resizeObserver.disconnect(); resizeObserver.observe(ctx.header); resizeObserver.observe(ctx.frame); observedHeader = ctx.header; }
    if (mode) position();
    } finally { syncing = false; }
  }
  function scheduleSync() { if (!syncTimer) syncTimer = setTimeout(sync, 80); }
  function chatMutation(record) {
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    if (target === document.body || target?.closest('.chat-ctrl,.chat-container.chat-window,#chatBody,[data-sentry-component="ChatHeader"]')) return true;
    return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
      (node.matches('.chat-ctrl,.chat-container.chat-window,#chatBody,[data-sentry-component="ChatHeader"]') || node.querySelector('.chat-container.chat-window,#chatBody,[data-sentry-component="ChatHeader"]')));
  }
  const observer = new MutationObserver(records => {
    if (!records.some(r => !toolbar?.contains(r.target) && !overlay?.contains(r.target) && chatMutation(r))) return;
    scheduleSync();
    if (mode === 'mine' && !scan && !refreshTimer && records.some(r => ctx?.container.contains(r.target))) {
      refreshTimer = setTimeout(() => { refreshTimer = null; if (mode === 'mine' && !scan) collect(epoch); }, 250);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mode) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  document.addEventListener('click', e => {
    if (mode && ctx.header.contains(e.target) && !e.composedPath().includes(toolbar)) close(false);
  }, true);
  window.addEventListener('resize', scheduleSync);
  window.addEventListener('popstate', () => { close(false, false); scheduleSync(); });
  window.addEventListener('pagehide', () => close(false, false));
  document.addEventListener('visibilitychange', () => {
    // Alt+Tab·탭 전환은 목록을 닫는 동작이 아니다. 탐색만 멈추고 검색·목록 위치를 보존한다.
    if (document.hidden) {
      if (scan) stopScan('창 전환으로 탐색을 멈췄습니다. 더 찾으려면 다시 눌러 주세요.');
    } else scheduleSync();
  });
  const visibility = new IntersectionObserver(entries => {
    // 백그라운드 전환과 사이트가 실제로 채팅 프레임을 닫는 경우를 구분한다.
    if (!document.hidden && !entries[0].isIntersecting) close(false);
  });
  // iframe 전체가 닫히는 경우에도 탐색을 정리한다.
  visibility.observe(document.body);
  sync();
})();
