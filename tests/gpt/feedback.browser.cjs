// 가상 자소설 + 가상 GPT 두 출처에서 실제 MV3 콘텐츠 스크립트/워커로 인용 질문 → 답 → 받기 흐름을 검증한다.
// 실제 사용자 대화로 전송하지 않는다. JSL_FEEDBACK_SHOTS=<폴더>를 주면 단계별 대시보드 화면을 저장한다.
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
  // 실제 Angular처럼 모델 반영 뒤 입력란을 다시 그린다. 입력란 수정은 모델로 올린다.
  model.$apply=function(fn){fn();ta.value=this.qnas[this.currentQnaIndex].answer;};
  model.switch_qna(1);ta.addEventListener('input',e=>{model.qnas[model.currentQnaIndex].answer=e.target.value});
  </script></body>`);
// 가상 GPT: 보낸 요청의 인용을 읽어 정해진 형식으로 스트리밍 답을 만든다. localStorage로 새로고침 뒤 대화를 복원한다.
const chat = `<!doctype html><html><head><title>가상 자기소개서 대화</title><style>body{font:14px/1.5 sans-serif;max-width:680px;margin:40px auto}.whitespace-pre-wrap{white-space:pre-wrap}#prompt-textarea{border:1px solid #aaa;padding:12px;min-height:70px;white-space:pre-wrap}</style></head><body>
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
    const quotes=[...prompt.matchAll(/\\[인용 (\\d+) · ([^\\]]+)\\]\\s*\\n+원문: ([^\\n]*)/g)].map(m=>({id:m[1],kind:m[2],text:m[3]}));
    if(!quotes.length)return;
    const sec=document.createElement('section');sec.dataset.testid='conversation-turn-'+Date.now();
    const art=document.createElement('article');const msg=document.createElement('div');msg.dataset.messageAuthorRole='assistant';msg.dataset.isStreaming='true';
    const md=document.createElement('div');md.className='markdown';msg.append(md);sec.append(msg);art.append(sec);box.append(art);
    let html='<p>요청하신 곳을 봤습니다.</p>';
    for(const q of quotes){
      if(window.mode==='broken'&&q.id===quotes[0].id){html+='<p>첫 인용은 좋아 보여서 따로 고치지 않았습니다.</p>';continue;}
      if(q.kind==='질문')html+='<h3>인용 '+q.id+'</h3><p>진단: 판단할 근거가 부족합니다.</p><p>확인 필요: 어떤 상황이었는지 알려 주세요.</p>';
      else html+='<h3>인용 '+q.id+'</h3><p><strong>진단:</strong> 가상 진단 '+q.id+'</p><p>수정안:</p><pre><div>plaintext</div><code>[수정 '+q.id+'] '+esc(q.text)+'</code></pre><p>확인 필요: 없음</p>';
    }
    md.innerHTML=html.split('<h3>').slice(0,2).join('<h3>');persist();
    setTimeout(()=>{md.innerHTML=html;persist();finish(msg);},400);
  }
  document.querySelector('form').onsubmit=e=>{e.preventDefault();window.sends++;window.lastPrompt=editor.innerText;
    if(window.echo){const node=document.createElement('div');node.dataset.messageAuthorRole='user';node.dataset.messageId=crypto.randomUUID();const text=document.createElement('div');text.className='whitespace-pre-wrap';text.textContent=window.lastPrompt;node.append(text);box.append(node);persist();respond(window.lastPrompt);}
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
    const dash = target.locator('#jsl-dashboard'), view = dash.locator('.gq'), primary = dash.locator('.gq-actions .jsl-action-btn.primary');
    const card = id => view.locator('[data-quote-id="' + id + '"]');
    const answer = () => target.locator('textarea.answer').inputValue();
    const shot = async name => { if (shots) await dash.locator('.wrap').screenshot({ path: path.join(shots, name + '.png') }); };
    const select = async (text, nth = 0) => {
      await target.locator('textarea.answer').evaluate((ta, [part, index]) => {
        let at = -1; for (let i = 0; i <= index; i++) at = ta.value.indexOf(part, at + 1);
        ta.focus(); ta.setSelectionRange(at, at + part.length);
        ta.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 520, clientY: 120 }));
      }, [text, nth]);
    };
    const add = async (text, kind, nth = 0) => {
      await select(text, nth);
      await target.locator('#jsl-gpt-feedback .bubble').waitFor({ state: 'visible' });
      await target.locator('#jsl-gpt-feedback button[data-kind="' + kind + '"]').click();
      await target.locator('#jsl-gpt-feedback .bubble').waitFor({ state: 'hidden' });
    };

    // 1. 드래그 → 버블 → 대시보드 화면에 담기
    await add('JobFit 프로젝트를', 'context');
    await view.waitFor({ state: 'visible' });
    assert.equal(await dash.locator('.view-title').innerText(), 'GPT 질문');
    assert.match(await dash.locator('.view-meta').innerText(), /1번 문항/);
    assert.match(await card(1).innerText(), /JobFit 프로젝트를[\s\S]*빠진 맥락/);
    await add('데이터 처리에 대한 깊은 이해를 함양할 수 있었습니다', 'tone');
    await add('같은 단어', 'ask', 1);
    await add('JobFit 프로젝트를', 'tone'); // 같은 범위는 종류만 바꾼다
    assert.equal(await view.locator('.gq-card').count(), 3);
    assert.match(await card(1).innerText(), /AI 티/);
    await card(1).locator('.gq-kind').click(); assert.match(await card(1).innerText(), /질문/);
    await card(1).locator('.gq-kind').click(); assert.match(await card(1).innerText(), /빠진 맥락/);
    assert.equal(await primary.innerText(), '질문 내용을 적어 주세요'); assert.equal(await primary.isDisabled(), true);
    await card(3).locator('.gq-memo').fill('이 단어가 반복돼서 어색한지 봐줘');
    assert.equal(await primary.innerText(), '보낼 GPT 대화를 골라 주세요');
    await card(1).locator('.gq-memo').fill('동아리 이름은 가상 동아리');
    await card(1).locator('.gq-memo').press('Control+s'); await card(1).locator('.gq-memo').press('Alt+2');
    assert.equal(await target.evaluate(() => saves), 0); assert.equal(await target.evaluate(() => model.currentQnaIndex), 0);
    const marks = await target.locator('#jsl-gpt-feedback-marks .q').count();
    assert.equal(marks, 3, '답변란에 담은 인용 3곳을 표시한다');
    await shot('1-collect');
    console.log('PASS: bubble kinds, same-range kind change, kind chip cycle, memo isolation, send blockers, quote marks');

    // 2. 담은 뒤 편집: 유일한 원문은 따라가고, 사라진 인용만 경고한다
    await target.locator('textarea.answer').fill('앞에 새 문장을 넣었습니다. ' + sourceAnswer.replace('깊은 이해를 함양할 수 있었습니다', '많이 배웠습니다'));
    await card(2).locator('.gq-note.warn').waitFor();
    assert.equal(await primary.innerText(), '원문이 바뀐 인용을 빼 주세요');
    await card(2).locator('.gq-x').click();
    await target.locator('textarea.answer').fill(sourceAnswer);
    await add('데이터 처리에 대한 깊은 이해를 함양할 수 있었습니다', 'tone');
    assert.deepEqual(await view.locator('.gq-card').evaluateAll(cards => cards.map(c => c.dataset.quoteId)), ['1', '3', '4']);
    console.log('PASS: rebase after edits, lost quote warning and removal, stable ids');

    // 3. 대화 고르기 → 막힌 전송(작성 중인 GPT 입력) → 보내기
    await view.getByRole('button', { name: /보낼 GPT 대화 고르기/ }).click();
    await view.locator('.gq-opt', { hasText: '가상 자기소개서 대화' }).click();
    await view.locator('.gq-target', { hasText: '가상 자기소개서 대화' }).waitFor();
    assert.equal(await primary.innerText(), 'GPT로 보내기 · 3');
    await gpt.locator('#prompt-textarea').fill('사용자가 입력 중인 초안');
    await primary.click();
    await view.locator('.gq-status', { hasText: '보내지 못했어요' }).waitFor();
    assert.match(await view.locator('.gq-status').innerText(), /작성 중인 내용/);
    assert.equal(await gpt.evaluate(() => sends), 0); assert.equal(await view.locator('.gq-memo').count(), 3);
    await gpt.locator('#prompt-textarea').fill('');
    await view.locator('.gq-status .gq-link', { hasText: '닫기' }).click();
    await primary.click();
    await view.locator('.gq-status', { hasText: 'GPT가 답하는 중' }).waitFor();
    await shot('2-waiting');
    assert.equal(await gpt.evaluate(() => sends), 1);
    const prompt = await gpt.evaluate(() => lastPrompt);
    assert.ok(prompt.startsWith('[자비스 요청]'));
    assert.match(prompt, /\[인용 1 · 빠진 맥락\]/); assert.match(prompt, /\[인용 3 · 질문\][\s\S]*이 단어가 반복돼서/); assert.match(prompt, /\[인용 4 · AI 티\]/);
    assert.doesNotMatch(prompt, /다른 문항의 비공개|\b91\b/);
    assert.equal(await primary.isDisabled(), true);
    console.log('PASS: conversation pick, blocked send keeps draft, format-enforced prompt, waiting state');

    // 4. 답 도착 → 제안 카드 · 기존 적용 패널 미부착
    await view.locator('.gq-sum').waitFor();
    assert.match(await view.locator('.gq-sum').innerText(), /수정안 2 · 확인 필요 1/);
    assert.match(await card(1).innerText(), /JobFit 프로젝트를[\s\S]*→[\s\S]*\[수정 1\] JobFit 프로젝트를[\s\S]*가상 진단 1/);
    assert.match(await card(3).innerText(), /확인 필요[\s\S]*어떤 상황이었는지/);
    assert.equal(await gpt.locator('[data-jsl-gpt]').count(), 0, '인용 질문의 답에는 문항 전체 적용 패널을 붙이지 않는다');
    assert.equal(await primary.innerText(), '남은 2개 모두 받기');
    await shot('3-review');
    console.log('PASS: streamed reply parsed per quote, ask card, no full-answer apply panel on feedback reply');

    // 5. 받기 → 되돌리기 → 모두 받기 (중복 원문 위치 보정 포함)
    await card(1).getByRole('button', { name: '인용 1 받기' }).click();
    await card(1).locator('.gq-done, .st.done').first().waitFor();
    const once = sourceAnswer.replace('JobFit 프로젝트를', '[수정 1] JobFit 프로젝트를');
    assert.equal(await answer(), once); assert.equal(await target.evaluate(() => model.qnas[0].answer), once);
    await target.locator('#jsl-gpt-feedback-marks .a').waitFor({ state: 'attached' });
    await card(1).getByRole('button', { name: '인용 1 되돌리기' }).click();
    await card(1).getByRole('button', { name: '인용 1 받기' }).waitFor();
    assert.equal(await answer(), sourceAnswer);
    await primary.click();
    await dash.locator('.gq-actions .jsl-action-btn.primary', { hasText: '새 질문' }).waitFor();
    const all = sourceAnswer.replace('JobFit 프로젝트를', '[수정 1] JobFit 프로젝트를')
      .replace('데이터 처리에 대한 깊은 이해를 함양할 수 있었습니다', '[수정 4] 데이터 처리에 대한 깊은 이해를 함양할 수 있었습니다');
    assert.equal(await answer(), all);
    assert.equal(await target.locator('#jsl-gpt-feedback-marks .a').count(), 2);
    assert.equal(await target.evaluate(() => saves), 0);
    await shot('4-applied');
    console.log('PASS: apply one, undo, apply all with shifted positions, applied marks, no save');

    // 6. 새로고침 복원
    await target.reload();
    await dash.getByRole('button', { name: /GPT 질문/ }).click();
    await view.locator('.gq-sum').waitFor();
    assert.match(await view.locator('.gq-sum').innerText(), /받음 2/);
    assert.equal(await view.locator('.gq-done').count(), 2);
    console.log('PASS: reload restores reply and decisions');

    // 7. 새 질문 → 형식 오류 인용 + 답 기다리는 사이 원문 편집
    await gpt.evaluate(() => { localStorage.setItem('fixture-mode', 'broken'); window.mode = 'broken'; });
    await primary.click();
    await view.locator('.gq-empty').waitFor();
    await target.locator('textarea.answer').fill(sourceAnswer);
    await add('JobFit 프로젝트를', 'tone');
    await add('마지막 문장입니다', 'tone');
    await primary.click();
    await view.locator('.gq-status', { hasText: 'GPT가 답하는 중' }).waitFor();
    await target.locator('textarea.answer').fill(sourceAnswer.replace('마지막 문장입니다', '끝 문장입니다'));
    await view.locator('.gq-sum').waitFor();
    assert.match(await card(1).innerText(), /읽지 못함[\s\S]*GPT에서 보기/);
    await card(2).getByRole('button', { name: '인용 2 받기' }).click();
    await card(2).locator('.gq-note.warn', { hasText: '원문이 바뀌어' }).waitFor(); assert.match(await view.locator('.gq-sum').innerText(), /원문 바뀜 1 · 읽지 못함 1/);
    assert.equal(await answer(), sourceAnswer.replace('마지막 문장입니다', '끝 문장입니다'));
    await shot('5-exceptions');
    console.log('PASS: broken format isolated per quote, stale source never overwritten');

    // 8. GPT 탭 닫힘 → 다시 열기 → 감시 재개
    await gpt.evaluate(() => { localStorage.setItem('fixture-mode', 'slow'); window.mode = 'slow'; });
    await card(1).locator('.gq-link', { hasText: '닫기' }).click(); await card(2).locator('.gq-link', { hasText: '빼기' }).click();
    await primary.click();
    await target.locator('textarea.answer').fill(sourceAnswer);
    await add('같은 단어', 'tone');
    await primary.click();
    await view.locator('.gq-status', { hasText: 'GPT가 답하는 중' }).waitFor();
    await gpt.close();
    await view.locator('.gq-status', { hasText: '보낸 GPT 탭을 찾을 수 없어요' }).waitFor();
    await shot('6-lost');
    const reopened = context.waitForEvent('page');
    await view.locator('.gq-status .gq-link', { hasText: '다시 열기' }).click();
    gpt = await reopened;
    gpt.on('pageerror', e => errors.push('gpt: ' + e.message));
    await gpt.waitForURL('https://chatgpt.com/g/project/c/feedback-fixture', { waitUntil: 'commit' });
    await gpt.evaluate(() => localStorage.setItem('fixture-mode', 'normal')).catch(() => {});
    await gpt.goto(gpt.url());
    await view.locator('.gq-sum').waitFor({ timeout: 25000 });
    assert.match(await card(1).innerText(), /\[수정 1\] 같은 단어/);
    console.log('PASS: closed GPT tab shown as lost, reopened tab resumes watching the same request');

    // 9. 전송 확인 불가 → 사용자가 고른 다시 보내기만 새 요청으로 보낸다
    await dash.locator('.gq-actions .jsl-action-btn', { hasText: '모두 빼기' }).click();
    await primary.filter({ hasText: '새 질문' }).click();
    await view.locator('.gq-empty').waitFor();
    await gpt.evaluate(() => { window.echo = false; });
    await add('마지막 문장입니다', 'context');
    await primary.click();
    await view.locator('.gq-status', { hasText: '보냈는지 확인하지 못했어요' }).waitFor({ timeout: 25000 });
    assert.equal(await gpt.evaluate(() => sends), 1);
    await target.waitForTimeout(6000); // 확인 불가 요청은 자동으로 다시 보내지 않는다(주기 확인 한 번 이상)
    assert.equal(await gpt.evaluate(() => sends), 1);
    await gpt.evaluate(() => { window.echo = true; });
    await view.locator('.gq-status .gq-link', { hasText: '보내지 않았다면 다시 보내기' }).click();
    await view.locator('.gq-sum').waitFor({ timeout: 25000 });
    assert.equal(await gpt.evaluate(() => sends), 2);
    console.log('PASS: unknown send is never retried automatically; explicit resend creates a new request');

    // 10. 다른 문항에 있을 때 답 도착 → 알림에서 그 문항으로
    await dash.locator('.gq-actions .jsl-action-btn', { hasText: '모두 빼기' }).click();
    await primary.filter({ hasText: '새 질문' }).click();
    await gpt.evaluate(() => { window.delay = 3500; });
    await add('같은 단어', 'tone');
    await primary.click();
    await view.locator('.gq-status', { hasText: 'GPT가 답하는 중' }).waitFor();
    await target.locator('#q2').click();
    await dash.locator('.view-meta', { hasText: '2번 문항' }).waitFor();
    const go = target.locator('#jsl-toasts .tact', { hasText: '1번 문항으로' });
    await go.waitFor({ timeout: 25000 });
    await go.click();
    await dash.locator('.view-meta', { hasText: '1번 문항' }).waitFor();
    await view.locator('.gq-sum').waitFor();
    assert.equal(await target.evaluate(() => model.currentQnaIndex), 0);
    console.log('PASS: reply for another question notifies with a jump action and opens that question');

    // 11. 실사이트처럼 모델에 서버 CRLF가 남고 입력칸 끝 줄바꿈이 모델에서 잘린 상태에서도 보내고 받는다
    await dash.locator('.gq-actions .jsl-action-btn', { hasText: '모두 빼기' }).click();
    await primary.filter({ hasText: '새 질문' }).click();
    await gpt.evaluate(() => { window.delay = 900; });
    await target.evaluate(() => {
      const q = model.qnas[0]; q.answer = q.answer.replace(/\n/g, '\r\n').trim();
      document.querySelector('textarea.answer').value = q.answer + '\n';
    });
    assert.notEqual(await target.evaluate(() => model.qnas[0].answer), await answer());
    await add('마지막 문장입니다', 'tone');
    await primary.click();
    await view.locator('.gq-sum').waitFor({ timeout: 25000 });
    await card(1).getByRole('button', { name: '인용 1 받기' }).click();
    await card(1).locator('.st.done').waitFor();
    assert.equal(await answer(), sourceAnswer.replace('마지막 문장입니다', '[수정 1] 마지막 문장입니다') + '\n');
    console.log('PASS: CRLF model answer and trimmed ng-model value do not block send or apply');

    // 12. 문항 이탈
    await target.evaluate(() => history.pushState({}, '', '/resume_list'));
    await view.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('PASS: SPA exit closes view, no page errors');
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
