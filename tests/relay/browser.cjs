// 실제 MV3 확장 + 가상 입력 페이지. 개인 프로필과 실사이트에는 접근하지 않는다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const P = require('../../src/core/relay-profile.js');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsl-relay-test-'));
const fake = P.empty();
const record = (category, values) => ({title:values[0],fields:P.templates[category].map((label,i)=>[label,values[i]])});
fake.categories.어학 = [record('어학',['가상 어학','000012-A','2026.01','가상 등급'])];
fake.categories.교육 = [
  record('교육',['가상 교육 A','가상 교육원','2025.01.02','2025.03.04','120','  가상 교육 본문\n\n'+'줄바꿈과 긴 내용 보존 확인. '.repeat(10)+'  ']),
  record('교육',['<img src=x onerror=alert(1)>','가상 교육원','','','0',''])
];
const errors=[];
(async()=>{
  const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--disable-extensions-except='+root,'--load-extension='+root]});
  context.setDefaultTimeout(10000);
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).host;
    await context.route('https://jasoseol.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><body style="margin:0;background:#fafafa"><label>가상 지원서<textarea id="answer">원래 초안</textarea></label></body>'}));
    const options=await context.newPage();options.on('pageerror',e=>errors.push(e.message));
    await options.goto('chrome-extension://'+id+'/src/options/options.html');
    const status=options.locator('#profile-status');
    await status.filter({hasText:'불러왔습니다'}).waitFor();
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile),undefined);
    assert.equal(await options.locator('input[type=file]').count(),0);
    assert.equal(await options.getByText('현재 내용 내보내기',{exact:true}).count(),0);
    for(const name of ['어학','교육']){
      await options.getByRole('button',{name,exact:true}).click();
      for(const [index,item] of fake.categories[name].entries()){
        await options.locator('#profile-add').click();
        const box=options.locator('.profile-record').nth(index);
        for(const [label,value] of item.fields) await box.getByLabel(label,{exact:true}).fill(value);
        assert.equal(await box.locator('.profile-record-head strong').textContent(),item.title);
      }
    }
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile),undefined);
    await options.locator('#profile-save').click();await status.filter({hasText:'이 브라우저에 저장했습니다'}).waitFor();
    assert.deepEqual(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile),fake);
    await options.reload();await status.filter({hasText:'불러왔습니다'}).waitFor();
    assert.equal(await options.getByLabel('등록번호',{exact:true}).inputValue(),'000012-A');
    await options.getByRole('button',{name:'수상',exact:true}).click();await options.locator('#profile-add').click();
    await options.locator('#profile-save').click();await status.filter({hasText:'항목 이름'}).waitFor();
    assert.deepEqual(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile),fake);
    await options.getByLabel('상훈명',{exact:true}).fill('가상 우수상');
    await options.locator('#profile-save').click();await status.filter({hasText:'이 브라우저에 저장했습니다'}).waitFor();
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile.categories.수상[0].fields[0][1]),'가상 우수상');
    await options.getByRole('button',{name:'삭제',exact:true}).click();
    await options.locator('#profile-save').click();await status.filter({hasText:'이 브라우저에 저장했습니다'}).waitFor();
    await options.getByRole('button',{name:'어학',exact:true}).click();
    console.log('PASS: no file controls, direct entry, derived title, empty-name validation, save/read-back/reload, add/edit/delete');

    // JSON 붙여넣기는 편집 화면에만 추가하고, 저장 버튼을 눌러야 저장한다.
    const importText=options.locator('#profile-import-text');
    await options.locator('.profile-import summary').click();
    await importText.fill('{');await options.locator('#profile-import').click();
    await status.filter({hasText:'JSON 형식'}).waitFor();
    assert.equal(await options.locator('.profile-record').count(),1);
    const license={fields:[['자격증명','가상 자격증’s'],['발급기관','가상 기관'],['등록번호','0000-A'],['취득일','2026.01.02']]};
    await importText.fill(JSON.stringify({version:1,categories:{어학:[{fields:fake.categories.어학[0].fields},{fields:[['시험명','가상 어학'],['등록번호','1']]}],자격증:[license,license]}}));
    await options.locator('#profile-import').click();
    await status.filter({hasText:'자격증 1개를 편집 화면에 추가했습니다'}).waitFor();
    assert.match(await status.textContent(),/같은 항목 2개는 건너뛰었습니다.*어학 · 가상 어학/);
    assert.equal(await importText.inputValue(),'');
    assert.equal(await options.getByRole('button',{name:'자격증',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await options.getByLabel('등록번호',{exact:true}).inputValue(),'0000-A');
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile.categories.자격증.length),0);
    await options.locator('#profile-save').click();await status.filter({hasText:'이 브라우저에 저장했습니다'}).waitFor();
    fake.categories.자격증=[{title:'가상 자격증’s',fields:license.fields}];
    assert.deepEqual(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile),fake);
    await importText.fill(JSON.stringify({version:1,categories:{자격증:[license]}}));await options.locator('#profile-import').click();
    await status.filter({hasText:'추가할 새 항목이 없습니다'}).waitFor();
    await options.getByRole('button',{name:'어학',exact:true}).click();
    console.log('PASS: JSON paste adds to editor only, derived title, duplicate/same-name skip, invalid JSON keeps draft, explicit save');

    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://jasoseol.com/resume/900');
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://jasoseol.com'});
    await worker.evaluate(async()=>{
      await chrome.storage.local.set({jslRelayOn:'fictional',jslRelayDocs:{fictional:{resumeId:'fictional',qnas:[{number:1,question:'가상 문항',answer:'  가상 답변\n\n끝  '}]}}});
      const tab=(await chrome.tabs.query({url:'https://jasoseol.com/resume/900'}))[0];
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/core/relay-profile.js','src/features/relay-panel.js']});
    });
    const host=page.locator('#jsl-relay-host'), panel=host.locator('.profile-panel');
    await host.waitFor();assert.equal(await panel.isVisible(),false);
    assert.equal(await host.locator('.bar').evaluate(el=>el.getBoundingClientRect().width),48);
    assert.equal(await host.locator('.bar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(41, 41, 41)');
    await host.locator('.n').click();
    await host.locator('.tip.copied').waitFor();
    // Windows 클립보드는 LF를 CRLF로 반환할 수 있다. 빈 줄과 공백은 그대로 비교한다.
    assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),'  가상 답변\n\n끝  ');
    const clip=async()=>(await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n');
    const current=()=>panel.locator('.step.cur .field-label').textContent();
    const said=text=>panel.locator('.profile-status').filter({hasText:text}).waitFor();
    const dock=()=>panel.locator('.dock').evaluate(d=>[...d.querySelectorAll('.dock-value,.next')].map(e=>e.textContent));
    await host.getByRole('button',{name:'교육',exact:true}).click();await panel.waitFor();
    const picks=panel.locator('.pick');
    assert.deepEqual(await picks.evaluateAll(els=>els.map(e=>[e.textContent,e.getAttribute('aria-pressed')])),[['1','true'],['2','false']]);
    assert.equal(await panel.locator('.record-meta').textContent(),'2025.01.02 – 2025.03.04');
    assert.equal(await panel.locator('.step').count(),6);assert.equal(await current(),'과정명');
    assert.deepEqual(await dock(),['가상 교육 A','복사하고 다음']);
    const nextBox=await panel.locator('.next').boundingBox();
    await panel.getByRole('button',{name:'과정명 복사하고 다음 칸으로',exact:true}).click();await said('과정명 복사됨');
    assert.equal(await clip(),'가상 교육 A');assert.equal(await current(),'교육기관');assert.equal(await panel.locator('.step.done').count(),1);
    // 복사하고 다음 버튼은 칸을 따라 움직이지 않고 같은 자리에 남는다.
    assert.deepEqual(await panel.locator('.next').boundingBox(),nextBox);
    assert.deepEqual(await dock(),['가상 교육원','복사하고 다음']);
    // 아무 칸이나 누르면 그 값을 복사하고 바로 다음 칸으로 이어간다.
    await panel.getByRole('button',{name:'교육시간 복사',exact:true}).click();await said('교육시간 복사됨');
    assert.equal(await clip(),'120');assert.equal(await current(),'주요내용');
    assert.deepEqual(await dock(),[fake.categories.교육[0].fields[5][1],'복사하고 다음']);
    await panel.getByRole('button',{name:'주요내용 복사하고 다음 칸으로',exact:true}).click();await said('주요내용 복사됨 · 마지막 칸');
    assert.equal(await clip(),fake.categories.교육[0].fields[5][1]);
    assert.equal(await panel.locator('.step.cur').count(),0);assert.deepEqual(await dock(),['마지막 칸까지 복사했습니다\n다음은 <img src=x onerror=alert(1)>','다음 교육으로']);
    await panel.getByRole('button',{name:'전체 보기',exact:true}).click();
    assert.equal(await panel.locator('.field.expanded').count(),1);
    // 마지막 칸 뒤에는 같은 자리의 버튼으로 다음 항목에 넘어간다.
    await panel.getByRole('button',{name:'2번 교육으로 넘어가기',exact:true}).click();await said('2번 교육으로 넘어왔습니다');
    assert.equal(await picks.nth(1).getAttribute('aria-pressed'),'true');
    assert.equal(await panel.locator('.record-title strong').textContent(),'<img src=x onerror=alert(1)>');
    assert.equal(await panel.locator('img').count(),0);assert.equal(await panel.locator('.record-meta').count(),0);
    assert.equal(await panel.getByRole('button',{name:'주요내용 복사',exact:true}).isDisabled(),true);
    // 빈 값(시작일·종료일)은 다음 칸에서 건너뛴다.
    await panel.getByRole('button',{name:'교육기관 복사',exact:true}).click();await said('교육기관 복사됨');
    assert.equal(await current(),'교육시간');
    // 마지막 항목을 끝내면 앞의 끝나지 않은 항목으로 안내한다.
    await panel.getByRole('button',{name:'교육시간 복사하고 다음 칸으로',exact:true}).click();await said('교육시간 복사됨 · 마지막 칸');
    assert.deepEqual(await dock(),['마지막 칸까지 복사했습니다\n다음은 가상 교육 A','다음 교육으로']);
    assert.equal(await panel.getByRole('button',{name:'1번 교육으로 넘어가기',exact:true}).count(),1);
    await picks.nth(0).click();
    assert.equal(await panel.locator('.step.done').count(),3);assert.equal(await panel.locator('.step.cur').count(),0);
    assert.deepEqual(await dock(),['마지막 칸까지 복사했습니다\n다음은 <img src=x onerror=alert(1)>','다음 교육으로']);
    await panel.getByRole('button',{name:'처음부터 다시',exact:true}).click();
    assert.equal(await panel.locator('.step.done').count(),0);assert.equal(await current(),'과정명');
    assert.equal(await page.locator('#answer').inputValue(),'원래 초안');
    await host.getByRole('button',{name:'어학',exact:true}).click();
    await panel.getByRole('button',{name:'등록번호 복사',exact:true}).click();await said('등록번호 복사됨');
    assert.equal(await clip(),'000012-A');assert.equal(await current(),'응시일');
    await panel.getByRole('button',{name:'응시일 복사하고 다음 칸으로',exact:true}).click();await said('응시일 복사됨');
    await panel.getByRole('button',{name:'등급 복사하고 다음 칸으로',exact:true}).click();await said('등급 복사됨 · 마지막 칸');
    assert.equal(await clip(),'가상 등급');assert.equal(await picks.first().evaluate(e=>e.classList.contains('fin')),false);
    await panel.getByRole('button',{name:'시험명 복사',exact:true}).click();await said('시험명 복사됨');
    assert.equal(await picks.first().evaluate(e=>e.classList.contains('fin')),true);
    await host.getByRole('button',{name:'어학',exact:true}).click();assert.equal(await panel.isVisible(),false);
    console.log('PASS: record picker, fixed copy-and-next dock, restart, jump from any field, skip empty values, per-record progress, long text, inert markup, untouched site draft');

    // 설정 저장이 열린 패널에 반영되는지, 오래된 편집본은 덮어쓰기를 막는지 확인한다.
    const other=await context.newPage();await other.goto(options.url());await other.locator('#profile-status').filter({hasText:'불러왔습니다'}).waitFor();
    await options.getByLabel('등록번호',{exact:true}).fill('000099-Z');await options.locator('#profile-save').click();
    await status.filter({hasText:'이 브라우저에 저장했습니다'}).waitFor();
    await host.getByRole('button',{name:'어학',exact:true}).click();
    await panel.getByText('000099-Z',{exact:true}).waitFor();
    await other.getByLabel('등록번호',{exact:true}).fill('stale');await other.locator('#profile-save').click();
    await other.locator('#profile-status').filter({hasText:'다른 설정 화면'}).waitFor();
    other.on('dialog',d=>d.accept());await other.close();
    await host.getByRole('button',{name:'교육',exact:true}).click();
    for(const [width,height] of [[1280,800],[375,667],[320,480]]){
      await page.setViewportSize({width,height});
      await page.waitForFunction(()=>{const el=document.querySelector('#jsl-relay-host').shadowRoot.querySelector('.profile-panel');const r=el.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});
      const rect=await panel.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=height,JSON.stringify(rect));
      assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    }
    if(process.env.JSL_RELAY_SCREENSHOT){await page.setViewportSize({width:1000,height:800});await page.screenshot({path:process.env.JSL_RELAY_SCREENSHOT});}
    await host.getByRole('button',{name:'모든 탭에서 닫기',exact:true}).click();await host.waitFor({state:'detached'});
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile.categories.어학[0].fields[1][1]),'000099-Z');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS: settings propagation, stale editor protection, viewport bounds, global close retains profile, no page errors');
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('jsl-relay-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
