JSL.register('gpt-connect', function () {
  'use strict';
  const documentKey = crypto.randomUUID();
  let busy = false;
  const onResume = id => location.pathname.match(/^\/resume\/(\d+)\/?$/)?.[1] === String(id);
  const validPage = packet => onResume(packet.resumeId);
  // 되돌리기 — 우리가 써넣은 값이 그대로 남아 있는 문항만 입력 직전 값으로 되돌린다.
  // 그 사이 사용자가 자소설에서 직접 고친 문항은 건드리지 않는다. 빈 답변으로도 되돌려야 하므로
  // 일괄 입력(applyGptAnswers)이 아니라 문항 단위 setAnswer를 쓴다.
  async function revert(message) {
    if (message.documentKey !== documentKey || !onResume(message.resumeId)) throw Error('대상 지원서가 이동했습니다. 자소설에서 직접 확인해 주세요.');
    const before = await JSL.getState();
    if (!before) throw Error('되돌리기 전 내용을 확인할 수 없습니다. 자소설에서 직접 확인해 주세요.');
    const kept = [], failed = [], wrote = [];
    for (const item of message.revert) {
      const qna = before.qnas.find(q => String(q.id) === String(item.id));
      if (!qna || Number(qna.number) !== item.number || qna.question !== item.question) { failed.push(item.number); continue; }
      if ((qna.answer || '') !== item.wrote) { kept.push(item.number); continue; }
      const result = await JSL.action('setAnswer', { number: item.number, text: item.text });
      if (result && result.ok) wrote.push(item); else failed.push(item.number);
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    const after = onResume(message.resumeId) ? await JSL.getState() : null;
    const reverted = [], unverified = [];
    for (const item of wrote) {
      const qna = after && after.qnas.find(q => String(q.id) === String(item.id));
      if (qna && (qna.answer || '') === item.text) reverted.push(item.number); else unverified.push(item.number);
    }
    const parts = [];
    if (reverted.length) parts.push('문항 ' + reverted.join(', ') + ' 되돌림');
    if (kept.length) parts.push('문항 ' + kept.join(', ') + ' 유지');
    if (unverified.concat(failed).length) parts.push('문항 ' + unverified.concat(failed).sort((a, b) => a - b).join(', ') + ' 확인 불가');
    const headline = parts.join(' · ') || '되돌릴 내용이 없습니다';
    const detail = kept.length ? '자소설에서 직접 고친 문항은 그대로 두었습니다. 저장 버튼은 누르지 않았습니다.'
      : reverted.length ? '입력 직전 내용으로 되돌렸습니다. 저장 버튼은 누르지 않았습니다.'
        : '지원서에서 현재 내용을 확인해 주세요.';
    const applied = reverted.length > 0 && !unverified.length && !failed.length;
    JSL.emit('toast', { message: headline + ' · ' + detail, kind: applied ? 'ok' : 'fail' });
    return { reverted, kept, headline, detail, applied };
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (message.type === 'gpt:state') {
      JSL.getState().then(state => reply({ state, documentKey }), () => reply({ state: null, documentKey }));
      return true;
    }
    if (message.type !== 'gpt:write' && message.type !== 'gpt:undo' && message.type !== 'gpt:review-question') return;
    (async function () {
      if (busy) throw Error('다른 답변을 입력 중입니다.');
      busy = true;
      try {
        if (message.type === 'gpt:review-question') {
          if (message.documentKey !== documentKey || !onResume(message.resumeId)) throw Error('대상 지원서가 이동했습니다.');
          const expected = message.question;
          const matches = state => state?.qnas?.find(q => String(q.id) === String(expected?.id) &&
            q.number === expected.number && q.question === expected.question);
          if (!matches(await JSL.getState())) throw Error('확인할 문항이 변경되었습니다. 지원서에서 직접 확인해 주세요.');
          const switched = await JSL.action('switchQna', { number: expected.number });
          await new Promise(resolve => setTimeout(resolve, 120));
          const active = matches(await JSL.getState());
          if (!onResume(message.resumeId) || !switched?.ok || !active?.active) throw Error('지원서 탭은 열었지만 해당 문항으로 이동하지 못했습니다.');
          JSL.emit('focus:answer', { number: expected.number });
          return { focused: true };
        }
        if (message.type === 'gpt:undo') return await revert(message);
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
        // headline/detail은 ChatGPT 패널이 두 줄로 나눠 쓴다. status는 토스트 한 줄이라 기존 문장을 유지한다.
        const headline = applied ? '문항 ' + verified.join(', ') + ' 입력 확인' :
          (result.ok ? '반영 불일치' : '입력 처리 오류') + ' · 입력 확인 ' + verified.length + '/' + packet.answers.length + '문항';
        const detail = applied ? '저장 버튼은 누르지 않았습니다. 지원서에서 확인하고 직접 저장하세요.' :
          '지원서에서 현재 내용을 확인해 주세요.';
        const status = applied ? headline + ' · 저장 버튼은 누르지 않았습니다.' : headline + ' · ' + detail;
        JSL.emit('toast', { message: status, kind: applied ? 'ok' : 'fail' });
        return { verified, total: packet.answers.length, status, headline, detail, applied };
      } finally { busy = false; }
    })().then(reply, e => reply({ applied: false, error: e.message }));
    return true;
  });
});
