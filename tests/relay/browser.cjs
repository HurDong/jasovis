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
const education = [
  record('교육',['가상 교육 A','가상 교육원','2025.01.02','2025.03.04','120','  가상 교육 본문\n\n'+'줄바꿈과 긴 내용 보존 확인. '.repeat(10)+'  ']),
  record('교육',['<img src=x onerror=alert(1)>','가상 교육원','','','0',''])
];
const license = record('자격증',['가상 자격증’s','가상 기관','0000-A','2026.01.02']);
const errors=[];
(async()=>{
  const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--disable-extensions-except='+root,'--load-extension='+root]});
  context.setDefaultTimeout(10000);
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).host;
    const stored=()=>worker.evaluate(async()=>(await chrome.storage.local.get('jslRelayProfile')).jslRelayProfile);
    const store=value=>worker.evaluate(async v=>{await chrome.storage.local.set({jslRelayProfile:v});},value);
    await context.route('https://jasoseol.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><body style="margin:0;background:#fafafa"><label>가상 지원서<textarea id="answer">원래 초안</textarea></label></body>'}));

    // 옵션 화면에는 권한 설정만 남고 내 이력 편집·파일 입출력은 없다.
    const options=await context.newPage();options.on('pageerror',e=>errors.push(e.message));
    await options.goto('chrome-extension://'+id+'/src/options/options.html');
    await options.locator('#grant').waitFor({state:'attached'});
    assert.equal(await options.locator('textarea, input, #profile-status').count(),0);
    await options.close();

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
    const button=name=>panel.getByRole('button',{name,exact:true});
    const field=name=>panel.getByLabel(name,{exact:true});
    // 같은 안내 문구가 연달아 나오면 문구만으로는 저장 완료를 알 수 없어 저장본과 편집칸 닫힘을 기다린다.
    const saved=async check=>{for(let i=0;i<200&&!check(await stored());i++)await new Promise(r=>setTimeout(r,25));assert.ok(check(await stored()));await panel.locator('.field-edit').waitFor({state:'detached'});};

    // 빈 분류에서 바로 새 항목을 추가한다. 입력 키는 사이트 문서 리스너로 올라가지 않는다.
    await page.evaluate(()=>{window.__siteKeys=0;document.addEventListener('keydown',()=>window.__siteKeys++);});
    await host.getByRole('button',{name:'어학',exact:true}).click();await panel.waitFor();
    await panel.getByText('등록된 어학 정보가 없습니다').waitFor();
    assert.equal(await stored(),undefined);
    await button('+ 어학 추가').click();
    assert.deepEqual(await panel.locator('.edit-label').allTextContents(),P.templates.어학);
    await button('외국어 활용능력').click();
    assert.deepEqual(await panel.locator('.edit-label').allTextContents(),P.alternates.어학['외국어 활용능력']);
    await button('공인시험').click();
    await button('추가').click();await said('시험명 칸을 입력해 주세요');
    assert.equal(await stored(),undefined);
    await field('시험명').pressSequentially('abc');
    assert.equal(await page.evaluate(()=>window.__siteKeys),0);
    for(const [label,value] of fake.categories.어학[0].fields) await field(label).fill(value);
    await button('추가').click();await said('가상 어학 추가됨');
    assert.deepEqual(await stored(),fake);
    assert.equal(await panel.locator('.pick[aria-pressed=true]').textContent(),'1');

    // ✎로 칸 하나만 고친다. Esc는 취소, Enter·✓는 저장, 첫 칸은 비울 수 없다.
    await panel.locator('.step').nth(1).hover();
    await button('등록번호 수정').click();
    assert.equal(await field('등록번호').inputValue(),'000012-A');
    await field('등록번호').fill('999');await field('등록번호').press('Escape');
    assert.equal(await panel.locator('.field-edit').count(),0);
    assert.deepEqual(await stored(),fake);
    await button('등록번호 수정').click();
    await field('등록번호').fill('000012-B');await field('등록번호').press('Enter');await said('등록번호 수정됨');await saved(v=>v.categories.어학[0].fields[1][1]==='000012-B');
    assert.equal((await stored()).categories.어학[0].fields[1][1],'000012-B');
    await button('등록번호 수정').click();
    await field('등록번호').fill('000012-A');await button('등록번호 저장').click();await saved(v=>v.categories.어학[0].fields[1][1]==='000012-A');
    await button('시험명 수정').click();
    await field('시험명').fill('  ');await field('시험명').press('Enter');await said('시험명 칸은 비울 수 없습니다');
    await button('시험명 수정 취소').click();
    assert.deepEqual(await stored(),fake);

    // 다른 탭이 먼저 바꾼 항목은 덮어쓰지 않는다. 다시 그려져도 입력 중인 값은 남는다.
    await button('응시일 수정').click();
    await field('응시일').fill('draft-date');
    const changed=JSON.parse(JSON.stringify(fake));changed.categories.어학[0].fields[3][1]='다른 탭 등급';
    await store(changed);
    await panel.getByText('다른 탭 등급',{exact:true}).waitFor();
    assert.equal(await field('응시일').inputValue(),'draft-date');
    await button('응시일 저장').click();await said('다른 탭에서 이 항목이 바뀌었습니다');
    assert.deepEqual(await stored(),changed);
    await button('응시일 수정 취소').click();
    await store(fake);await panel.getByText('가상 등급',{exact:true}).waitFor();

    // 여러 줄 칸은 Enter로 줄을 바꾸고 Ctrl+Enter로 추가한다. 삭제는 한 번 더 확인한다.
    await host.getByRole('button',{name:'수상',exact:true}).click();
    await button('+ 수상 추가').click();
    await field('상훈명').fill('가상 우수상');
    await field('수상내역').fill('첫 줄\n둘째 줄');await field('수상내역').press('Enter');
    assert.equal((await stored()).categories.수상.length,0);
    await field('수상내역').press('Control+Enter');await said('가상 우수상 추가됨');
    assert.equal((await stored()).categories.수상[0].fields[3][1],'첫 줄\n둘째 줄\n');
    await button('가상 우수상 삭제').click();
    await panel.getByText('이 항목을 삭제할까요?').waitFor();
    await button('취소').click();
    assert.equal((await stored()).categories.수상.length,1);
    await button('가상 우수상 삭제').click();await button('삭제 확인').click();await said('가상 우수상 삭제됨');
    assert.deepEqual(await stored(),fake);
    await panel.getByText('등록된 수상 정보가 없습니다').waitFor();
    console.log('PASS: options page has no profile editor, add from empty panel, language template, key isolation, pencil edit/cancel/save, required title, stale edit protection with kept draft, multiline add, confirmed delete');

    // JSON은 확인으로 미리 보고 '추가하고 저장'을 눌러야 저장한다.
    await host.getByRole('button',{name:'교육',exact:true}).click();
    await button('JSON으로 추가').click();
    const area=field('붙여넣을 이력 JSON'), preview=panel.locator('.json-preview'), jsonError=panel.locator('.json-error');
    await button('확인').click();await jsonError.filter({hasText:'JSON을 붙여넣어 주세요'}).waitFor();
    await button('교육 형식 예시 넣기').click();
    assert.deepEqual(JSON.parse(await area.inputValue()).categories.교육[0].fields.map(pair=>pair[0]),P.templates.교육);
    await button('확인').click();await jsonError.filter({hasText:'항목 이름'}).waitFor();
    await area.fill('{');
    assert.equal(await jsonError.count(),0);
    await button('확인').click();await jsonError.filter({hasText:'JSON 형식'}).waitFor();
    const paste={version:1,categories:{
      어학:[{fields:fake.categories.어학[0].fields},{fields:[['시험명','가상 어학'],['등록번호','1']]}],
      자격증:[{fields:license.fields},{fields:license.fields}],
      교육:education.map(item=>({fields:item.fields}))
    }};
    await area.fill(JSON.stringify(paste));await button('확인').click();await preview.waitFor();
    const summary=await preview.textContent();
    assert.match(summary,/3개를 추가합니다/);assert.match(summary,/자격증 1가상 자격증’s/);
    assert.match(summary,/교육 2가상 교육 A, <img src=x onerror=alert\(1\)>/);
    assert.match(summary,/같은 항목 2개는 건너뜁니다/);assert.match(summary,/이름이 같아 제외: 어학 · 가상 어학/);
    assert.equal(await panel.locator('img').count(),0);
    assert.deepEqual(await stored(),fake);
    await button('추가하고 저장').click();await said('자격증 1개, 교육 2개를 추가했습니다');
    fake.categories.자격증=[license];fake.categories.교육=education;
    assert.deepEqual(await stored(),fake);
    assert.equal(await host.getByRole('button',{name:'자격증',exact:true}).getAttribute('aria-expanded'),'true');
    await button('JSON으로 추가').click();
    await area.fill(JSON.stringify(paste));await button('확인').click();
    await preview.filter({hasText:'추가할 새 항목이 없습니다'}).waitFor();
    await button('닫기').click();
    assert.deepEqual(await stored(),fake);
    await host.getByRole('button',{name:'자격증',exact:true}).click();assert.equal(await panel.isVisible(),false);
    assert.equal(await page.locator('#answer').inputValue(),'원래 초안');
    console.log('PASS: JSON sample, empty/invalid/field errors cleared on edit, preview before save, duplicate/same-name skip, inert markup, save and switch category, nothing-new close');

    await host.getByRole('button',{name:'교육',exact:true}).click();await panel.waitFor();
    const picks=panel.locator('.pick:not(.add)');
    assert.deepEqual(await picks.evaluateAll(els=>els.map(e=>[e.textContent,e.getAttribute('aria-pressed')])),[['1','true'],['2','false']]);
    assert.equal(await panel.locator('.record-meta').textContent(),'2025.01.02 – 2025.03.04');
    assert.equal(await panel.locator('.step').count(),6);assert.equal(await current(),'과정명');
    assert.deepEqual(await dock(),['가상 교육 A','복사하고 다음']);
    const nextBox=await panel.locator('.next').boundingBox();
    await button('과정명 복사하고 다음 칸으로').click();await said('과정명 복사됨');
    assert.equal(await clip(),'가상 교육 A');assert.equal(await current(),'교육기관');assert.equal(await panel.locator('.step.done').count(),1);
    // 복사하고 다음 버튼은 칸을 따라 움직이지 않고 같은 자리에 남는다.
    assert.deepEqual(await panel.locator('.next').boundingBox(),nextBox);
    assert.deepEqual(await dock(),['가상 교육원','복사하고 다음']);
    // 아무 칸이나 누르면 그 값을 복사하고 바로 다음 칸으로 이어간다.
    await button('교육시간 복사').click();await said('교육시간 복사됨');
    assert.equal(await clip(),'120');assert.equal(await current(),'주요내용');
    assert.deepEqual(await dock(),[education[0].fields[5][1],'복사하고 다음']);
    // 칸을 고쳐도 복사 진행은 이어진다.
    await button('교육시간 수정').click();await field('교육시간').fill('121');await field('교육시간').press('Enter');await saved(v=>v.categories.교육[0].fields[4][1]==='121');
    assert.equal(await current(),'주요내용');assert.equal(await panel.locator('.step.done').count(),2);
    await button('교육시간 수정').click();await field('교육시간').fill('120');await field('교육시간').press('Enter');await saved(v=>v.categories.교육[0].fields[4][1]==='120');
    await button('주요내용 복사하고 다음 칸으로').click();await said('주요내용 복사됨 · 마지막 칸');
    assert.equal(await clip(),education[0].fields[5][1]);
    assert.equal(await panel.locator('.step.cur').count(),0);assert.deepEqual(await dock(),['마지막 칸까지 복사했습니다\n다음은 <img src=x onerror=alert(1)>','다음 교육으로']);
    await button('전체 보기').click();
    assert.equal(await panel.locator('.field.expanded').count(),1);
    // 마지막 칸 뒤에는 같은 자리의 버튼으로 다음 항목에 넘어간다.
    await button('2번 교육으로 넘어가기').click();await said('2번 교육으로 넘어왔습니다');
    assert.equal(await picks.nth(1).getAttribute('aria-pressed'),'true');
    assert.equal(await panel.locator('.record-title strong').textContent(),'<img src=x onerror=alert(1)>');
    assert.equal(await panel.locator('img').count(),0);assert.equal(await panel.locator('.record-meta').count(),0);
    assert.equal(await button('주요내용 복사').isDisabled(),true);
    // 빈 값(시작일·종료일)은 다음 칸에서 건너뛴다.
    await button('교육기관 복사').click();await said('교육기관 복사됨');
    assert.equal(await current(),'교육시간');
    // 마지막 항목을 끝내면 앞의 끝나지 않은 항목으로 안내한다.
    await button('교육시간 복사하고 다음 칸으로').click();await said('교육시간 복사됨 · 마지막 칸');
    assert.deepEqual(await dock(),['마지막 칸까지 복사했습니다\n다음은 가상 교육 A','다음 교육으로']);
    assert.equal(await button('1번 교육으로 넘어가기').count(),1);
    await picks.nth(0).click();
    assert.equal(await panel.locator('.step.done').count(),3);assert.equal(await panel.locator('.step.cur').count(),0);
    assert.deepEqual(await dock(),['마지막 칸까지 복사했습니다\n다음은 <img src=x onerror=alert(1)>','다음 교육으로']);
    await button('처음부터 다시').click();
    assert.equal(await panel.locator('.step.done').count(),0);assert.equal(await current(),'과정명');
    assert.equal(await page.locator('#answer').inputValue(),'원래 초안');
    await host.getByRole('button',{name:'어학',exact:true}).click();
    await button('등록번호 복사').click();await said('등록번호 복사됨');
    assert.equal(await clip(),'000012-A');assert.equal(await current(),'응시일');
    await button('응시일 복사하고 다음 칸으로').click();await said('응시일 복사됨');
    await button('등급 복사하고 다음 칸으로').click();await said('등급 복사됨 · 마지막 칸');
    assert.equal(await clip(),'가상 등급');assert.equal(await picks.first().evaluate(e=>e.classList.contains('fin')),false);
    await button('시험명 복사').click();await said('시험명 복사됨');
    assert.equal(await picks.first().evaluate(e=>e.classList.contains('fin')),true);
    await host.getByRole('button',{name:'어학',exact:true}).click();assert.equal(await panel.isVisible(),false);
    console.log('PASS: record picker, fixed copy-and-next dock, progress kept after edit, restart, jump from any field, skip empty values, per-record progress, long text, inert markup, untouched site draft');

    // 다른 탭의 저장이 열린 패널에 반영되고, 좁은 화면에서도 편집 화면이 밖으로 나가지 않는다.
    await host.getByRole('button',{name:'어학',exact:true}).click();
    const updated=JSON.parse(JSON.stringify(fake));updated.categories.어학[0].fields[1][1]='000099-Z';
    await store(updated);await panel.getByText('000099-Z',{exact:true}).waitFor();
    await host.getByRole('button',{name:'교육',exact:true}).click();
    const inside=async(width,height)=>{
      await page.waitForFunction(()=>{const el=document.querySelector('#jsl-relay-host').shadowRoot.querySelector('.profile-panel');const r=el.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});
      const rect=await panel.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=height,JSON.stringify(rect));
      assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    };
    for(const [width,height] of [[1280,800],[375,667],[320,480]]){await page.setViewportSize({width,height});await inside(width,height);}
    await button('JSON으로 추가').click();await inside(320,480);
    assert.equal(await button('확인').isVisible(),true);
    await button('취소').click();
    await button('교육 추가').click();await inside(320,480);await button('취소').click();
    if(process.env.JSL_RELAY_SCREENSHOT){await page.setViewportSize({width:1000,height:800});await page.screenshot({path:process.env.JSL_RELAY_SCREENSHOT});}
    await host.getByRole('button',{name:'모든 탭에서 닫기',exact:true}).click();await host.waitFor({state:'detached'});
    assert.equal((await stored()).categories.어학[0].fields[1][1],'000099-Z');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS: cross-tab propagation, viewport bounds for copy/JSON/new views, global close retains profile, no page errors');
  } finally {
    await context.close();
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('jsl-relay-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
