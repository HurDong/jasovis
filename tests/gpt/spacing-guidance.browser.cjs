// 실제 MV3 경로 + 가상 HTTPS 페이지. 실제 계정 입력·저장·GPT 전송 없음.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const F = require('./fixtures.cjs'), { narrativePairs } = require('./spacing-fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const pairs = [...narrativePairs,
  { source: '협업 과정에서 본인의 역할과 결과를 설명해주세요. (본인의 역할과 결과를 중심으로 작성해주세요.)',
    response: '협업 과정에서 본인의역할과 결과를 설명해주세요.' }];
const qnas = pairs.map((p,i) => ({ id: 501+i, number:i+1, question:p.source, answer:'기존 '+i+'\n' }));
const block = (i, answer = '  가상 답변 '+i+'\n\t끝\n', question = pairs[i].response) => F.block(i+1, { question, answer, language:'text' });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsl-spacing-'));
(async () => {
  const context = await chromium.launchPersistentContext(profile, { channel:'chromium', headless:true,
    args:['--disable-extensions-except='+root, '--load-extension='+root] });
  context.setDefaultTimeout(10000);
  try {
    const errors = [];
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    await context.route('https://jasoseol.com/**', r => r.fulfill({ contentType:'text/html; charset=utf-8', body:F.resume(77,false,qnas) }));
    await context.route('https://chatgpt.com/**', r => r.fulfill({ contentType:'text/html; charset=utf-8', body:F.chat.replace(F.full, pairs.map((_,i)=>block(i)).join('')) }));
    const target = await context.newPage(); await target.goto('https://jasoseol.com/resume/77');
    const gpt = await context.newPage(); await gpt.goto('https://chatgpt.com/g/project/c/spacing');
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const status = text => gpt.locator('[data-jsl-gpt] [role="status"]').filter({hasText:text}).waitFor();
    const apply = () => gpt.getByRole('button',{name:'자소설에 적용',exact:true}).click();
    const answers = () => target.evaluate(()=>model.qnas.map(q=>q.answer));
    const replace = html => gpt.locator('.markdown').evaluate((n,html)=>{n.innerHTML=html;},html);
    await apply(); await status('연결할 지원서를 선택');
    await gpt.locator('[data-jsl-gpt] button').filter({hasText:'/ 탭'}).click();
    await status('문항 1, 2, 3, 4 입력 확인');
    assert.equal(await gpt.getByRole('combobox').count(),0);
    assert.deepEqual(await answers(),pairs.map((_,i)=>'  가상 답변 '+i+'\n\t끝\n'));
    assert.deepEqual(await target.evaluate(()=>model.qnas.map(q=>q.question)),pairs.map(p=>p.source));
    const notes = gpt.locator('.jsl-gpt-difference');
    assert.equal(await notes.count(),4);
    assert.match(await notes.nth(0).locator('summary').textContent(),/자동 대응.*띄어쓰기.*작성 안내 생략/);
    await notes.nth(0).locator('summary').click();
    await notes.nth(0).getByText('문항 대응은 답변의 작성 조건 충족을 뜻하지 않습니다.',{exact:true}).waitFor();
    assert.ok((await notes.nth(0).textContent()).includes(pairs[0].source));
    assert.equal((await worker.evaluate(async()=> (await chrome.storage.local.get('gpt-confirmed-mappings'))['gpt-confirmed-mappings'] || [])).length,0);
    await gpt.setViewportSize({width:390,height:844});
    assert.equal(await gpt.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if (process.env.JSL_GPT_SPACING_SHOT) await gpt.locator('[data-jsl-gpt]').screenshot({path:process.env.JSL_GPT_SPACING_SHOT});
    await gpt.getByRole('button',{name:'되돌리기',exact:true}).click(); await status('되돌림');
    assert.deepEqual(await answers(),qnas.map(q=>q.answer));
    console.log('PASS: auto identification, source guidance disclosure, exact answers/questions, 390px, no automatic learning, undo');

    await replace(block(2,'역순 3\n')+block(0,'역순 1\n'));
    await apply(); await status('문항 3, 1 입력 확인');
    assert.deepEqual(await answers(),['역순 1\n',qnas[1].answer,'역순 3\n',qnas[3].answer]);
    await gpt.getByRole('button',{name:'되돌리기',exact:true}).click(); await status('되돌림');
    await replace(block(1,'부분 2\n')); await apply(); await status('문항 2 입력 확인');
    assert.deepEqual(await answers(),[qnas[0].answer,'부분 2\n',qnas[2].answer,qnas[3].answer]);
    await gpt.getByRole('button',{name:'되돌리기',exact:true}).click(); await status('되돌림');
    console.log('PASS: reverse and partial responses reach only their intended IDs');

    // Pause only delivery to the real handler, preserving all production validation.
    await worker.evaluate(()=>{
      const original=handle;
      handle=async(message,sender)=>{
        if(message.type==='gpt:apply' && globalThis.holdApply) {
          globalThis.holdApply=false;
          await new Promise(resolve=>{globalThis.releaseApply=resolve;});
        }
        return original(message,sender);
      };
    });
    for (const kind of ['question','answer','response']) {
      await replace(block(0,'검증 중 답변\n'));
      await worker.evaluate(()=>{globalThis.releaseApply=null; globalThis.holdApply=true;});
      await apply(); await status('입력 중');
      await worker.evaluate(()=>new Promise((resolve,reject)=>{
        const deadline=Date.now()+5000;
        const check=()=>globalThis.releaseApply ? resolve() : Date.now()>deadline ? reject(Error('apply gate timeout')) : setTimeout(check,20);
        check();
      }));
      if(kind==='question') await target.evaluate(()=>{model.qnas[0].question+=' 추가 조건';});
      if(kind==='answer') await target.evaluate(()=>{model.qnas[0].answer='사용자 편집';});
      if(kind==='response') await replace(block(0,'변경된 응답\n'));
      await worker.evaluate(()=>globalThis.releaseApply());
      await status('변경');
      assert.equal((await answers())[0],kind==='answer'?'사용자 편집':qnas[0].answer);
      await target.evaluate(qnas=>{model.qnas=qnas;},qnas);
    }
    console.log('PASS: changes to question, existing answer or response after prepare reject the write');
    assert.equal(await target.evaluate(()=>saves),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: no save calls or page errors');
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(profile)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('jsl-spacing-'));
    fs.rmSync(profile,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
