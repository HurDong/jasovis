// 실제 확장 메시지 경로를 가상 문항으로 확인한다. 실사이트 요청/입력은 없다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const F = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsl-matching-'));
const block = (index, overrides = {}) => F.block(index + 1, { heading: '문항 ' + F.compoundPairs[index].label,
  question: F.compoundPairs[index].response, answer: F.compoundPairs[index].answer, language: 'text', ...overrides });
(async () => {
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root] });
  context.setDefaultTimeout(10000);
  try {
    const errors = [];
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    await context.route('https://jasoseol.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: F.resume(77, false, F.compoundQnas) }));
    await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: F.chat.replace(F.full, F.compoundPairs.map((_, i) => block(i)).join('')) }));
    const target = await context.newPage(); await target.goto('https://jasoseol.com/resume/77');
    const gpt = await context.newPage(); await gpt.goto('https://chatgpt.com/g/project/c/compound');
    const status = text => gpt.locator('[data-jsl-gpt] [role="status"]').filter({ hasText: text }).waitFor();
    const apply = () => gpt.getByRole('button', { name: '자소설에 적용', exact: true }).click();
    const answers = () => target.evaluate(() => model.qnas.map(q => q.answer));
    const replace = html => gpt.locator('.markdown').evaluate((node, html) => { node.innerHTML = html; }, html);
    await apply(); await status('연결할 지원서를 선택');
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/ 탭' }).click();
    await status('입력 확인');
    assert.equal(await gpt.getByRole('combobox').count(), 0);
    assert.deepEqual(await answers(), F.compoundPairs.map(p => p.answer));
    assert.deepEqual(await target.evaluate(() => model.qnas.map(q => q.question)), F.compoundPairs.map(p => p.source));
    await gpt.getByRole('button', { name: '되돌리기', exact: true }).click(); await status('되돌림');
    assert.deepEqual(await answers(), F.compoundQnas.map(q => q.answer));
    console.log('PASS: 13 compound questions, omitted guides, source/answer preservation, native MV3 apply and undo');

    await replace(block(9, { question: '', answer: '단일 4-3 수정\n' }));
    await apply(); await status('문항 10 입력 확인');
    assert.equal((await answers())[9], '단일 4-3 수정\n');
    await gpt.getByRole('button', { name: '자소설에서 확인 ↗', exact: true }).click();
    await target.waitForFunction(() => model.currentQnaIndex === 9);
    console.log('PASS: label-only partial revision resolves actual input slot and review navigation');

    const before = await answers();
    await replace(block(1, { question: F.compoundPairs[1].main.replace('전문 분야', '전문 영역'), answer: '선택 후 입력할 가상 답변' }));
    await apply(); await status('자동으로 맞추지 못');
    await gpt.getByText('응답 문항 1-2', { exact: true }).waitFor();
    await gpt.getByText('문항 2의 질문이 비슷합니다. 원문을 비교한 뒤 선택하세요.', { exact: true }).waitFor();
    assert.match(await gpt.getByRole('combobox').locator('option[value="202"]').textContent(), /^추천 ·/);
    assert.equal(await gpt.getByRole('combobox').inputValue(), '');
    assert.deepEqual(await answers(), before);
    await gpt.getByRole('button', { name: '선택한 문항에 적용' }).click(); await status('각 답변의 대상 문항');
    assert.deepEqual(await answers(), before);
    await gpt.setViewportSize({ width: 390, height: 844 });
    assert.equal(await gpt.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await gpt.getByRole('combobox').selectOption('202');
    await gpt.getByRole('button', { name: '선택한 문항에 적용' }).click(); await status('문항 2 입력 확인');
    assert.equal((await answers())[1], '선택 후 입력할 가상 답변');
    assert.equal(await target.evaluate(() => saves), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: recommendation never preselects/writes, manual confirmation works, 390px layout, no save or page errors');

    await replace(block(1, { question: '[700자] ' + F.compoundPairs[1].main.replace('전문 분야', '전문 영역'), answer: '기억으로 적용한 가상 답변' }));
    await apply(); await status('문항 2 입력 확인');
    assert.equal(await gpt.getByRole('combobox').count(), 0);
    assert.equal((await answers())[1], '기억으로 적용한 가상 답변');
    await gpt.getByRole('button', { name: '대응 기억 삭제', exact: true }).click(); await status('대응 기억을 삭제');
    await replace(block(1, { question: F.compoundPairs[1].main.replace('전문 분야', '전문 영역'), answer: '삭제 후에는 선택 필요' }));
    await apply(); await status('자동으로 맞추지 못');
    assert.equal(await gpt.getByRole('combobox').inputValue(), '');
    assert.equal((await answers())[1], '기억으로 적용한 가상 답변');
    console.log('PASS: confirmed mapping survives display variation; delete restores unselected mapping, no extra write');

    await gpt.getByRole('button', { name: '연결 해제', exact: true }).click(); await status('연결을 해제');
    await target.evaluate(qnas => { model.qnas = qnas; model.currentQnaIndex = 0; }, F.wrappedQnas);
    await replace(F.wrappedPairs.map((p, i) => F.block(i + 1, { question: p.response, answer: p.answer, language: 'text' })).join(''));
    await apply(); await status('연결할 지원서를 선택');
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/ 탭' }).click();
    await status('문항 1, 2, 3, 4 입력 확인');
    assert.equal(await gpt.getByRole('combobox').count(), 0);
    assert.deepEqual(await answers(), F.wrappedPairs.map(p => p.answer));
    assert.deepEqual(await target.evaluate(() => model.qnas.map(q => q.question)), F.wrappedPairs.map(p => p.source));
    assert.equal(await target.evaluate(() => saves), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: parenthesized notice omission, NBSP and nested parentheses, four exact MV3 writes without mapping or save');
    await gpt.getByRole('button', { name: '연결 해제', exact: true }).click(); await status('연결을 해제');
    await target.evaluate(qnas => { model.qnas = qnas; model.currentQnaIndex = 0; }, F.languageQnas);
    await replace(F.languagePairs.map((p, i) => F.block(i + 1, { question: '[700자] ' + p.response + '\n700자 이내 / 영문 1400자', answer: p.answer, language: 'text' })).join(''));
    await apply(); await status('연결할 지원서를 선택');
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/ 탭' }).click();
    await status('문항 1, 2, 3, 4 입력 확인');
    assert.equal(await gpt.getByRole('combobox').count(), 0);
    assert.deepEqual(await answers(), F.languagePairs.map(p => p.answer));
    assert.deepEqual(await target.evaluate(() => model.qnas.map(q => q.question)), F.languagePairs.map(p => p.source));
    assert.equal(await target.evaluate(() => saves), 0);
    await gpt.getByRole('button', { name: '되돌리기', exact: true }).click(); await status('되돌림');
    assert.deepEqual(await answers(), F.languageQnas.map(q => q.answer));
    assert.deepEqual(errors, []);
    console.log('PASS: four question identities survive language limits and omitted notice; exact writes and undo, no save');
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('jsl-matching-'));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
