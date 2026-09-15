// 가상 자소설 + 가상 GPT 두 출처에서 실제 MV3 콘텐츠 스크립트/워커로 고르기 → 질문 바 → 답 → 바꾸기 흐름을 검증한다.
// 실제 사용자 대화로 전송하지 않는다. JSL_FEEDBACK_SHOTS=<폴더>를 주면 단계별 화면을 저장한다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const base = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsl-feedback-'));
const shots = process.env.JSL_FEEDBACK_SHOTS;
const sourceAnswer = '대학 동아리에서 JobFit 프로젝트를 운영했습니다. 저는 데이터 처리에 대한 깊은 이해를 함양할 수 있었습니다. 같은 단어와 같은 단어가 있습니다.\n\n마지막 문장입니다.';
const source = base.resume(55, false, [
  { id: 91, number: 1, question: '문제를 해결한 경험을 설명하세요.', answer: sourceAnswer },
  { id: 92, number: 2, question: '지원 동기를 설명하세요.', answer: '다른 문항의 비공개 가상 내용입니다.' }
]).replace('</body>', `<style>body{font-family:sans-serif;margin:0}textarea.answer{position:fixed;left:380px;top:70px;width:520px;height:300px;font:16px/2 sans-serif}#q1,#q2{position:fixed;top:10px;left:380px}#q2{left:470px}</style>
  <button id="q1" onclick="model.switch_qna(1)">1번 열기</button><button id="q2" onclick="model.switch_qna(2)">2번 열기</button>
  <script>
  const ta=document.querySelector('textarea.answer');
  // 실제 사이트처럼 모델 반영 뒤 입력란을 조금 늦게 다시 그린다. 입력란 값이 사용자 입력으로 바뀐 경우만 모델로 올린다(ng-model).
  let rendered='';
  model.$apply=function(fn){fn();const idx=this.currentQnaIndex;setTimeout(()=>{ta.value=rendered=this.qnas[idx].answer;},45);};
  const baseSwitch=model.switch_qna.bind(model);model.switch_qna=n=>{baseSwitch(n);rendered=ta.value;};
  model.switch_qna(1);ta.addEventListener('input',e=>{if(e.target.value!==rendered){rendered=e.target.value;model.qnas[model.currentQnaIndex].answer=e.target.value;}});
  </script></body>`);
