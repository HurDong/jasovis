const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../../src/core/gpt-protocol');
const main = '협업 과정에서 본인의 역할과 결과를 설명해주세요.';
const guide = '(본인의 역할과 결과를 중심으로 작성해주세요.)';
const state = question => ({ resume: { id: 77 }, qnas: [{ id: 501, number: 1, question, answer: '기존\n' }] });
const candidate = (question, number = 1) => ({ key: '0', number, question, text: '  가상 답변\n\t끝\n' });
const run = (source, target) => P.map([candidate(source)], state(target));
const { narrativePairs } = require('./spacing-fixtures.cjs');

test('경험 서술의 재진술 목록과 보기 보존, 마침표 없는 주십시오 경계', () => {
  for (const p of narrativePairs) assert.ok(run(p.response, p.source).packet, p.source);
  for (const extra of ['고객사 검증자료', '실패', '최근 두 해', '동료의 역할', '선택 범위']) {
    const p = narrativePairs[0];
    assert.equal(run(p.response, p.source.replace('등 작성', extra + ' 등 작성')).packet, null, extra);
  }
});
test('띄어쓰기·뒤 재진술 안내·복합 차이를 식별하고 원문 보존', () => {
  for (const [source, target, changes] of [
    [main.replace('본인의 역할', '본인의역할'), main, ['word-spacing']],
    [main, main + ' ' + guide, ['guidance-omitted']],
    [main.replace('본인의 역할', '본인의역할'), main + ' ' + guide, ['word-spacing', 'guidance-omitted']],
    [main.replace('과정에서 ', '과정에서   '), main, ['whitespace-collapse']],
  ]) {
    const r = run(source, target);
    assert.equal(r.packet?.answers[0].id, '501', source + ' / ' + target);
    assert.equal(r.packet.answers[0].question, target);
    assert.equal(r.packet.answers[0].text, candidate(source).text);
    const pair = r.rows[0].comparisons[0];
    for (const kind of changes) assert.ok(pair.changes.some(c => c.kind === kind), kind);
    for (const a of [r.rows[0].analysis, P.analyzeQuestion(target)]) {
      assert.equal(a.raw, a === r.rows[0].analysis ? source : target);
      for (const span of a.spans) assert.equal(a.raw.slice(span.start, span.end), span.raw);
    }
  }
});
test('조건·대상·선택 범위·알 수 없는 안내는 표식 유무와 관계없이 보류', () => {
  for (const detail of ['최근 3년의 경험을 작성해주세요.', '사례 두 가지를 작성해주세요.',
    '고객을 대상으로 작성해주세요.', '반드시 증빙을 포함해주세요.', '실패 경험은 제외해주세요.',
    '팀 활동 중 하나만 선택하여 작성해주세요.', '본인의 성격을 작성해주세요.',
    '본인의 역할과 결과를 작성해주세요. 추가로 개선안을 설명해주세요.']) {
    for (const marker of ['', '※ ']) assert.equal(run(main, main + ' (' + marker + detail + ')').packet, null, detail);
  }
  for (const suffix of [' (본인의 역할과 결과를 작성해주세요.', ' ' + guide + ' 실패 원인도 작성해주세요.',
    ' (본인의 역할과 결과를 작성해주세요.）', ' ' + guide + ')']) assert.equal(run(main, main + suffix).packet, null, suffix);
  assert.equal(run(main + ' (역할을 제외해주세요.)', main + ' ' + guide).packet, null);
  assert.equal(run(main, '활동 작성법 → 증빙 조건 → 1. ' + main).packet, null);
});
test('숫자·영문·단위·의미 경계와 번호 충돌은 공백 삭제로 확정하지 않음', () => {
  for (const [a,b] of [['1 0개','10개'], ['AI ML','AIML'], ['10 kg','10kg'], ['아버지 가방','아버지가 방'], ['안 한다','안한다'], ['한 가지','한가지']]) {
    assert.equal(run(a + ' 경험을 설명해주세요.', b + ' 경험을 설명해주세요.').packet, null, a);
  }
  assert.equal(P.map([candidate(main, 2)], state(main)).packet, null);
  assert.equal(P.map([candidate(main.replace('본인의 역할', '본인의역할'), null)], state(main)).packet, null);
  for (const [a,b] of [['성공','실패'], ['포함','제외']]) assert.equal(run(main + a, main + b).packet, null);
  const longMain = '관측 장비를 점검한 경험과 분석한 결과를 이후 학습 계획에 연결하여 구체적으로 서술해주세요.';
  for (const [a,b] of [['AI ML','AIML'],['1 0개','10개'],['10 kg','10kg'],['1.0','10']]) {
    for (const wrap of [s=>'('+s+')',s=>s]) assert.equal(run(longMain+' '+wrap(a),longMain+' ('+b+')').packet,null,a);
  }
  const spaced = candidate(main.replace('본인의 역할','본인의역할'));
  assert.notEqual(P.memoryExpression(spaced),P.memoryExpression(candidate(main)));
});
test('같은 본 질문의 안내 구별·중복 응답은 수동, 부분·역순은 실제 ID로 대응', () => {
  const s = state(main + ' ' + guide);
  s.qnas.push({ id: 502, number: 2, question: main + ' (최근 3년의 경험을 작성해주세요.)', answer: '' });
  assert.equal(P.map([candidate(main)], s).packet, null);
  assert.equal(P.map([candidate(s.qnas[0].question)], s).packet, null, '안내가 재현되어도 같은 본 질문의 대상은 수동');
  assert.equal(P.map([candidate(main), { ...candidate(main), key: '1' }], state(main + ' ' + guide)).packet, null);
  s.qnas[1].question = '학습 과정에서 본인의 목표와 계획을 설명해주세요. (목표와 계획을 작성해주세요.)';
  const second = { ...candidate('학습 과정에서 본인의목표와 계획을 설명해주세요.', 2), key: '1' };
  assert.deepEqual(P.map([second, candidate(main)], s).packet?.answers.map(a => a.id), ['502', '501']);
  assert.equal(P.map([second], s).packet?.answers[0].id, '502');
});
