const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/core/relay-profile.js');

test('새 설치는 개인정보 없이 시작하며 빈 객체끼리 참조를 공유하지 않는다', () => {
  const a = P.empty(), b = P.empty();
  a.categories.교육.push({title:'가상 교육',fields:[['교육시간','10']]});
  assert.equal(b.categories.교육.length, 0);
  assert.deepEqual(P.categories.map(c => b.categories[c].length), [0,0,0,0]);
});
test('저장 검증은 앞자리 0·날짜·앞뒤 공백·빈 줄을 보존한다', () => {
  const p = P.empty();
  p.categories.어학.push({title:'가상 어학',fields:[['등록번호','001-A'],['응시일','2026.01'],['설명','  첫 줄\n\n끝  ']]});
  assert.deepEqual(P.validate(JSON.parse(JSON.stringify(p))), p);
  const copy = P.validate(p); copy.categories.어학[0].fields[0][1]='changed';
  assert.equal(p.categories.어학[0].fields[0][1],'001-A');
});
test('숫자로 된 번호·알 수 없는 분류·버전·손상된 필드·과대한 데이터는 거절한다', () => {
  const p = P.empty(); p.categories.자격증=[{title:'가상',fields:[['등록번호',123]]}];
  assert.throws(()=>P.validate(p),/문자열/);
  assert.throws(()=>P.validate({...P.empty(),version:2}),/version/);
  const unknown=P.empty();unknown.categories.unknown=[];
  assert.throws(()=>P.validate(unknown),/분류/);
  const oversized=P.empty();oversized.source='a'.repeat(P.limit);
  assert.throws(()=>P.validate(oversized),/256KB/);
  const missing=P.empty();delete missing.categories.교육;
  assert.throws(()=>P.validate(missing),/배열/);
});
test('추가 메타데이터는 제외하고 HTML은 실행하지 않는 문자열로 보존한다', () => {
  const p = P.empty(); p.source='private note';p.categories.수상=[{title:'<img src=x onerror=alert(1)>',fields:[['내역','<script>alert(1)</script>']]}];
  const value=P.validate(p);assert.equal(value.source,undefined);assert.equal(value.categories.수상[0].title,p.categories.수상[0].title);
});
test('붙여넣기 병합은 첫 필드로 이름을 만들고 원문을 보존하며 같은 항목은 다시 넣지 않는다', () => {
  const current = P.empty();
  current.categories.어학.push({title:'가상 시험',fields:[['시험명','가상 시험'],['등록번호','0012-A']]});
  const text = JSON.stringify({version:1,categories:{
    어학:[{fields:[['시험명','가상 시험'],['등록번호','0012-A']]},{title:'무시됨',fields:[['시험명','가상 시험'],['등록번호','9999']]}],
    교육:[{fields:[['과정명','가상 과정’s 4기'],['주요내용','  첫 줄\n\n1 인 개발  ']]},{fields:[['과정명','가상 과정’s 4기'],['주요내용','  첫 줄\n\n1 인 개발  ']]}]
  }});
  const result = P.merge(current, text);
  assert.deepEqual(result.added, {어학:0,자격증:0,수상:0,교육:1});
  assert.equal(result.duplicates, 2);
  assert.deepEqual(result.conflicts, ['어학 · 가상 시험']);
  assert.deepEqual(result.value.categories.교육, [{title:'가상 과정’s 4기',fields:[['과정명','가상 과정’s 4기'],['주요내용','  첫 줄\n\n1 인 개발  ']]}]);
  assert.equal(current.categories.교육.length, 0);
});
test('붙여넣기 병합은 잘못된 JSON·형식·분류와 분류별 한도 초과를 편집본 변경 없이 거절한다', () => {
  const current = P.empty();
  assert.throws(()=>P.merge(current,'{'),/JSON 형식/);
  assert.throws(()=>P.merge(current,'[]'),/형식이 필요/);
  assert.throws(()=>P.merge(current,JSON.stringify({version:2,categories:{}})),/version/);
  assert.throws(()=>P.merge(current,JSON.stringify({version:1,categories:{기타:[]}})),/분류/);
  assert.throws(()=>P.merge(current,JSON.stringify({version:1,categories:{수상:[{fields:[['상훈명','   ']]}]}})),/항목 이름/);
  assert.throws(()=>P.merge(current,JSON.stringify({version:1,categories:{수상:[{fields:[['상훈명','가상'],['수상일자',20260101]]}]}})),/문자열/);
  const many = Array.from({length:51},(_,i)=>({fields:[['자격증명','가상 '+i]]}));
  assert.throws(()=>P.merge(current,JSON.stringify({version:1,categories:{자격증:many}})),/50/);
  assert.deepEqual(current, P.empty());
});
