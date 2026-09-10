const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/core/gpt-protocol');
const questions = ['현재의 자신을 기술하십시오.', '지원 동기를 작성하십시오.', '관심 분야를 설명하십시오.', '문제를 해결한 경험은?', '추가로 알리고 싶은 내용은?'];
const state = { resume: { id: 55, title: '예시기업 ICT' }, qnas: questions.map((question, i) => ({ id: 91 + i, number: i + 1, question, answer: '기존 ' + (i + 1) })) };
const h = (text, level = 3) => ({ type: 'heading', text, level });
const t = text => ({ type: 'text', text });
const c = text => ({ type: 'code', text });
const question = n => [h('문항 ' + n), t('문항 원문: ' + questions[n - 1]), t('글자 수 제한: 500자'), t('작성 전략: 제외'), c('[제목 ' + n + ']\n\n  본문\t그대로\n')];
test('전략·소재표·다섯 문항·검수표 중 답변만 추출하고 원문 보존', () => {
  const parsed = P.parse([h('지원 전략', 2), t('설명'), { type: 'boundary' }, h('이번 지원서 완성본', 1), ...[1, 2, 3, 4, 5].flatMap(question), h('최종 검수표', 2), { type: 'boundary' }, c('검수용 코드'), t('맺음말')]);
  assert.equal(parsed.length, 5);
  const mapped = P.map(parsed, state).packet;
  assert.deepEqual(mapped.answers.map(a => a.id), ['91', '92', '93', '94', '95']);
  assert.equal(mapped.answers[0].text, '[제목 1]\n\n  본문\t그대로\n');
});
test('일부 문항·출력 역순·번호만 있는 수정안 지원', () => {
  assert.deepEqual(P.map(P.parse([...question(4), ...question(2)]), state).packet.answers.map(a => a.number), [4, 2]);
  assert.equal(P.map(P.parse([h('문항 2 수정안'), c('수정 본문')]), state).packet.answers[0].id, '92');
});
test('번호 없는 단일 코드·Codex 작업 지시·소재표는 임의 매핑하지 않음', () => {
  assert.deepEqual(P.parse([c('아무 번호 없는 코드')]), []);
  assert.deepEqual(P.parse([h('Codex 작업 지시문'), c('# 작업: 구현하라\n저장소: ...')]), []);
  assert.deepEqual(P.parse([h('문항 2 수정안'), c('# 작업: 구현하라\n저장소: ...')]), []);
  assert.deepEqual(P.parse([h('문항 1'), { type: 'boundary' }, c('표 뒤의 무관한 코드')]), []);
});
test('번호 없어도 질문이 유일하게 일치하면 대응', () => {
  assert.equal(P.map(P.parse([t('문항 원문: ' + questions[2]), c('답변')]), state).packet.answers[0].number, 3);
});
test('표시 공백·줄바꿈·명시적 제한 정규화, 실제 내용 차이 보존', () => {
  for (const suffix of [' (최대 500자)', ' [500자 이내]', ' （500자）', ' 글자 수 제한: 500자', ' (500자, 공백 포함)']) {
    assert.equal(P.normalizeQuestion('지원  동기를\n작성하십시오.' + suffix), questions[1]);
  }
  for (const other of ['지원 동기를 작성하십시오!', '지원 경험을 작성하십시오.', '지원 동기를 작성하십시오. (금융 분야)', '지원동기를 작성하십시오.']) {
    assert.notEqual(P.normalizeQuestion(other), P.normalizeQuestion(questions[1]));
  }
  assert.notEqual(P.normalizeQuestion('아버지 가방'), P.normalizeQuestion('아버지가 방'));
  const packet = P.map(P.parse([h('문항 2'), t('문항 원문: 지원  동기를\n작성하십시오. (500자 이내)'), c('  답변\n')]), state).packet;
  assert.equal(packet.answers[0].question, questions[1]);
  assert.equal(packet.answers[0].text, '  답변\n');
});
test('번호·질문 충돌 및 없는 질문은 사용자 선택까지 보류', () => {
  const candidates = P.parse([h('문항 1'), t('질문: ' + questions[1]), c('답변')]);
  assert.equal(P.map(candidates, state).packet, null);
  assert.equal(P.map(candidates, state, { 0: '92' }).packet.answers[0].number, 2);
  assert.equal(P.map(P.parse([h('문항 1'), t('질문: 다른 질문'), c('답변')]), state).packet, null);
});
test('중복 후보는 명시적 선택·제외가 필요하고 중복 대상 금지', () => {
  const candidates = P.parse([h('문항 2 수정안'), c('안 A'), c('안 B')]);
  assert.equal(P.map(candidates, state).packet, null);
  assert.equal(P.map(candidates, state, { 0: 'skip', 1: '92' }).packet.answers[0].text, '안 B');
  assert.throws(() => P.map(candidates, state, { 0: '92', 1: '92' }), /여러 답변/);
});
test('정규화 충돌로 같은 질문이 둘이면 번호가 있어도 자동 확정하지 않음', () => {
  const copy = structuredClone(state); copy.qnas[0].question = questions[1] + ' (500자)';
  assert.equal(P.map(P.parse(question(2)), copy).packet, null);
});
test('연결 이후 지원서·문항 변경 및 준비 이후 답변 변경 거부', () => {
  const link = P.metadata(state), copy = structuredClone(state);
  assert.equal(P.sameQuestions(link, copy), true);
  copy.qnas[0].question += ' (500자)'; assert.equal(P.sameQuestions(link, copy), true);
  copy.qnas[0].question = '새 질문'; assert.equal(P.sameQuestions(link, copy), false);
  copy.resume.id = 56; assert.equal(P.sameQuestions(link, copy), false);
  const packet = P.map(P.parse(question(2)), state).packet;
  const changed = structuredClone(state); changed.qnas[1].answer = '사용자 수정';
  assert.throws(() => P.validate(packet, changed, true), /답변이 입력 준비 중 변경/);
  changed.qnas[1].question = '새 질문'; assert.throws(() => P.validate(packet, changed), /변경/);
  assert.equal(JSON.stringify(link).includes('기존'), false);
});
test('대화별 ID는 프로젝트 경로와 독립적이고 새 대화·임의 출처 제외', () => {
  assert.equal(P.conversation('https://chatgpt.com/g/project/c/abc-123'), 'abc-123');
  assert.equal(P.conversation('https://chatgpt.com/c/abc-123'), 'abc-123');
  assert.equal(P.conversation('https://chatgpt.com/g/project'), null);
  assert.equal(P.conversation('https://example.com/c/abc-123'), null);
});
