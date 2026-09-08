// 채팅 도구 전용 MAIN 브리지. 본문은 현재 렌더된 내 메시지만, 방은 참여 목록만 읽는다.
(function () {
  'use strict';
  if (window.__jslChatToolsMain) return;
  window.__jslChatToolsMain = true;
  let requireNative = null, store = null;
  const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  function reactStore() {
    if (store) return store;
    const chunks = window.webpackChunk_N_E;
    if (!Array.isArray(chunks)) return null;
    if (!requireNative) {
      // 공개 클라이언트의 런타임을 얻되 기존 모듈·캐시를 덮어쓰지 않는다.
      chunks.push([['jsl-chat-tools-runtime'], {}, function (require) { requireNative = require; }]);
    }
    if (!requireNative || !requireNative.m) return null;
    // 배포마다 바뀌는 모듈 번호 대신 확인한 채팅 저장소의 메서드 조합으로 좁힌다.
    const matches = Object.keys(requireNative.m).filter(key => {
      const source = String(requireNative.m[key]);
      return ['setRoomInfo(', 'setMyChats(', 'setBeforeChatRoom(', 'setTargetMessage('].every(part => source.includes(part));
    });
    if (matches.length !== 1) return null;
    const candidate = requireNative(matches[0]).default;
    if (!candidate || !Array.isArray(candidate.myChats) ||
        !['setRoomInfo', 'setPage', 'setTargetMessage', 'setIsOpenChatContentSearch'].every(k => typeof candidate[k] === 'function')) return null;
    store = candidate;
    return store;
  }
  function visible(panel) {
    if (!panel || !panel.isConnected) return false;
    const r = panel.getBoundingClientRect(), s = getComputedStyle(panel);
    return r.width > 40 && r.height > 40 && r.right > 0 && r.left < innerWidth &&
      s.display !== 'none' && s.visibility !== 'hidden';
  }
  function context() {
    const panel = document.getElementById('chatBody');
    if (panel) {
      const room = Array.from(panel.classList).find(c => /^chatBody-\d+$/.test(c));
      if (!visible(panel) || !room) return null;
      return { engine: 'react', panel, chatId: positive(room.slice(9)) };
    }
    const el = document.querySelector('[ng-controller="ChatCtrl"]');
    const scope = el && window.angular && window.angular.element(el).scope();
    const container = el && el.querySelector('.chat-container.chat-window');
    if (!scope || !scope.is_open_chat || !visible(container)) return null;
    return { engine: 'angular', panel: container, scope, chatId: positive(scope.current_chat && scope.current_chat.id) };
  }
  function messageProps(node, id) {
    const key = Object.keys(node).find(k => k.startsWith('__reactProps$'));
    function find(p, depth) {
      if (!p || depth > 3) return null;
      if (p.message && positive(p.message.id) === id) return p.message;
      for (const child of Array.isArray(p.children) ? p.children : [p.children]) {
        const value = child && typeof child === 'object' && find(child.props, depth + 1);
        if (value) return value;
      }
      return null;
    }
    return key ? find(node[key], 0) : null;
  }
  function snapshot(ctx) {
    const messages = [], ids = [], dates = [];
    let inspected = 0;
    if (ctx.engine === 'react') {
      for (const node of ctx.panel.querySelectorAll('[id^="chat-message-"]')) {
        const id = positive(node.id.slice(13));
        if (!id) continue;
        ids.push(id);
        const m = messageProps(node, id);
        if (!m || !['self', 'other', 'channelChat'].includes(m.type) || (m.chat_id != null && Number(m.chat_id) !== ctx.chatId)) continue;
        inspected++;
        if (typeof m.created_at === 'string') dates.push(m.created_at);
        // 닉네임·색깔로 추측하지 않는다. 사이트가 계산한 self 타입을 사용한다.
        if (m.type !== 'self') continue;
        messages.push({ id, text: m.remove_status === 1 ? String(m.content || '') : '삭제된 메시지입니다.',
          date: String(m.created_at || ''), deleted: m.remove_status !== 1 });
      }
    } else {
      for (const node of ctx.panel.querySelectorAll('.message-content[message_id]')) {
        const id = positive(node.getAttribute('message_id'));
        if (!id) continue;
        ids.push(id); inspected++;
        if (!node.closest('.send')) continue;
        const copy = node.cloneNode(true);
        copy.querySelectorAll('.message_target-message').forEach(q => q.remove());
        const deleted = node.matches('.deleted-message') || !!node.closest('.deleted-message');
        messages.push({ id, text: deleted ? '삭제된 메시지입니다.' : copy.textContent.trim(), date: '', deleted });
      }
    }
    // 구조 변경으로 읽지 못한 경우를 '내 메시지 0개'로 오인하지 않는다.
    if (ids.length && inspected !== ids.length) return { ok: false, reason: 'structure' };
    dates.sort();
    return { ok: true, chatId: ctx.chatId, messages, ids, firstDate: dates[0] || '', lastDate: dates[dates.length - 1] || '' };
  }
  function rooms(ctx) {
    if (ctx.engine === 'react') {
      const native = reactStore();
      if (!native || Number(native.roomInfo && native.roomInfo.id) !== ctx.chatId) return null;
      return native.myChats;
    }
    const groups = ctx.scope.chat_groups;
    const mine = Array.isArray(groups) && groups.find(group => group.type === 'my');
    return mine && Array.isArray(mine.list) ? mine.list : null;
  }
  function handle(d) {
    const ctx = context(), p = d.payload || {};
    if (d.action === 'context') return ctx && ctx.chatId ? { ok: true, chatId: ctx.chatId } : { ok: false, reason: 'unavailable' };
    if (!ctx || !ctx.chatId || Number(p.chatId) !== ctx.chatId) return { ok: false, reason: 'changed' };
    if (d.action === 'mine') return snapshot(ctx);
    const list = rooms(ctx);
    if (!list) return { ok: false, reason: 'structure' };
    if (d.action === 'rooms') return { ok: true, chatId: ctx.chatId, rooms: list.filter(r => positive(r.id)).map(r => ({
      id: Number(r.id), title: String(r.title || '이름 없는 채팅방'), unread: Math.max(0, Number(r.unread_count) || 0)
    })) };
    const target = list.find(r => Number(r.id) === positive(p.targetId));
    if (!target) return { ok: false, reason: 'unavailable' };
    if (ctx.engine === 'react') {
      store.setIsOpenChatContentSearch(false);
      store.setTargetMessage(null);
      store.setRoomInfo(target);
      store.setPage('chatRoom');
    } else {
      if (typeof ctx.scope.open_chatroom !== 'function') return { ok: false, reason: 'structure' };
      const open = () => ctx.scope.open_chatroom(target);
      if (ctx.scope.$root.$$phase) open(); else ctx.scope.$apply(open);
    }
    return { ok: true, targetId: Number(target.id) };
  }
  window.addEventListener('JSL_CHAT_TOOLS_REQ', event => {
    const d = event.detail || {};
    if (!['context', 'mine', 'rooms', 'switch'].includes(d.action)) return;
    let result;
    try { result = handle(d); } catch (_) { result = { ok: false, reason: 'unavailable' }; }
    window.dispatchEvent(new CustomEvent('JSL_CHAT_TOOLS_RES', { detail: { id: d.id, result } }));
  });
})();
