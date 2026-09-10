const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), crypto = require('node:crypto');
const P = require('../../src/core/gpt-protocol');
function fixture() {
  const storage = {}, state = { resume: { id: 55, title: '예시기업' }, qnas: [{ id: 91, number: 1, question: '지원 동기', answer: '기존' }] };
  const targetTabs = [{ id: 2, url: 'https://jasoseol.com/resume/55', title: '예시기업', windowId: 1 }];
  const flags = { sourceValid: true, documentKey: 'doc1', writes: 0, beforeWrite: null, reads: 0, beforeRead: null };
  let listener;
  const chrome = { storage: { local: {
    get: async key => ({ [key]: storage[key] }), set: async values => Object.assign(storage, structuredClone(values)), remove: async key => { delete storage[key]; }
  } }, tabs: {
    query: async () => structuredClone(targetTabs), get: async id => structuredClone(targetTabs.find(t => t.id === id) || { id, url: 'https://example.com' }),
    create: async ({ url }) => ({ id: 99, url }),
    sendMessage: async (id, message) => {
      if (message.type === 'gpt:source-check') return { valid: flags.sourceValid };
      if (message.type === 'gpt:state') { flags.reads++; if (flags.beforeRead) await flags.beforeRead(); return { state: structuredClone(state), documentKey: flags.documentKey }; }
      if (message.type === 'gpt:write') {
        if (flags.beforeWrite) await flags.beforeWrite();
        P.validate(message.packet, state, true); flags.writes++;
        state.qnas[0].answer = message.packet.answers[0].text;
        return { applied: true, status: '입력 확인' };
      }
    }
  }, runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../src/core/gpt-background.js'), 'utf8'), { chrome, JSLGpt: P, importScripts() {}, URL, crypto, console });
  const base = { conversation: 'chat1', response: 'response1', fingerprint: 'hash1' };
  const send = (type, extra = {}, sender = {}) => new Promise(resolve => listener({ ...base, type, ...extra }, { frameId: 0, tab: { id: 1 }, url: 'https://chatgpt.com/c/chat1', ...sender }, resolve));
  const connect = async (extra = {}) => (await send('gpt:connect', { tabId: 2, ...extra })).link;
  const prepare = async (link, extra = {}) => send('gpt:prepare', { revision: link.revision, candidates: [{ key: '0', number: 1, question: '지원 동기', text: '새 답변' }], ...extra });
  return { flags, storage, state, targetTabs, send, connect, prepare };
}
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
