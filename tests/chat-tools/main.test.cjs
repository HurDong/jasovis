const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../src/core/chat-tools-main.js'), 'utf8');
function harness() {
  let response;
  const handlers = {}, reads = [], calls = [];
  const messages = [
    { id: 100, chat_id: 10, type: 'self', content: 'my message', created_at: '2026-09-08T01:00:00Z', remove_status: 1 },
    { id: 101, chat_id: 10, type: 'other', content: 'same nickname, other author', remove_status: 1 },
    { id: 102, chat_id: 10, type: 'self', content: 'removed private original', remove_status: 2 }
  ];
  const nodes = messages.map(message => ({ id: 'chat-message-' + message.id, __reactProps$test: { children: { props: { message } } } }));
  const panel = { isConnected: true, classList: ['chatBody-10'], getBoundingClientRect: () => ({ width: 359, height: 600, right: 359, left: 0 }), querySelectorAll: () => nodes };
  const store = { myChats: [{ id: 10, title: 'current' }, { id: 20, title: 'joined', unread_count: 4 }], roomInfo: { id: 10 },
    setRoomInfo(r) { calls.push(['room', r.id]); this.roomInfo = r; }, setPage(p) { calls.push(['page', p]); },
    setTargetMessage(v) { calls.push(['target', v]); }, setIsOpenChatContentSearch(v) { calls.push(['search', v]); }
  };
  function factory(m) {
    function setRoomInfo() {} function setMyChats() {} function setBeforeChatRoom() {} function setTargetMessage() {}
    m.exports.default = store;
  }
  const requireNative = id => { reads.push(id); const m = { exports: {} }; requireNative.m[id](m); return m.exports; };
  requireNative.m = { 'dynamic-id': factory, unrelated() { throw Error('must not execute unrelated modules'); } };
  const chunks = []; chunks.push = entry => entry[2](requireNative);
  const window = { webpackChunk_N_E: chunks, addEventListener: (event, cb) => { handlers[event] = cb; }, dispatchEvent: e => { response = e.detail.result; } };
  const context = vm.createContext({ window, document: { getElementById: () => panel }, innerWidth: 1000,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } });
  vm.runInContext(source, context);
  function request(action, payload = { chatId: 10 }) { response = null; handlers.JSL_CHAT_TOOLS_REQ({ detail: { id: 1, action, payload } }); return JSON.parse(JSON.stringify(response)); }
  return { request, store, panel, nodes, messages, reads, calls, requireNative, context };
}
test('mine uses native self flag, includes deleted placeholder, excludes other author', () => {
  const h = harness(), r = h.request('mine');
  assert.equal(r.ok, true); assert.deepEqual(r.messages.map(m => m.id), [100, 102]);
  assert.equal(r.messages[1].text, '삭제된 메시지입니다.'); assert.equal(JSON.stringify(r).includes('removed private original'), false);
  assert.equal(h.reads.length, 0);
});
test('partial or wrong-room props fail visibly instead of returning misleading zero', () => {
  const h = harness(); delete h.nodes[0].__reactProps$test;
  assert.equal(h.request('mine').reason, 'structure');
  const h2 = harness(); h2.messages[0].chat_id = 20;
  assert.equal(h2.request('mine').reason, 'structure');
});
test('wrong room and hidden panel do not read data or switch', () => {
  const h = harness(); assert.equal(h.request('mine', { chatId: 20 }).ok, false);
  h.panel.isConnected = false; assert.equal(h.request('switch', { chatId: 10, targetId: 20 }).ok, false);
  assert.equal(h.calls.length, 0);
});
test('room list returns only display metadata and executes one matching module', () => {
  const h = harness(); h.store.myChats[1].last_messages = [{ content: 'not needed' }];
  assert.deepEqual(h.request('rooms').rooms, [{ id: 10, title: 'current', unread: 0 }, { id: 20, title: 'joined', unread: 4 }]);
  assert.deepEqual(h.reads, ['dynamic-id']);
});
test('switch only accepts current joined rooms and clears native search/target', () => {
  const h = harness(); assert.equal(h.request('switch', { chatId: 10, targetId: 999 }).ok, false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.request('switch', { chatId: 10, targetId: 20 }).ok, true);
  assert.deepEqual(h.calls, [['search', false], ['target', null], ['room', 20], ['page', 'chatRoom']]);
});
test('room removed after listing cannot be entered from stale selection', () => {
  const h = harness(); h.request('rooms'); h.store.myChats.pop();
  assert.equal(h.request('switch', { chatId: 10, targetId: 20 }).ok, false);
  assert.equal(h.calls.length, 0);
});
test('ambiguous store modules fail closed', () => {
  const h = harness(); h.requireNative.m.duplicate = h.requireNative.m['dynamic-id'];
  assert.equal(h.request('rooms').reason, 'structure'); assert.deepEqual(h.reads, []);
});
test('duplicate injection does not add handlers or replace state', () => {
  const h = harness(); h.request('rooms'); vm.runInContext(source, h.context); h.request('rooms');
  assert.deepEqual(h.reads, ['dynamic-id']);
});
