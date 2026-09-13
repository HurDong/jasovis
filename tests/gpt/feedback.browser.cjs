// 가상 두 출처 + 실제 MV3 콘텐츠 스크립트/워커. 사용자 대화로 전송하지 않는다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const base = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsl-feedback-'));
const sourceAnswer = '첫 번째 문장의 표현입니다. 두 번째 문장의 표현입니다. 같은 단어와 같은 단어가 있습니다.\n\n마지막 문장입니다.';
const source = base.resume(55, false, [
  { id: 91, number: 1, question: '문제를 해결한 경험을 설명하세요.', answer: sourceAnswer },
  { id: 92, number: 2, question: '지원 동기를 설명하세요.', answer: '다른 문항의 비공개 가상 내용입니다.' }
]).replace('</body>', `<style>textarea.answer{width:600px;height:240px;margin:50px;font:16px/2 sans-serif}body{font-family:sans-serif}#q1,#q2{position:fixed;top:10px;left:50px}#q2{left:140px}</style>
  <button id="q1" onclick="model.switch_qna(1)">1번 열기</button><button id="q2" onclick="model.switch_qna(2)">2번 열기</button>
  <script>model.switch_qna(1);document.querySelector('textarea.answer').addEventListener('input',e=>{model.qnas[model.currentQnaIndex].answer=e.target.value});</script></body>`);
const chat = `<!doctype html><html><head><title>가상 자기소개서 대화</title><style>body{font:14px/1.5 sans-serif;max-width:680px;margin:40px auto}.whitespace-pre-wrap{white-space:pre-wrap}#prompt-textarea{border:1px solid #aaa;padding:12px;min-height:70px;white-space:pre-wrap}</style></head><body>
  <div id="messages"></div><form data-type="unified-composer"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div>
  <button type="submit" data-testid="send-button" disabled>전송</button></form><script>
  window.sends=0;window.echo=true;const editor=document.getElementById('prompt-textarea'),button=document.querySelector('button');
  editor.addEventListener('input',()=>{button.disabled=!editor.innerText.trim();if(window.editNext){window.editNext=false;button.disabled=true;
    setTimeout(()=>{editor.append('사용자가 덧붙인 내용');editor.dispatchEvent(new Event('input',{bubbles:true}))},0)}});
  document.querySelector('form').onsubmit=e=>{e.preventDefault();window.sends++;window.lastPrompt=editor.innerText;
    if(window.echo){const node=document.createElement('div');node.dataset.messageAuthorRole='user';node.dataset.messageId=crypto.randomUUID();const text=document.createElement('div');text.className='whitespace-pre-wrap';text.textContent=window.lastPrompt;node.append(text);document.getElementById('messages').append(node)}
    editor.replaceChildren(document.createElement('p'));button.disabled=true;};
  </script></body></html>`;
