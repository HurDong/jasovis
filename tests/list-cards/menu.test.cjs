const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture(fetcher) {
  const events = {}, shadowEvents = {}, nodes = new Map(), copied = [], requests = [];
  const node = () => ({ hidden: false, style: {}, dataset: {}, setAttribute(k,v) { this[k]=v; },
    getAttribute(k) { return this[k]; }, focus() {}, getBoundingClientRect: () => ({width:258,height:300}),
    querySelectorAll: () => [node()], contains: () => false });
  const shadow = { querySelector(s) { if (!nodes.has(s)) nodes.set(s,node()); return nodes.get(s); },
    addEventListener: (n,f) => {shadowEvents[n]=f;} };
  const state = {page:'list',resumes:[{id:1,employmentCompanyId:11},{id:2,employmentCompanyId:22}]};
  vm.runInNewContext(fs.readFileSync('src/features/list-menu.js','utf8'), {
    JSL:{register:(_,f)=>f(),onState:f=>f(state),getState:()=>Promise.resolve(state)},
    document:{body:{appendChild(){}},createElement:()=>({...node(),attachShadow:()=>shadow}),
      addEventListener:(n,f)=>{events[n]=f;}}, window:{addEventListener(){}},
    location:{pathname:'/resume_list',origin:'https://jasoseol.com'}, innerWidth:1000,innerHeight:800,
    MutationObserver:class {observe(){} disconnect(){}}, URL, AbortController,
    navigator:{clipboard:{writeText:t=>{copied.push(t);return Promise.resolve();}}},
    fetch:(url,opts)=>{requests.push({url,opts});return fetcher(url,opts);},
    setTimeout:()=>1,clearTimeout(){}
  });
  function open(id=1) {
    const card={...node(),isConnected:true,matches:()=>false,getAttribute:()=>String(id),querySelector:()=>({textContent:'가상 기업'})};
    events.contextmenu({target:{closest:()=>card},preventDefault(){},clientX:10,clientY:10});
  }
  function copy(){ const item={dataset:{action:'copy-notice'},getAttribute:()=>null,matches:()=>false};
    shadowEvents.click({target:{closest:()=>item},preventDefault(){}}); }
  return {open,copy,copied,requests,close:()=>events.pointerdown({composedPath:()=>[]}),
    status:()=>nodes.get('.status').textContent};
}
const flush = () => new Promise(resolve=>setImmediate(resolve));
const ok = value => Promise.resolve({ok:true,json:()=>Promise.resolve({employment_page_url:value})});

test('메뉴는 조회하지 않고 복사 클릭만 기업 URL을 조회한다',async()=>{
  const f=fixture(()=>ok('https://careers.example.com/jobs/42?lang=ko'));f.open();await flush();
  assert.equal(f.requests.length,0);f.copy();f.copy();await flush();
  assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/\/11\?skip_read_log=true$/);
  assert.equal(f.requests[0].opts.credentials,'include');
  assert.deepEqual(f.copied,['https://careers.example.com/jobs/42?lang=ko']);
});
test('주소 누락 및 잘못된 주소는 기존 클립보드를 보존한다',async()=>{
  for(const value of [null,'','/recruit/11','javascript:alert(1)','https://link.jasoseol.com/recruit/11','https://jasoseol.com/recruit/11','https://user:pass@example.com']) {
    const f=fixture(()=>ok(value));f.open();f.copy();await flush();assert.equal(f.copied.length,0);assert.match(f.status(),/주소가 없습니다/);
  }
});
test('HTTP 및 네트워크 실패 후 재시도할 수 있다',async()=>{
  for(const fail of [()=>Promise.resolve({ok:false}),()=>Promise.reject(new Error('network'))]) {
    let n=0;const f=fixture(()=>n++ ? ok('https://example.com/') : fail());f.open();f.copy();await flush();
    assert.equal(f.copied.length,0);assert.match(f.status(),/불러오지 못했습니다/);
    f.copy();await flush();assert.equal(f.copied.length,1);
  }
});
test('닫기와 카드 전환은 요청을 취소하고 늦은 응답을 복사하지 않는다',async()=>{
  for(const change of [f=>f.close(),f=>f.open(2)]) {
    let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.open();f.copy();change(f);
    assert.equal(f.requests[0].opts.signal.aborted,true);
    resolve(await ok('https://example.com/'));await flush();assert.equal(f.copied.length,0);
  }
});
