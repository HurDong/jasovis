// 현재 문항의 인용·질문 계약. DOM이나 저장소에 의존하지 않는다.
(function (root) {
  'use strict';
  const fail = text => { throw Error(text); };
  function current(state) {
    const active = state?.qnas?.filter(q => q.active);
    if (!state?.resume?.id || active?.length !== 1) fail('현재 문항을 읽지 못했습니다. 문항을 연 뒤 다시 시도해 주세요.');
    return active[0];
  }
  function create(state) {
    const q = current(state);
    return { version: 1, resumeId: String(state.resume.id), question: { id: String(q.id), number: q.number, question: q.question },
      answer: String(q.answer || ''), quotes: [], nextId: 1, message: '' };
  }
  function validate(d, sending = false) {
    if (d?.version !== 1 || !/^\d+$/.test(d.resumeId) || !d.question?.id || !Number.isInteger(d.question.number) ||
        typeof d.question.question !== 'string' || typeof d.answer !== 'string' || d.answer.length > 100000 ||
        !Array.isArray(d.quotes) || d.quotes.length > 20 || typeof d.message !== 'string' || d.message.length > 8000) fail('질문 초안 형식을 확인해 주세요.');
    const ids = new Set();
    for (const q of d.quotes) {
      if (!Number.isInteger(q.id) || q.id < 1 || ids.has(q.id) || !Number.isInteger(q.start) || !Number.isInteger(q.end) ||
          q.start < 0 || q.end <= q.start || q.end > d.answer.length || q.text !== d.answer.slice(q.start, q.end) ||
          !q.text.trim() || q.text.length > 8000 || typeof q.feedback !== 'string' || q.feedback.length > 4000) fail('인용 원문이나 범위를 확인해 주세요.');
      ids.add(q.id);
    }
    if (!Number.isInteger(d.nextId) || d.nextId <= Math.max(0, ...ids)) fail('인용 번호를 확인해 주세요.');
    if (sending) {
      if (!d.quotes.length) fail('질문할 단어나 문장을 먼저 선택해 주세요.');
      if (![d.message, ...d.quotes.map(q => q.feedback)].some(s => s.trim())) fail('인용별 질문 또는 공통 질문을 적어 주세요.');
      for (const text of [d.message, ...d.quotes.map(q => q.feedback)]) {
        for (const match of text.matchAll(/인용\s*(\d+)/g)) if (!ids.has(Number(match[1]))) fail('삭제된 인용 ' + match[1] + '을 질문에서 수정해 주세요.');
      }
    }
    return d;
  }
  function check(d, state) {
    validate(d);
    const q = current(state);
    if (String(state.resume.id) !== d.resumeId || String(q.id) !== d.question.id || q.number !== d.question.number || q.question !== d.question.question)
      fail('현재 문항이 바뀌었습니다. 해당 문항에서 질문을 다시 열어 주세요.');
    if (String(q.answer || '') !== d.answer) fail('인용 후 답변이 바뀌었습니다. 인용을 다시 선택해 주세요. 작성한 질문은 유지됩니다.');
    return q;
  }
  function add(d, start, end) {
    validate(d);
    const old = d.quotes.find(q => q.start === start && q.end === end);
    if (old) return old;
    if (d.quotes.length >= 20) fail('인용은 한 문항에서 최대 20개까지 추가할 수 있습니다.');
    const q = { id: d.nextId, start, end, text: d.answer.slice(start, end), feedback: '' };
    validate({ ...d, quotes: [...d.quotes, q], nextId: d.nextId + 1 });
    d.quotes.push(q); d.nextId++;
    delete d.attempt;
    return q;
  }
  function context(d, q) {
    // 단어만 골라도 뜻을 알 수 있도록 같은 문단에서 앞뒤 최대 120자만 동봉한다.
    const start = Math.max(d.answer.lastIndexOf('\n', q.start - 1) + 1, q.start - 120);
    const newline = d.answer.indexOf('\n', q.end);
    const end = Math.min(newline < 0 ? d.answer.length : newline, q.end + 120);
    return d.answer.slice(start, end);
  }
  function prompt(d) {
    validate(d, true);
    const lines = ['자소설닷컴에서 현재 작성 중인 답변 일부에 대해 질문합니다.',
      '이 대화의 기존 공고·지원자 정보·다른 문항 맥락을 이어서 참고해 주세요. 아래 인용은 현재 편집 중인 원문입니다.',
      '', '현재 문항 ' + d.question.number + ': ' + d.question.question];
    const contexts = new Map();
    for (const q of d.quotes) {
      lines.push('', '[인용 ' + q.id + ']', q.text);
      if (q.feedback.trim()) lines.push('이 인용에 대한 질문: ' + q.feedback.trim());
      const text = context(d, q);
      if (text !== q.text) {
        if (!contexts.has(text)) contexts.set(text, []);
        contexts.get(text).push(q.id);
      }
    }
    for (const [text, ids] of contexts) lines.push('', '[주변 문맥 — ' + ids.map(id => '인용 ' + id).join(', ') + ']', text);
    if (d.message.trim()) lines.push('', '[공통 질문]', d.message.trim());
    lines.push('', '인용 번호로 대상을 구분해 질문에 답해 주세요. 수정은 요청한 범위에 맞추고, 경험이나 성과를 임의로 만들지 마세요.');
    return lines.join('\n');
  }
  root.JSLFeedback = { current, create, validate, check, add, prompt };
  if (typeof module !== 'undefined') module.exports = root.JSLFeedback;
})(globalThis);