(async () => {
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root,
      '--host-resolver-rules=MAP chatgpt.com ~NOTFOUND, MAP jasoseol.com ~NOTFOUND'] });
  context.setDefaultTimeout(12000);
  try {
    await context.route('https://jasoseol.com/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: source }));
    await context.route('https://chatgpt.com/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: chat }));
    const target = await context.newPage(), gpt = await context.newPage(), errors = [];
    target.on('pageerror', e => errors.push(e.message)); gpt.on('pageerror', e => errors.push(e.message));
    await target.goto('https://jasoseol.com/resume/55'); await gpt.goto('https://chatgpt.com/g/project/c/feedback-fixture');
    const ui = id => target.locator('#jsl-gpt-feedback').locator('#' + id);
    const open = async () => { await target.getByRole('button', { name: 'GPT 질문', exact: true }).click(); await ui('panel').waitFor({ state: 'visible' }); };
    const add = async (start, end) => {
      await target.locator('textarea.answer').evaluate((ta, range) => {
        ta.focus(); ta.setSelectionRange(...range); ta.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 240, clientY: 170 }));
      }, [start, end]);
      await ui('add').click();
    };
    await open(); await add(0, 16); await add(17, 33); await add(0, 16);
    assert.equal(await ui('quotes').locator('.quote').count(), 2);
    await target.getByRole('textbox', { name: '인용 1 질문', exact: true }).fill('첫 문장을 간결하게 바꿔줘.');
    await target.getByRole('textbox', { name: '인용 2 질문', exact: true }).fill('두 번째 표현이 어색한지 봐줘.');
    await ui('message').fill('인용 1과 인용 2를 각각 봐줘.');
    await ui('message').press('Control+s'); await ui('message').press('Alt+2');
    assert.equal(await target.evaluate(() => saves), 0); assert.equal(await target.evaluate(() => model.currentQnaIndex), 0);
    await target.locator('#q2').click(); await ui('panel').waitFor({ state: 'hidden' }); await open();
    assert.equal(await ui('quotes').locator('.quote').count(), 0);
    await target.locator('#q1').click(); await ui('panel').waitFor({ state: 'hidden' }); await open();
    assert.equal(await ui('quotes').locator('.quote').count(), 2);
    assert.equal(await ui('message').inputValue(), '인용 1과 인용 2를 각각 봐줘.');
    await ui('close').click(); await target.reload(); await open();
    assert.equal(await ui('quotes').locator('.quote').count(), 2);
    console.log('PASS: separate word/sentence selections, duplicate range, per-quote notes, question isolation, reload recovery');
    await target.getByRole('button', { name: '인용 2 삭제', exact: true }).click(); await add(34, 39);
    await target.getByRole('textbox', { name: '인용 3 질문', exact: true }).fill('이 단어를 자연스럽게 바꿔줘.');
    await ui('message').fill('인용 1과 인용 3을 각각 봐줘.');
    await ui('targets').selectOption('feedback-fixture');
    await target.waitForFunction(() => !document.querySelector('#jsl-gpt-feedback').shadowRoot.getElementById('send').disabled);
    await target.setViewportSize({ width: 390, height: 844 });
    const rect = await ui('panel').boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
    await target.setViewportSize({ width: 1100, height: 850 });
    if (process.env.JSL_FEEDBACK_SCREENSHOT) await ui('panel').screenshot({ path: process.env.JSL_FEEDBACK_SCREENSHOT });
    await gpt.locator('#prompt-textarea').fill('사용자가 입력 중인 초안');
    await ui('send').click(); await ui('status').filter({ hasText: '작성 중인 내용' }).waitFor();
    assert.equal(await gpt.locator('#prompt-textarea').innerText(), '사용자가 입력 중인 초안'); assert.equal(await gpt.evaluate(() => sends), 0);
    await gpt.locator('#prompt-textarea').fill('');
    await gpt.evaluate(() => { const el = document.createElement('button'); el.dataset.testid = 'stop-button'; el.textContent = '중지'; document.body.append(el); });
    await ui('send').click(); await ui('status').filter({ hasText: '답변 중' }).waitFor();
    assert.equal(await gpt.evaluate(() => sends), 0); await gpt.locator('[data-testid="stop-button"]').evaluate(el => el.remove());
    await gpt.evaluate(() => { const el = document.createElement('div'); el.dataset.testid = 'attachment-chip'; el.textContent = '가상 첨부'; document.querySelector('form').append(el); });
    await ui('send').click(); await ui('status').filter({ hasText: '첨부 파일' }).waitFor();
    assert.equal(await gpt.evaluate(() => sends), 0); await gpt.locator('[data-testid="attachment-chip"]').evaluate(el => el.remove());
    await gpt.evaluate(() => { window.editNext = true; });
    await ui('send').click(); await ui('status').filter({ hasText: '전송을 멈췄습니다' }).waitFor();
    assert.equal(await gpt.evaluate(() => sends), 0); assert.match(await gpt.locator('#prompt-textarea').innerText(), /사용자가 덧붙인 내용/);
    await gpt.locator('#prompt-textarea').fill('');
    console.log('PASS: stable IDs after deletion, explicit conversation link, mobile panel bounds, existing GPT draft and busy response preserved');
    await ui('send').click();
    try { await ui('status').filter({ hasText: '전송했습니다' }).waitFor(); }
    catch (e) { console.log('Fixture send diagnostics:', await ui('status').innerText(), await gpt.evaluate(() => ({ sends, html: editor.innerHTML, text: editor.innerText, errors: window.errors }))); throw e; }
    assert.equal(await gpt.evaluate(() => sends), 1);
    const prompt = await gpt.evaluate(() => lastPrompt);
    assert.match(prompt, /\[인용 1\]/); assert.match(prompt, /\[인용 3\]/); assert.doesNotMatch(prompt, /\[인용 2\]|다른 문항의 비공개/);
    assert.match(prompt, /첫 문장을 간결하게/); assert.equal(await ui('send').isDisabled(), true);
    assert.equal(await target.locator('textarea.answer').inputValue(), sourceAnswer); assert.equal(await target.evaluate(() => saves), 0);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const stored = await worker.evaluate(async () => {
      const all = await chrome.storage.session.get(null);
      return Object.values(all).find(v => v.draft?.attempt?.status === 'sent' && v.updated);
    });
    assert.ok(stored);
    const result = await worker.evaluate(async d => {
      const tab = (await chrome.tabs.query({ url: 'https://jasoseol.com/resume/55' }))[0];
      return (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async draft => chrome.runtime.sendMessage({
        type: 'feedback:send', draft, conversation: 'feedback-fixture', attempt: draft.attempt.id }), args: [d] }))[0].result;
    }, stored.draft);
    assert.equal(result.status, 'sent'); assert.equal(await gpt.evaluate(() => sends), 1);
    console.log('PASS: one-click input/send with visible user-message verification, exact quote IDs, duplicate request suppressed, no answer writes/save');
    await target.reload(); await open(); assert.equal(await ui('send').isDisabled(), true);
    await target.locator('textarea.answer').fill(sourceAnswer.replace('첫', '새'));
    await ui('status').filter({ hasText: '답변이 바뀌었습니다' }).waitFor(); assert.equal(await ui('send').isDisabled(), true);
    await ui('reset').click(); await add(0, 16); await ui('message').fill('새로 선택한 문장을 봐줘.');
    assert.match(await ui('quotes').innerText(), /인용 4/);
    await gpt.evaluate(() => { window.echo = false; });
    await ui('send').click();
    try { await ui('status').filter({ hasText: '새 메시지를 확인하지 못했습니다' }).waitFor({ timeout: 22000 }); }
    catch (e) { console.log('Fixture uncertain-send diagnostics:', await ui('status').innerText(), await gpt.evaluate(() => ({ sends, html: editor.innerHTML, text: editor.innerText }))); throw e; }
    assert.equal(await gpt.evaluate(() => sends), 2); assert.equal(await ui('send').isDisabled(), true);
    await target.reload(); await open(); assert.equal(await ui('send').isDisabled(), true);
    assert.equal(await gpt.evaluate(() => sends), 2);
    console.log('PASS: stale source blocks send; explicit reselection retains questions; unknown send result stays blocked across reload');
    await ui('reset').click(); await add(0, 16); await ui('message').fill('현재 원문의 첫 문장만 간결하게 고쳐줘.');
    await gpt.close();
    const reopened = context.waitForEvent('page');
    await ui('send').click(); const newGpt = await reopened;
    // chrome.tabs.create의 첫 요청은 CDP attach보다 빠를 수 있다. DNS를 막고 연결 후 fixture로 탐색한다.
    await newGpt.waitForURL('https://chatgpt.com/g/project/c/feedback-fixture', { waitUntil: 'commit' });
    const requestedUrl = newGpt.url();
    await newGpt.goto(requestedUrl);
    try { await ui('status').filter({ hasText: '전송했습니다' }).waitFor({ timeout: 22000 }); }
    catch (e) { console.log('Fixture reopen diagnostics:', await ui('status').innerText(), newGpt.url(), await newGpt.evaluate(() => ({ sends: window.sends, html: document.getElementById('prompt-textarea')?.innerHTML }))); throw e; }
    assert.equal(newGpt.url(), 'https://chatgpt.com/g/project/c/feedback-fixture');
    assert.equal(await newGpt.evaluate(() => sends), 1);
    await target.evaluate(() => history.pushState({}, '', '/resume_list'));
    await ui('panel').waitFor({ state: 'hidden' });
    console.log('PASS: composer shortcuts isolated, attachments and concurrent GPT edits preserved, closed linked project conversation reopened, SPA exit hides panel');
    assert.deepEqual(errors, []);
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
