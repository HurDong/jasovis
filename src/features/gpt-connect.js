JSL.register('gpt-connect', function () {
  'use strict';
  const documentKey = crypto.randomUUID();
  let busy = false;
  const validPage = packet => location.pathname.match(/^\/resume\/(\d+)\/?$/)?.[1] === String(packet.resumeId);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (message.type === 'gpt:state') {
      JSL.getState().then(state => reply({ state, documentKey }), () => reply({ state: null, documentKey }));
      return true;
    }
    if (message.type !== 'gpt:write') return;
    (async function () {
      if (busy) throw Error('다른 답변을 입력 중입니다.');
      busy = true;
      try {
        const packet = message.packet;
        if (message.documentKey !== documentKey || !validPage(packet)) throw Error('대상 지원서가 이동했습니다. 다시 적용해 주세요.');
        globalThis.JSLGpt.validate(packet, await JSL.getState(), true);
        if (!validPage(packet)) throw Error('대상 지원서가 이동했습니다.');
        const result = await JSL.action('applyGptAnswers', packet);
        // 사이트의 입력 후처리가 끝난 뒤 재조회한다. 서버 저장 확인을 뜻하지 않는다.
        await new Promise(resolve => setTimeout(resolve, 120));
        const state = await JSL.getState();
        if (!state) throw Error('입력 후 결과를 확인할 수 없습니다. 지원서에서 현재 내용을 확인해 주세요.');
        if (!validPage(packet)) throw Error('입력 후 지원서가 이동해 결과를 확인할 수 없습니다.');
        globalThis.JSLGpt.validate(packet, state);
        const verified = packet.answers.filter(a => state.qnas.find(q => String(q.id) === String(a.id)).answer === a.text).map(a => a.number);
        const applied = result.ok && verified.length === packet.answers.length;
        const status = applied ? '문항 ' + verified.join(', ') + ' 입력 확인 · 저장 버튼은 누르지 않았습니다.' :
          (result.ok ? '반영 불일치 · ' : '입력 처리 오류 · ') + '입력 확인 ' + verified.length + '/' + packet.answers.length + '문항 · 지원서에서 현재 내용을 확인해 주세요.';
        JSL.emit('toast', { message: status, kind: applied ? 'ok' : 'fail' });
        return { verified, total: packet.answers.length, status, applied };
      } finally { busy = false; }
    })().then(reply, e => reply({ applied: false, error: e.message }));
    return true;
  });
});
