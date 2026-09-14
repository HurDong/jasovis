// 현재 문항의 인용·요청·응답 판독 계약. DOM이나 저장소에 의존하지 않는다.
(function (root) {
  'use strict';
  const fail = text => { throw Error(text); };
  const MARK = '[자비스 요청]';
  const KINDS = {
    context: { label: '빠진 맥락', request: '무엇을 어디서, 무엇을 위해 했는지 등 이 문장만으로는 드러나지 않는 맥락을 채워 주세요.' },
    tone: { label: 'AI 티', request: '뜻과 사실은 유지하고, 상투적이거나 번역투인 표현을 실제 지원자가 쓸 법한 담백한 문장으로 바꿔 주세요.' },
    ask: { label: '질문', request: '' }
  };
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
  function create(state) {
    const q = current(state);
    return { version: 2, resumeId: String(state.resume.id), question: { id: String(q.id), number: q.number, question: q.question },
      answer: lf(q.answer), quotes: [], nextId: 1, review: {} };
  }
  function validate(d, sending = false) {
    if (d?.version !== 2 || !/^\d+$/.test(d.resumeId) || !d.question?.id || !Number.isInteger(d.question.number) ||
        typeof d.question.question !== 'string' || typeof d.answer !== 'string' || d.answer.length > 100000 ||
        !Array.isArray(d.quotes) || d.quotes.length > 20 || (d.review != null && typeof d.review !== 'object')) fail('질문 초안 형식을 확인해 주세요.');
    const ids = new Set();
    for (const q of d.quotes) {
      if (!Number.isInteger(q.id) || q.id < 1 || ids.has(q.id) || !Number.isInteger(q.start) || !Number.isInteger(q.end) ||
          q.start < 0 || q.end <= q.start || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 8000 ||
          !KINDS[q.kind] || typeof q.feedback !== 'string' || q.feedback.length > 4000) fail('인용 원문이나 범위를 확인해 주세요.');
      // 위치를 잃은 인용은 화면에 경고로만 남는다. 보낼 수 없다.
      if (!q.lost && (q.end > d.answer.length || q.text !== d.answer.slice(q.start, q.end))) fail('인용 원문이나 범위를 확인해 주세요.');
      ids.add(q.id);
    }
    if (!Number.isInteger(d.nextId) || d.nextId <= Math.max(0, ...ids)) fail('인용 번호를 확인해 주세요.');
    if (sending) {
      if (!d.quotes.length) fail('고칠 곳을 먼저 담아 주세요.');
      if (d.quotes.some(q => q.lost)) fail('원문이 바뀐 인용을 빼 주세요.');
      if (d.quotes.some(q => q.kind === 'ask' && !q.feedback.trim())) fail('질문 내용을 적어 주세요.');
    }
    return d;
  }
  function check(d, state) {
    validate(d);
    const q = current(state);
    if (String(state.resume.id) !== d.resumeId || String(q.id) !== d.question.id || q.number !== d.question.number || q.question !== d.question.question)
      fail('현재 문항이 바뀌었습니다. 해당 문항에서 다시 열어 주세요.');
    if (!sameAnswer(q.answer, d.answer)) fail('답변이 바뀌었습니다. 다시 보내 주세요.');
    return q;
  }
  function occurrences(text, part) {
    const found = [];
    for (let i = text.indexOf(part); i >= 0 && found.length < 3; i = text.indexOf(part, i + 1)) found.push(i);
    return found;
  }
  // 기록 위치에 같은 원문이 있으면 그 자리, 아니면 원문이 정확히 한 번 있을 때만 그 자리.
  function locate(text, part, hint) {
    if (Number.isInteger(hint) && hint >= 0 && text.slice(hint, hint + part.length) === part) return hint;
    const found = occurrences(text, part);
    return found.length === 1 ? found[0] : -1;
  }
  // 편집 중인 답변에 맞춰 인용 위치를 다시 잡는다. 못 찾은 인용은 lost로 표시한다.
  function rebase(d, answer) {
    const next = structuredClone(d);
    next.answer = String(answer || '');
    for (const q of next.quotes) {
      const at = locate(next.answer, q.text, q.start);
      if (at < 0) { q.lost = true; continue; }
      delete q.lost; q.start = at; q.end = at + q.text.length;
    }
    return next;
  }
  function add(d, start, end, kind = 'context') {
    validate(d);
    if (!KINDS[kind]) fail('요청 종류를 확인해 주세요.');
    const old = d.quotes.find(q => q.start === start && q.end === end && !q.lost);
    if (old) { old.kind = kind; return old; }
    if (d.quotes.length >= 20) fail('인용은 한 문항에서 최대 20개까지 담을 수 있습니다.');
    const q = { id: d.nextId, start, end, text: d.answer.slice(start, end), kind, feedback: '' };
    validate({ ...d, quotes: [...d.quotes, q], nextId: d.nextId + 1 });
    d.quotes.push(q); d.nextId++;
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
    const lines = [MARK + ' 자소설닷컴 ' + d.question.number + '번 문항 답변에서 고칠 곳 ' + d.quotes.length + '개입니다.',
      '이 대화에 있는 공고·이력·다른 문항 정보를 근거로 삼아 주세요.', '',
      '문항 ' + d.question.number + ': ' + d.question.question, '',
      '규칙',
      '- 대화에 없는 소속·경험·기간·수치는 지어내지 않습니다. 근거가 부족하면 수정안 대신 "확인 필요"에 무엇을 알려주면 되는지 적습니다.',
      '- 수정안 코드 블록에는 원문 인용 자리에 그대로 넣을 문장만 적습니다. 인용 밖 문장은 고치지 않습니다.',
      '- 인용마다 아래 형식만 사용합니다.', '',
      '### 인용 N', '진단: 한두 문장', '수정안:', '```', '원문 인용을 대체할 문장', '```', '확인 필요: 없음'];
    for (const q of d.quotes) {
      lines.push('', '[인용 ' + q.id + ' · ' + KINDS[q.kind].label + ']', '원문: ' + q.text);
      const around = context(d, q);
      if (around !== q.text) lines.push('주변 문맥: ' + around);
      if (q.kind === 'ask') lines.push('요청: ' + q.feedback.trim());
      else {
        lines.push('요청: ' + KINDS[q.kind].request);
        if (q.feedback.trim()) lines.push('덧붙임: ' + q.feedback.trim());
      }
    }
    return lines.join('\n');
  }
  const isRequest = text => String(text || '').trimStart().startsWith(MARK);

  // ── 응답 판독 ──
  // blocks: [{type:'heading'|'text'|'code'|'boundary', text}] — 화면에 보이는 순서.
  const heading = text => {
    const s = String(text || '').replace(/\*\*/g, '').trim();
    if (s.length > 60) return null;
    const m = /^(?:#{1,6}\s*)?[\[【(]?\s*인용\s*(\d{1,2})\s*[\]】)]?\s*(?:[—–\-:：·.][^\n]{0,40})?$/.exec(s);
    return m ? Number(m[1]) : null;
  };
  const NONE = /^(?:없음|없습니다|없어요|해당\s*없음|-|—|–)\.?$/;
  function readSection(blocks, q) {
    const codes = blocks.filter(b => b.type === 'code');
    let diagnosis = '', ask = '', waitingAsk = false;
    for (const b of blocks) {
      if (b.type !== 'text') { waitingAsk = false; continue; }
      for (const raw of String(b.text).split('\n')) {
        const line = raw.replace(/\*\*/g, '').trim();
        if (!line) continue;
        const dx = /^진단\s*[:：]\s*(.*)$/.exec(line), ax = /^확인\s*필요\s*[:：]\s*(.*)$/.exec(line);
        if (dx) { diagnosis = dx[1].trim(); waitingAsk = false; continue; }
        if (ax) { ask = ax[1].trim(); waitingAsk = !ask; continue; }
        if (/^수정안\s*[:：]?\s*$/.test(line)) { waitingAsk = false; continue; }
        if (waitingAsk) { ask = line; waitingAsk = false; }
      }
    }
    if (NONE.test(ask)) ask = '';
    const base = { diagnosis: diagnosis.slice(0, 600), ask: ask.slice(0, 600) };
    if (codes.length > 1) return { ...base, status: 'invalid', reason: '수정안이 여러 개입니다.' };
    if (!codes.length) return ask ? { ...base, status: 'ask' } : { ...base, status: 'invalid', reason: '수정안을 찾지 못했습니다.' };
    const body = codes[0].text.trim();
    if (!body || body.length > 8000 || /인용\s*\d|수정안\s*[:：]|```/.test(body)) return { ...base, status: 'invalid', reason: '수정안 형식을 읽지 못했습니다.' };
    // 원문 인용의 앞뒤 공백은 보존한다. GPT가 붙인 줄바꿈으로 문단이 바뀌지 않게 한다.
    const replacement = q.text.match(/^\s*/)[0] + body + q.text.match(/\s*$/)[0];
    if (replacement === q.text) return { ...base, status: 'same' };
    return { ...base, status: 'ready', replacement };
  }
  function parseReply(blocks, quotes) {
    const wanted = new Map(quotes.map(q => [q.id, q])), sections = new Map(), repeated = new Set();
    let open = null;
    for (const b of Array.isArray(blocks) ? blocks : []) {
      const id = b.type === 'heading' || b.type === 'text' ? heading(b.text) : null;
      if (id != null) {
        if (!wanted.has(id)) { open = null; continue; }
        if (sections.has(id)) repeated.add(id);
        open = []; sections.set(id, open); continue;
      }
      if (open) open.push(b);
    }
    const items = {};
    for (const [id, q] of wanted) {
      if (repeated.has(id)) items[id] = { status: 'invalid', reason: '같은 인용의 답이 여러 번 나왔습니다.', diagnosis: '', ask: '' };
      else if (!sections.has(id)) items[id] = { status: 'invalid', reason: 'GPT 답에서 이 인용을 찾지 못했습니다.', diagnosis: '', ask: '' };
      else items[id] = readSection(sections.get(id), q);
    }
    return { items, seen: [...sections.keys()].filter(id => wanted.has(id)) };
  }
  // 받은 인용의 길이 변화만큼 뒤 인용의 예상 위치를 옮긴다.
  function hint(d, q) {
    let shift = 0;
    for (const [id, r] of Object.entries(d.review || {})) {
      const other = d.quotes.find(x => x.id === Number(id));
      if (r.state === 'applied' && other && other.start < q.start) shift += r.replacement.length - other.text.length;
    }
    return q.start + shift;
  }
  function replaceAt(text, at, from, to) {
    if (at < 0 || text.slice(at, at + from.length) !== from) fail('원문이 바뀌어 넣지 않았습니다.');
    return text.slice(0, at) + to + text.slice(at + from.length);
  }
  root.JSLFeedback = { MARK, KINDS, sameAnswer, current, create, validate, check, add, rebase, locate, prompt, isRequest, parseReply, hint, replaceAt };
  if (typeof module !== 'undefined') module.exports = root.JSLFeedback;
})(globalThis);
