// 인용 배지가 섞인 질문 추출을 실제 MV3 경로와 가상 사이트에서 검증한다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const F = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsl-citation-'));
const questions = [
  '가상기업에 지원한 계기와 해당 분야에 관심을 가진 이유를 설명해 주세요.',
  '가상자료를 활용하여 전문 역량을 키운 경험을 구체적으로 설명해 주세요.',
  '새로운 도구로 반복 작업을 줄인 경험과 결과를 구체적으로 설명해 주세요.'
];
const answers = questions.map((_, i) => '[가상 답변 ' + (i + 1) + ']\n\n  가상자료+1도 답변에는 보존합니다.\t끝\n');
answers[2] += '<span data-testid="webpage-citation-pill">답변 안의 예시 코드</span>\n';
const qnas = questions.map((question, i) => ({ id: 501 + i, number: i + 1, question, answer: '기존 ' + (i + 1) }));
const citation = (label = '가상자료', count = '') =>
  `<span class="contents" data-content-reference-start="10" data-content-reference-end="20"><span data-state="closed"><span data-testid="webpage-citation-pill"><a href="https://example.invalid/source"><span><span>${label}</span>${count ? `<span>${count}</span>` : ''}</span></a></span></span></span>`;
const block = (i, questionHtml, headingHtml = '문항 ' + (i + 1)) => F.block(i + 1, { question: questions[i], answer: answers[i], language: 'text' })
  .replace(`<h3>문항 ${i + 1}</h3>`, `<h3>${headingHtml}</h3>`)
  .replace(questions[i], questionHtml);
const full = block(0, questions[0] + ' ' + citation()) +
  block(1, questions[1].replace('가상자료', '<a href="https://example.invalid/guide">가상자료</a>') + ' ' + citation(), '문항 2 ' + citation('별도자료')) +
  block(2, questions[2] + ' ' + citation('다른자료', '+1'));
(async () => {
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root] });
  context.setDefaultTimeout(10000);
  try {
    const errors = [];
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    await context.route('https://jasoseol.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: F.resume(77, false, qnas) }));
    await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: F.chat.replace(F.full, full) }));
    const target = await context.newPage(); await target.goto('https://jasoseol.com/resume/77');
    const gpt = await context.newPage(); await gpt.goto('https://chatgpt.com/g/project/c/citation-fixture');
    const status = text => gpt.locator('[data-jsl-gpt] [role="status"]').filter({ hasText: text }).waitFor();
    const apply = () => gpt.getByRole('button', { name: '자소설에 적용', exact: true }).click();
    const readAnswers = () => target.evaluate(() => model.qnas.map(q => q.answer));
    const replace = html => gpt.locator('.markdown').evaluate((node, value) => { node.innerHTML = value; }, html);
    const undo = async () => { await gpt.getByRole('button', { name: '되돌리기', exact: true }).click(); await status('되돌림'); };
    const originalMarkup = await gpt.locator('.markdown').innerHTML();
    await apply(); await status('연결할 지원서를 선택');
    await gpt.locator('[data-jsl-gpt] button').filter({ hasText: '/ 탭' }).click();
    await status('문항 1, 2, 3 입력 확인');
    assert.equal(await gpt.getByRole('combobox').count(), 0);
    assert.deepEqual(await readAnswers(), answers);
    assert.deepEqual(await target.evaluate(() => model.qnas.map(q => q.question)), questions);
    assert.equal(await gpt.locator('.markdown').innerHTML(), originalMarkup);
    assert.equal(await gpt.locator('[data-testid="webpage-citation-pill"]').count(), 4);
    await gpt.locator('.code-copy').first().click(); assert.equal(await gpt.evaluate(() => copied), 1);
    await undo(); assert.deepEqual(await readAnswers(), qnas.map(q => q.answer));
    console.log('PASS: three cited questions auto-map; citation UI, ordinary question link, answer bytes and copy remain intact; undo works');

    // 배지가 두 문장 사이에 있어도 질문의 나머지 요구를 보존한다.
    await replace(block(0, questions[0].replace('계기와', '계기' + citation('중간자료', '+2') + '와')));
    await apply(); await status('문항 1 입력 확인');
    assert.equal((await readAnswers())[0], answers[0]);
    await undo();
    console.log('PASS: an inline citation is omitted without losing adjacent question text');

    // 출처와 같은 단어라도 일반 링크·평문·알 수 없는 배지는 비교에서 삭제하지 않는다.
    for (const suffix of [
      ' <a href="https://example.invalid/source">가상자료</a>',
      ' 가상자료',
      ' <span data-testid="unknown-citation">가상자료</span>',
      ' ' + citation() + ' 반드시 최근 3년의 경험만 작성하십시오.'
    ]) {
      await replace(block(0, questions[0] + suffix));
      await apply(); await status('자동으로 맞추지 못');
      assert.equal(await gpt.getByRole('combobox').inputValue(), '');
      assert.deepEqual(await readAnswers(), qnas.map(q => q.answer));
    }
    console.log('PASS: ordinary links, literal source words, unknown markup and requirements after a citation cannot disappear into an auto-match');

    // 선택 화면이 열린 뒤 질문의 실제 내용이 바뀌면 기존 후보를 쓸 수 없다.
    await replace(block(0, questions[0] + ' ' + citation() + ' 추가 질문'));
    await apply(); await status('자동으로 맞추지 못');
    await gpt.getByRole('combobox').selectOption('501');
    await gpt.locator('.markdown li').first().evaluate(node => { node.append(' 변경된 요구'); });
    await gpt.getByRole('button', { name: '선택한 문항에 적용' }).click();
    await status('응답 내용이 변경');
    assert.deepEqual(await readAnswers(), qnas.map(q => q.answer));
    assert.equal(await target.evaluate(() => saves), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: source changes are still rejected; no save calls or page errors');
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('jsl-citation-'));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
