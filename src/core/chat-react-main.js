// React chat-slide: 선택한 메시지 행의 원본 props만 읽는다.
// 과거 대화는 UI 어댑터가 사이트의 기존 스크롤 로더로 불러온다.
(function () {
  'use strict';
  if (window.__jslReactReplyBridge) return;
  window.__jslReactReplyBridge = true;
  let approved = null;
  function id(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
  function context() {
    const panel = document.getElementById('chatBody');
    const room = panel && Array.from(panel.classList).find(function (c) { return /^chatBody-\d+$/.test(c); });
    const chatId = room && id(room.slice(9));
    if (!chatId || !panel.isConnected || panel.getBoundingClientRect().width < 40) return null;
    return { panel: panel, chatId: chatId };
  }
  function row(ctx, messageId) { return ctx.panel.querySelector('[id="chat-message-' + messageId + '"]'); }
  function nativeMessage(node, replyId) {
    const key = Object.keys(node).find(function (k) { return k.startsWith('__reactProps$'); });
    // 실제 사이트의 행은 <ChatBody_Message message={message} />를 자식으로 둔다.
    // 해당 행의 JSX 자식만 제한적으로 확인하며 다른 상태는 탐색하지 않는다.
    function find(props, depth) {
      if (!props || depth > 3) return null;
      if (props.message && id(props.message.id) === replyId) return props.message;
      const children = Array.isArray(props.children) ? props.children : [props.children];
      for (const child of children) {
        const found = child && typeof child === 'object' && find(child.props, depth + 1);
        if (found) return found;
      }
      return null;
    }
    return key ? find(node[key], 0) : null;
  }
  window.addEventListener('JSL_CHAT_REQ', function (event) {
    const d = event.detail || {}, payload = d.payload || {};
    if (payload.engine !== 'react' || !['resolveReply', 'jump', 'cancel'].includes(d.action)) return;
    let result = { ok: false, reason: 'unavailable' };
    try {
      if (d.action === 'cancel') { approved = null; result = { ok: true }; }
      else {
        const ctx = context(), replyId = id(payload.replyId), node = ctx && replyId && row(ctx, replyId);
        if (d.action === 'resolveReply') {
          approved = null;
          const message = node && node.querySelector('blockquote') && nativeMessage(node, replyId);
          const target = message && message.target_message, targetId = target && id(target.id);
          if (targetId && targetId !== replyId &&
              (message.chat_id == null || id(message.chat_id) === ctx.chatId) &&
              (target.chat_id == null || id(target.chat_id) === ctx.chatId)) {
            if (target.remove_status != null && Number(target.remove_status) !== 1) result = { ok: false, reason: 'deleted' };
            else {
              approved = { panel: ctx.panel, chatId: ctx.chatId, replyId: replyId, targetId: targetId, node: node };
              result = { ok: true, chatId: ctx.chatId, replyId: replyId, targetId: targetId };
            }
          }
        } else if (approved && ctx && ctx.panel === approved.panel && ctx.chatId === approved.chatId &&
            id(payload.chatId) === ctx.chatId && replyId === approved.replyId && node === approved.node &&
            id(payload.targetId) === approved.targetId) result = { ok: true };
        else result = { ok: false, reason: 'changed' };
      }
    } catch (_) { result = { ok: false, reason: 'unavailable' }; }
    window.dispatchEvent(new CustomEvent('JSL_CHAT_RES', { detail: { id: d.id, result: result } }));
  });
})();
