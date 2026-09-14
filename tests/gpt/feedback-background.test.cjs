const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { webcrypto } = require('node:crypto');
const F = require('../../src/core/gpt-feedback.js'), P = require('../../src/core/gpt-protocol.js');
const code = fs.readFileSync(path.join(__dirname, '../../src/core/gpt-feedback-background.js'), 'utf8');
const copy = value => value == null ? value : structuredClone(value);
const source = { id: 'fixture-extension', frameId: 0, tab: { id: 1 }, url: 'https://jasoseol.com/resume/55' };
const gpt = { id: 'fixture-extension', frameId: 0, tab: { id: 2 }, url: 'https://chatgpt.com/g/project/c/fixture' };
const LINE = '[자비스 요청] 자소설닷컴 1번 문항 답변에 대한 질문입니다.';
function setup() {
  const data = { state: { resume: { id: 55, title: '가상 지원서' }, qnas: [
    { id: 91, number: 1, question: '가상 질문입니다.', answer: '가상 답변 원문입니다.', active: true }
  ] }, documentKey: 'source-document', editorAnswer: '가상 답변 원문입니다.' };
  const local = { 'gpt-conversation:fixture': { ...P.metadata(data.state), revision: 'revision-one' } }, session = {};
  const env = { data, local, session, delivers: [], notices: [], activated: [], created: [],
    tabs: [{ id: 2, windowId: 1, active: false, url: gpt.url, title: '가상 대화' }], hook: null };
  const area = store => ({
    async get(k) { return copy(k == null ? store : { [k]: store[k] }); },
    async set(values) { Object.assign(store, copy(values)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k]; }
  });
  env.start = () => {
    let listener;
    const chrome = { runtime: { id: 'fixture-extension', onMessage: { addListener(fn) { listener = fn; } } },
      storage: { local: area(local), session: area(session) },
      tabs: { async query() { return copy(env.tabs); }, async update(id) { env.activated.push(id); return { id, windowId: 1 }; },
        async create(options) { env.created.push(options); const tab = { id: 2, windowId: 1, active: !!options.active, url: options.url }; env.tabs.push(tab); return tab; },
        onRemoved: { addListener(fn) { env.removed = fn; } },
        async sendMessage(tab, message) {
          if (message.type === 'feedback:page-info') return { conversation: 'fixture', documentKey: 'gpt-document', url: gpt.url, title: '가상 대화', ready: true };
          if (message.type === 'feedback:changed') { env.notices.push({ tab, ...message }); return; }
          if (message.type === 'feedback:locate') return { conversation: 'fixture', messageId: env.located || null, line: message.line };
          if (message.type === 'feedback:start-watch') { env.started = message; return { watching: true }; }
          env.delivers.push({ background: message.background, prompt: message.prompt });
          if (env.hook) await env.hook();
          // 뒤 탭에서 입력이 반영되지 않는 브라우저를 흉내 낸다. 넣은 글은 지웠다고 알린다.
          if (message.background && env.backgroundFails) return { status: 'blocked', retry: true, error: '뒤 탭 입력 실패' };
          const auth = await env.dispatch({ type: 'feedback:authorize', attempt: message.attempt, conversation: 'fixture', documentKey: 'gpt-document' }, gpt);
          if (!auth.ok) return { status: 'blocked', error: auth.error };
          if (env.disconnect) throw Error('fixture disconnected after click authorization');
          if (env.noClick) return { status: 'blocked', error: '클릭 직전 입력 변경으로 전송하지 않음' };
          return env.noEcho ? { status: 'sent' } : { status: 'sent', messageId: env.messageId || 'user-message-1' };
        } }, windows: { async update() {} } };
    const context = vm.createContext({ chrome, JSLFeedback: F, JSLGpt: P, crypto: webcrypto, URL, setTimeout, clearTimeout, structuredClone,
      locks: new Set(), key: id => 'gpt-conversation:' + id,
      origin: sender => new URL(sender.url).origin,
      binding: async id => copy(local['gpt-conversation:' + id]),
      readTarget: async () => copy(data) });
    vm.runInContext(code, context);
    env.dispatch = (message, sender = source) => new Promise(resolve => listener(message, sender, resolve));
  };
  env.start();
  env.ask = (start = 0, end = 5, request = '어색해?') => F.ask(data.state, data.editorAnswer, start, end, request);
  env.send = (id, ask = env.ask()) => env.dispatch({ type: 'feedback:send', conversation: 'fixture', attempt: id, ask: copy(ask) });
  return env;
}
const answerBlocks = [{ type: 'text', text: '진단: 딱딱함' }, { type: 'text', text: '수정안:' }, { type: 'code', text: '가상 대답' }, { type: 'text', text: '확인 필요: 없음' }];
const reply = (e, extra = {}, sender = gpt) => e.dispatch({ type: 'feedback:reply', attempt: 'wait', messageId: 'user-message-1', phase: 'complete', blocks: answerBlocks, ...extra }, sender);

