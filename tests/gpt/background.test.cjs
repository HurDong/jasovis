const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), crypto = require('node:crypto');
const P = require('../../src/core/gpt-protocol');
const { narrativePairs } = require('./spacing-fixtures.cjs');
function fixture(storage = {}) {
  const state = { resume: { id: 55, title: '예시기업' }, qnas: [{ id: 91, number: 1, question: '지원 동기', answer: '기존' }] };
  const targetTabs = [{ id: 2, url: 'https://jasoseol.com/resume/55', title: '예시기업', windowId: 1 }];
  const flags = { sourceValid: true, documentKey: 'doc1', writes: 0, focusedTabs: [], focusedWindows: [], beforeWrite: null, reads: 0, beforeRead: null, undos: 0 };
  let listener;
  const chrome = { permissions: { onRemoved: { addListener() {} } }, storage: { local: {
    get: async key => ({ [key]: storage[key] }), set: async values => Object.assign(storage, structuredClone(values)), remove: async key => { delete storage[key]; }
  } }, tabs: {
    query: async () => structuredClone(targetTabs), get: async id => structuredClone(targetTabs.find(t => t.id === id) || { id, url: 'https://example.com' }),
    update: async (id, changes) => { flags.focusedTabs.push({id, ...changes}); },
    create: async ({ url }) => ({ id: 99, url }),
    sendMessage: async (id, message) => {
      if (message.type === 'gpt:source-check') return { valid: flags.sourceValid };
      if (message.type === 'gpt:review-question') { flags.reviewQuestion = message.question; return { focused: true }; }
      if (message.type === 'gpt:state') { flags.reads++; if (flags.beforeRead) await flags.beforeRead(); return { state: structuredClone(state), documentKey: flags.documentKey }; }
      if (message.type === 'gpt:write') {
        if (flags.beforeWrite) await flags.beforeWrite();
        P.validate(message.packet, state, true); flags.writes++;
        state.qnas[0].answer = message.packet.answers[0].text;
        return { applied: true, status: '입력 확인', verified: flags.unverified ? [] : message.packet.answers.map(a => a.number) };
      }
      if (message.type === 'gpt:undo') {
        flags.undos++;
        const reverted = [], kept = [];
        for (const item of message.revert) {
          const qna = state.qnas.find(q => String(q.id) === String(item.id));
          // 우리가 써넣은 값이 그대로 남은 문항만 되돌린다 — gpt-connect와 같은 규칙.
          if (!qna || (qna.answer || '') !== item.wrote) { kept.push(item.number); continue; }
          qna.answer = item.text; reverted.push(item.number);
        }
        return { reverted, kept, applied: reverted.length > 0 && !kept.length };
      }
    }
  }, windows: { update: async (id, changes) => { flags.focusedWindows.push({id, ...changes}); } }, runtime: { onMessage: { addListener: fn => { if (!listener) listener = fn; } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../src/core/gpt-background.js'), 'utf8'), { chrome, JSLGpt: P, importScripts() {}, URL, crypto, TextEncoder, console });
  const base = { conversation: 'chat1', response: 'response1', fingerprint: 'hash1' };
  const send = (type, extra = {}, sender = {}) => new Promise(resolve => listener({ ...base, type, ...extra }, { frameId: 0, tab: { id: 1 }, url: 'https://chatgpt.com/c/chat1', ...sender }, resolve));
  const connect = async (extra = {}) => (await send('gpt:connect', { tabId: 2, ...extra })).link;
  const prepare = async (link, extra = {}) => send('gpt:prepare', { revision: link.revision, candidates: [{ key: '0', number: 1, question: '지원 동기', text: '새 답변' }], ...extra });
  return { flags, storage, state, targetTabs, send, connect, prepare };
}
test('새 자동 대응의 준비 UI 근거·안내 원문을 전달하고 기억하지 않는다', async () => {
  const f = fixture(), p = narrativePairs[0];
  f.state.qnas[0].question = p.source;
  const link = await f.connect();
  const prepared = await f.prepare(link, { candidates: [{key:'0',number:1,question:p.response,text:'  검증 답변\n'}] });
  assert.ok(prepared.token);
  assert.equal(prepared.comparisons[0].mode,'automatic');
  assert.equal(prepared.comparisons[0].targetQuestion,p.source);
  assert.equal(prepared.comparisons[0].targetGuidance.raw,p.source.slice(p.source.indexOf('(')));
  assert.deepEqual(prepared.comparisons[0].changes.map(c=>c.kind),['word-spacing','guidance-omitted']);
  const applied = await f.send('gpt:apply',{revision:link.revision,token:prepared.token});
  assert.equal(applied.applied,true);
  assert.equal(f.state.qnas[0].question,p.source);
  assert.equal(f.state.qnas[0].answer,'  검증 답변\n');
  assert.equal(f.storage['gpt-confirmed-mappings'].length,0);
});

test('되돌리기는 입력 직전 답변으로 돌리고 토큰은 한 번만 쓴다', async () => {
  const f = fixture(), link = await f.connect(), p = await f.prepare(link);
  const applied = await f.send('gpt:apply', { revision: link.revision, token: p.token });
  assert.equal(applied.applied, true); assert.equal(f.state.qnas[0].answer, '새 답변'); assert.ok(applied.undoToken);
  const undone = await f.send('gpt:undo', { revision: link.revision, token: applied.undoToken });
  assert.deepEqual(undone.reverted, [1]); assert.equal(f.state.qnas[0].answer, '기존'); assert.equal(f.flags.undos, 1);
  const again = await f.send('gpt:undo', { revision: link.revision, token: applied.undoToken });
  assert.equal(again.ok, false); assert.match(again.error, /만료되거나 변경/); assert.equal(f.flags.undos, 1);
});
test('되돌리기는 사용자가 직접 고친 문항을 건드리지 않는다', async () => {
  const f = fixture(), link = await f.connect(), p = await f.prepare(link);
  const applied = await f.send('gpt:apply', { revision: link.revision, token: p.token });
  f.state.qnas[0].answer = '직접 수정';
  const undone = await f.send('gpt:undo', { revision: link.revision, token: applied.undoToken });
  assert.deepEqual(undone.kept, [1]); assert.equal(undone.applied, false); assert.equal(f.state.qnas[0].answer, '직접 수정');
});
test('연결·발신 응답·문서·대상 변경 뒤에는 되돌리지 않는다', async () => {
  for (const kind of ['link', 'source', 'document', 'response', 'target']) {
    const f = fixture(), link = await f.connect(), p = await f.prepare(link);
    const applied = await f.send('gpt:apply', { revision: link.revision, token: p.token });
    if (kind === 'link') await f.connect();
    if (kind === 'source') f.flags.sourceValid = false;
    if (kind === 'document') f.flags.documentKey = 'doc2';
    if (kind === 'target') f.targetTabs[0].url = 'https://jasoseol.com/resume/56';
    const r = await f.send('gpt:undo', { revision: link.revision, token: applied.undoToken,
      ...(kind === 'response' ? { response: 'response2' } : {}) });
    assert.equal(r.ok, false, kind); assert.equal(f.flags.undos, 0, kind); assert.equal(f.state.qnas[0].answer, '새 답변', kind);
  }
});
test('준비 토큰 단회 사용과 변경된 기존 답변 보호', async () => {
  const f = fixture(), link = await f.connect(), p = await f.prepare(link);
  f.state.qnas[0].answer = '사용자가 수정';
  const result = await f.send('gpt:apply', { revision: link.revision, token: p.token });
  assert.equal(result.ok, false); assert.match(result.error, /답변이 입력 준비 중 변경/); assert.equal(f.flags.writes, 0);
  const retry = await f.send('gpt:apply', { revision: link.revision, token: p.token });
  assert.match(retry.error, /만료되거나 변경/);
});
test('준비 후 연결 변경·발신 응답 변경·문서 새로고침은 쓰기 전에 거부', async () => {
  for (const kind of ['link', 'source', 'document', 'response', 'target']) {
    const f = fixture(), link = await f.connect(), p = await f.prepare(link);
    if (kind === 'link') await f.connect();
    if (kind === 'source') f.flags.sourceValid = false;
    if (kind === 'document') f.flags.documentKey = 'doc2';
    if (kind === 'target') f.targetTabs[0].url = 'https://jasoseol.com/resume/56';
    const r = await f.send('gpt:apply', { revision: link.revision, token: p.token, ...(kind === 'response' ? { response: 'response2' } : {}) });
    assert.equal(r.ok, false, kind); assert.equal(f.flags.writes, 0, kind);
  }
});
test('자동 선택 뒤 탭이 늘면 거부, 명시적 탭 선택은 존중', async () => {
  const f = fixture(), link = await f.connect(), p = await f.prepare(link);
  f.targetTabs.push({ ...f.targetTabs[0], id: 3 });
  assert.equal((await f.send('gpt:apply', { revision: link.revision, token: p.token })).ok, false);
  const explicit = await f.prepare(link, { tabId: 2 });
  assert.equal((await f.send('gpt:apply', { revision: link.revision, token: explicit.token })).applied, true);
  assert.equal(f.flags.writes, 1);
});
test('동시 응답·다른 대화 입력과 처리 중 연결 변경은 잠금으로 차단', async () => {
  const f = fixture(), link = await f.connect(), link2 = await f.connect({ conversation: 'chat2' });
  const p = await f.prepare(link), p2 = await f.prepare(link2, { conversation: 'chat2' });
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  f.flags.beforeWrite = () => new Promise(resolve => { release = resolve; started(); });
  const active = f.send('gpt:apply', { revision: link.revision, token: p.token });
  await began;
  assert.equal((await f.send('gpt:apply', { revision: link.revision, token: p.token })).ok, false);
  assert.equal((await f.send('gpt:unlink')).ok, false);
  const other = await f.send('gpt:apply', { conversation: 'chat2', revision: link2.revision, token: p2.token });
  assert.equal(other.ok, false); assert.match(other.error, /같은 지원서/);
  release(); assert.equal((await active).applied, true); assert.equal(f.flags.writes, 1);
});
test('출처·프레임 거부, 로컬 연결 정보에는 답변 본문을 저장하지 않음', async () => {
  const f = fixture();
  assert.equal((await f.send('gpt:connect', { tabId: 2 }, { url: 'https://example.com' })).ok, false);
  assert.equal((await f.send('gpt:connect', { tabId: 2 }, { frameId: 1 })).ok, false);
  const link = await f.connect(); await f.prepare(link);
  assert.equal(JSON.stringify(f.storage).includes('새 답변'), false); assert.equal(JSON.stringify(f.storage).includes('기존'), false);
});


test('확인 버튼은 실제 적용 탭과 그 창을 선택하고 추가 입력하지 않는다', async () => {
  const f = fixture(), link = await f.connect();
  f.targetTabs.push({ ...f.targetTabs[0], id: 3, windowId: 9 });
  const p = await f.prepare(link, { tabId: 3 });
  const result = await f.send('gpt:apply', { revision: link.revision, token: p.token });
  assert.equal(result.target.tabId, 3);
  const focused = await f.send('gpt:focus', { revision: link.revision, target: result.target });
  assert.equal(focused.focused, true);
  assert.equal(f.flags.reviewQuestion.number, 1);
  assert.equal(f.flags.reviewQuestion.id, '91');
  assert.deepEqual(f.flags.focusedTabs, [{id:3,active:true}]);
  assert.deepEqual(f.flags.focusedWindows, [{id:9,focused:true}]);
  assert.equal(f.flags.writes, 1);
});

test('확인 대상 소실·페이지 이동·연결 변경·응답 변경은 탭을 전환하지 않는다', async () => {
  for (const kind of ['closed', 'page', 'link', 'source', 'resume']) {
    const f = fixture(), link = await f.connect(), p = await f.prepare(link);
    const result = await f.send('gpt:apply', { revision: link.revision, token: p.token });
    if (kind === 'closed') f.targetTabs.length = 0;
    if (kind === 'page') f.targetTabs[0].url = 'https://jasoseol.com/resume/56';
    if (kind === 'link') await f.connect();
    if (kind === 'source') f.flags.sourceValid = false;
    if (kind === 'resume') result.target.resumeId = '56';
    assert.equal((await f.send('gpt:focus', {revision:link.revision,target:result.target})).ok, false, kind);
    assert.equal(f.flags.focusedTabs.length, 0, kind);
    assert.equal(f.flags.writes, 1, kind);
  }
});

test('수동 선택은 확인된 입력 후에만 기억하고 같은 표현을 재사용·삭제한다', async()=>{
  const f=fixture(),link=await f.connect();
  const candidates=[{key:'0',number:1,question:'지원한 계기',text:'비공개 가상 답변'}];
  assert.ok((await f.prepare(link,{candidates})).mapping);
  const p=await f.prepare(link,{candidates,choices:{0:'91'}});
  assert.deepEqual(f.storage['gpt-confirmed-mappings'],[]);
  await f.send('gpt:apply',{revision:link.revision,token:p.token});
  assert.equal(f.storage['gpt-confirmed-mappings'].length,1);
  assert.equal(JSON.stringify(f.storage['gpt-confirmed-mappings']).includes('비공개 가상 답변'),false);
  assert.ok((await f.prepare(link,{candidates})).token);
  await f.send('gpt:forget-mappings',{revision:link.revision});
  assert.ok((await f.prepare(link,{candidates})).mapping);
});
test('자동 대응·미확인 입력은 학습하지 않고 연결·문항·버전 변경은 기억을 폐기',async()=>{
  const f=fixture(),link=await f.connect(),p=await f.prepare(link);
  await f.send('gpt:apply',{revision:link.revision,token:p.token});
  assert.deepEqual(f.storage['gpt-confirmed-mappings'],[]);
  const candidates=[{key:'0',number:1,question:'지원한 계기',text:'가상 답변'}];
  async function learn(){const p=await f.prepare(link,{candidates,choices:{0:'91'}}); await f.send('gpt:apply',{revision:link.revision,token:p.token});}
  await learn(); f.storage['gpt-confirmed-mappings'][0].version=-1;
  assert.ok((await f.prepare(link,{candidates})).mapping);
  await learn(); f.state.qnas[0].question+=' (700자)';
  assert.ok((await f.prepare(link,{candidates})).mapping);
  await learn(); await f.connect(); assert.deepEqual(f.storage['gpt-confirmed-mappings'],[]);
});
test('상한·기한 정리와 준비 후 삭제, 미확인 결과를 기억하지 않음',async()=>{
  const f=fixture(),link=await f.connect();
  f.storage['gpt-confirmed-mappings']=Array.from({length:270},(_,i)=>({version:P.ANALYZER_VERSION,updated:Date.now(),conversation:'other'+i,expression:'가상 표현',targets:['91']}));
  await f.prepare(link); assert.equal(f.storage['gpt-confirmed-mappings'].length,256);
  f.storage['gpt-confirmed-mappings'].forEach(r=>r.updated=0); await f.prepare(link); assert.equal(f.storage['gpt-confirmed-mappings'].length,0);
  const candidates=[{key:'0',number:1,question:'지원한 계기',text:'가상 답변'}];
  const p=await f.prepare(link,{candidates,choices:{0:'91'}});
  await f.send('gpt:forget-mappings',{revision:link.revision});
  await f.send('gpt:apply',{revision:link.revision,token:p.token});
  assert.deepEqual(f.storage['gpt-confirmed-mappings'],[]);
  const p2=await f.prepare(link,{candidates,choices:{0:'91'}}); f.state.qnas[0].answer='직접 변경';
  assert.equal((await f.send('gpt:apply',{revision:link.revision,token:p2.token})).ok,false);
  assert.deepEqual(f.storage['gpt-confirmed-mappings'],[]);
});


test('작업자 재시작 후 저장 범위 복구와 검증되지 않은 입력의 학습 거부',async()=>{
  const f=fixture(),link=await f.connect();
  const candidates=[{key:'0',number:1,question:'지원한 계기',text:'가상 답변'}];
  f.flags.unverified=true;
  let p=await f.prepare(link,{candidates,choices:{0:'91'}});
  await f.send('gpt:apply',{revision:link.revision,token:p.token});
  assert.deepEqual(f.storage['gpt-confirmed-mappings'],[]);
  f.flags.unverified=false;
  p=await f.prepare(link,{candidates,choices:{0:'91'}});
  await f.send('gpt:apply',{revision:link.revision,token:p.token});
  const restarted=fixture(f.storage);
  assert.ok((await restarted.prepare(link,{candidates})).token);
  const other=await restarted.connect({conversation:'chat2'});
  assert.ok((await restarted.prepare(other,{conversation:'chat2',candidates})).mapping);
});
test('준비 뒤 선택하지 않은 문항의 표시 분량 변경도 원문 구성 지문으로 거부',async()=>{
  const f=fixture(); f.state.qnas.push({id:92,number:2,question:'추가 질문',answer:''});
  const link=await f.connect(),p=await f.prepare(link);
  f.state.qnas[1].question+=' (700자)';
  const result=await f.send('gpt:apply',{revision:link.revision,token:p.token});
  assert.equal(result.ok,false); assert.match(result.error,/문항 구성/); assert.equal(f.flags.writes,0);
});
