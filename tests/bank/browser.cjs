const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.route('https://jasoseol.com/**', route => route.fulfill({ body: '<title>가상 목록</title>' }));
    const page = await context.newPage();
    await page.setContent('<textarea id="draft">보존할 가상 초안</textarea>');
    await page.evaluate(() => {
      window.storageListeners = [];
      window.chrome = { storage: {
        local: { get: (_, cb) => cb({ jslAnswerBank: {}, jslAnswerBankCategoryVersion: 2 }), set: () => {} },
        onChanged: { addListener: fn => storageListeners.push(fn) }
      } };
      window.JSL = {
        register: (_, fn) => fn(), onState: () => {}, getState: async () => null,
        ui: { ready: Promise.resolve(), addAction: (_, fn) => { window.openBank = fn; } }
      };
      window.updateBank = (bank, stages) => storageListeners.forEach(fn => fn({
        jslAnswerBank: { newValue: bank }, jslResumeStage: { newValue: stages }
      }, 'local'));
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../src/features/bank.js') });
    await page.evaluate(() => window.openBank());
    await page.getByRole('button', { name: '우수 답변', exact: true }).click();
    const empty = page.locator('.empty');
    assert.match(await empty.innerText(), /아직 답변 뱅크에서/);
    const link = page.getByRole('link', { name: '자기소개서 목록 열기 (새 탭)' });
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://jasoseol.com/resume_list');
    assert.equal(page.url(), 'about:blank');
    assert.equal(await page.locator('#draft').inputValue(), '보존할 가상 초안');
    await popup.close();

    const bank = { 101: { resumeId: 1, resumeTitle: '가상 기업', number: 1, question: '지원동기', answer: '가상 답변', tags: ['지원동기·기업적합'] } };
    await page.evaluate(bank => updateBank(bank, {}), bank);
    assert.match(await empty.innerText(), /현재 선택한 기간/);
    await page.evaluate(bank => updateBank(bank, { 1: 2 }), bank);
    assert.equal(await page.locator('.item').count(), 1);
    assert.equal(await link.count(), 0);
    await page.locator('.search').fill('없는 검색어');
    await page.waitForFunction(() => document.querySelector('#jsl-bank-panel').shadowRoot.querySelector('.empty'));
    assert.match(await empty.innerText(), /검색·분류 조건/);
    assert.equal(await link.count(), 0);
    await page.locator('.search').fill('');
    await page.waitForFunction(() => document.querySelector('#jsl-bank-panel').shadowRoot.querySelector('.item'));
    await page.getByRole('button', { name: '필터', exact: true }).click();
    await page.getByRole('button', { name: '성취·실패', exact: true }).click();
    assert.match(await empty.innerText(), /검색·분류 조건/);
    assert.equal(await link.count(), 0);
    await page.evaluate(() => updateBank({}, {}));
    await page.setViewportSize({ width: 375, height: 667 });
    await link.scrollIntoViewIfNeeded();
    const bounds = await link.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);
    await link.focus();
    assert.equal(await link.evaluate(el => el.getRootNode().activeElement === el), true);
    if (process.env.JSL_BANK_SCREENSHOT) await page.screenshot({ path: process.env.JSL_BANK_SCREENSHOT });
    console.log('PASS: empty bank, unconfirmed stages, new-tab navigation, draft preservation, storage refresh, search/category filters, narrow viewport and keyboard focus');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