test('뒤에 있는 GPT 탭으로 보내고 사용자의 탭은 옮기지 않는다', async () => {
  const e = setup(); assert.equal((await e.send('wait')).status, 'sent');
  assert.deepEqual(e.delivers.map(d => d.background), [true]);
  assert.deepEqual(e.activated, []);
  const record = e.session['feedback:attempt:wait'];
  assert.equal(record.userMessage, 'user-message-1'); assert.equal(record.ask, undefined);
  assert.equal(JSON.stringify(record.request), JSON.stringify({ resumeId: '55', questionId: '91', number: 1, quote: { text: '가상 답변', start: 0 }, request: '어색해?' }));
  assert.equal(e.session['feedback:slot:1'], 'wait');
  assert.ok(e.delivers[0].prompt.startsWith(LINE));
});
test('열린 대화 탭이 없으면 뒤에 새로 연다', async () => {
  const e = setup(); e.tabs.length = 0;
  assert.equal((await e.send('new-tab')).status, 'sent');
  assert.equal(e.created.length, 1); assert.equal(e.created[0].active, false); assert.deepEqual(e.activated, []);
});
test('뒤 탭 입력이 반영되지 않으면 잠깐 앞으로 가져와 한 번만 다시 넣고 곧바로 자소설 탭으로 돌아온다', async () => {
  const e = setup(); e.backgroundFails = true;
  assert.equal((await e.send('flash')).status, 'sent');
  assert.deepEqual(e.delivers.map(d => d.background), [true, false]);
  assert.deepEqual(e.activated, [2, 1]);
});
test('앞 탭 재시도에서도 막히면 blocked로 남기고 자소설 탭으로 돌아온다', async () => {
  const e = setup(); e.backgroundFails = true; e.noClick = true;
  assert.equal((await e.send('flash-blocked')).status, 'blocked');
  assert.deepEqual(e.activated, [2, 1]);
});
test('확인된 전송을 기록하고 워커 재시작 뒤 같은 요청을 다시 전달하지 않는다', async () => {
  const e = setup(); assert.equal((await e.send('attempt-one')).status, 'sent');
  e.start(); assert.equal((await e.send('attempt-one')).status, 'sent'); assert.equal(e.delivers.length, 1);
});
test('클릭 승인 이후 채널 실패는 확인 불가이며 재시작 뒤에도 재전송하지 않는다', async () => {
  const e = setup(); e.disconnect = true;
  assert.equal((await e.send('attempt-uncertain')).status, 'unknown');
  assert.equal(e.session['feedback:slot:1'], 'attempt-uncertain', 'GPT에 갔을 수 있는 질문은 칸을 차지한다');
  e.start(); e.disconnect = false;
  assert.equal((await e.send('attempt-uncertain')).status, 'unknown'); assert.equal(e.delivers.length, 1);
});
test('진행 중 기록이 남은 요청은 재시작 이후 자동으로 이어 보내지 않는다', async () => {
  for (const status of ['preparing', 'ready', 'committing']) {
    const e = setup(); e.session['feedback:attempt:old'] = { sourceTab: 1, status };
    assert.equal((await e.send('old')).status, 'unknown'); assert.equal(e.delivers.length, 0);
  }
});
test('클릭하지 않았음이 확인된 요청은 blocked이고 앞서 보낸 질문 칸을 지우지 않는다', async () => {
  const e = setup(); await e.send('wait');
  e.noClick = true;
  assert.equal((await e.send('no-click')).status, 'blocked');
  assert.equal(e.session['feedback:slot:1'], 'wait');
  assert.ok(e.session['feedback:attempt:wait']);
});
test('새 질문이 GPT로 가면 질문 칸은 하나라 이전 질문 기록을 지운다', async () => {
  const e = setup(); await e.send('wait'); await reply(e);
  e.messageId = 'user-message-2';
  assert.equal((await e.send('next', e.ask(6, 8, ''))).status, 'sent');
  assert.equal(e.session['feedback:attempt:wait'], undefined);
  assert.equal(e.session['feedback:slot:1'], 'next');
  const loaded = await e.dispatch({ type: 'feedback:load' });
  assert.equal(loaded.attempt.id, 'next'); assert.equal(loaded.attempt.request.quote.text, '원문');
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
  const e = setup(), ask = e.ask(); e.data.editorAnswer += '!';
  assert.equal((await e.send('raw-edit', ask)).status, 'blocked'); assert.equal(e.delivers.length, 0);
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
  release(); assert.equal((await first).status, 'sent'); assert.equal(e.delivers.length, 1);
});
test('동일 대화 탭 중복 시 임의 탭에 입력하지 않는다', async () => {
  const e = setup(); e.tabs.push({ ...e.tabs[0], id: 3 });
  assert.equal((await e.send('duplicate-tab')).status, 'blocked'); assert.equal(e.delivers.length, 0);
});
test('자소설 원본 탭 닫기 시 질문 칸과 전송 기록을 삭제한다', async () => {
  const e = setup(); await e.send('cleanup');
  e.session['feedback:slot:3'] = 'other'; e.session['feedback:attempt:other'] = { sourceTab: 3, status: 'sent' };
  await e.removed(1);
  assert.deepEqual(Object.keys(e.session).sort(), ['feedback:attempt:other', 'feedback:slot:3']);
});
test('보낸 메시지를 찾지 못하면 답을 기다리지 않고 확인 불가로 둔다', async () => {
  const e = setup(); e.noEcho = true;
  assert.equal((await e.send('no-echo')).status, 'unknown');
});
test('GPT 답을 판독해 보관하고 자소설 탭에 알리며, 불러오기에 요약으로 돌려준다', async () => {
  const e = setup(); await e.send('wait');
  assert.equal((await reply(e, { phase: 'streaming', blocks: answerBlocks.slice(0, 1) })).done, false);
  assert.equal(e.session['feedback:attempt:wait'].progress.streaming, true);
  assert.equal((await reply(e, { phase: 'streaming', blocks: answerBlocks.slice(0, 2) })).done, false);
  assert.equal(e.notices.length, 1, '쓰는 중 알림은 한 번만');
  assert.equal((await reply(e)).done, true);
  const item = e.session['feedback:attempt:wait'].reply.item;
  assert.deepEqual([item.status, item.replacement, item.diagnosis], ['ready', '가상 대답', '딱딱함']);
  assert.deepEqual(e.notices.map(n => [n.tab, n.done, n.number, n.questionId]), [[1, false, 1, '91'], [1, true, 1, '91']]);
  assert.equal((await reply(e)).done, true); assert.equal(e.notices.length, 2); // 완료 뒤 다시 읽지 않는다
  const loaded = await e.dispatch({ type: 'feedback:load' });
  assert.equal(loaded.attempt.status, 'sent'); assert.equal(loaded.attempt.reply.item.replacement, '가상 대답');
  assert.equal(JSON.stringify(loaded).includes('가상 답변 원문'), false);
  assert.equal(loaded.selected, 'fixture');
});
test('다른 지원서에서는 이 탭의 질문을 불러오지 않는다', async () => {
  const e = setup(); await e.send('wait');
  e.data.state.resume.id = 56;
  assert.equal((await e.dispatch({ type: 'feedback:load' })).attempt, null);
});
test('다른 출처·다른 메시지·다른 대화·기다리지 않는 요청의 답은 받지 않는다', async () => {
  const e = setup(); await e.send('wait');
  assert.equal((await reply(e, {}, { ...gpt, url: 'https://example.com/c/fixture' })).ok, false);
  assert.equal((await reply(e, { messageId: 'user-message-2' })).ok, false);
  assert.equal((await reply(e, {}, { ...gpt, url: 'https://chatgpt.com/c/other' })).ok, false);
  assert.equal((await reply(e, { attempt: 'missing' })).ok, false);
  assert.equal((await reply(e, { blocks: [{ type: 'script', text: 'x' }] })).ok, false);
  assert.equal(e.session['feedback:attempt:wait'].reply, undefined);
});
test('바꾼 결과는 받은 수정안과 고른 곳이 맞을 때만 기록하고, 되돌리면 지운다', async () => {
  const e = setup(); await e.send('wait');
  const review = { state: 'applied', at: 0, replacement: '가상 대답', original: '가상 답변' };
  assert.equal((await e.dispatch({ type: 'feedback:review', attempt: 'wait', review })).ok, false, '답이 오기 전에는 기록하지 않는다');
  await reply(e);
  assert.equal((await e.dispatch({ type: 'feedback:review', attempt: 'wait', review: { ...review, replacement: '지어낸 글' } })).ok, false);
  assert.equal((await e.dispatch({ type: 'feedback:review', attempt: 'wait', review }, { ...source, tab: { id: 9 } })).ok, false);
  assert.equal((await e.dispatch({ type: 'feedback:review', attempt: 'wait', review })).ok, true);
  assert.equal(JSON.stringify((await e.dispatch({ type: 'feedback:load' })).attempt.review), JSON.stringify(review));
  assert.equal((await e.dispatch({ type: 'feedback:review', attempt: 'wait', review: null })).ok, true);
  assert.equal((await e.dispatch({ type: 'feedback:load' })).attempt.review, null);
  assert.equal((await e.dispatch({ type: 'feedback:review', attempt: 'wait', review: { state: 'stale' } })).ok, true);
});
test('GPT 탭이 닫히면 기다리는 요청에 표시하고, 다시 열린 탭의 감시 요청에서 풀어 준다', async () => {
  const e = setup(); await e.send('wait');
  await e.removed(2);
  assert.equal(e.session['feedback:attempt:wait'].lost, true); assert.equal(e.notices.at(-1).done, false);
  const watched = await e.dispatch({ type: 'feedback:watch' }, { ...gpt, tab: { id: 7 } });
  assert.equal(JSON.stringify(watched.waiting), JSON.stringify([{ attempt: 'wait', messageId: 'user-message-1', line: LINE }]));
  assert.equal(e.session['feedback:attempt:wait'].lost, false); assert.equal(e.session['feedback:attempt:wait'].targetTab, 7);
  await reply(e); assert.equal((await e.dispatch({ type: 'feedback:watch' }, gpt)).waiting.length, 0);
});
test('정리는 보낸 자소설 탭만 할 수 있고, GPT에서 보기는 대화 탭을 앞으로 가져온다', async () => {
  const e = setup(); await e.send('wait');
  assert.equal((await e.dispatch({ type: 'feedback:dismiss', attempt: 'wait' }, { ...source, tab: { id: 9 } })).ok, false);
  assert.equal((await e.dispatch({ type: 'feedback:focus', attempt: 'wait' })).focused, true); assert.deepEqual(e.activated, [2]);
  assert.equal((await e.dispatch({ type: 'feedback:dismiss', attempt: 'wait' })).ok, true);
  assert.equal(e.session['feedback:attempt:wait'], undefined); assert.equal(e.session['feedback:slot:1'], undefined);
  assert.equal((await e.dispatch({ type: 'feedback:load' })).attempt, null);
});
test('확인 불가 요청은 사용자가 보냈다고 확인하면 다시 보내지 않고 대화에서 첫 줄로 메시지를 찾아 답을 기다린다', async () => {
  const e = setup(); e.noEcho = true;
  assert.equal((await e.send('claim')).status, 'unknown');
  assert.equal((await e.dispatch({ type: 'feedback:claim', attempt: 'claim' })).ok, false); // 아직 대화에 없음
  assert.equal((await e.dispatch({ type: 'feedback:claim', attempt: 'claim' }, { ...source, tab: { id: 9 } })).ok, false);
  e.located = 'user-message-9';
  assert.equal((await e.dispatch({ type: 'feedback:claim', attempt: 'claim' })).status, 'sent');
  const record = e.session['feedback:attempt:claim'];
  assert.equal(record.status, 'sent'); assert.equal(record.userMessage, 'user-message-9'); assert.equal(e.delivers.length, 1);
  assert.equal(e.started.line, LINE);
  assert.equal((await reply(e, { attempt: 'claim', messageId: 'user-message-9' })).done, true);
  const other = setup(); other.noEcho = true; await other.send('none'); other.tabs.length = 0;
  assert.match((await other.dispatch({ type: 'feedback:claim', attempt: 'none' })).error, /열려 있지 않습니다/);
});
