// 실제 MV3 확장 + 두 HTTPS 출처를 로컬 HTML로 대체. 실사이트 쓰기 없음.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const F = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsl-gpt-'));
(async () => {
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root] });
  context.setDefaultTimeout(10000);
  try {
    await context.route('https://jasoseol.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: F.resume(Number(new URL(route.request().url()).pathname.split('/')[2]) || 55) }));
    await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: F.chat }));
    const target = await context.newPage(); await target.goto('https://jasoseol.com/resume/55');
    const gpt = await context.newPage();
    const errors = []; gpt.on('pageerror', e => errors.push(e.message));
    await gpt.goto('https://chatgpt.com/g/project/c/fixture');
    const status = () => gpt.locator('[data-jsl-gpt] [role="status"]').first();
    const apply = () => gpt.getByRole('button', { name: '자소설에 적용', exact: true }).first().click();
    const waitStatus = text => status().filter({ hasText: text }).waitFor();
    const replace = async html => {
      await gpt.locator('.markdown').first().evaluate((node, value) => { node.innerHTML = value; }, html);
    };
    const answers = () => target.evaluate(() => model.qnas.map(q => q.answer));
    await apply(); await waitStatus('연결할 지원서를 선택');
    assert.deepEqual(await answers(), [1, 2, 3, 4, 5].map(n => '기존 ' + n));
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/ 탭' }).click();
    await waitStatus('문항 1, 2, 3, 4, 5 입력 확인');
    assert.deepEqual(await answers(), F.answers);
    assert.equal(await target.evaluate(() => saves), 0);
    await gpt.locator('.code-copy').first().click(); assert.equal(await gpt.evaluate(() => copied), 1);
    console.log('PASS: natural 5-question response, all code languages, exact text, first connection, native copy, no save');

    await gpt.getByRole('button', { name: '되돌리기', exact: true }).first().click();
    await waitStatus('되돌림');
    assert.deepEqual(await answers(), [1, 2, 3, 4, 5].map(n => '기존 ' + n));
    assert.equal(await target.evaluate(() => saves), 0);
    assert.equal(await gpt.getByRole('button', { name: '되돌리기', exact: true }).count(), 0);
    await apply(); await waitStatus('문항 1, 2, 3, 4, 5 입력 확인');
    assert.deepEqual(await answers(), F.answers);
    console.log('PASS: undo restores the five answers before the write, consumes the button, and re-apply still works');
    if (process.env.JSL_GPT_SCREENSHOT) await gpt.locator('[data-jsl-gpt]').first().screenshot({path:process.env.JSL_GPT_SCREENSHOT});
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const targetId = await worker.evaluate(async () => (await chrome.tabs.query({url:'https://jasoseol.com/resume/55'}))[0].id);
    await gpt.getByRole('button', {name:'자소설에서 확인 ↗',exact:true}).first().click();
    await gpt.waitForFunction(() => !document.querySelector('[data-jsl-gpt] button').disabled);
    assert.equal(await worker.evaluate(async id => (await chrome.tabs.get(id)).active, targetId), true);
    const otherWindow = await worker.evaluate(async id => (await chrome.windows.create({tabId:id,focused:false})).id, targetId);
    await gpt.bringToFront();
    await gpt.getByRole('button', {name:'자소설에서 확인 ↗',exact:true}).first().click();
    await gpt.waitForFunction(() => !document.querySelector('[data-jsl-gpt] button').disabled);
    assert.equal(await worker.evaluate(async id => (await chrome.windows.get(id)).focused, otherWindow), true);
    assert.deepEqual(await answers(), F.answers); assert.equal(await target.evaluate(() => saves), 0);
    await gpt.bringToFront();
    console.log('PASS: review button focuses applied tab and its other window without writing or saving');


    const sizes = await gpt.evaluate(() => { const a = document.querySelector('.markdown').getBoundingClientRect(), b = document.querySelector('[data-jsl-gpt]').getBoundingClientRect(); return [a.x, b.x, a.width, b.width]; });
    assert.ok(Math.abs(sizes[0] - sizes[1]) < 1 && Math.abs(sizes[2] - sizes[3]) < 1);
    await gpt.setViewportSize({ width: 390, height: 844 });
    assert.equal(await gpt.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await gpt.setViewportSize({ width: 1100, height: 800 });
    console.log('PASS: panel aligned to response content, 390px width without overflow');

    await replace(F.block(4, { answer: '네 번째 수정\n' }) + F.block(2, { heading: '문항 2 수정안', question: '', answer: '두 번째 수정\n' }));
    await apply(); await waitStatus('문항 4, 2 입력 확인');
    assert.deepEqual(await answers(), [F.answers[0], '두 번째 수정\n', F.answers[2], '네 번째 수정\n', F.answers[4]]);
    await gpt.reload();
    await gpt.getByText('연결: 예시기업 ICT 55', { exact: true }).waitFor();
    console.log('PASS: out-of-order partial revision and conversation binding persists on reload');

    await replace(F.block(1, { question: F.questions[1], answer: '충돌 후보' }));
    await apply(); await waitStatus('자동으로 맞추지 못');
    assert.notEqual((await answers())[0], '충돌 후보');
    await gpt.getByRole('combobox').selectOption('92');
    await gpt.getByRole('button', { name: '선택한 문항에 적용' }).click();
    await waitStatus('문항 2 입력 확인'); assert.equal((await answers())[1], '충돌 후보');
    await replace(F.block(2, { answer: '후보 A' }) + F.block(2, { answer: '후보 B' }));
    await apply(); await waitStatus('자동으로 맞추지 못');
    await gpt.getByRole('combobox').nth(0).selectOption('skip'); await gpt.getByRole('combobox').nth(1).selectOption('92');
    await gpt.getByRole('button', { name: '선택한 문항에 적용' }).click();
    await waitStatus('문항 2 입력 확인'); assert.equal((await answers())[1], '후보 B');
    console.log('PASS: conflicting question and duplicate candidates wait for explicit mapping');

    await replace(F.block(1, { question: F.questions[1], answer: '선택 중인 응답' }));
    await apply(); await waitStatus('자동으로 맞추지 못');
    await gpt.getByRole('combobox').selectOption('92');
    await gpt.locator('code').first().evaluate(node => { node.textContent = '재생성되어 달라진 응답'; });
    await gpt.getByRole('button', { name: '선택한 문항에 적용' }).click();
    await waitStatus('응답 내용이 변경'); assert.equal((await answers())[1], '후보 B');
    console.log('PASS: response edited while mapping cannot apply stale candidates');

    await replace('<pre><code>번호 없는 단일 블록</code></pre>');
    await gpt.locator('[data-jsl-gpt]').waitFor({ state: 'detached' });
    await replace('<h2>Codex 작업 지시문</h2><pre><code># 작업: 기능 구현\n저장소: 예시</code></pre>');
    assert.equal(await gpt.locator('[data-jsl-gpt]').count(), 0);
    await replace(F.block(2));
    await gpt.getByRole('button', { name: '자소설에 적용' }).waitFor();
    await gpt.locator('article').evaluate(node => node.dataset.isStreaming = 'true');
    await gpt.locator('[data-jsl-gpt]').waitFor({ state: 'detached' });
    await gpt.locator('article').evaluate(node => delete node.dataset.isStreaming);
    await gpt.getByRole('button', { name: '자소설에 적용' }).waitFor();
    assert.equal(await gpt.locator('[data-jsl-gpt]').count(), 1);
    const oldResponse = await gpt.locator('[data-jsl-gpt]').getAttribute('data-jsl-gpt-response');
    await gpt.locator('[data-message-author-role="assistant"]').evaluate(node => node.replaceWith(node.cloneNode(true)));
    await gpt.waitForFunction(old => document.querySelectorAll('[data-jsl-gpt]').length === 1 && document.querySelector('[data-jsl-gpt]').dataset.jslGptResponse !== old, oldResponse);
    console.log('PASS: unnumbered/unrelated code excluded; streaming and regenerated DOM remount one button');

    const other = await context.newPage(); await other.goto('https://jasoseol.com/resume/55');
    await apply(); await waitStatus('입력할 지원서 탭을 선택');
    assert.equal(await other.evaluate(() => model.qnas[1].answer), '기존 2');
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/ 탭' }).last().click();
    await waitStatus('문항 2 입력 확인'); assert.equal(await other.evaluate(() => model.qnas[1].answer), F.answers[1]);
    await other.close();
    console.log('PASS: duplicate target tabs never choose first/active automatically');

    await replace(F.block(2, { answer: '실패하면 입력되면 안 됨' }));
    const before = await answers();
    await target.evaluate(() => { model.answer_keyup = () => { throw Error('fixture failure'); }; });
    await apply(); await waitStatus('입력 확인 0/1'); assert.deepEqual(await answers(), before);
    await target.evaluate(() => { model.answer_keyup = q => setTimeout(() => { q.answer = '사이트 후처리로 변경'; }, 30); });
    await apply(); await waitStatus('입력 확인 0/1');
    assert.equal((await answers())[1], '사이트 후처리로 변경');
    await target.evaluate(() => { model.answer_keyup = () => {}; model.qnas[1].question = '변경된 질문'; });
    await apply(); await waitStatus('연결 후 지원서 문항이 변경');
    assert.equal((await answers())[1], '사이트 후처리로 변경');
    await target.evaluate(q => { model.qnas[1].question = q; }, F.questions[1]);
    console.log('PASS: hook failure rollback, delayed reread mismatch, changed questions rejected');

    // 같은 프로젝트의 다른 대화는 연결되지 않는다. SPA에서 이전 응답 패널도 즉시 무효화한다.
    await gpt.evaluate(() => history.pushState({}, '', '/g/project/c/another'));
    await gpt.locator('[data-jsl-gpt]').waitFor({ state: 'detached' });
    await gpt.locator('article').evaluate((node, html) => { node.outerHTML = html; }, F.turn(F.block(3)));
    await apply(); await waitStatus('연결할 지원서를 선택');
    const secondTarget = await context.newPage(); await secondTarget.goto('https://jasoseol.com/resume/56');
    await gpt.getByRole('button', { name: '자소설에 적용' }).click();
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/resume/56' }).click();
    await waitStatus('문항 3 입력 확인');
    await gpt.getByRole('button', { name: '연결 해제', exact: true }).click(); await waitStatus('연결을 해제');
    await gpt.goto('https://chatgpt.com/g/project/c/fixture');
    await gpt.getByText('연결: 예시기업 ICT 55', { exact: true }).waitFor();
    await gpt.getByRole('button', { name: '연결 변경', exact: true }).click();
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/resume/56' }).click();
    await waitStatus('연결을 변경했습니다');
    assert.equal(await secondTarget.evaluate(() => model.qnas[0].answer), '기존 1');
    await apply();
    await waitStatus('문항 1, 2, 3, 4, 5 입력 확인');
    assert.deepEqual(await secondTarget.evaluate(() => model.qnas.map(q => q.answer)), F.answers);
    await secondTarget.close();
    await apply(); await gpt.getByRole('button', { name: '연결된 지원서 열기' }).waitFor();
    assert.equal(await target.evaluate(() => saves), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: SPA conversation isolation, connect/change/unlink, missing tab, no save calls, no page errors');
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('jsl-gpt-'));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
