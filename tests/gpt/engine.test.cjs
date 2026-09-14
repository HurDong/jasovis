const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../../src/core/gpt-protocol');
const body = '지원 직무에 관심을 갖게 된 이유와 앞으로의 목표를 기술하십시오.';
const state = (question = body) => ({resume:{id:77}, qnas:[{id:91,number:1,question,answer:'기존'}]});
const candidate = (question = body, number = 1) => ({key:'0',number,question,text:'  가상 답변\n'});
const run = (q, s=state(), memories=[]) => P.map([candidate(q)], s, {}, memories);
test('조합 표시 변환, 반복 분석과 UTF-16 구간 원문 보존', () => {
  for (const question of [body, '관측 장비를 점검한 순서와 측정 오차를 줄인 방법을 설명해 주세요.']) {
    for (const prefix of ['', '① ', '문항 1: ', '[1] ', '１． ', '（１） ']) for (const limit of ['[700자 이내]', '（700자 이내（영문 작성 시 1400자））', '(국문 700자 / 영문 1400자)']) {
      for (const text of [limit+' '+prefix+question, prefix+question+' '+limit, limit+'\n'+prefix+question+'\n700자 이내 / 영문 1400자']) {
        const result=run(text,state(question));
        assert.equal(result.packet?.answers[0].id,'91',text);
        const a=P.analyzeQuestion(text);
        assert.equal(a.key,P.analyzeQuestion(a.key).key);
        for(const span of a.spans) assert.equal(text.slice(span.start,span.end),span.raw);
        assert.ok(a.spans.some(s=>s.kind==='limit'));
      }
    }
  }
});
test('선택 예시, 원문이 같은 미분류·깨진 구조, 의미 기호 보존',()=>{
  assert.ok(run('(※ 구체적인 사례를 사용해도 됩니다) '+body).packet);
  assert.ok(run(body+' (예시: 가상 실험)').packet);
  for(const text of [body+' (알 수 없는 안내)',body+' (미완성', 'A+B의 차이를 기술하십시오.']) {
    assert.ok(run(text,state(text)).packet);
    if(text!==body) assert.equal(run(text).packet,null);
  }
  assert.equal(run('A-B의 차이를 기술하십시오.',state('A+B의 차이를 기술하십시오.')).packet,null);
});
test('필수 조건·대상·기간·개수·부정 변경은 자동 대응하지 않는다',()=>{
  for(const [a,b] of [['성공','실패'],['포함','제외'],['최근 3년','최근 5년'],['사례 2가지','사례 3가지'],['갖게 된','갖지 않는'],['고객','동료'],['반드시 결과를 포함','결과를 생략']]) {
    const q='협업에서 '+a+' 경험을 구체적으로 설명하십시오.';
    const r=run(q.replace(a,b),state(q)); assert.equal(r.packet,null,a);
    if(!['고객','반드시 결과를 포함'].includes(a))assert.equal(r.rows[0].suggestion,null,a);
  }
  const s=state(body+' ※ 최근 3년의 사례 2가지를 작성해주세요.');
  s.qnas.push({id:92,number:2,question:body+' ※ 최근 5년의 사례 3가지를 작성해주세요.',answer:''});
  assert.equal(run(body,s).packet,null);
  assert.equal(P.map([candidate('',1)],s).packet,null);
});
test('번호 충돌 추천 억제와 대상 순서·무관한 문항 추가 불변, 중복 재검사',()=>{
  const s=state(); s.qnas.push({id:92,number:2,question:'다른 활동을 설명하십시오.',answer:''});
  assert.equal(P.map([candidate(body,2)],s).rows[0].suggestion,null);
  const expected=run(body,s).packet.answers[0].id;
  s.qnas.reverse(); assert.equal(run(body,s).packet.answers[0].id,expected);
  s.qnas.push({id:93,number:3,question:'[700자] '+body,answer:''});
  assert.equal(run(body,s).packet,null);
  assert.equal(P.map([candidate('',1)],s).packet,null);
});
test('기억한 표현은 표시 변형만 재사용하고 충돌·중복·상반된 이력을 재검사',()=>{
  const expression=body.replace('관심을 갖게 된 이유','관심의 계기');
  const memories=[{expression:P.memoryExpression(candidate(expression)),targets:['91']}];
  assert.ok(run('[700자] '+expression,state(),memories).packet);
  assert.equal(run(expression.replace('계기','출발점'),state(),memories).packet,null);
  assert.equal(P.map([candidate(expression,2)],state(),{},memories).packet,null);
  assert.equal(run(expression,state(),[{...memories[0],targets:['91','92']}]).packet,null);
  assert.equal(P.map([candidate(expression),{...candidate(expression),key:'1'}],state(),{},memories).packet,null);
  assert.equal(P.memoryExpression(candidate('')),null);
  const s=state(); s.qnas.push({id:92,number:2,question:body,answer:''});
  assert.equal(run(expression,s,memories).packet,null);
});
test('추출 출처와 응답 목록 순번 분리, 검수 경계와 여러 수정안 유지',()=>{
  const blocks=[{type:'heading',level:3,text:'4. 문항 1 수정안'}, {type:'text',text:'질문: '+body}, {type:'code',text:'A'}, {type:'code',text:'B'}, {type:'text',text:'검수: 설명'}, {type:'code',text:'잘못된 코드'}];
  const c=P.parse(blocks); assert.equal(c.length,2); assert.equal(c[0].number,1); assert.equal(c[0].provenance.listNumber,4);
  assert.equal(c[0].provenance.code,2); assert.equal(c[1].provenance.code,3); assert.equal(P.map(c,state()).packet,null);
  assert.equal(P.parse([{type:'heading',level:3,text:'① 수정안'}, {type:'code',text:'A'}])[0].number,1);
});
