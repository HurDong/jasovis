const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../src/core/gpt-feedback.js');
const state = () => ({ resume: { id: 55 }, qnas: [
  { id: 91, number: 1, question: '문제를 해결한 경험은?', answer: '첫 문장입니다. 같은 단어와 같은 단어를 씁니다.\n\n두 번째 문장입니다. 🧩 한글 끝.', active: true },
  { id: 92, number: 2, question: '다른 문항', answer: '보내면 안 되는 다른 문항 내용', active: false }
] });
test('단어/문장/불연속 범위를 정확히 보관하고 같은 범위만 중복 제거한다', () => {
  const d = F.create(state());
  F.add(d, 0, 8); F.add(d, 0, 8);
  const first = d.answer.indexOf('같은'), second = d.answer.lastIndexOf('같은');
  F.add(d, first, first + 2); F.add(d, second, second + 2);
  assert.deepEqual(d.quotes.map(q => q.id), [1, 2, 3]);
  assert.equal(d.quotes[1].text, d.quotes[2].text);
  d.quotes.splice(1, 1); F.add(d, first, first + 2);
  assert.deepEqual(d.quotes.map(q => q.id), [1, 3, 4]);
});
test('겹치는 선택과 UTF-16 범위(이모지)를 원문 그대로 보존한다', () => {
  const d = F.create(state()); F.add(d, 0, 8); F.add(d, 2, 8);
  const start = d.answer.indexOf('🧩'); F.add(d, start, start + 2);
  assert.equal(d.quotes[2].text, '🧩'); assert.doesNotThrow(() => F.validate(d));
});
test('선택 문항과 인용별/공통 질문만 전달하고 다른 문항 본문을 보내지 않는다', () => {
  const d = F.create(state()); F.add(d, 0, 8); F.add(d, 9, 11);
  d.quotes[0].feedback = '이 문장을 짧게 바꿔줘'; d.message = '인용 1과 인용 2를 각각 봐줘';
  const prompt = F.prompt(d);
  assert.match(prompt, /현재 문항 1: 문제를 해결한 경험은\?/);
  assert.match(prompt, /\[인용 1\]/); assert.match(prompt, /이 문장을 짧게 바꿔줘/);
  assert.match(prompt, /\[공통 질문\]/); assert.doesNotMatch(prompt, /보내면 안 되는/);
  assert.equal((prompt.match(/\[주변 문맥/g) || []).length, 1);
});
test('참조한 인용을 삭제해도 남은 번호를 바꾸지 않고 잘못된 참조를 알린다', () => {
  const d = F.create(state()); F.add(d, 0, 8); F.add(d, 9, 11); d.message = '인용 1을 고쳐줘';
  d.quotes.shift(); assert.equal(d.quotes[0].id, 2);
  assert.throws(() => F.prompt(d), /삭제된 인용 1/);
});
test('질문이 없거나 원문이 다른 인용은 전송할 수 없다', () => {
  const d = F.create(state()); F.add(d, 0, 8);
  assert.throws(() => F.prompt(d), /질문을 적어/);
  d.quotes[0].feedback = '자연스럽게'; d.quotes[0].text = '만들어진 원문';
  assert.throws(() => F.prompt(d), /인용 원문/);
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
  const d = F.create(s), start = d.answer.indexOf('선택'); F.add(d, start, start + 2); d.message = '단어를 바꿔줘';
  const p = F.prompt(d); assert.doesNotMatch(p, /문단 비밀/); assert.doesNotMatch(p, /가{121}|나{121}/);
});
