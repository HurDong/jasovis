// 가상 편집기에서 실제 hotkeys/checkpoint를 실행. 사이트 모델·저장 API는 사용하지 않는다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="outside">다른 입력으로 이동</button><main><textarea class="answer" style="width:500px;height:240px">가상 답변 1. 다음 문장.</textarea></main>');
    await page.evaluate(() => {
      const handlers = {}, subscribers = [];
      window.model = { number: 1, mode: 'replace', delay: 45, actions: [], values: ['가상 답변 1. 다음 문장.', '가상 답변 2. 다음 문장.', '가상 답변 3. 다음 문장.'] };
      const broadcast = () => subscribers.forEach(fn => fn({ qnas: model.values.map((answer, i) => ({ id: i + 101, number: i + 1, active: model.number === i + 1, answer })) }));
      window.JSL = {
        register: (_, fn) => fn(), on: (name, fn) => (handlers[name] ||= []).push(fn),
        emit: (name, payload) => (handlers[name] || []).forEach(fn => fn(payload)),
        onState: fn => { subscribers.push(fn); broadcast(); },
        action: async (name, payload) => {
          model.actions.push(name);
          if (name !== 'switchQna' || payload.number > 3) return { ok: false };
          const hadFocus = document.activeElement.matches('textarea.answer');
          model.number = payload.number;
          const ta = document.querySelector('textarea.answer');
          ta.value = model.values[model.number - 1];
          broadcast();
          // state가 먼저 도착하고 후속 렌더에서 포커스된 노드를 숨기거나 교체한다.
          if (hadFocus && model.mode !== 'reuse') setTimeout(() => {
            if (model.mode === 'replace') ta.replaceWith(ta.cloneNode(true));
            else { ta.style.display = 'none'; setTimeout(() => { ta.style.display = ''; }, 35); }
          }, model.delay);
          return { ok: true };
        }
      };
    });
    const checkpoint = process.env.JSL_FOCUS_BASELINE
      ? require('node:child_process').execFileSync('git', ['show', 'HEAD:src/features/checkpoint.js'], { cwd: root, encoding: 'utf8' })
      : fs.readFileSync(path.join(root, 'src/features/checkpoint.js'), 'utf8');
    await page.addScriptTag({ content: checkpoint });
    await page.addScriptTag({ path: path.join(root, 'src/features/hotkeys.js') });
    const focused = () => page.evaluate(() => document.activeElement === document.querySelector('textarea.answer') && document.activeElement.offsetParent !== null);
    for (const mode of ['replace', 'hide', 'reuse']) {
      await page.evaluate(mode => { model.mode = mode; }, mode);
      for (const number of [1, 2, 3, 1, 3, 2]) {
        await page.keyboard.press('Alt+' + number);
        await page.waitForTimeout(650); // 후속 렌더 이후 검사. Tab/클릭/입력을 끼우지 않는다.
        assert.equal(await focused(), true, `${mode}: consecutive Alt+${number}`);
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('jsl-checkpoint').shadowRoot.querySelector('.caret')).visibility), 'visible');
        assert.equal(await page.locator('textarea.answer').inputValue(), `가상 답변 ${number}. 다음 문장.`);
      }
    }
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => model.number), 3);
    assert.equal(await focused(), true);
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => model.number), 2);
    assert.equal(await focused(), true);

    // 빠른 연속 요청은 마지막 문항에만 정착한다.
    await page.keyboard.press('Alt+1');
    await page.keyboard.press('Alt+3');
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => model.number), 3);
    assert.equal(await focused(), true);

    // 안정 확인 중 클릭하거나 Esc로 나가면 타이머가 본문으로 되돌리지 않는다.
    for (const exit of ['click', 'escape']) {
      await page.keyboard.press('Alt+2');
      if (exit === 'click') await page.locator('#outside').click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(650);
      assert.equal(await focused(), false, exit);
    }
    await page.keyboard.press('Alt+1');
    await page.keyboard.type('TEST');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('textarea.answer').inputValue(), '가상 답변 1. 다음 문장.TEST');
    assert.ok((await page.evaluate(() => model.actions)).every(name => name === 'switchQna'));
    console.log('PASS: consecutive Alt+1/2/3, delayed replacement/hide, reused textarea, arrows, latest request, click/Esc cancellation, typing without save');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
