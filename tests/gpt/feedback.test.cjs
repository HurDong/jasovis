const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../src/core/gpt-feedback.js');
const state = () => ({ resume: { id: 55 }, qnas: [
  { id: 91, number: 1, question: '문제를 해결한 경험은?', answer: '첫 문장입니다. 같은 단어와 같은 단어를 씁니다.\n\n두 번째 문장입니다. 🧩 한글 끝.', active: true },
  { id: 92, number: 2, question: '다른 문항', answer: '보내면 안 되는 다른 문항 내용', active: false }
] });
const code = text => ({ type: 'code', text });
const h = text => ({ type: 'heading', text });
const p = text => ({ type: 'text', text });

test('단어/문장/불연속 범위를 보관하고 같은 범위를 다시 담으면 종류만 바꾼다', () => {
  const d = F.create(state());
  F.add(d, 0, 8, 'context'); F.add(d, 0, 8, 'tone');
  const first = d.answer.indexOf('같은'), second = d.answer.lastIndexOf('같은');
  F.add(d, first, first + 2); F.add(d, second, second + 2, 'ask');
  assert.deepEqual(d.quotes.map(q => [q.id, q.kind]), [[1, 'tone'], [2, 'context'], [3, 'ask']]);
  d.quotes.splice(1, 1); F.add(d, first, first + 2);
  assert.deepEqual(d.quotes.map(q => q.id), [1, 3, 4]);
  assert.throws(() => F.add(d, 0, 3, 'shorter'), /요청 종류/);
});
test('겹치는 선택과 UTF-16 범위(이모지)를 원문 그대로 보존한다', () => {
  const d = F.create(state()); F.add(d, 0, 8); F.add(d, 2, 8);
  const start = d.answer.indexOf('🧩'); F.add(d, start, start + 2);
  assert.equal(d.quotes[2].text, '🧩'); assert.doesNotThrow(() => F.validate(d));
});
test('요청은 표지·규칙·형식·인용별 종류를 담고 다른 문항 본문이나 내부 ID를 보내지 않는다', () => {
  const d = F.create(state()); F.add(d, 0, 8, 'context'); F.add(d, 9, 11, 'tone'); F.add(d, 12, 14, 'ask');
  d.quotes[0].feedback = '캡스톤이었어'; d.quotes[2].feedback = '이 단어가 어색해?';
  const prompt = F.prompt(d);
  assert.ok(F.isRequest(prompt)); assert.ok(prompt.startsWith(F.MARK));
  assert.match(prompt, /문항 1: 문제를 해결한 경험은\?/);
  assert.match(prompt, /### 인용 N\n진단: 한두 문장\n수정안:\n```\n원문 인용을 대체할 문장\n```\n확인 필요: 없음/);
  assert.match(prompt, /\[인용 1 · 빠진 맥락\]\n원문: 첫 문장입니다\.\n주변 문맥: [^\n]+\n요청: [^\n]*맥락[^\n]*\n덧붙임: 캡스톤이었어/);
  assert.match(prompt, /\[인용 2 · AI 티\]/); assert.match(prompt, /\[인용 3 · 질문\][\s\S]*요청: 이 단어가 어색해\?/);
  assert.match(prompt, /지어내지 않습니다/);
  assert.doesNotMatch(prompt, /보내면 안 되는|\b55\b|\b91\b/);
});
test('질문 종류는 내용이 있어야 보내고, 담은 인용이 없거나 위치를 잃으면 보내지 않는다', () => {
  const d = F.create(state());
  assert.throws(() => F.prompt(d), /고칠 곳/);
  F.add(d, 0, 8, 'ask'); assert.throws(() => F.prompt(d), /질문 내용/);
  d.quotes[0].feedback = '짧게?'; assert.doesNotThrow(() => F.prompt(d));
  d.quotes[0].text = '만들어진 원문'; assert.throws(() => F.validate(d), /인용 원문/);
});
test('편집 뒤 재배치: 같은 자리 유지, 유일한 원문은 이동, 사라지거나 중복이면 위치를 잃는다', () => {
  const d = F.create(state());
  const same = d.answer.indexOf('같은');
  F.add(d, 0, 5); F.add(d, d.answer.indexOf('두 번째'), d.answer.indexOf('두 번째') + 5); F.add(d, same, same + 2);
  const edited = '추가한 머리말. ' + d.answer.replace('같은 단어와 같은 단어', '다른 표현과 다른 표현').replace('첫 문장', '첫 문장');
  const next = F.rebase(d, edited);
  assert.equal(next.quotes[0].start, edited.indexOf('첫 문장'));
  assert.equal(next.quotes[1].start, edited.indexOf('두 번째'));
  assert.equal(next.quotes[2].lost, true);
  assert.doesNotThrow(() => F.validate(next)); assert.throws(() => F.validate(next, true), /원문이 바뀐/);
  const dup = F.rebase(d, '같은 말 같은 말'); assert.equal(dup.quotes[2].lost, true); // 기록 위치 불일치 + 중복은 추측하지 않는다
  assert.equal(d.quotes[2].lost, undefined); // 원본 초안은 바꾸지 않는다
});
test('원문 한 글자 수정, 다른 문항/지원서, 문항 원문 변경을 각각 거부한다', () => {
  const d = F.create(state()); F.add(d, 0, 8);
  for (const mutate of [s => s.qnas[0].answer += '.', s => s.qnas.forEach(q => q.active = !q.active),
    s => s.resume.id = 56, s => s.qnas[0].question += '!']) {
    const changed = state(); mutate(changed); assert.throws(() => F.check(d, changed));
  }
  assert.doesNotThrow(() => F.check(d, state()));
});
test('읽기 실패나 활성 문항 중복을 빈 문항으로 취급하지 않는다', () => {
  assert.throws(() => F.create(null), /현재 문항/);
  const s = state(); s.qnas[1].active = true; assert.throws(() => F.create(s), /현재 문항/);
});
test('인용 주변 문맥은 현재 문단 안에서 앞뒤 120자로 제한한다', () => {
  const s = state(); s.qnas[0].answer = '앞 문단 비밀\n' + '가'.repeat(400) + '선택' + '나'.repeat(400) + '\n뒷 문단 비밀';
  const d = F.create(s), start = d.answer.indexOf('선택'); F.add(d, start, start + 2);
  const text = F.prompt(d); assert.doesNotMatch(text, /문단 비밀/); assert.doesNotMatch(text, /가{121}|나{121}/);
});

const quotes = [{ id: 1, kind: 'context', text: 'JobFit 프로젝트에서' }, { id: 2, kind: 'tone', text: ' 깊은 이해를 함양할 수 있었으며' },
  { id: 3, kind: 'context', text: '트래픽이 몰리는 시간대에는' }, { id: 4, kind: 'ask', text: '같은 원문' }];
test('정상 형식의 답을 인용별 수정안·진단·확인 필요로 읽고 앞뒤 공백은 원문 기준으로 맞춘다', () => {
  const blocks = [p('두 곳을 봤습니다.'), h('인용 1'), p('진단: 어디서 한 건지 없음'), p('수정안:'), code('교내 캡스톤에서 JobFit 서비스를 만들며\n'), p('확인 필요: 없음'),
    h('인용 2 — AI 티'), p('진단: 추상적\n수정안:'), code('수십만 건을 나눠 처리하는 법을 익혔고'), p('확인 필요: 없습니다.'),
    h('인용 3'), p('진단: 규모가 없음'), p('확인 필요: 피크 요청 규모를 알려 주세요'),
    h('인용 4'), p('진단: 그대로 좋음'), code('같은 원문'), h('인용 9'), code('요청하지 않은 번호')];
  const { items, seen } = F.parseReply(blocks, quotes);
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.deepEqual(items[1], { status: 'ready', replacement: '교내 캡스톤에서 JobFit 서비스를 만들며', diagnosis: '어디서 한 건지 없음', ask: '' });
  assert.equal(items[2].replacement, ' 수십만 건을 나눠 처리하는 법을 익혔고'); assert.equal(items[2].ask, '');
  assert.deepEqual(items[3], { status: 'ask', diagnosis: '규모가 없음', ask: '피크 요청 규모를 알려 주세요' });
  assert.equal(items[4].status, 'same');
});
test('굵은 문단 제목·대괄호 제목·다음 줄 확인 필요도 읽는다', () => {
  const { items } = F.parseReply([p('**인용 1**'), p('**진단:** 맥락 부족'), code('새 문장'), p('**확인 필요:**'), p('기간을 알려 주세요'),
    p('[인용 2]'), code('담백한 문장')], quotes.slice(0, 2));
  assert.equal(items[1].status, 'ready'); assert.equal(items[1].diagnosis, '맥락 부족'); assert.equal(items[1].ask, '기간을 알려 주세요');
  assert.equal(items[2].status, 'ready');
});
test('형식을 어긴 인용만 읽지 못함으로 표시한다: 누락·중복·여러 수정안·빈 수정안·틀 문구·긴 제목 문장', () => {
  const { items } = F.parseReply([h('인용 1'), code('하나'), code('둘'), h('인용 2'), code('   '),
    h('인용 3'), code('수정안: 인용 3 대체 문장'), h('인용 3'), code('다시'),
    p('인용 4에 대해서는 원문이 좋아 보이지만 조금 더 구체적으로 적으면 좋겠다는 긴 설명 문장입니다 정말로 깁니다'), code('설명 뒤 코드')], quotes);
  assert.match(items[1].reason, /여러 개/); assert.match(items[2].reason, /형식/);
  assert.match(items[3].reason, /여러 번/); assert.match(items[4].reason, /찾지 못/);
  const noCode = F.parseReply([h('인용 1'), p('진단: 좋음')], quotes.slice(0, 1)).items[1];
  assert.equal(noCode.status, 'invalid'); assert.equal(noCode.diagnosis, '좋음');
  assert.deepEqual(F.parseReply(null, quotes.slice(0, 1)).items[1].status, 'invalid');
});
test('받기 위치: 앞서 받은 인용의 길이 변화만큼 보정하고, 원문이 바뀌면 교체하지 않는다', () => {
  const s = state(); s.qnas[0].answer = 'A짧음 가운데 B끝 가운데';
  const d = F.create(s); F.add(d, 0, 3); const b = d.answer.indexOf('B끝'); F.add(d, b, b + 2);
  d.review = { 1: { state: 'applied', at: 0, replacement: 'A아주 길어진 문장', original: 'A짧음' } };
  const after = F.replaceAt(d.answer, 0, 'A짧음', 'A아주 길어진 문장');
  const q2 = d.quotes[1], at = F.locate(after, q2.text, F.hint(d, q2));
  assert.equal(at, after.indexOf('B끝'));
  assert.equal(F.locate('가운데 가운데', '가운데', 99), -1);
  assert.equal(F.locate('앞 가운데 뒤', '가운데', 99), 2);
  assert.throws(() => F.replaceAt(after, at + 1, 'B끝', 'x'), /원문이 바뀌어/);
  assert.equal(F.replaceAt(after, at, 'B끝', 'B'), 'A아주 길어진 문장 가운데 B 가운데');
});
test('v1 초안이나 알 수 없는 종류는 초안 형식 오류다', () => {
  const d = F.create(state()); F.add(d, 0, 3);
  assert.throws(() => F.validate({ ...d, version: 1 }), /초안 형식/);
  assert.throws(() => F.validate({ ...d, quotes: [{ ...d.quotes[0], kind: 'polish' }] }), /인용 원문/);
});