// 가상 GPT: 보낸 질문의 고칠 부분을 읽어 정해진 형식으로 스트리밍 답을 만든다. localStorage로 새로고침 뒤 대화를 복원한다.
const chat = `<!doctype html><html><head><title>가상 자기소개서 대화</title><style>body{font:14px/1.5 sans-serif;max-width:680px;margin:40px auto}#prompt-textarea{border:1px solid #aaa;padding:12px;min-height:70px;white-space:pre-wrap}</style></head><body>
  <div id="messages"></div><form data-type="unified-composer"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div>
  <button type="submit" data-testid="send-button" disabled>전송</button></form><script>
  window.sends=0;window.echo=true;window.mode=localStorage.getItem('fixture-mode')||'normal';window.delay=900;
  const editor=document.getElementById('prompt-textarea'),button=document.querySelector('button'),box=document.getElementById('messages');
  const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const persist=()=>localStorage.setItem('fixture-messages',box.innerHTML);
  function finish(msg){if(window.mode==='slow')return;setTimeout(()=>{msg.removeAttribute('data-is-streaming');const b=document.createElement('button');b.dataset.testid='copy-turn-action-button';b.textContent='복사';msg.closest('section').append(b);persist();},window.delay);}
  const saved=localStorage.getItem('fixture-messages');
  if(saved){box.innerHTML=saved;box.querySelectorAll('[data-is-streaming="true"]').forEach(finish);}
  editor.addEventListener('input',()=>{button.disabled=!editor.innerText.trim();});
  function respond(prompt){
    const quote=(/고칠 부분: ([\\s\\S]*?)(?=\\n(?:주변 문맥: |질문: ))/.exec(prompt)||[])[1],question=(/질문: ([^\\n]*)/.exec(prompt)||[])[1]||'';
    if(quote==null)return;
    const sec=document.createElement('section');sec.dataset.testid='conversation-turn-'+Date.now();
    const art=document.createElement('article');const msg=document.createElement('div');msg.dataset.messageAuthorRole='assistant';msg.dataset.isStreaming='true';
    const md=document.createElement('div');md.className='markdown';msg.append(md);sec.append(msg);art.append(sec);box.append(art);
    let html;
    if(window.mode==='broken')html='<p>좋아 보여서 따로 고치지 않았습니다.</p>';
    else if(question.includes('질문만'))html='<p><strong>진단:</strong> 반복이 강조로 읽혀서 어색하지 않아요.</p><p>확인 필요: 없음</p>';
    else html='<p><strong>진단:</strong> 가상 진단입니다.</p><p>수정안:</p><pre><div>plaintext</div><code>[수정] '+esc(quote)+'</code></pre><p>확인 필요: 없음</p>';
    md.innerHTML='<p><strong>진단:</strong> 쓰는 중</p>';persist();
    setTimeout(()=>{md.innerHTML=html;persist();finish(msg);},400);
  }
  document.querySelector('form').onsubmit=e=>{e.preventDefault();window.sends++;window.lastPrompt=editor.innerText;
    // 실제 GPT처럼 보낸 메시지의 코드 블록을 꾸며 보여준다(표시 글자가 보낸 원문과 달라진다).
    const prompt=window.lastPrompt,fence=String.fromCharCode(96).repeat(3);
    const post=()=>{const node=document.createElement('div');node.dataset.messageAuthorRole='user';node.dataset.messageId=crypto.randomUUID();
      prompt.split(fence).forEach((part,i)=>{if(i%2){const pre=document.createElement('pre');const head=document.createElement('div');head.textContent='plaintext 코드 복사';const code=document.createElement('code');code.textContent=part.trim();pre.append(head,code);node.append(pre);}else{const d=document.createElement('div');d.style.whiteSpace='pre-wrap';d.textContent=part;node.append(d);}});
      box.append(node);window.posted=(window.posted||0)+1;persist();respond(prompt);};
    if(window.echo){if(window.echoDelay)setTimeout(post,window.echoDelay);else post();}
    editor.replaceChildren(document.createElement('p'));button.disabled=true;};
  </script></body></html>`;
