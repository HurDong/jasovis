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
    // 포맷이 아니라 내용으로 분량 메타를 판별한다. 괄호는 경계만 제공한다.
    const language = '(?:국문|한글|영문|영어)(?:\\s*작성)?(?:\\s*시|\\s*기준)?\\s*[:：]?\\s*';
    const amounts = new RegExp('^(?:' + language + ')?' + limit + '(?:\\s*[,;/·]?\\s*' + language + limit + ')*$', 'i');
    const bareRange = /^최소\s*\d[\d,]*\s*[~∼〜-]\s*최대\s*\d[\d,]*$/;
    // 끝의 균형 잡힌 그룹을 통째로 검사한다. 일부 괄호나 모르는 조건은 버리지 않는다.
    const closes = { ')': '(', '）': '（', ']': '[' };
    while (Object.hasOwn(closes, s.at(-1))) {
      const stack = [];
      let start = -1;
      for (let i = s.length - 1; i >= 0; i--) {
        const ch = s[i];
        if (Object.hasOwn(closes, ch)) stack.push(closes[ch]);
        else if ('(（['.includes(ch)) {
          if (stack.pop() !== ch) break;
          if (!stack.length) { start = i; break; }
        }
      }
      if (start < 0) break;
      // 닫히지 않은 바깥 괄호의 내부만 잘라내지 않는다. '2)' 같은 문항 접두사는 허용한다.
      const prefixStack = [];
      for (const ch of s.slice(0, start)) {
        if ('(（['.includes(ch)) prefixStack.push(ch);
        else if (Object.hasOwn(closes, ch) && prefixStack.length) {
          if (prefixStack.at(-1) !== closes[ch]) break;
          prefixStack.pop();
        }
      }
      if (prefixStack.length) break;
      const content = s.slice(start + 1, -1).replace(/[()（）\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!amounts.test(content) && !bareRange.test(content)) break;
      s = s.slice(0, start).trimEnd();
    }
    s = s.replace(new RegExp('\\s*(?:글자\\s*수\\s*제한|분량)\\s*[:：]\\s*' + limit + '\\s*$', 'i'), '');
    // 단위가 없어도 최소/최대가 모두 명시된 끝의 범위는 사이트 분량 메타다.
    s = s.replace(/\s*[（(\[]\s*최소\s*\d[\d,]*\s*[~∼〜-]\s*최대\s*\d[\d,]*\s*[）)\]]\s*$/, '');
    return s.replace(/\s+/g, ' ').trim();
  }
  function questionKey(text, number = null) {
    // 기존 긴 지침의 호환 키. 제한된 구두점만 공백으로 바꿔, GPT가 마침표나 괄호 간격을
    // 바꿔 적어도 같은 문항으로 본다. 공백 자체는 없애지 않는다 ('아버지 가방'과 '아버지가 방'은 다르다).
    let s = normalizeQuestion(text);
    // 번호 메타와 일치하는 명시적 접두사만 비교에서 제외한다. 소수·연도·본문 숫자는 보존한다.
    const prefix = /^(?:(?:문항\s*|Q\s*)(\d+)(?:\s*[:：.)]\s*|\s+)|(\d+)\s*번(?:\s*문항)?(?:\s*[:：.)]\s*|\s+)|\((\d+)\)\s*|\[(\d+)\]\s*|(\d+)[.)]\s+)(?=\S)/i.exec(s);
    if (prefix && Number(prefix.slice(1).find(x => x !== undefined)) === number) s = s.slice(prefix[0].length);
    return s.replace(/[.!?。()（）\[\]:：,，]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // 공고의 '1-2'는 편집기의 두 번째 입력칸 번호와 별개다.
  const compound = '[1-9]\\d{0,2}(?:\\s*[-–]\\s*[1-9]\\d{0,2}){1,3}';
  const compoundHeading = new RegExp('^(?:문항\\s*(' + compound + ')|(' + compound + ')\\s*번\\s*(?:문항)?|Q\\s*(' + compound + '))(?=\\s|[.:：)]|$)', 'i');
  const cleanLabel = value => value.replace(/\s/g, '').replace(/–/g, '-');
  function questionHeading(text) {
    const s = text.trim(), sub = compoundHeading.exec(s);
    const circled = /^([①-⑳])\s*(?=\S)/.exec(s);
    if (circled) return { number: circled[1].charCodeAt(0) - 0x2460 + 1, length: circled[0].length };
    if (sub) return { number: null, label: cleanLabel(sub[1] || sub[2] || sub[3]), length: sub[0].length };
    // 불완전한 복합 번호를 앞자리 정수로 잘라 읽지 않는다.
    const single = /^(?:문항\s*(\d+)|(\d+)\s*번\s*(?:문항)?|Q\s*(\d+))(?=\s|[.:：)\-]|$)/i.exec(s);
    if (!single || /^\s*[-–]\s*\d/.test(s.slice(single[0].length))) return null;
    return { number: Number(single[1] || single[2] || single[3]), length: single[0].length };
  }
  function similarity(a, b) {
    // 추천 전용 문자 bigram Dice. 긴 질문에도 비용이 선형이며 점수만으로 쓰지 않는다.
    const compact = value => value.replace(/\s/g, '');
    a = compact(a); b = compact(b);
    if (Math.min(a.length, b.length) < 12 || Math.max(a.length, b.length) > 4000) return 0;
    const signals = s => [...new Set(s.match(/성공|실패|포함|제외|금지|필수|반드시|장점|단점|강점|약점|찬성|반대/g) || [])].sort().join('|');
    if (signals(a) !== signals(b)) return 0;
    const grams = new Map();
    for (let i = 1; i < a.length; i++) { const key = a.slice(i - 1, i + 1); grams.set(key, (grams.get(key) || 0) + 1); }
    let common = 0;
    for (let i = 1; i < b.length; i++) { const key = b.slice(i - 1, i + 1), count = grams.get(key) || 0; if (count) { common++; grams.set(key, count - 1); } }
    return 2 * common / (a.length + b.length - 2);
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
    return { main, full: key(detail), reduced: key(reduced), rawDetail: detail };
  }
  function detailedMatch(a, b) {
    if (!a || !b || a.main !== b.main || !a.full || !b.full) return false;
    const protectedTokens = s => s.match(/[A-Za-z0-9]+(?:[.,]\d+)*/g) || [];
    if (JSON.stringify(protectedTokens(a.rawDetail)) !== JSON.stringify(protectedTokens(b.rawDetail))) return false;
    const text = s => s.replace(/[()（）\[\]]/g, '').trim();
    const spacing = spacingDifference(text(a.rawDetail), text(b.rawDetail));
    const compact = text(a.rawDetail).replace(/\s/g, '');
    if (spacing.equal && spacing.boundaries.some(({offset}) => /[A-Za-z0-9]/.test(compact.slice(offset - 1, offset + 1)))) return false;
    // 둘 다 서로 다른 예시를 생략해 일치시키지는 않는다. 한쪽 원문과 다른 쪽 축약형이 같아야 한다.
    return a.full === b.full || a.full === b.reduced || a.reduced === b.full;
  }
  function parse(blocks) {
    const result = [];
    let context = null;
    for (const [blockIndex, block] of blocks.entries()) {
      if (block.type === 'boundary') { context = null; continue; }
      if (block.type === 'code') {
        if (!context || !block.text.trim()) continue;
        if (/^\s*(?:#\s*)?(?:작업|저장소|구현 목표|Codex|AGENTS\.md)\s*[:：\n]/i.test(block.text)) continue;
        result.push({ key: String(result.length), number: context.number, ...(context.label ? { label: context.label } : {}), question: context.question, text: block.text, provenance: { heading: context.start, question: context.questionBlock ?? null, code: blockIndex, listNumber: context.listNumber ?? null } });
        continue;
      }
      const text = block.text.trim();
      if (/^(?:검수|전략표|출처|다른 문항 설명)\s*[:：]/.test(text)) { context = null; continue; }
      const listing = /^(\d+)[.)]\s+(?=(?:문항|Q)\s*\d)/i.exec(text);
      const headingText = listing ? text.slice(listing[0].length) : text;
      const heading = questionHeading(headingText);
      if (heading && (block.type === 'heading' || !text.includes('\n'))) {
        context = { number: heading.number, label: heading.label, question: '', level: block.level || 3, start: blockIndex, listNumber: listing ? Number(listing[1]) : null };
        const inline = headingText.slice(heading.length).match(/^\s*[:：]\s*(.+)$/);
        if (inline && !/^(수정|개선|최종|완성|초안)/.test(inline[1])) context.question = inline[1];
        continue;
      }
      if (block.type === 'heading' && (!context || block.level <= context.level || /검수|전략|출처|지시문|프롬프트|Codex/i.test(text))) context = null;
      const q = /^(?:[-•]\s*)?(?:문항\s*원문|질문(?:\s*원문)?)\s*[:：]\s*([^]*?)\s*$/.exec(text);
      if (q && q[1]) {
        if (!context) context = { number: null, question: '', level: block.level || 3 };
        context.questionBlock = blockIndex;
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
          (c.number !== null && (!Number.isSafeInteger(c.number) || c.number < 1)) ||
          (c.label !== undefined && (typeof c.label !== 'string' || !/^[1-9]\d{0,2}(?:-[1-9]\d{0,2}){1,3}$/.test(c.label) || c.number !== null)) ||
          (!c.number && !c.label && !c.question.trim()) ||
          typeof c.text !== 'string' || !c.text.trim() || c.text.length > 100000) throw Error('답변 후보 형식을 확인할 수 없습니다.');
      keys.add(c.key);
    }
  }
  const ANALYZER_VERSION = 2;
  // Compare boundaries, not just a whitespace-free key. Only Korean grammatical
  // anchors are allowed; moved boundaries, Latin/numeric/unit splits stay manual.
  function spacingDifference(a, b) {
    const boundaries = s => {
      let compact = '', spaces = new Set();
      for (const ch of s.trim()) { if (/\s/.test(ch)) spaces.add(compact.length); else compact += ch; }
      return { compact, spaces };
    };
    const x = boundaries(a), y = boundaries(b);
    if (!x.compact || x.compact !== y.compact) return { equal: false, safe: false, boundaries: [] };
    const inserted = [...y.spaces].filter(i => !x.spaces.has(i)), deleted = [...x.spaces].filter(i => !y.spaces.has(i));
    const changed = [...inserted, ...deleted].sort((a, b) => a - b);
    const union = [...new Set([0, ...x.spaces, ...y.spaces, x.compact.length])].sort((a,b) => a-b);
    const safe = changed.length > 0 && changed.every(i => {
      const p = union.indexOf(i), left = x.compact.slice(union[p-1], i), right = x.compact.slice(i, union[p+1]);
      return /^[가-힣]{2,}(?:의|을|를|에서|으로)$/.test(left) && /^[가-힣]{2,}$/.test(right);
    }) && !(inserted.length && deleted.length);
    return { equal: true, safe, boundaries: changed.map(offset => ({ offset, change: inserted.includes(offset) ? 'insert' : 'delete' })) };
  }
  // Prove body restatement or a bounded experience-outline list. Unknown topics
  // and requirements remain in the key; company-specific synonyms are not inferred.
  function restatedGuidance(body, detail) {
    const flat = detail.replace(/^[（(\[［]\s*|\s*[）)\]］]$/g, '').replace(/^\s*[※*•]+\s*/, '').trim();
    if (!/(?:작성|기술|서술|설명)(?:하시오|하십시오|해\s*(?:주세요|주십시오))?[.!。]?\s*$/.test(flat) ||
        /[()（）\[\]［］\dA-Za-z]|반드시|필수|제외|금지|최근|기간|이내|이상|이하|한정|대상|선택|하나|가지|않|못|없이|아닌|추가|만\s|또는/.test(flat)) return false;
    const content = flat.replace(/\s*(?:중심으로|포함하여)\s*/g, ' ')
      .replace(/구체적으로\s*/g, '').replace(/(?:작성|기술|서술|설명)(?:하시오|하십시오|해\s*(?:주세요|주십시오))?[.!。]?\s*$/, '').trim();
    if (/[.!?。]/.test(content)) return false;
    const tokens = s => s.split(/[\s,/·]+/).filter(Boolean).map(t => t.replace(/(?:에서|으로|과|와|을|를|의)$/g, ''));
    const core = tokens(body), required = tokens(content);
    let cursor = 0;
    const repeated = required.length > 0 && required.every(t => {
      const found = core.indexOf(t, cursor); cursor = found + 1;
      return t.length >= 2 && found >= 0;
    });
    if (repeated) return 'body-restatement';
    // Experience questions often restate their narrative structure as a trailing
    // list: context/cause, actions/reasons, outcome/reflection. Require a list,
    // explicit experience in the body and at least one non-scaffold body anchor.
    // This proves identification only, never whether the answer covers the guide.
    if (!/경험|사례/.test(body) || !/등\s*$/.test(content) || !/[,/·]/.test(content)) return false;
    const compactBody = body.replace(/\s/g, '');
    let anchors = 0;
    const scaffold = /^(?:상황|원인|파악|과정|방법|판단|근거|결과|배운점|교훈|수준|및|대한|등)$/;
    const parts = content.replace(/본인만의|자신만의/g, '').replace(/에 대한|로부터/g, ' ')
      .replace(/원인파악/g, '원인 파악').replace(/배운\s*점/g, '배운점')
      .split(/[\s,/·]+/).filter(Boolean);
    const outlined = parts.every(part => {
      const token = part.length > 2 ? part.replace(/(?:의|을|를)$/g, '') : part;
      if (scaffold.test(token)) return true;
      if (token.length >= 2 && compactBody.includes(token)) { anchors++; return true; }
      // Nominalized process names retain the action stem; a new action is not inferred.
      const action = /^(.*)과정$/.exec(token)?.[1];
      if (action?.length >= 2 && compactBody.includes(action)) { anchors++; return true; }
      return false;
    }) && anchors > 0;
    return outlined ? 'experience-outline' : false;
  }
  // Shared, lossless analysis. Offsets always address the untouched question, not its key.
  function analyzeQuestion(value, meta = {}) {
    const raw = String(value || ''), spans = [], removed = [];
    const add = (kind, start, end, reason) => {
      const span = { kind, start, end, raw: raw.slice(start, end), reason };
      if (kind === 'limit') {
        span.amounts = [...span.raw.matchAll(/(\d[\d,]*)\s*(자|바이트|bytes?)/gi)].map(m => ({ value: Number(m[1].replace(/,/g, '')), unit: m[2] }));
        span.languages = span.raw.match(/국문|한글|영문|영어/g) || [];
        span.whitespace = span.raw.match(/공백\s*(포함|제외)/)?.[1] || null;
      }
      spans.push(span);
      if (['limit', 'identifier', 'optional'].includes(kind)) removed.push([start, end]);
    };
    // Only complete groups and complete lines can prove an independent amount annotation.
    const stack = [], groups = [], close = { ')': '(', '）': '（', ']': '[', '］': '［' };
    let malformed = false;
    for (let i = 0; i < raw.length; i++) {
      if ('(（[［'.includes(raw[i])) stack.push(i);
      else if (close[raw[i]]) {
        if (!stack.length) { if (!/^\s*(?:(?:문항|Q)\s*)?\d+$/.test(raw.slice(0, i))) malformed = true; continue; }
        const start = stack.pop();
        if (raw[start] !== close[raw[i]]) malformed = true;
        if (!stack.length) groups.push([start, i + 1]);
      }
    }
    malformed ||= stack.length > 0;
    const isLimit = text => {
      const flat = text.replace(/[()（）\[\]［］]/g, ' ').replace(/^\s*(?:※|분량\s*[:：]|글자\s*수\s*(?:제한)?\s*[:：])\s*/, '').trim();
      return !!flat && normalizeQuestion('LIMIT (' + flat + ')') === 'LIMIT';
    };
    if (!malformed) for (const [start, end] of groups) {
      const text = raw.slice(start, end);
      if (isLimit(text)) add('limit', start, end, '독립된 수치·단위·언어별 분량 안내');
      else if (/^[(（[［]\s*(?:※\s*)?(?:예시\s*[:：]|예\s*[:：])/.test(text) && !/필수|반드시|금지|제외|최근|\d+\s*(?:년|가지|개)/.test(text)) add('optional', start, end, '명시적 선택 예시');
      else if (/사용해도 됩니다|선택 사항|선택사항/.test(text) && !/필수|반드시|금지/.test(text)) add('optional', start, end, '명시적 선택 허용');
      else add('unknown', start, end, '괄호만으로 생략 가능 여부를 판정하지 않음');
    }
    let offset = 0;
    for (const line of raw.split('\n')) {
      if (!malformed && isLimit(line) && !removed.some(([a, b]) => a <= offset && b >= offset + line.length)) add('limit', offset, offset + line.length, '독립된 분량 안내 줄');
      offset += line.length + 1;
    }
    let text;
    // Offsets are UTF-16, as are browser strings and selection ranges.
    const masked = raw.split('').map((ch, i) => removed.some(([a, b]) => i >= a && i < b) ? ' ' : ch).join('');
    let contentOffset = masked.length - masked.trimStart().length;
    text = masked.trim();
    // Fullwidth conversion is confined to the leading identifier region.
    text = text.replace(/^[（［(\[]?\s*(?:(?:문항|Q)\s*)?[０-９]+(?:[．.：:）)］\]\s])/, part => part.replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10)).replace(/[（［．：）］]/g, c => ({'（':'(', '［':'[', '．':'.', '：':':', '）':')', '］':']'}[c])));
    const numbered = /^(?:\[\s*(?:문항\s*|Q\s*)?([1-9]\d{0,2}(?:\s*[-–]\s*[1-9]\d{0,2}){1,3})\s*\]|(?:문항\s*|Q\s*)([1-9]\d{0,2}(?:\s*[-–]\s*[1-9]\d{0,2}){0,3})\s*[:：.)]?|([1-9]\d{0,2})\s*번(?:\s*문항)?\s*[:：.)]?|\(([1-9]\d{0,2})\)|\[([1-9]\d{0,2})\]|([1-9]\d{0,2})[.)](?=\s)|([①-⑳]))\s*/i.exec(text);
    let prefix = null;
    if (numbered) {
      prefix = numbered[7] ? String(numbered[7].charCodeAt(0) - 0x2460 + 1) : cleanLabel(numbered.slice(1, 7).find(Boolean));
      const start = contentOffset;
      if (start >= 0) add('identifier', start, start + numbered[0].length, '질문 시작의 명시적 문항 표기');
      text = text.slice(numbered[0].length);
      contentOffset += numbered[0].length;
    }
    const canonical = s => s.replace(/([.!?。])\s*(?:※|\*{1,2}|•)\s*/g, '$1 ').replace(/\s*([（(])/g, ' $1').replace(/\u00a0/g, ' ').replace(/(서술|기술|작성|설명)(?:하시오|하십시오|해\s*(?:주세요|주십시오))/g, '$1')
      .replace(/([.!?。])(?=\s|[（(]|$)/g, ' ').replace(/\s+/g, ' ').trim();
    const key = canonical(text);
    const marked = /[.!?。]\s*(?:[（(]\s*)?(?:※|\*{1,2}|•)\s*/.exec(text);
    // Only a complete trailing group after a complete question can be separated.
    // Keep its raw span even when it cannot be proven to be a restatement.
    const trailing = !malformed && groups.find(([start, end]) => start >= contentOffset &&
      !masked.slice(end).trim() && /(?:[.!?。]|(?:하시오|하십시오|해\s*(?:주세요|주십시오)))\s*$/.test(masked.slice(contentOffset, start)) &&
      !removed.some(([a,b]) => a <= start && b >= end));
    const splitAt = trailing ? trailing[0] - contentOffset : marked?.index;
    const bodyText = splitAt == null ? text : text.slice(0, splitAt);
    const detail = trailing ? raw.slice(...trailing) : marked ? text.slice(marked.index + 1).trim() : '';
    const main = canonical(bodyText);
    const guideKind = detail && !malformed && restatedGuidance(bodyText, detail);
    const knownDetail = !!guideKind;
    const guidance = detail ? { raw: detail, restated: knownDetail, kind: guideKind || 'unknown',
      reason: guideKind === 'body-restatement' ? '안내의 내용어가 본 질문에 순서대로 있음' : guideKind === 'experience-outline' ? '경험 질문의 본문 주제와 서술 구조 목록 확인' : '추가 요구인지 확인 필요' } : null;
    if (trailing) {
      const span = spans.find(s => s.start === trailing[0] && s.end === trailing[1]);
      if (span) { span.kind = knownDetail ? 'guidance' : 'unknown'; span.reason = guidance.reason; }
    }
    const constraints = [];
    for (const m of text.matchAll(/성공|실패|포함|제외|금지|필수|반드시|장점|단점|강점|약점|찬성|반대|않[는은을아]|못[한하했]|아닌|없이|최근\s*\d+\s*년|\d+\s*(?:년|개월|가지|개)|(?:한|두|세)\s*가지/g)) {
      const start = contentOffset + m.index;
      constraints.push(m[0].replace(/\s/g, ''));
      if (start >= 0) add('constraint', start, start + m[0].length, '조건·기간·개수·부정 신호 보존');
    }
    for (const m of raw.matchAll(/[^.!?。\n()（）]{1,60}(?:대상으로|에 한하여|필수|반드시)[^.!?。\n()（）]*/g)) {
      spans.push({ kind: 'requirement', start: m.index, end: m.index + m[0].length, raw: m[0], reason: '명시적인 대상·필수 조건 문구 보존' });
    }
    // Unclassified material remains in key; identical unknowns are still exact matches.
    spans.push({ kind: 'body', start: 0, end: raw.length, raw, reason: '원문 보존; 별도 분류 구간을 제외한 비교 본문', text });
    if (malformed) spans.push({ kind: 'unknown', start: 0, end: raw.length, raw, reason: '불완전한 괄호 구조' });
    return { version: ANALYZER_VERSION, raw, id: meta.id || null, editorNumber: meta.editorNumber ?? null,
      label: meta.label || (prefix?.includes('-') ? prefix : null), prefix, listNumber: meta.listNumber ?? null,
      key, main, bodyText, detail, guidance, knownDetail, constraints, spans, malformed };
  }
  function compareQuestion(a, b) {
    const conflicts = [], uncertainty = [], evidence = [], changes = [];
    const label = a.label, number = a.editorNumber;
    const identity = label ? label === b.label : (number ?? (a.prefix && !a.prefix.includes('-') ? Number(a.prefix) : null)) === b.editorNumber;
    if ((label && label !== b.label) || (number != null && number !== b.editorNumber) ||
        (a.prefix && !a.prefix.includes('-') && Number(a.prefix) !== b.editorNumber) ||
        (a.label && a.prefix?.includes('-') && a.label !== a.prefix) ||
        (b.prefix && !b.prefix.includes('-') && Number(b.prefix) !== b.editorNumber)) conflicts.push('identifier');
    if (identity) evidence.push('identifier');
    const spacing = spacingDifference(a.key, b.key), coreSpacing = spacingDifference(a.main, b.main);
    const exact = !!a.key && a.key === b.key, sameMain = !!a.main && (a.main === b.main || coreSpacing.safe);
    if (a.raw !== b.raw && a.raw.replace(/\s+/g, ' ').trim() === b.raw.replace(/\s+/g, ' ').trim()) changes.push({ kind: 'whitespace-collapse', text: '연속 공백·줄바꿈 정리' });
    if (spacing.safe || (sameMain && coreSpacing.safe)) changes.push({ kind: 'word-spacing', text: '한국어 단어 사이 띄어쓰기 차이', boundaries: (spacing.safe ? spacing : coreSpacing).boundaries });
    if (spacing.equal && !spacing.safe && !exact) uncertainty.push('띄어쓰기 의미 경계 확인 필요');
    const opposite = [['성공', '실패'], ['포함', '제외'], ['장점', '단점'], ['강점', '약점'], ['찬성', '반대']];
    if (!exact) {
      if (opposite.some(([x, y]) => (a.constraints.includes(x) && b.constraints.includes(y)) || (a.constraints.includes(y) && b.constraints.includes(x)))) conflicts.push('opposite');
      const signals = c => c.constraints.filter(x => /않|못|아닌|없이|\d|가지/.test(x));
      const as = signals(a), bs = signals(b);
      if (as.length && bs.length && JSON.stringify(as) !== JSON.stringify(bs)) conflicts.push('condition');
      else if (JSON.stringify(as) !== JSON.stringify(bs)) uncertainty.push('조건·부정 표현의 생략 또는 변경');
    }
    const detailMatch = detailedMatch(detailedQuestion(a.raw, a.editorNumber), detailedQuestion(b.raw, b.editorNumber));
    const omitted = identity && sameMain && !a.malformed && !b.malformed && ((!a.detail && b.knownDetail) || (!b.detail && a.knownDetail));
    const spaced = identity && spacing.safe && !a.malformed && !b.malformed;
    if (exact || detailMatch || omitted || spaced) evidence.push('question');
    if (detailMatch && !identity) conflicts.push('identity-required');
    if (omitted) changes.push({ kind: 'guidance-omitted', text: '뒤 작성 안내 생략: ' + (a.guidance || b.guidance).reason, side: a.detail ? 'source' : 'target', raw: a.detail || b.detail });
    if (!exact && !omitted && !detailMatch && !spaced) uncertainty.push(a.detail || b.detail ? '작성 안내·추가 요구의 차이 확인 필요' : '질문 본문 차이');
    // A one-sided negative is not a proven opposite, but must not be recommended.
    const score = conflicts.length || uncertainty.some(x => x.startsWith('조건')) ? 0 : similarity(a.main, b.main);
    return { id: b.id, identity, exact, sameMain, evidence, conflicts, uncertainty, score, changes,
      sourceGuidance: a.guidance, targetGuidance: b.guidance,
      sourceQuestion: a.raw, targetQuestion: b.raw, difference: [...changes.map(c => c.text), ...uncertainty].join(' · ') || (exact ? '허용된 표시 차이 또는 원문 일치' : '요구 내용 차이') };
  }
  function memoryExpression(candidate) {
    if (!candidate.question?.trim()) return null;
    const a = analyzeQuestion(candidate.question);
    return a.key && a.key.length <= 4000 ? a.key : null;
  }
  function questionFingerprint(state) {
    return JSON.stringify(metadata(state).qnas.map(q => [q.id, q.number, q.question]).sort((a, b) => a[0].localeCompare(b[0])));
  }
  function map(candidates, state, choices = {}, memories = []) {
    candidatesValid(candidates);
    const { qnas } = metadata(state);
    const described = qnas.map(q => ({ ...q, analysis: analyzeQuestion(q.question, { id: q.id, editorNumber: q.number }) }));
    const rows = candidates.map(candidate => {
      const analysis = analyzeQuestion(candidate.question, { label: candidate.label, editorNumber: candidate.number, listNumber: candidate.provenance?.listNumber });
      const comparisons = described.map(q => compareQuestion(analysis, q.analysis));
      const matches = comparisons.filter(c => c.evidence.includes('question'));
      const eligible = comparisons.filter(c => c.evidence.includes('question') && !c.conflicts.length);
      let target = null, reason = '', evidence = [];
      if (matches.length === 1 && eligible.length === 1) { target = eligible[0].id; evidence = eligible[0].evidence; }
      if (!candidate.question.trim()) {
        const identities = comparisons.filter(c => c.identity && !c.conflicts.length);
        if (identities.length === 1) { target = identities[0].id; evidence = ['identifier']; }
      }
      if (target && described.filter(q => q.analysis.key === described.find(q => q.id === target).analysis.key || (!candidate.question && q.analysis.main === described.find(q => q.id === target).analysis.main)).length > 1) {
        target = null; reason = '같은 질문이 여러 문항에 있습니다.';
      }
      // A matching core cannot identify a target when omitted conditions distinguish two slots.
      const competing = comparisons.filter(c => c.sameMain);
      if (competing.length > 1) target = null;
      const expression = memoryExpression(candidate);
      const remembered = memories.filter(m => m.expression === expression);
      const ids = new Set(remembered.flatMap(m => m.targets));
      const rememberedId = ids.size === 1 ? [...ids][0] : null;
      const rememberedPair = comparisons.find(c => c.id === rememberedId);
      if (!target && expression && rememberedPair && !rememberedPair.conflicts.length && (matches.length === 0 || (matches.length === 1 && matches[0].id === rememberedId)) && competing.length <= 1 &&
          !described.some(q => q.id !== rememberedId && q.analysis.key === described.find(n => n.id === rememberedId).analysis.key)) {
        target = rememberedId; evidence = ['confirmed'];
      }
      if (ids.size > 1) { target = null; reason = '같은 질문 표현을 서로 다른 문항에 선택한 이력이 있습니다.'; }
      if (!target && !reason) reason = matches.length > 1 || competing.length > 1 ? '같은 질문이 여러 문항에 있습니다. 생략된 조건을 비교해 주세요.' :
        comparisons.some(c => c.conflicts.includes('identifier') && c.evidence.includes('question')) ? '번호와 질문이 서로 다른 문항을 가리킵니다.' :
        '질문 표현 또는 생략된 조건을 확인하고 대상 문항을 선택해 주세요.';
      const ranked = comparisons.filter(c => !c.conflicts.length).sort((a, b) => b.score - a.score);
      const suggestion = !target && ids.size <= 1 && ranked[0]?.score >= 0.8 && ranked[0].score - (ranked[1]?.score || 0) >= 0.08 ? ranked[0].id : null;
      return { candidate, analysis, comparisons, target, reason, suggestion, evidence };
    });
    const duplicateIds = new Set(rows.filter(r => r.target && rows.filter(x => x.target === r.target).length > 1).map(r => r.target));
    const disputedSuggestions = new Set(rows.filter(r => r.suggestion && rows.some(other => other !== r &&
      (other.target === r.suggestion || other.suggestion === r.suggestion))).map(r => r.suggestion));
    for (const r of rows) {
      if (duplicateIds.has(r.target)) { r.target = null; r.reason = '같은 문항의 후보가 여러 개입니다. 사용할 답변만 선택해 주세요.'; }
      if (disputedSuggestions.has(r.suggestion)) r.suggestion = null;
      if (Object.hasOwn(choices, r.candidate.key)) {
        const chosen = choices[r.candidate.key];
        if (chosen !== 'skip' && !qnas.some(q => q.id === chosen)) throw Error('선택한 문항이 없습니다.');
        r.manual = chosen !== 'skip'; r.target = chosen; r.reason = ''; r.evidence = ['manual'];
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
  root.JSLGpt = { analyzeQuestion, compareQuestion, memoryExpression, questionFingerprint, ANALYZER_VERSION, conversation, normalizeQuestion, questionKey, parse, metadata, sameQuestions, map, validate };
  if (typeof module !== 'undefined') module.exports = root.JSLGpt;
})(globalThis);
