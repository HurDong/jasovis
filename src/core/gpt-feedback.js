// 답변에서 고른 곳 하나에 대한 질문 요청과 응답 판독 계약. DOM이나 저장소에 의존하지 않는다.
(function (root) {
  'use strict';
  const fail = text => { throw Error(text); };
  const MARK = '[자비스 요청]';
  const LIMIT = { answer: 100000, quote: 8000, request: 4000, replacement: 8000 };
  // 사이트 모델에는 서버가 준 CRLF가 남아 있을 수 있고, textarea는 LF로 보여준다. Angular ng-model은
  // 입력칸 값을 앞뒤 공백을 잘라 모델에 올린다. 이 두 차이만 같은 답변으로 본다. 위치는 항상 입력칸 기준이다.
  const lf = text => String(text || '').replace(/\r\n?/g, '\n');
  function sameAnswer(model, view) {
    const a = lf(model), b = String(view ?? '');
    return a === b || a.trim() === b.trim();
  }
  function current(state) {
    const active = state?.qnas?.filter(q => q.active);
    if (!state?.resume?.id || active?.length !== 1) fail('현재 문항을 읽지 못했습니다. 문항을 연 뒤 다시 시도해 주세요.');
    return active[0];
  }
  // 고른 곳 하나 + 질문 하나. answer는 보낼 때 입력칸에 보이던 전체 답변이다.
  function ask(state, answer, start, end, request) {
    const q = current(state);
    return validate({ version: 3, resumeId: String(state.resume.id), question: { id: String(q.id), number: q.number, question: q.question },
      answer: String(answer ?? ''), quote: { start, end, text: String(answer ?? '').slice(start, end) }, request: String(request ?? '').trim() });
  }
  function validate(a) {
    if (a?.version !== 3 || !/^\d+$/.test(a.resumeId) || !a.question?.id || !Number.isInteger(a.question.number) ||
        typeof a.question.question !== 'string' || typeof a.answer !== 'string' || a.answer.length > LIMIT.answer) fail('질문 형식을 확인해 주세요.');
    const s = a.quote?.start, e = a.quote?.end;
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s || e > a.answer.length ||
        typeof a.quote.text !== 'string' || a.quote.text !== a.answer.slice(s, e) || !a.quote.text.trim()) fail('고른 곳을 다시 골라 주세요.');
    if (a.quote.text.length > LIMIT.quote) fail('고른 곳이 너무 깁니다. ' + LIMIT.quote.toLocaleString() + '자 안으로 골라 주세요.');
    if (typeof a.request !== 'string' || a.request.length > LIMIT.request) fail('질문은 ' + LIMIT.request.toLocaleString() + '자 안으로 적어 주세요.');
    return a;
  }
  function check(a, state) {
    validate(a);
    const q = current(state);
    if (String(state.resume.id) !== a.resumeId || String(q.id) !== a.question.id || q.number !== a.question.number || q.question !== a.question.question)
      fail('현재 문항이 바뀌었습니다. 해당 문항에서 다시 골라 주세요.');
    if (!sameAnswer(q.answer, a.answer)) fail('답변이 바뀌었습니다. 다시 보내 주세요.');
    return q;
  }
  function occurrences(text, part) {
    const found = [];
    for (let i = text.indexOf(part); i >= 0 && found.length < 3; i = text.indexOf(part, i + 1)) found.push(i);
    return found;
  }
  // 기록 위치에 같은 원문이 있으면 그 자리, 아니면 원문이 정확히 한 번 있을 때만 그 자리.
  function locate(text, part, hint) {
    if (!part) return -1;
    if (Number.isInteger(hint) && hint >= 0 && text.slice(hint, hint + part.length) === part) return hint;
    const found = occurrences(text, part);
    return found.length === 1 ? found[0] : -1;
  }
  function context(a) {
    // 단어만 골라도 뜻을 알 수 있도록 같은 문단에서 앞뒤 최대 160자만 동봉한다.
    const { start, end } = a.quote;
    const from = Math.max(a.answer.lastIndexOf('\n', start - 1) + 1, start - 160);
    const newline = a.answer.indexOf('\n', end);
    return a.answer.slice(from, Math.min(newline < 0 ? a.answer.length : newline, end + 160));
  }
  // 요청 첫 줄. GPT 화면에서 보낸 메시지를 찾는 기준이다(내부 ID 대신).
  const headline = number => MARK + ' 자소설닷컴 ' + number + '번 문항 답변에 대한 질문입니다.';
  function prompt(a) {
    validate(a);
    const around = context(a);
    const lines = [headline(a.question.number), '이 대화에 있는 공고·이력·다른 문항 정보를 근거로 삼아 주세요.', '',
      '문항 ' + a.question.number + ': ' + a.question.question, '', '고칠 부분: ' + a.quote.text];
    if (around !== a.quote.text) lines.push('주변 문맥: ' + around);
    lines.push('질문: ' + (a.request || '따로 없음. 아래 규칙대로 다듬어 주세요.'), '',
      '규칙',
      '- 질문에 답하면서, 고칠 부분에 빠진 맥락(어디서·무엇을·왜)이나 AI가 쓴 듯한 상투적·번역투 표현이 있으면 함께 고칩니다.',
      '- 대화에 없는 소속·경험·기간·수치는 지어내지 않습니다. 근거가 부족하면 "확인 필요"에 무엇을 알려주면 되는지 적습니다.',
      '- 수정안 코드 블록에는 고칠 부분 자리에 그대로 넣을 문장만 적습니다. 고칠 부분 밖 문장은 고치지 않습니다. 고칠 필요가 없으면 수정안을 쓰지 않습니다.',
      '- 아래 형식만 사용합니다.', '',
      '진단: 질문에 대한 답과 이유를 한두 문장으로', '수정안:', '```', '고칠 부분을 대체할 문장', '```', '확인 필요: 없음');
    return lines.join('\n');
  }
  const isRequest = text => String(text || '').trimStart().startsWith(MARK);

  // ── 응답 판독 ──
  // blocks: [{type:'heading'|'text'|'code'|'boundary', text}] — 화면에 보이는 순서.
  // status: ready(수정안) · same(그대로) · ask(확인 필요만) · note(답만) · invalid(읽지 못함)
  const NONE = /^(?:없음|없습니다|없어요|해당\s*없음|-|—|–)\.?$/;
  function parseAnswer(blocks, quoteText) {
    const list = Array.isArray(blocks) ? blocks : [], codes = list.filter(b => b.type === 'code');
    let diagnosis = '', askText = '', waitingAsk = false, waitingDiagnosis = false;
    for (const b of list) {
      if (b.type !== 'text' && b.type !== 'heading') { waitingAsk = waitingDiagnosis = false; continue; }
      for (const raw of String(b.text).split('\n')) {
        const line = raw.replace(/\*\*/g, '').trim();
        if (!line) continue;
        const dx = /^진단\s*[:：]\s*(.*)$/.exec(line), ax = /^확인\s*필요\s*[:：]\s*(.*)$/.exec(line);
        if (dx) { diagnosis = dx[1].trim(); waitingDiagnosis = !diagnosis; waitingAsk = false; continue; }
        if (ax) { askText = ax[1].trim(); waitingAsk = !askText; waitingDiagnosis = false; continue; }
        if (/^수정안\s*[:：]?\s*$/.test(line)) { waitingAsk = waitingDiagnosis = false; continue; }
        if (waitingAsk) { askText = line; waitingAsk = false; }
        else if (waitingDiagnosis) { diagnosis = line; waitingDiagnosis = false; }
      }
    }
    if (NONE.test(askText)) askText = '';
    const base = { diagnosis: diagnosis.slice(0, 1200), ask: askText.slice(0, 600) };
    if (codes.length > 1) return { ...base, status: 'invalid', reason: '수정안이 여러 개라 고르지 못했어요.' };
    if (!codes.length) {
      if (askText) return { ...base, status: 'ask' };
      if (diagnosis) return { ...base, status: 'note' };
      return { ...base, status: 'invalid', reason: '답 형식을 읽지 못했어요.' };
    }
    const body = codes[0].text.trim();
    if (!body || body.length > LIMIT.replacement || /수정안\s*[:：]|```/.test(body)) return { ...base, status: 'invalid', reason: '수정안 형식을 읽지 못했어요.' };
    // 고른 곳의 앞뒤 공백은 보존한다. GPT가 붙인 줄바꿈으로 문단이 바뀌지 않게 한다.
    const q = String(quoteText || '');
    const replacement = q.match(/^\s*/)[0] + body + q.match(/\s*$/)[0];
    if (replacement === q) return { ...base, status: 'same' };
    return { ...base, status: 'ready', replacement };
  }
  function replaceAt(text, at, from, to) {
    if (at < 0 || text.slice(at, at + from.length) !== from) fail('원문이 바뀌어 넣지 않았습니다.');
    return text.slice(0, at) + to + text.slice(at + from.length);
  }
  root.JSLFeedback = { MARK, LIMIT, headline, sameAnswer, current, ask, validate, check, locate, prompt, isRequest, parseAnswer, replaceAt };
  if (typeof module !== 'undefined') module.exports = root.JSLFeedback;
})(globalThis);