(async () => {
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 860 },
    args: ['--disable-extensions-except=' + root, '--load-extension=' + root, '--host-resolver-rules=MAP chatgpt.com ~NOTFOUND, MAP jasoseol.com ~NOTFOUND'] });
  context.setDefaultTimeout(15000);
  try {
    await context.route('https://jasoseol.com/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: source }));
    await context.route('https://chatgpt.com/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: chat }));
    const target = await context.newPage(), errors = [];
    let gpt = await context.newPage();
    target.on('pageerror', e => errors.push('target: ' + e.message)); gpt.on('pageerror', e => errors.push('gpt: ' + e.message));
    await target.goto('https://jasoseol.com/resume/55'); await gpt.goto('https://chatgpt.com/g/project/c/feedback-fixture');
    await target.bringToFront();
    const bar = target.locator('#jsl-gpt-feedback .float');
    const offer = bar.locator('.offer'), compose = bar.locator('.compose'), input = compose.locator('textarea');
    const card = bar.locator('.card'), pill = bar.locator('.pill');
    const ta = target.locator('textarea.answer');
    const answer = () => ta.inputValue();
    const shot = async name => { if (shots) await target.screenshot({ path: path.join(shots, name + '.png') }); };
    // 마우스로 고른 것처럼: 누르고, 범위를 잡고, 뗀다.
    const select = async (text, nth = 0) => {
      await ta.evaluate((el, [part, index]) => {
        let at = -1; for (let i = 0; i <= index; i++) at = el.value.indexOf(part, at + 1);
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.focus(); el.setSelectionRange(at, at + part.length);
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      }, [text, nth]);
    };
    // 고른 글자의 화면 위치(답변란과 같은 글꼴로 복제해 잰다).
    const lineRects = (text, nth = 0) => ta.evaluate((el, [part, index]) => {
      let at = -1; for (let i = 0; i <= index; i++) at = el.value.indexOf(part, at + 1);
      const cs = getComputedStyle(el), r = el.getBoundingClientRect(), d = document.createElement('div');
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle', 'boxSizing']) d.style[p] = cs[p];
      Object.assign(d.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', visibility: 'hidden' });
      const s = document.createElement('span'); s.textContent = el.value.slice(at, at + part.length);
      d.append(el.value.slice(0, at), s, el.value.slice(at + part.length)); document.body.append(d);
      const out = [...s.getClientRects()].map(x => ({ left: x.left, right: x.right, top: x.top, bottom: x.bottom })); d.remove(); return out;
    }, [text, nth]);
    const overlaps = (a, b) => a.x < b.right - 1 && a.x + a.width > b.left + 1 && a.y < b.bottom - 1 && a.y + a.height > b.top + 1;
    const assertClear = async (text, nth, label) => {
      const box = await bar.boundingBox(), lines = await lineRects(text, nth);
      const dash = await target.locator('#jsl-dashboard .wrap').boundingBox();
      assert.ok(box, label + ': 질문 바가 보인다');
      for (const line of lines) assert.equal(overlaps(box, line), false, label + ': 고른 줄을 가리지 않는다');
      assert.equal(overlaps(box, { left: dash.x, right: dash.x + dash.width, top: dash.y, bottom: dash.y + dash.height }), false, label + ': 대시보드를 가리지 않는다');
      return box;
    };
    const ask = async (text, question, nth = 0) => {
      await select(text, nth);
      await offer.waitFor();
      await ta.press('Alt+q');
      await input.waitFor();
      await input.fill(question);
      await input.press('Enter');
    };

    // 1. 마우스·키보드로 고르면 우클릭 없이 질문 바가 뜬다. 고른 줄과 대시보드를 가리지 않는다.
    assert.equal(await target.locator('#jsl-dashboard').getByRole('button', { name: /GPT 질문/ }).count(), 0, '대시보드 맨 아래 GPT 질문 버튼은 없다');
    await select('JobFit 프로젝트를');
    await offer.waitFor();
    assert.match(await offer.innerText(), /이 부분 GPT에게 질문[\s\S]*Alt\+Q/);
    await assertClear('JobFit 프로젝트를', 0, '제안 바');
    await ta.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
    await offer.waitFor({ state: 'hidden' });
    await ta.evaluate(el => { const at = el.value.indexOf('마지막'); el.setSelectionRange(at, at); });
    await ta.press('Shift+ArrowRight'); await ta.press('Shift+ArrowRight'); await ta.press('Shift+ArrowRight');
    await offer.waitFor();
    await target.mouse.click(1100, 700); // 답변란 밖을 누르면 닫힌다
    await offer.waitFor({ state: 'hidden' });
    await shot('1-offer');
    console.log('PASS: mouse and keyboard selection show the question bar without right-click, clear of the selection and dashboard, closes on outside click');

    // 드래그 없이 검수 문장에 커서만 둔 상태에서도 Alt+Q로 질문 칸을 연다.
    await ta.evaluate(el => { el.focus(); const at = el.value.indexOf('깊은 이해'); el.setSelectionRange(at, at); });
    await ta.press('Alt+q'); await input.waitFor();
    assert.match(await compose.locator('.quote').innerText(), /저는 데이터 처리에 대한 깊은 이해를 함양할 수 있었습니다\./);
    assert.equal(await gpt.locator('[data-message-author-role="user"]').count(), 0, '단축키는 전송하지 않는다');
    await input.press('Escape'); await bar.waitFor({ state: 'hidden' });
    console.log('PASS: Alt+Q opens the checkpoint sentence without a selection or sending');

    // 2. Alt+Q → 질문 칸에 바로 커서. 사이트 단축키·저장이 새지 않고, 대화 고르기·막힌 전송은 글을 지킨다.
    await select('JobFit 프로젝트를');
    await offer.waitFor();
    await ta.press('Alt+q');
    await input.waitFor();
    assert.equal(await target.evaluate(() => document.activeElement?.id), 'jsl-gpt-feedback', '커서가 질문 칸에 있다');
    assert.match(await compose.locator('.quote').innerText(), /JobFit 프로젝트를/);
    await target.locator('#jsl-gpt-feedback-marks .p').waitFor({ state: 'attached' }); // 다음 프레임의 표시 층 갱신을 기다린다.
    assert.equal(await target.locator('#jsl-gpt-feedback-marks .p').count(), 1, '질문 칸에 쓰는 동안 고른 곳을 칠해 둔다');
    await assertClear('JobFit 프로젝트를', 0, '질문 칸');
    await input.pressSequentially('어디서 한 건지 빠진 것 같아');
    await input.press('Control+s'); await input.press('Alt+2');
    assert.equal(await target.evaluate(() => saves), 0); assert.equal(await target.evaluate(() => model.currentQnaIndex), 0);
    await input.press('Enter');
    await compose.locator('.note', { hasText: '보낼 GPT 대화를 골라 주세요' }).waitFor();
    await compose.locator('.opt', { hasText: '가상 자기소개서 대화' }).click();
    await compose.locator('.target', { hasText: '가상 자기소개서 대화' }).waitFor();
    await gpt.locator('#prompt-textarea').fill('사용자가 입력 중인 초안');
    await input.press('Enter');
    await compose.locator('.note', { hasText: '작성 중인 내용' }).waitFor();
    assert.equal(await gpt.evaluate(() => sends), 0);
    assert.equal(await input.inputValue(), '어디서 한 건지 빠진 것 같아');
    await gpt.locator('#prompt-textarea').fill('');
    await shot('2-compose');
    await input.press('Enter');
    await pill.filter({ hasText: 'GPT가' }).waitFor();
    assert.equal(await gpt.evaluate(() => sends), 1);
    const prompt = await gpt.evaluate(() => lastPrompt);
    assert.ok(prompt.startsWith('[자비스 요청] 자소설닷컴 1번 문항 답변에 대한 질문입니다.'));
    assert.match(prompt, /고칠 부분: JobFit 프로젝트를\n+주변 문맥: [^\n]+\n+질문: 어디서 한 건지 빠진 것 같아/);
    assert.doesNotMatch(prompt, /다른 문항의 비공개|\b91\b/);
    assert.equal(await target.evaluate(() => document.activeElement === document.querySelector('textarea.answer')), true, '보낸 뒤 쓰던 답변란으로 돌아온다');
    assert.equal(await target.locator('#jsl-gpt-feedback-marks .q').count(), 1, '질문한 곳에 밑줄을 남긴다');
    await shot('3-waiting');
    console.log('PASS: Alt+Q focuses the question box, keys isolated, target pick, blocked send keeps the text, prompt, waiting pill and caret return');

    // 3. 답 도착 → 같은 자리에 수정안 → 접기·펼치기 → 바꾸기 → 되돌리기 → 다시 바꾸기
    await card.waitFor();
    assert.match(await card.innerText(), /수정안[\s\S]*\+5자[\s\S]*내 질문 · 어디서 한 건지[\s\S]*가상 진단입니다[\s\S]*JobFit 프로젝트를[\s\S]*\[수정\] JobFit 프로젝트를/);
    assert.equal(await gpt.locator('[data-jsl-gpt]').count(), 0, '질문의 답에는 문항 전체 적용 패널을 붙이지 않는다');
    await assertClear('JobFit 프로젝트를', 0, '수정안');
    await shot('4-result');
    await ta.press('Alt+q');
    await target.waitForFunction(() => document.activeElement?.id === 'jsl-gpt-feedback');
    await target.keyboard.press('Escape');
    await pill.filter({ hasText: '수정안 도착' }).waitFor();
    await pill.getByRole('button', { name: '보기' }).click();
    await card.getByRole('button', { name: '바꾸기 ↵' }).click();
    await pill.filter({ hasText: '바꿨어요' }).waitFor();
    const once = sourceAnswer.replace('JobFit 프로젝트를', '[수정] JobFit 프로젝트를');
    assert.equal(await answer(), once); assert.equal(await target.evaluate(() => model.qnas[0].answer), once);
    const mirror = await target.evaluate(() => document.querySelector('#jsl-checkpoint')?.shadowRoot?.querySelector('.layer')?.textContent ?? null);
    assert.equal(mirror.replace(/ $/, ''), once, '검수 마커 복제 층도 바꾼 글로 다시 그린다');
    await target.locator('#jsl-gpt-feedback-marks .a').waitFor({ state: 'attached' });
    await target.locator('#jsl-gpt-feedback-marks .a').waitFor({ state: 'hidden', timeout: 4000 });
    assert.equal(await pill.getByRole('button', { name: '되돌리기' }).isVisible(), true, '강조가 사라져도 되돌리기는 유지');
    await pill.getByRole('button', { name: '되돌리기' }).click();
    await card.waitFor();
    assert.equal(await answer(), sourceAnswer);
    await card.focus();
    await target.keyboard.press('Enter');
    await pill.filter({ hasText: '바꿨어요' }).waitFor();
    assert.equal(await answer(), once);
    await bar.waitFor({ state: 'hidden', timeout: 12000 }); // 잠시 뒤 스스로 닫힌다
    assert.equal(await target.evaluate(() => saves), 0);
    console.log('PASS: result card in place, collapse/expand, apply, undo, Enter applies, auto close, no save');

    // 4. 답만 있는 질문 → 새로고침해도 남아 있고 닫으면 끝난다
    await ta.fill(sourceAnswer);
    await ask('같은 단어', '반복이 어색한지 질문만', 1);
    await card.filter({ hasText: 'GPT 답' }).waitFor();
    assert.match(await card.innerText(), /어색하지 않아요/);
    assert.equal(await card.getByRole('button', { name: /바꾸기/ }).count(), 0);
    await target.reload();
    await card.filter({ hasText: 'GPT 답' }).waitFor();
    await card.getByRole('button', { name: '닫기' }).click();
    await bar.waitFor({ state: 'hidden' });
    await target.reload();
    await target.waitForTimeout(1500);
    assert.equal(await bar.isVisible(), false, '닫은 질문은 새로고침 뒤에도 다시 뜨지 않는다');
    console.log('PASS: answer-only reply, reload restores, closing ends the question');

    // 5. 기다리는 사이 고른 곳을 고치면 바꾸지 않는다. 형식이 틀린 답은 읽지 못함으로 둔다.
    await gpt.evaluate(() => { window.delay = 2500; });
    await ask('마지막 문장입니다', '');
    await pill.filter({ hasText: 'GPT가' }).waitFor();
    await ta.fill(sourceAnswer.replace('마지막 문장입니다', '끝 문장입니다'));
    await card.waitFor({ timeout: 20000 });
    await card.getByRole('button', { name: '바꾸기 ↵' }).click();
    await card.filter({ hasText: '원문이 바뀌어 넣지 못했어요' }).waitFor();
    assert.equal(await answer(), sourceAnswer.replace('마지막 문장입니다', '끝 문장입니다'));
    await card.getByRole('button', { name: '닫기' }).click();
    await gpt.evaluate(() => { localStorage.setItem('fixture-mode', 'broken'); window.mode = 'broken'; window.delay = 900; });
    await ta.fill(sourceAnswer);
    await ask('같은 단어', '');
    await card.filter({ hasText: '답을 읽지 못했어요' }).waitFor({ timeout: 20000 });
    await card.getByRole('button', { name: '닫기' }).click();
    await shot('5-exceptions');
    console.log('PASS: stale source never overwritten, broken format shown as unreadable');

    // 6. GPT가 답하는 중이면 겹친 질문은 막히고 앞 질문은 남는다. GPT 탭이 닫혀도 다시 열어 이어받는다. 새 질문은 앞 질문을 대신한다.
    await gpt.evaluate(() => { localStorage.setItem('fixture-mode', 'slow'); window.mode = 'slow'; });
    await ask('JobFit 프로젝트를', '느린 질문');
    await pill.filter({ hasText: 'GPT가' }).waitFor();
    const sendsBeforeOverlap = await gpt.evaluate(() => sends);
    await ask('같은 단어', '겹친 질문');
    await compose.locator('.note', { hasText: 'GPT가 답변 중' }).waitFor({ timeout: 20000 });
    assert.equal(await gpt.evaluate(() => sends), sendsBeforeOverlap, '답하는 중에는 겹친 질문을 보내지 않는다');
    await input.press('Escape'); await ta.evaluate(el => el.setSelectionRange(0, 0)); await target.mouse.click(1100, 700);
    await pill.filter({ hasText: 'GPT가' }).waitFor();
    await gpt.waitForFunction(() => [...document.querySelectorAll('.markdown')].pop()?.querySelector('code')); // 가상 GPT가 답 본문을 다 쓴 뒤(완료 표시 전) 닫는다
    await gpt.close();
    await pill.filter({ hasText: 'GPT 탭이 닫혔어요' }).waitFor();
    await shot('6-lost');
    const reopened = context.waitForEvent('page');
    await pill.getByRole('button', { name: '다시 열기' }).click();
    gpt = await reopened;
    gpt.on('pageerror', e => errors.push('gpt: ' + e.message));
    await gpt.waitForURL('https://chatgpt.com/g/project/c/feedback-fixture', { waitUntil: 'commit' });
    await gpt.evaluate(() => localStorage.setItem('fixture-mode', 'normal')).catch(() => {});
    await gpt.goto(gpt.url());
    await target.bringToFront();
    await card.waitFor({ timeout: 25000 });
    assert.match(await card.innerText(), /내 질문 · 느린 질문[\s\S]*\[수정\] JobFit 프로젝트를/);
    await ask('마지막 문장입니다', '대신하는 질문');
    await card.filter({ hasText: '대신하는 질문' }).waitFor({ timeout: 20000 });
    await card.getByRole('button', { name: '버리기' }).click();
    await bar.waitFor({ state: 'hidden' });
    console.log('PASS: blocked overlapping question keeps the earlier one, closed GPT tab resumes, a new question replaces the old');

    // 7. 전송 확인 불가 → 자동으로 다시 보내지 않고, 다시 보내기는 질문 칸을 되살려 새 요청으로 보낸다
    await gpt.evaluate(() => { window.echo = false; });
    const sendsStart = await gpt.evaluate(() => sends);
    await ask('JobFit 프로젝트를', '확인 불가 질문');
    await card.filter({ hasText: '보냈는지 확인하지 못했어요' }).waitFor({ timeout: 25000 });
    await target.waitForTimeout(6000);
    assert.equal(await gpt.evaluate(() => sends), sendsStart + 1);
    await gpt.evaluate(() => { window.echo = true; });
    await card.getByRole('button', { name: '다시 보내기' }).click();
    await input.waitFor();
    assert.equal(await input.inputValue(), '확인 불가 질문');
    await input.press('Enter');
    await card.filter({ hasText: '수정안' }).waitFor({ timeout: 25000 });
    assert.equal(await gpt.evaluate(() => sends), sendsStart + 2);
    await card.getByRole('button', { name: '버리기' }).click();
    console.log('PASS: unknown send is never retried automatically; resend reopens the question box');

    // 7-2. 확인 시간(8초)이 지난 뒤에야 메시지가 뜬 경우: 다시 보내지 않고 이어받는다
    await gpt.evaluate(() => { window.echoDelay = 9500; });
    const postedBefore = await gpt.evaluate(() => window.posted || 0);
    await ask('같은 단어', '늦게 뜬 질문');
    await card.filter({ hasText: '보냈는지 확인하지 못했어요' }).waitFor({ timeout: 25000 });
    await gpt.waitForFunction(n => (window.posted || 0) > n, postedBefore, { timeout: 15000 });
    const sendsBefore = await gpt.evaluate(() => sends);
    await card.getByRole('button', { name: '보냈어요 · 답 기다리기' }).click();
    await card.filter({ hasText: '늦게 뜬 질문' }).waitFor({ timeout: 25000 });
    assert.equal(await gpt.evaluate(() => sends), sendsBefore, '이어받기는 다시 보내지 않는다');
    await gpt.evaluate(() => { window.echoDelay = 0; });
    await card.getByRole('button', { name: '버리기' }).click();
    console.log('PASS: late-rendered sent message is claimed by headline without resending');

    // 8. 다른 문항에 있으면 답변란 옆에 그 문항 상태를 붙이고, 가기로 돌아가면 수정안이 뜬다
    await gpt.evaluate(() => { window.delay = 3500; });
    await ask('같은 단어', '다른 문항 이동');
    await pill.filter({ hasText: 'GPT가' }).waitFor();
    await target.locator('#q2').click();
    await pill.filter({ hasText: '1번 문항 질문' }).waitFor();
    await pill.filter({ hasText: '답 도착' }).waitFor({ timeout: 25000 });
    await pill.getByRole('button', { name: '가기' }).click();
    await card.filter({ hasText: '다른 문항 이동' }).waitFor();
    assert.equal(await target.evaluate(() => model.currentQnaIndex), 0);
    await card.getByRole('button', { name: '버리기' }).click();
    await gpt.evaluate(() => { window.delay = 900; });
    console.log('PASS: another question shows a docked status with a jump back to the result');

    // 9. 실사이트처럼 모델에 서버 CRLF가 남고 입력칸 끝 줄바꿈이 모델에서 잘린 상태에서도 보내고 바꾼다
    await target.evaluate(() => {
      const q = model.qnas[0]; q.answer = q.answer.replace(/\n/g, '\r\n').trim();
      document.querySelector('textarea.answer').value = q.answer.replace(/\r\n/g, '\n') + '\n'; rendered = document.querySelector('textarea.answer').value; // eslint-disable-line no-undef
    });
    await ask('마지막 문장입니다', '');
    await card.filter({ hasText: '수정안' }).waitFor({ timeout: 25000 });
    await card.getByRole('button', { name: '바꾸기 ↵' }).click();
    await pill.filter({ hasText: '바꿨어요' }).waitFor();
    assert.equal(await answer(), sourceAnswer.replace('마지막 문장입니다', '[수정] 마지막 문장입니다') + '\n');
    console.log('PASS: CRLF model answer and trimmed ng-model value do not block send or apply');

    // 10. 답변란 옆 자리가 넉넉하면 질문 칸은 글 위가 아니라 옆에 뜬다
    await target.setViewportSize({ width: 1500, height: 860 });
    await bar.waitFor({ state: 'hidden', timeout: 12000 });
    await select('데이터 처리에 대한');
    await offer.waitFor();
    await ta.press('Alt+q');
    await input.waitFor();
    const box = await assertClear('데이터 처리에 대한', 0, '넓은 화면 질문 칸');
    const taBox = await ta.boundingBox();
    assert.ok(box.x >= taBox.x + taBox.width, '답변란 오른쪽에 둔다');
    await input.press('Escape');
    await bar.waitFor({ state: 'hidden' });
    assert.equal(await ta.evaluate(el => el.selectionStart === el.selectionEnd), true, 'Esc는 선택을 접고 질문 바까지 닫는다');
    await shot('7-beside');
    console.log('PASS: wide screen puts the question box beside the answer; Esc closes it');

    for (const method of ['outside', 'answer', 'escape-outside', 'button']) {
      await select('데이터 처리에 대한'); await ta.press('Alt+q'); await input.waitFor();
      await input.fill('닫아도 남길 가상 질문');
      if (method === 'outside') await target.mouse.click(1100, 700);
      else if (method === 'answer') await ta.click({ position: { x: 10, y: 10 } });
      else if (method === 'escape-outside') { await ta.focus(); await target.keyboard.press('Escape'); }
      else await compose.getByRole('button', { name: '질문 칸 닫기', exact: true }).click();
      await bar.waitFor({ state: 'hidden' });
      await select('데이터 처리에 대한'); await ta.press('Alt+q'); await input.waitFor();
      assert.equal(await input.inputValue(), '닫아도 남길 가상 질문', method + ': 닫아도 질문 글은 보존');
      await input.press('Escape'); await bar.waitFor({ state: 'hidden' });
    }
    console.log('PASS: typed compose closes by outside/answer click, Esc outside input and close button, preserving draft');

    // 공고가 왼쪽 여백을 차지하면 질문 칸을 그 뒤에 배치하지 않는다.
    await target.setViewportSize({ width: 1200, height: 860 });
    await ta.evaluate(el => { el.style.left = '480px'; el.style.top = '250px'; el.style.width = '700px'; });
    await target.evaluate(() => {
      document.getElementById('jsl-jd-panel')?.remove();
      const panel = document.createElement('div'); panel.id = 'jsl-jd-panel';
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none';
      panel.attachShadow({ mode: 'open' }).innerHTML = '<div class="scroll" style="position:fixed;left:0;top:0;width:400px;height:800px;background:white;pointer-events:auto">가상 공고</div>';
      document.body.append(panel);
    });
    await select('데이터 처리에 대한');
    await ta.press('Alt+q');
    await input.waitFor();
    await target.waitForTimeout(1100);
    const clearBox = await assertClear('데이터 처리에 대한', 0, '왼쪽 공고 질문 칸');
    assert.equal(overlaps(clearBox, { left: 0, right: 400, top: 0, bottom: 800 }), false, '공고 영역을 피한다');
    assert.ok(clearBox.x >= 0 && clearBox.x + clearBox.width <= 1200 && clearBox.y >= 0 && clearBox.y + clearBox.height <= 860);
    const exposed = await bar.evaluate(el => {
      const r = el.getBoundingClientRect();
      return [[r.left + 5, r.top + 5], [r.right - 5, r.bottom - 5]].every(([x, y]) => document.elementFromPoint(x, y)?.id === 'jsl-gpt-feedback');
    });
    assert.ok(exposed, '질문 칸 양쪽이 다른 패널에 가려지지 않는다');
    await shot('8-clear-of-job-panel');
    console.log('PASS: question box avoids the left job panel and remains fully visible');

    // 전체 답변 교체 후에는 잠깐만 전체 강조, 이후 커서 문장만 검수 표시한다.
    await target.keyboard.press('Escape');
    await ta.fill(sourceAnswer);
    await ask(sourceAnswer, '전체 문장 다듬기');
    await card.getByRole('button', { name: '바꾸기 ↵' }).click();
    await target.locator('#jsl-gpt-feedback-marks .a').waitFor({ state: 'attached' });
    await ta.evaluate(el => {
      const at = el.value.indexOf('깊은 이해'); el.focus(); el.setSelectionRange(at, at);
      el.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await target.locator('#jsl-gpt-feedback-marks .a').waitFor({ state: 'hidden', timeout: 4000 });
    const sentence = await target.locator('#jsl-checkpoint .mark').innerText();
    assert.equal(sentence, '저는 데이터 처리에 대한 깊은 이해를 함양할 수 있었습니다.');
    assert.ok(await pill.getByRole('button', { name: '되돌리기' }).isVisible());
    await pill.getByRole('button', { name: '되돌리기' }).click();
    await card.waitFor();
    assert.equal(await answer(), sourceAnswer);
    console.log('PASS: whole-answer highlight expires, cursor sentence remains, undo still works');

    // 11. 문항 이탈
    await target.evaluate(() => history.pushState({}, '', '/resume_list'));
    await bar.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('PASS: SPA exit hides the bar, no page errors');
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
