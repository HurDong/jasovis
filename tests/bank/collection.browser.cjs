const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://jasoseol.com/**', route => route.fulfill({ body: '<div ng-repeat="category_area in column.list"></div>' }));
    await page.goto('https://jasoseol.com/resume_list');
    await page.evaluate(() => {
      window.scope = { resumesInCurrentSeason: [] };
      window.angular = { element: () => ({ scope: () => scope }) };
      window.data = { jslAnswerBank: {}, jslAnswerBankCategoryVersion: 2, jslResumeStage: { 99: 4 } };
      const listeners = [];
      window.chrome = { storage: {
        local: {
          get: (keys, cb) => setTimeout(() => cb(structuredClone(data)), 10),
          set: values => {
            const changes = {};
            for (const [key, value] of Object.entries(values)) {
              changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
              data[key] = structuredClone(value);
            }
            listeners.forEach(fn => fn(changes, 'local'));
          }
        }, onChanged: { addListener: fn => listeners.push(fn) }
      } };
      window.importCalls = 0;
      window.importRequests = [];
      window.addEventListener('JSL_REQ', ev => { if (ev.detail.action === 'getFullResumes') {
        importCalls++; importRequests.push(ev.detail.payload);
      } });
      window.res = (id, answer, category = 2) => ({ id, name: '가상 기업 ' + id, category,
        qnas: [{ id: id * 100, number: 1, question: '지원동기', answer }] });
      window.broadcast = () => JSL.getState().then(state => window.dispatchEvent(new CustomEvent('JSL_STATE', { detail: state })));
    });
    await page.addScriptTag({ path: path.join(root, 'src/core/list-main.js') });
    await page.addScriptTag({ path: path.join(root, 'src/core/bridge.js') });
    // Inject bank before bridge's deferred feature init, then initialize explicitly if the timer already fired.
    await page.evaluate(() => { JSL.register = (_, fn) => fn(); JSL.ui = { ready: Promise.resolve(), addAction: () => {} }; });
    const source = process.env.JSL_BANK_BASELINE
      ? execFileSync('git', ['show', 'dca1707:src/features/bank.js'], { cwd: root, encoding: 'utf8' })
      : fs.readFileSync(path.join(root, 'src/features/bank.js'), 'utf8');
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(200); // storage initialization and the empty-list first request
    await page.evaluate(() => { scope.resumesInCurrentSeason = [res(1, '가상 답변 A'), res(2, '가상 답변 B')]; });
    await page.waitForFunction(() => Object.keys(data.jslAnswerBank).length === 2, { timeout: 6000 });
    assert.equal(await page.evaluate(() => data.jslResumeStage[99]), 4);

    const calls = await page.evaluate(() => importCalls);
    await page.evaluate(async () => { await broadcast(); await broadcast(); });
    assert.equal(await page.evaluate(() => importCalls), calls, 'unchanged snapshots do not fetch full answers again');

    // A different period, then answer hydration within that period, must both trigger collection.
    await page.evaluate(async () => { scope.resumesInCurrentSeason = [res(3, '')]; await broadcast(); });
    await page.waitForTimeout(50);
    await page.evaluate(async () => { scope.resumesInCurrentSeason = [res(3, '늦게 준비된 가상 답변')]; await broadcast(); });
    await page.waitForFunction(() => !!data.jslAnswerBank[300]);
    assert.equal(await page.evaluate(() => Object.keys(data.jslAnswerBank).length), 3);
    assert.equal(await page.evaluate(() => data.jslResumeStage[1]), 2);

    // Failed request is retried, without marking it imported.
    await page.evaluate(async () => {
      const action = JSL.action; let fail = true;
      JSL.action = (name, payload) => name === 'getFullResumes' && fail
        ? (fail = false, Promise.resolve({ ok: false })) : action(name, payload);
      scope.resumesInCurrentSeason = [res(4, '재시도 가상 답변')];
      await broadcast();
    });
    await page.waitForFunction(() => !!data.jslAnswerBank[400], { timeout: 6000 });

    // A late response from the previous period must not populate the current request.
    await page.evaluate(async () => {
      const action = JSL.action; let hold = true;
      JSL.action = (name, payload) => name === 'getFullResumes' && hold
        ? (hold = false, new Promise(resolve => { window.release = resolve; })) : action(name, payload);
      scope.resumesInCurrentSeason = [res(5, '이전 기간 가상 답변')]; await broadcast();
    });
    await page.waitForFunction(() => typeof release === 'function');
    await page.evaluate(async () => {
      scope.resumesInCurrentSeason = [res(6, '현재 기간 가상 답변')]; await broadcast();
      release({ ok: true, data: { resumes: [{ id: 5, title: '가상 기업 5', qnas: scope.resumesInCurrentSeason[0].qnas }] } });
    });
    await page.waitForFunction(() => !!data.jslAnswerBank[600], { timeout: 6000 });
    assert.equal(await page.evaluate(() => data.jslAnswerBank[600].resumeId), 6);

    // Clearing local bank while the list stays open makes the next snapshot collect it again.
    await page.evaluate(() => chrome.storage.local.set({ jslAnswerBank: {} }));
    await page.waitForFunction(() => !!data.jslAnswerBank[600], { timeout: 6000 });
    await page.evaluate(async () => {
      importRequests.length = 0;
      scope.resumesInCurrentSeason = Array.from({ length: 23 }, (_, i) => res(100 + i, '가상 긴 답변 '.repeat(300)));
      await broadcast();
      window.callsBeforeYield = importRequests.length;
    });
    await page.waitForFunction(() => !!data.jslAnswerBank[12200]);
    assert.equal(await page.evaluate(() => callsBeforeYield), 0, 'state handling does not synchronously request full answers');
    assert.deepEqual(await page.evaluate(() => importRequests.map(r => r.offset)), [0, 5, 10, 15, 20]);
    assert.equal(await page.evaluate(() => importRequests.every(r => r.limit === 5)), true);
    console.log('PASS: real list-main + bridge + bank: delayed list, period switch, delayed answers, unchanged deduplication, failed request retry, stale response, reset recovery, previous stages preserved');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
