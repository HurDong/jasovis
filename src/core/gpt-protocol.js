// DOM과 무관한 후보 추출·문항 대응. 답변 원문에는 정규화를 적용하지 않는다.
(function (root) {
  'use strict';
  const id = value => /^(0|[1-9]\d*)$/.test(String(value));
  function conversation(url) {
    try {
      const u = new URL(url);
      return u.origin === 'https://chatgpt.com' ? u.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]+)\/?$/)?.[1] || null : null;
    } catch { return null; }
  }
  function normalizeQuestion(text) {
    // 끝의 명시적인 글자 수 메타만 제거한다. 숫자·문장부호·단어는 보존한다.
    let s = String(text || '').replace(/\u00a0/g, ' ').trim();
    // 한 덩어리의 수치 제한. 사이트는 '최소 500자, 최대 2,000자 입력가능'처럼 여러 덩어리를 잇기도 한다.
    const one = '(?:(?:공백\\s*(?:포함|제외)|최대|최소)\\s*)?\\d[\\d,]*\\s*(?:자|바이트|bytes?)(?:\\s*(?:이내|이상|이하))?(?:\\s*[,·/]?\\s*공백\\s*(?:포함|제외))?';
    const limit = one + '(?:\\s*[,·/~∼〜-]?\\s*' + one + ')*(?:\\s*(?:입력|작성)\\s*가능)?';
    s = s.replace(new RegExp('\\s*[（(\\[]\\s*' + limit + '\\s*[）)\\]]\\s*$', 'i'), '');
    s = s.replace(new RegExp('\\s*(?:글자\\s*수\\s*제한|분량)\\s*[:：]\\s*' + limit + '\\s*$', 'i'), '');
    // 단위가 없어도 최소/최대가 모두 명시된 끝의 범위는 사이트 분량 메타다.
    s = s.replace(/\s*[（(\[]\s*최소\s*\d[\d,]*\s*[~∼〜-]\s*최대\s*\d[\d,]*\s*[）)\]]\s*$/, '');
    return s.replace(/\s+/g, ' ').trim();
  }
  function questionKey(text, number = null) {
    // 대응 비교 전용 키. 문장부호·기호는 지우지 않고 공백으로 바꿔, GPT가 마침표나 괄호 간격을
    // 바꿔 적어도 같은 문항으로 본다. 공백 자체는 없애지 않는다 ('아버지 가방'과 '아버지가 방'은 다르다).
    let s = normalizeQuestion(text);
    // 번호 메타와 일치하는 명시적 접두사만 비교에서 제외한다. 소수·연도·본문 숫자는 보존한다.
    const prefix = /^(?:(?:문항\s*|Q\s*)(\d+)(?:\s*[:：.)]\s*|\s+)|(\d+)\s*번(?:\s*문항)?(?:\s*[:：.)]\s*|\s+)|\((\d+)\)\s*|\[(\d+)\]\s*|(\d+)[.)]\s+)(?=\S)/i.exec(s);
    if (prefix && Number(prefix.slice(1).find(x => x !== undefined)) === number) s = s.slice(prefix[0].length);
    return s.replace(/[\p{P}\p{S}ㆍ]/gu, ' ').replace(/\s+/g, ' ').trim();
  }
  function questionHeading(text) {
    return /^(?:문항\s*(\d+)|(\d+)\s*번\s*(?:문항)?|Q\s*(\d+))(?=\s|[.:：)\-]|$)/i.exec(text.trim());
  }
  function detailedQuestion(text, number) {
    const s = normalizeQuestion(text);
    const split = /^(.*?(?:서술|기술|작성|설명)해\s*주세요)\s*[.!。]\s*([^]+)$/.exec(s);
    if (!split) return null;
    const main = questionKey(split[1].replace(/해\s+주세요/g, '해주세요'), number);
    if (main.length < 30) return null;
    const detail = split[2].trim();
    // 바깥 괄호는 작성 지침을 감싼다. 그 안의 짧은 예시 괄호만 선택적으로 제외한다.
    let reduced = detail;
    if (detail.startsWith('(') && detail.endsWith(')')) {
      let depth = 0, balanced = true;
      for (let i = 0; i < detail.length; i++) {
        if (detail[i] === '(') depth++;
        if (detail[i] === ')') depth--;
        if (depth < 0 || (depth === 0 && i < detail.length - 1)) balanced = false;
      }
      if (!balanced || depth !== 0) return null;
      reduced = '(' + detail.slice(1, -1).replace(/\(([^()]{1,80})\)/g, (whole, inner) =>
        (/(?:등\s*$|\/)/.test(inner) && !/필수|제외|금지|반드시/.test(inner)) ? '' : whole) + ')';
    }
    const key = value => questionKey(value).replace(/\s/g, '');
    return { main, full: key(detail), reduced: key(reduced) };
  }
  function detailedMatch(a, b) {
    if (!a || !b || a.main !== b.main || !a.full || !b.full) return false;
    // 둘 다 서로 다른 예시를 생략해 일치시키지는 않는다. 한쪽 원문과 다른 쪽 축약형이 같아야 한다.
    return a.full === b.full || a.full === b.reduced || a.reduced === b.full;
  }
  function parse(blocks) {
    const result = [];
    let context = null;
    for (const block of blocks) {
      if (block.type === 'boundary') { context = null; continue; }
      if (block.type === 'code') {
        if (!context || !block.text.trim()) continue;
        if (/^\s*(?:#\s*)?(?:작업|저장소|구현 목표|Codex|AGENTS\.md)\s*[:：\n]/i.test(block.text)) continue;
        result.push({ key: String(result.length), number: context.number, question: context.question, text: block.text });
        continue;
      }
      const text = block.text.trim();
      const heading = questionHeading(text);
      if (heading && (block.type === 'heading' || !text.includes('\n'))) {
        context = { number: Number(heading[1] || heading[2] || heading[3]), question: '', level: block.level || 3 };
        const inline = text.slice(heading[0].length).match(/^\s*[:：]\s*(.+)$/);
        if (inline && !/^(수정|개선|최종|완성|초안)/.test(inline[1])) context.question = inline[1];
        continue;
      }
      if (block.type === 'heading' && (!context || block.level <= context.level || /검수|전략|출처|지시문|프롬프트|Codex/i.test(text))) context = null;
      const q = /^(?:[-•]\s*)?(?:문항\s*원문|질문(?:\s*원문)?)\s*[:：]\s*([^]*?)\s*$/.exec(text);
      if (q && q[1]) {
        if (!context) context = { number: null, question: '', level: block.level || 3 };
        context.question = q[1].split(/\n\s*(?:[-•]\s*)?(?:글자\s*수|선택한 소재|소재|작성 전략|실제 글자|문항 ID)\s*[:：]/)[0].trim();
      }
    }
    return result;
  }
  function metadata(state) {
    if (!id(state?.resume?.id) || !Array.isArray(state.qnas) || !state.qnas.length || state.qnas.length > 100) throw Error('지원서 문항을 읽지 못했습니다. 지원서 로딩 후 다시 시도해 주세요.');
    const qnas = state.qnas.map(q => ({ id: String(q.id), number: Number(q.number), question: q.question }));
    validate({ version: 1, resumeId: state.resume.id, answers: qnas.map(q => ({ ...q, text: '검증' })) }, state);
    return { resume: { id: String(state.resume.id), title: String(state.resume.title || '제목 없는 지원서') }, qnas };
  }
  function sameQuestions(link, state) {
    const current = metadata(state);
    return current.resume.id === String(link.resume.id) && current.qnas.length === link.qnas.length && link.qnas.every(q =>
      current.qnas.some(n => n.id === String(q.id) && n.number === q.number && normalizeQuestion(n.question) === normalizeQuestion(q.question)));
  }
  function candidatesValid(candidates) {
    if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100) throw Error('문항과 연결된 답변 블록을 찾지 못했습니다.');
    const keys = new Set();
    for (const c of candidates) {
      if (!c || typeof c.key !== 'string' || keys.has(c.key) || typeof c.question !== 'string' ||
          (c.number !== null && (!Number.isSafeInteger(c.number) || c.number < 1)) || (!c.number && !c.question.trim()) ||
          typeof c.text !== 'string' || !c.text.trim() || c.text.length > 100000) throw Error('답변 후보 형식을 확인할 수 없습니다.');
      keys.add(c.key);
    }
  }
  function map(candidates, state, choices = {}) {
    candidatesValid(candidates);
    const { qnas } = metadata(state);
    const rows = candidates.map(candidate => {
      const byNumber = qnas.find(q => q.number === candidate.number);
      let byQuestion = candidate.question ? qnas.filter(q => {
        const wanted = questionKey(candidate.question, candidate.number ?? q.number);
        return wanted && questionKey(q.question, q.number) === wanted;
      }) : [];
      if (!byQuestion.length && candidate.question && byNumber) {
        const detail = detailedQuestion(candidate.question, candidate.number);
        byQuestion = qnas.filter(q => detailedMatch(detail, detailedQuestion(q.question, q.number)));
      }
      let target = null, reason = '';
      if (candidate.question) {
        if (byQuestion.length === 1 && (candidate.number === null || byNumber?.id === byQuestion[0].id)) target = byQuestion[0];
        else reason = byQuestion.length > 1 ? '같은 질문이 여러 문항에 있습니다.' : '번호와 질문을 확인해 주세요.';
      } else if (byNumber) target = byNumber;
      else reason = '대상 문항을 선택해 주세요.';
      return { candidate, target: target?.id || null, reason };
    });
    const duplicateIds = new Set(rows.filter(r => r.target && rows.filter(x => x.target === r.target).length > 1).map(r => r.target));
    for (const r of rows) {
      if (duplicateIds.has(r.target)) { r.target = null; r.reason = '같은 문항의 후보가 여러 개입니다. 사용할 답변만 선택해 주세요.'; }
      if (Object.hasOwn(choices, r.candidate.key)) {
        const chosen = choices[r.candidate.key];
        if (chosen !== 'skip' && !qnas.some(q => q.id === chosen)) throw Error('선택한 문항이 없습니다.');
        r.target = chosen; r.reason = '';
      }
    }
    const selected = rows.filter(r => r.target && r.target !== 'skip');
    if (new Set(selected.map(r => r.target)).size !== selected.length) throw Error('한 문항에 여러 답변을 선택했습니다. 사용할 답변 하나만 남겨 주세요.');
    if (rows.some(r => !r.target)) return { rows, qnas, packet: null };
    if (!selected.length) throw Error('입력할 답변을 하나 이상 선택해 주세요.');
    const packet = { version: 1, resumeId: String(state.resume.id), answers: selected.map(r => {
      const q = qnas.find(q => q.id === r.target);
      return { ...q, text: r.candidate.text, expectedAnswer: state.qnas.find(n => String(n.id) === q.id).answer || '' };
    }) };
    validate(packet, state);
    return { rows, qnas, packet };
  }
  function validate(packet, state, checkAnswers = false) {
    if (!packet || packet.version !== 1 || !id(packet.resumeId) || String(state?.resume?.id) !== String(packet.resumeId) ||
        !Array.isArray(state?.qnas) || !Array.isArray(packet.answers) || !packet.answers.length || packet.answers.length > 100) throw Error('지원서 연결 정보가 일치하지 않습니다. 연결을 다시 선택해 주세요.');
    const ids = new Set(), numbers = new Set();
    for (const a of packet.answers) {
      if (!a || !id(a.id) || !Number.isSafeInteger(a.number) || a.number < 1 || ids.has(String(a.id)) || numbers.has(a.number) ||
          typeof a.text !== 'string' || !a.text.trim() || a.text.length > 100000 || typeof a.question !== 'string') throw Error('문항 정보가 중복되거나 답변 형식이 잘못되었습니다.');
      ids.add(String(a.id)); numbers.add(a.number);
      const matches = state.qnas.filter(q => String(q.id) === String(a.id));
      if (matches.length !== 1 || Number(matches[0].number) !== a.number || matches[0].question !== a.question) throw Error('문항 ' + a.number + '의 ID·번호·질문이 변경되었습니다. 연결을 다시 선택해 주세요.');
      if (checkAnswers && (typeof a.expectedAnswer !== 'string' || (matches[0].answer || '') !== a.expectedAnswer)) throw Error('지원서 답변이 입력 준비 중 변경되었습니다. 현재 내용을 확인하고 다시 적용해 주세요.');
    }
    return packet;
  }
  root.JSLGpt = { conversation, normalizeQuestion, questionKey, parse, metadata, sameQuestions, map, validate };
  if (typeof module !== 'undefined') module.exports = root.JSLGpt;
})(globalThis);
