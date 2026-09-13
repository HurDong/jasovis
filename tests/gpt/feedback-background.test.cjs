const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { webcrypto } = require('node:crypto');
const F = require('../../src/core/gpt-feedback.js'), P = require('../../src/core/gpt-protocol.js');
const code = fs.readFileSync(path.join(__dirname, '../../src/core/gpt-feedback-background.js'), 'utf8');
const copy = value => value == null ? value : structuredClone(value);
const source = { id: 'fixture-extension', frameId: 0, tab: { id: 1 }, url: 'https://jasoseol.com/resume/55' };
const gpt = { id: 'fixture-extension', frameId: 0, tab: { id: 2 }, url: 'https://chatgpt.com/g/project/c/fixture' };
function setup() {
  const data = { state: { resume: { id: 55, title: '가상 지원서' }, qnas: [
    { id: 91, number: 1, question: '가상 질문입니다.', answer: '가상 답변 원문입니다.', active: true }
  ] }, documentKey: 'source-document', editorAnswer: '가상 답변 원문입니다.' };
  const local = { 'gpt-conversation:fixture': { ...P.metadata(data.state), revision: 'revision-one' } }, session = {};
  const env = { data, local, session, delivers: 0, tabs: [{ id: 2, windowId: 1, url: gpt.url, title: '가상 대화' }], hook: null };
  const area = store => ({
    async get(k) { return copy(k == null ? store : { [k]: store[k] }); },
    async set(values) { Object.assign(store, copy(values)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k]; }
  });
  env.start = () => {
    let listener;
    const chrome = { runtime: { id: 'fixture-extension', onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: area(local), session: area(session) },
      tabs: { async query() { return copy(env.tabs); }, async update() {}, async create({ url }) { return { id: 2, windowId: 1, url }; },
        onRemoved: { addListener(fn) { env.removed = fn; } },
        async sendMessage(tab, message) {
          if (message.type === 'feedback:page-info') return { conversation: 'fixture', documentKey: 'gpt-document', url: gpt.url, title: '가상 대화', ready: true };
          env.delivers++;
          if (env.hook) await env.hook();
          const auth = await env.dispatch({ type: 'feedback:authorize', attempt: message.attempt, conversation: 'fixture', documentKey: 'gpt-document' }, gpt);
          if (!auth.ok) return { status: 'blocked', error: auth.error };
          if (env.disconnect) throw Error('fixture disconnected after click authorization');
          if (env.noClick) return { status: 'blocked', error: '클릭 직전 입력 변경으로 전송하지 않음' };
          return { status: 'sent' };
        } }, windows: { async update() {} } };
    const context = vm.createContext({ chrome, JSLFeedback: F, JSLGpt: P, crypto: webcrypto, URL, setTimeout, clearTimeout,
      locks: new Set(), key: id => 'gpt-conversation:' + id,
      origin: sender => new URL(sender.url).origin,
      binding: async id => copy(local['gpt-conversation:' + id]),
      readTarget: async () => copy(data) });
    vm.runInContext(code, context);
    env.dispatch = (message, sender = source) => new Promise(resolve => listener(message, sender, resolve));
  };
  env.start();
  env.draft = F.create(data.state); F.add(env.draft, 0, 5); env.draft.message = '인용 1을 자연스럽게 바꿔줘.';
  env.send = id => env.dispatch({ type: 'feedback:send', conversation: 'fixture', attempt: id, draft: copy(env.draft) });
  return env;
}
test('확인된 전송을 기록하고 워커 재시작 뒤 같은 요청을 다시 전달하지 않는다', async () => {
  const e = setup(); assert.equal((await e.send('attempt-one')).status, 'sent');
  assert.equal(e.session['feedback:attempt:attempt-one'].draft, undefined);
  e.start(); assert.equal((await e.send('attempt-one')).status, 'sent'); assert.equal(e.delivers, 1);
});
test('클릭 승인 이후 채널 실패는 확인 불가이며 재시작 뒤에도 재전송하지 않는다', async () => {
  const e = setup(); e.disconnect = true;
  assert.equal((await e.send('attempt-uncertain')).status, 'unknown');
  e.start(); e.disconnect = false;
  assert.equal((await e.send('attempt-uncertain')).status, 'unknown'); assert.equal(e.delivers, 1);
});
test('진행 중 기록이 남은 요청은 재시작 이후 자동으로 이어 보내지 않는다', async () => {
  for (const status of ['preparing', 'ready', 'committing']) {
    const e = setup(); e.session['feedback:attempt:old'] = { sourceTab: 1, status };
    assert.equal((await e.send('old')).status, 'unknown'); assert.equal(e.delivers, 0);
  }
});
test('클릭 허가 후라도 클라이언트가 클릭하지 않았음을 확인하면 blocked로 남긴다', async () => {
  const e = setup(); e.noClick = true;
  assert.equal((await e.send('no-click')).status, 'blocked');
  assert.equal(e.session['feedback:attempt:no-click'].status, 'blocked');
});
test('GPT로 전달한 뒤라도 클릭 승인 전에 원문·문항·연결·문서 변경을 거부한다', async () => {
  for (const mutate of [
    e => { e.data.state.qnas[0].answer += '!'; }, e => { e.data.editorAnswer += '!'; },
    e => { e.data.documentKey = 'reloaded'; }, e => { e.data.state.qnas[0].active = false; },
    e => { e.local['gpt-conversation:fixture'].revision = 'changed'; }
  ]) {
    const e = setup(); e.hook = () => mutate(e);
    assert.equal((await e.send('changed')).status, 'blocked');
    assert.equal(e.session['feedback:attempt:changed'].status, 'blocked');
  }
});
test('Angular 모델 반영 전 입력란만 바뀌어도 전송하지 않는다', async () => {
  const e = setup(); e.data.editorAnswer += '!';
  assert.equal((await e.send('raw-edit')).status, 'blocked'); assert.equal(e.delivers, 0);
});
test('다른 출처·프레임·확장에서 요청하거나 다른 지원서 연결을 고르면 거부한다', async () => {
  const e = setup();
  for (const sender of [{ ...source, frameId: 1 }, { ...source, id: 'another-extension' }, { ...source, url: 'https://example.com/' }])
    assert.equal((await e.dispatch({ type: 'feedback:load' }, sender)).ok, false);
  e.local['gpt-conversation:fixture'].resume.id = '56';
  assert.equal((await e.dispatch({ type: 'feedback:select', conversation: 'fixture' })).ok, false);
});
test('동시에 같은 요청을 다시 보내거나 같은 대화를 다른 요청으로 보내지 않는다', async () => {
  const e = setup(); let entered, release;
  const ready = new Promise(r => { entered = r; });
  e.hook = () => new Promise(r => { release = r; entered(); });
  const first = e.send('concurrent'); await ready;
  assert.equal((await e.send('concurrent')).ok, false);
  assert.equal((await e.send('another-request')).ok, false);
  release(); assert.equal((await first).status, 'sent'); assert.equal(e.delivers, 1);
});
test('동일 대화 탭 중복 시 임의 탭에 입력하지 않는다', async () => {
  const e = setup(); e.tabs.push({ ...e.tabs[0], id: 3 });
  assert.equal((await e.send('duplicate-tab')).status, 'blocked'); assert.equal(e.delivers, 0);
});
test('자소설 원본 탭 닫기 시 인용 초안과 전송 기록을 삭제한다', async () => {
  const e = setup(); await e.dispatch({ type: 'feedback:save', draft: e.draft }); await e.send('cleanup');
  e.session['feedback:draft:3:55:91'] = { draft: e.draft };
  await e.removed(1);
  assert.deepEqual(Object.keys(e.session), ['feedback:draft:3:55:91']);
});
