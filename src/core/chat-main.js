// MAIN: 답글 ID를 원본 ID로 해석하고 사이트의 기존 메시지 이동에 연결한다.
// 목록/편집기 액션과 응답이 충돌하지 않도록 별도 이벤트 채널을 사용한다.
(function () {
  'use strict';
  const targets = new Map();
  let generation = 0;
  function positiveId(value) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER - 2 ? n : null;
  }
  function context() {
    const el = document.querySelector('[ng-controller="ChatCtrl"]');
    if (!el || !window.angular) return null;
    const scope = window.angular.element(el).scope();
    const panel = el.querySelector('.chat-container.chat-window');
    const chatId = scope && positiveId(scope.current_chat && scope.current_chat.id);
    if (!panel || !chatId || !scope.is_open_chat) return null;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 40 || rect.right < 40 || rect.left >= innerWidth - 40 ||
        getComputedStyle(panel).display === 'none') return null;
    return { scope: scope, panel: panel, chatId: chatId };
  }
  function message(ctx, id) { return ctx.panel.querySelector('.message-content[message_id="' + id + '"]'); }
  function same(ctx) {
    const now = context();
    return now && now.scope === ctx.scope && now.chatId === ctx.chatId && now.panel === ctx.panel;
  }
  async function resolveReply(payload, ticket) {
    const ctx = context(), replyId = positiveId(payload.replyId);
    if (!ctx || !replyId) return { ok: false, reason: 'unavailable' };
    const node = message(ctx, replyId);
    if (!node || !node.querySelector('.message_target-message')) return { ok: false, reason: 'unavailable' };
    if (node.querySelector('.message_target-message .deleted-message')) return { ok: false, reason: 'deleted' };
    // HTML에는 답글 자신의 ID만 있다. 정확히 그 답글을 조회해 원본 ID를 얻는다.
    // 이름/문구 검색으로 다른 메시지를 원본이라고 추정하지 않는다.
    const http = window.angular.element(document.querySelector('[ng-controller="ChatCtrl"]')).injector().get('$http');
    const response = await http.get('/api/v2/chats/' + ctx.chatId + '/messages', {
      params: { first_message_id: Math.max(0, replyId - 2), last_message_id: replyId + 1, order: 'asc' },
      timeout: 8000
    });
    if (ticket !== generation || !same(ctx) || !node.isConnected) return { ok: false, reason: 'changed' };
    const reply = Array.isArray(response.data) && response.data.find(function (m) { return Number(m.id) === replyId; });
    const target = reply && reply.target_message;
    const targetId = target && positiveId(target.id);
    if (!targetId || targetId === replyId || (reply.chat_id != null && Number(reply.chat_id) !== ctx.chatId) ||
        (target.chat_id != null && Number(target.chat_id) !== ctx.chatId)) return { ok: false, reason: 'unavailable' };
    if (target.remove_status != null && Number(target.remove_status) !== 1) return { ok: false, reason: 'deleted' };
    targets.clear(); // 현재 사용자가 선택한 답글 한 건만 유지한다. 본문은 보관하지 않는다.
    targets.set(ctx.chatId + ':' + replyId, { targetId: targetId, scope: ctx.scope });
    return { ok: true, chatId: ctx.chatId, replyId: replyId, targetId: targetId };
  }
  function jump(payload) {
    const ctx = context(), replyId = positiveId(payload.replyId), targetId = positiveId(payload.targetId);
    const approved = ctx && targets.get(ctx.chatId + ':' + replyId);
    if (!ctx || Number(payload.chatId) !== ctx.chatId || !approved || approved.scope !== ctx.scope ||
        approved.targetId !== targetId || !message(ctx, replyId)) return { ok: false, reason: 'changed' };
    if (!message(ctx, targetId)) {
      // 원본 검색 결과/알림과 같은 로딩·이동 경로. 답변/메시지를 쓰는 API는 호출하지 않는다.
      const invoke = function () {
        ctx.scope.$broadcast('open-chat-message', { chatId: ctx.chatId, messageId: targetId, skipOpenChatroom: true });
      };
      if (ctx.scope.$root.$$phase) invoke();
      else ctx.scope.$apply(invoke);
    }
    return { ok: true };
  }
  window.addEventListener('JSL_CHAT_REQ', function (event) {
    const d = event.detail || {}, payload = d.payload || {};
    if (payload.engine === 'react') return;
    if (!['resolveReply', 'jump', 'cancel'].includes(d.action)) return;
    const ticket = d.action === 'resolveReply' || d.action === 'cancel' ? ++generation : generation;
    if (d.action === 'resolveReply') targets.clear();
    Promise.resolve().then(function () {
      if (d.action === 'cancel') { targets.clear(); return { ok: true }; }
      return d.action === 'resolveReply' ? resolveReply(payload, ticket) : jump(payload);
    }).catch(function () { return { ok: false, reason: 'network' }; }).then(function (result) {
      window.dispatchEvent(new CustomEvent('JSL_CHAT_RES', { detail: { id: d.id, result: result } }));
    });
  });
})();
