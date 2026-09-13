const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/core/gpt-protocol');
const { compoundPairs: pairs, compoundQnas } = require('./fixtures.cjs');
const state = { resume: { id: 77 }, qnas: compoundQnas };
const parse = (label, question, text = '가상 답변') => P.parse([
  { type: 'heading', level: 3, text: '문항 ' + label },
  ...(question ? [{ type: 'text', text: '문항 원문: ' + question }] : []), { type: 'code', text }
]);
const all = () => pairs.flatMap(p => parse(p.label, p.response, p.answer)).map((c, i) => ({ ...c, key: String(i) }));

test('복합 번호 13개와 명시적 안내 생략을 대응하고 입력 원문을 보존', () => {
  const candidates = all();
  assert.deepEqual(candidates.map(c => c.label), pairs.map(p => p.label));
  assert.ok(candidates.every(c => c.number === null));
  const packet = P.map(candidates, state).packet;
  assert.deepEqual(packet.answers.map(a => a.id), compoundQnas.map(q => String(q.id)));
  assert.deepEqual(packet.answers.map(a => a.question), pairs.map(p => p.source));
  assert.deepEqual(packet.answers.map(a => a.text), pairs.map(p => p.answer));
  assert.deepEqual(P.map(candidates.toReversed(), state).packet.answers.map(a => a.number), compoundQnas.map(q => q.number).reverse());
});
test('복합 번호만 있는 부분 수정과 띄어 쓴 번호는 입력칸 순번과 분리', () => {
  for (const label of ['2-2', '2 - 2', '2–2']) {
    assert.equal(P.map(parse(label, ''), state).packet.answers[0].number, 4);
  }
  assert.equal(P.map(parse('4-3', pairs[9].source), state).packet.answers[0].number, 10);
  // 편집기 순번으로 받은 응답도 지원한다.
  assert.equal(P.map(parse('10', pairs[9].main), state).packet.answers[0].number, 10);
  assert.equal(P.map(parse('10-수정안', ''), state).packet.answers[0].number, 10);
  for (const heading of ['Q2-2', '2-2번 문항']) {
    const candidates = P.parse([{ type: 'heading', level: 3, text: heading }, { type: 'code', text: '가상 수정' }]);
    assert.equal(P.map(candidates, state).packet.answers[0].number, 4);
  }
});
test('잘린 복합 번호, 중복 라벨, 번호와 질문 충돌은 자동 확정하지 않음', () => {
  for (const label of ['1-2-3-4-5', '1-0']) assert.deepEqual(parse(label, ''), []);
  assert.equal(P.map(parse('1-1', pairs[1].response), state).packet, null);
  assert.equal(P.map(parse('1-1', pairs[1].source), state).packet, null);
  assert.equal(P.map(parse('1', pairs[1].source), state).packet, null);
  const duplicate = structuredClone(state); duplicate.qnas[1].question = duplicate.qnas[0].question;
  assert.equal(P.map(parse('1-1', ''), duplicate).packet, null);
  const invalid = parse('1-1', ''); invalid[0].label = '1-0';
  assert.throws(() => P.map(invalid, state), /형식/);
});
test('본 질문 뒤의 임의 문장이나 서로 다른 지침은 생략 취급하지 않음', () => {
  const p = pairs[3];
  const modified = structuredClone(state);
  modified.qnas[3].question = '[문항2-2] ' + p.main + ' 반드시 결과도 설명하시오.';
  assert.equal(P.map(parse(p.label, p.main), modified).packet, null);
  const changed = p.source.replace('연도는 제외', '연도는 포함');
  assert.equal(P.map(parse(p.label, changed), state).packet, null);
  assert.equal(P.map(parse(p.label, p.main.replace('역량', '성격')), state).packet, null);
});
test('번호와 본 질문이 같으면 한정된 존대 종결 표현 차이를 처리', () => {
  const p = pairs[1];
  for (const ending of ['서술하십시오.', '서술해주세요.', '서술해 주세요.']) {
    assert.equal(P.map(parse(p.label, p.main.replace('서술하시오.', ending)), state).packet.answers[0].number, 2);
  }
});
test('유사도는 추천만 하고 선택 전에는 패킷을 생성하지 않음', () => {
  const p = pairs[1], candidates = parse(p.label, p.main.replace('전문 분야', '전문 영역'));
  const result = P.map(candidates, state);
  assert.equal(result.packet, null);
  assert.equal(result.rows[0].target, null);
  assert.equal(result.rows[0].suggestion, '202');
  assert.equal(P.map(candidates, state, { 0: '202' }).packet.answers[0].number, 2);
});
test('비슷한 후보가 둘이거나 같은 대상을 여러 답변이 추천하면 추천을 보류', () => {
  const query = '입사 후 성장하고 싶은 전문 영역과 목표를 서술하시오.';
  const candidates = [{ key: '0', number: null, question: query, text: '답변' }];
  const duplicate = structuredClone(state);
  duplicate.qnas[0].question = '[문항1-1] ' + pairs[1].main;
  assert.equal(P.map(candidates, duplicate).rows[0].suggestion, null);
  const twice = [candidates[0], { ...candidates[0], key: '1' }];
  assert.ok(P.map(twice, state).rows.every(r => !r.suggestion));
  const mixed = [candidates[0], { ...parse('1-2', pairs[1].main)[0], key: '1' }];
  assert.equal(P.map(mixed, state).rows[0].suggestion, null);
});
test('높은 문자 유사도여도 성공/실패와 포함/제외 변경을 추천하지 않음', () => {
  for (const [a, b] of [['성공', '실패'], ['포함', '제외'], ['강점', '약점']]) {
    const source = '팀 프로젝트에서 ' + a + ' 경험을 통해 배운 내용을 구체적으로 서술하시오.';
    const one = { resume: { id: 77 }, qnas: [{ id: 201, number: 1, question: '[문항1-1] ' + source, answer: '' }] };
    const result = P.map(parse('1-1', source.replace(a, b)), one);
    assert.equal(result.packet, null); assert.equal(result.rows[0].suggestion, null);
  }
});
test('복합 문항도 준비 뒤 질문 변경을 유사도로 우회하지 않음', () => {
  const packet = P.map(all(), state).packet, changed = structuredClone(state);
  changed.qnas[0].question += ' *수정된 안내입니다.';
  assert.equal(P.sameQuestions(P.metadata(state), changed), false);
  assert.throws(() => P.validate(packet, changed), /변경/);
});
