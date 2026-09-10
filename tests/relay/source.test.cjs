const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function fixture(noCanvas = false) {
  const frames = new Map(), events = {}, mediaEvents = {}, buttonEvents = {};
  const state = { paints: 0, strokes: 0, warnings: [], sent: [] };
  let nextFrame = 0, intersection, resize, clicked;
  const media = { matches: false, addEventListener: (name, fn) => { mediaEvents[name] = fn; } };
  const context = new Proxy({}, { get: (_, key) => {
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => { if (key === 'fillRect') state.paints++; if (key === 'stroke') state.strokes++; };
  }, set: () => true });
  const canvas = { width: 0, height: 0, clientWidth: 272, clientHeight: 38, getContext: () => noCanvas ? null : context };
  const label = { textContent: '' }, attrs = {}, classes = new Set();
  const button = {
    isConnected: true, innerHTML: '', textContent: '',
    classList: { add: c => classes.add(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) },
    setAttribute: (name, value) => { attrs[name] = value; },
    querySelector: name => name === 'canvas' ? canvas : label,
    addEventListener: (name, fn) => { buttonEvents[name] = fn; }, matches: () => false
  };
  const document = { hidden: false, addEventListener: (name, fn) => { events[name] = fn; } };
  const changed = [];
  const chrome = { runtime: { sendMessage: (msg, cb) => {
    state.sent.push(msg);
    changed.forEach(fn => fn({ jslRelayOn: { newValue: msg.type === 'relay:enable' ? 'demo' : null } }, 'local'));
    cb({ ok: true });
  } }, storage: { local: { get: (_, cb) => cb({}), set() {} }, onChanged: { addListener: fn => changed.push(fn) } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../src/features/relay-source.js'), 'utf8'), {
    JSL: { register: (_, fn) => fn(), ui: { ready: Promise.resolve(), addAction: (_, fn) => { clicked = fn; return button; } },
      onState: fn => fn({ resume: { id: 'demo' }, qnas: [{ number: 1, question: '가상 문항', answer: '가상 답변' }] }), emit() {} },
    chrome, document, window: { matchMedia: () => media, devicePixelRatio: 1 },
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} },
    IntersectionObserver: class { constructor(fn) { intersection = fn; } observe() {} },
    requestAnimationFrame: fn => { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id), setTimeout: () => 1, clearTimeout() {},
    console: { warn: msg => state.warnings.push(msg) }
  });
  await Promise.resolve();
  const step = now => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); };
  return { frames, state, button, canvas, label, attrs, media, document, events, mediaEvents, buttonEvents,
    step, show: () => { resize(); intersection([{ isIntersecting: true }]); },
    hide: () => intersection([{ isIntersecting: false }]), click: () => clicked() };
}

test('호버 효과와 라벨 전환이 캔버스와 호출 경로를 보존한다', async () => {
  const f = await fixture(); f.show(); f.step(100);
  const idleStrokes = f.state.strokes;
  f.buttonEvents.mouseenter(); f.step(150);
  assert.ok(f.state.strokes - idleStrokes > 100);
  f.click(); assert.equal(f.label.textContent, '자비스 닫기'); assert.equal(f.attrs['aria-pressed'], 'true');
  assert.ok(f.button.innerHTML.includes('<canvas'));
  f.click(); assert.equal(f.label.textContent, '자비스 호출');
  assert.deepEqual(f.state.sent.map(x => x.type), ['relay:enable', 'relay:disable']);
  assert.equal(f.state.warnings.length, 0);
});

test('숨김·화면 밖·분리 상태에서는 프레임을 멈추고 표시하면 재개한다', async () => {
  const f = await fixture(); f.show(); f.step(100); assert.equal(f.frames.size, 1);
  f.document.hidden = true; f.events.visibilitychange(); assert.equal(f.frames.size, 0);
  f.document.hidden = false; f.events.visibilitychange(); assert.equal(f.frames.size, 1);
  f.hide(); assert.equal(f.frames.size, 0);
  f.show(); assert.equal(f.frames.size, 1);
  f.button.isConnected = false; f.step(200); assert.equal(f.frames.size, 0);
});

test('모션 감소 설정은 정적으로 그리고 설정 해제 시 재개한다', async () => {
  const f = await fixture(); f.media.matches = true; f.show();
  assert.equal(f.frames.size, 0); assert.ok(f.state.paints > 0);
  f.media.matches = false; f.mediaEvents.change(); assert.equal(f.frames.size, 1);
  f.media.matches = true; f.mediaEvents.change(); assert.equal(f.frames.size, 0);
});

test('캔버스가 없어도 호출·닫기 기능은 동작한다', async () => {
  const f = await fixture(true);
  assert.equal(f.label.textContent, '자비스 호출'); f.click();
  assert.equal(f.label.textContent, '자비스 닫기'); assert.equal(f.frames.size, 0);
});
