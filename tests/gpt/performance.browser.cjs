const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
(async () => {
 const browser = await chromium.launch({channel:'chrome', headless:true});
 try {
  for (const linked of [false, true]) {
   const page = await browser.newPage();
   const errors = []; page.on('pageerror', e => errors.push(e.message));
   await page.route('https://chatgpt.com/**', r => r.fulfill({contentType:'text/html', body:'<html><body><main></main><aside id="other"></aside></body></html>'}));
   await page.goto('https://chatgpt.com/c/performance-fixture');
   await page.evaluate(linked => {
    window.stats = {parse:0, messages:0}; window.listeners=[];
    window.chrome = {runtime:{id:'fixture', onMessage:{addListener(fn){listeners.push(fn);}}, sendMessage:async () => {
     stats.messages++; return {ok:true, link:linked ? {resume:{id:'1',title:'가상 지원서'},revision:'fixture'} : null,targets:[]};
    }}, storage:{onChanged:{addListener(){}}}};
    window.addAnswer = () => {
     const row = document.createElement('article'); row.innerHTML='<div data-message-author-role="assistant"><div class="markdown"><h3>문항 1</h3><p>지원 동기를 작성하세요.</p><pre><code>가상 답변입니다.</code></pre></div></div><button data-testid="copy-turn-action-button">복사</button>';
     document.querySelector('main').append(row); return row;
    };
    for(let i=0;i<30;i++) addAnswer();
   }, linked);
   await page.addScriptTag({path:path.join(root,'src/core/gpt-protocol.js')});
   await page.evaluate(()=>{const parse=JSLGpt.parse;JSLGpt.parse=(...args)=>{stats.parse++;return parse(...args);};});
   const responseCode = process.env.JSL_GPT_PERF_BASELINE
    ? require('node:child_process').execFileSync('git',['show','809e719:src/features/gpt-response.js'],{cwd:root,encoding:'utf8'})
    : fs.readFileSync(path.join(root,'src/features/gpt-response.js'),'utf8');
   await page.addScriptTag({content:responseCode});
   const settle = () => page.waitForTimeout(450);
   const reset = () => page.evaluate(()=>{stats.parse=0;stats.messages=0;});
   const count = () => page.locator('[data-jsl-gpt]').count();
   await settle(); assert.equal(await count(),30);
   await reset();
   for(let i=0;i<5;i++){await page.locator('#other').evaluate((el,i)=>el.textContent='가상 변경 '+i,i);await settle();}
   const unrelated = await page.evaluate(()=>({...stats}));
   assert.equal(unrelated.parse,0,'unrelated changes must not reparse old answers');
   assert.equal(unrelated.messages,0);
   await page.locator('.markdown code').first().evaluate(el=>el.textContent='수정된 가상 답변');await settle();
   assert.equal(await page.evaluate(()=>stats.parse),1,'only changed answer is parsed');
   // Applying/source checks must still read the live answer before the debounce fires.
   const check = await page.evaluate(async()=>{
    const panel=document.querySelector('[data-jsl-gpt]');
    document.querySelector('.markdown code').textContent='다시 바뀐 가상 답변';
    return new Promise(resolve=>listeners[0]({type:'gpt:source-check',response:panel.dataset.jslGptResponse,conversation:'performance-fixture',fingerprint:'obsolete'}, {id:'fixture'},resolve));
   }); assert.equal(check.valid,false);await settle();
   await reset();
   await page.evaluate(()=>document.querySelector('article').setAttribute('data-is-streaming','true'));await settle();
   assert.equal(await count(),29);
   await page.evaluate(()=>document.querySelector('article').removeAttribute('data-is-streaming'));await settle();
   assert.equal(await count(),30);
   // Clone/replacement must remove dead controls and attach one working panel.
   await page.evaluate(()=>{const row=document.querySelector('article');row.replaceWith(row.cloneNode(true));});await settle();
   assert.equal(await count(),30);
   await page.evaluate(()=>addAnswer());await settle();assert.equal(await count(),31);
   await page.evaluate(()=>document.querySelector('article').remove());await settle();assert.equal(await count(),30);
   await page.evaluate(()=>history.pushState({},'', '/c/another-fixture'));await page.waitForTimeout(900);
   assert.equal(await count(),0,'old conversation responses remain stale');
   await page.evaluate(()=>addAnswer());await settle();assert.equal(await count(),1);
   assert.deepEqual(errors,[]);
   console.log(JSON.stringify({linked,unrelated,result:'PASS: edit, source recheck, streaming, clone, insertion, removal, SPA'}));
   await page.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
