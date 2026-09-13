// 현재 답변에서 인용을 모아 연결된 웹 GPT로 질문한다.
JSL.register('gpt-feedback', function () {
  'use strict';
  if (window.__jslFeedback) return;
  window.__jslFeedback = true;
  const F = JSLFeedback;
  let draft, state, identity = '', selected = '', items = [], capture, generation = 0, loading, sending = false, composing = false;
  let saveChain = Promise.resolve(), saveTimer, pointer = { x: 0, y: 0 };
  const host = document.createElement('div');
  host.id = 'jsl-gpt-feedback';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24272c;position:relative;z-index:2147483646}
    *{box-sizing:border-box}button,textarea,select{font:inherit}button{cursor:pointer;border:1px solid #d8dce1;background:white;color:inherit;border-radius:7px;padding:6px 9px}button:hover{background:#f4f5f7}button:disabled{cursor:default;opacity:.5}button:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #dc6227;outline-offset:2px}
    [hidden]{display:none!important}#add{position:fixed;background:#272b31;color:white;border:0;box-shadow:0 2px 12px #0002}
    #panel{position:fixed;right:20px;bottom:22px;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 40px);display:flex;flex-direction:column;background:#fff;border:1px solid #d8dce1;border-radius:14px;box-shadow:0 12px 48px #19202b26;overflow:hidden}
    header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #eceef1}header strong{flex:1;font-size:14px}#close{border:0;font-size:18px;padding:0 6px}
    #body{overflow:auto;overscroll-behavior:contain;padding:12px 14px}#question{color:#606874;font-size:12px;margin-bottom:10px}#quotes{display:grid;gap:8px}
    .quote{border:1px solid #e2e5e9;border-radius:9px;padding:9px}.quote-top{display:flex;justify-content:space-between;align-items:center}.ref{border:0;padding:0;color:#ad4b20;font-weight:600}.remove{border:0;padding:0 4px;color:#747c88}.text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:88px;overflow:auto;margin:5px 0 8px;color:#414751}
    textarea{display:block;width:100%;resize:vertical;min-height:52px;border:1px solid #dce0e5;border-radius:7px;padding:8px;line-height:1.5;color:#24272c;background:white}#message{min-height:84px;margin-top:6px}label{display:block;margin-top:12px;font-weight:600}#empty{color:#737b85;margin:0 0 12px}#targets{width:100%;margin-top:6px;border:1px solid #dce0e5;border-radius:7px;padding:6px;background:white;color:#454c56}
    #status{margin:10px 0 0;color:#9b3e19;white-space:pre-wrap}#reset{font-size:12px;margin-top:8px}footer{padding:10px 14px;border-top:1px solid #eceef1;display:flex;align-items:center;justify-content:space-between;gap:8px}#send{background:#d95c20;color:#fff;border-color:#d95c20;font-weight:600}#hint{color:#737b85;font-size:11px}details{margin-top:10px;color:#737b85;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;background:#f7f8fa;padding:8px;font:inherit}#refresh{border:0;color:#68717e;font-size:12px;padding:4px 0}
    @media(max-width:600px){#panel{right:12px;bottom:12px}}
  </style>
  <button id="add" hidden>GPT에 질문</button>
  <section id="panel" role="dialog" aria-label="현재 문항 GPT 질문" hidden>
    <header><strong>현재 문항에 질문하기</strong><button id="close" aria-label="질문창 닫기">×</button></header>
    <div id="body"><div id="question"></div><p id="empty">답변에서 단어나 문장을 선택하고 ‘인용 추가’를 누르세요.</p><div id="quotes"></div>
      <label for="message">함께 물어볼 내용</label><textarea id="message" maxlength="8000" placeholder="예: 인용 1은 더 구체적으로, 인용 2는 자연스럽게 바꿔줘."></textarea>
      <select id="targets" aria-label="보낼 GPT 대화"></select><button id="refresh">열린 GPT 대화 새로고침</button>
      <p id="status" role="status" hidden></p><button id="reset" hidden>인용을 비우고 현재 원문에서 다시 선택</button>
      <details><summary>전달할 내용 보기</summary><pre id="preview"></pre></details>
    </div><footer><span id="hint">선택 → 인용 추가 · Ctrl+Enter 전송</span><button id="send">GPT로 보내기 ↗</button></footer>
  </section>`;
  (document.body || document.documentElement).appendChild(host);
  const $ = id => root.getElementById(id), panel = $('panel');
  async function call(type, payload = {}) {
    let result;
    try { result = await chrome.runtime.sendMessage({ type: 'feedback:' + type, ...payload }); }
    catch { throw Error('확장 연결이 끊겼습니다. 확장을 다시 로드했다면 자소설과 GPT 페이지도 새로고침해 주세요.'); }
    if (!result?.ok) throw Error(result?.error || '질문 요청을 처리하지 못했습니다.');
    return result;
  }
  function status(text) { $('status').textContent = text || ''; $('status').hidden = !text; }
  function save(value = draft) {
    clearTimeout(saveTimer);
    if (!value) return saveChain;
    const copy = structuredClone(value);
    saveChain = saveChain.catch(() => {}).then(() => call('save', { draft: copy })).catch(e => { if (draft?.question.id === copy.question.id) status(e.message); });
    return saveChain;
  }
  function edited() {
    delete draft.attempt;
    clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 180);
    update();
  }
  function stale() {
    try { F.check(draft, state); return ''; } catch (e) { return e.message; }
  }
  function update() {
    if (!draft) return;
    const reason = stale(), sent = ['sent', 'unknown', 'pending'].includes(draft.attempt?.status);
    $('reset').hidden = !reason || sending;
    $('send').disabled = sending || !!reason || !selected || !draft.quotes.length || sent ||
      ![draft.message, ...draft.quotes.map(q => q.feedback)].some(s => s.trim());
    $('send').textContent = sending ? '전송 확인 중…' : draft.attempt?.status === 'sent' ? '전송 완료' : 'GPT로 보내기 ↗';
    if (reason) status(reason);
    try { $('preview').textContent = F.prompt(draft); } catch { $('preview').textContent = '인용과 질문을 작성하면 전달할 내용이 표시됩니다.'; }
  }
  function renderTargets() {
    $('targets').replaceChildren();
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = items.length ? '보낼 GPT 대화 선택' : 'GPT 대화를 열고 새로고침해 주세요';
    $('targets').appendChild(blank);
    for (const item of items) {
      const option = document.createElement('option'); option.value = item.conversation;
      option.textContent = (item.linked ? '' : '연결하기 · ') + item.title;
      $('targets').appendChild(option);
    }
    $('targets').value = selected;
  }
  function render() {
    if (!draft) return;
    $('question').textContent = draft.question.number + '번 · ' + draft.question.question;
    $('empty').hidden = !!draft.quotes.length;
    $('quotes').replaceChildren();
    for (const quote of draft.quotes) {
      const card = document.createElement('div'); card.className = 'quote'; card.dataset.quoteId = quote.id;
      const top = document.createElement('div'); top.className = 'quote-top';
      const ref = document.createElement('button'); ref.className = 'ref'; ref.textContent = '인용 ' + quote.id;
      ref.title = '공통 질문에 인용 번호 넣기';
      ref.onclick = () => {
        const input = $('message'); input.focus(); input.setRangeText('[인용 ' + quote.id + '] ', input.selectionStart, input.selectionEnd, 'end');
        draft.message = input.value; edited();
      };
      const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '인용 ' + quote.id + ' 삭제');
      remove.onclick = () => { draft.quotes = draft.quotes.filter(q => q.id !== quote.id); edited(); render(); save(); };
      const text = document.createElement('div'); text.className = 'text'; text.textContent = quote.text;
      const note = document.createElement('textarea'); note.maxLength = 4000; note.rows = 2; note.placeholder = '이 부분에 질문하기 (선택)';
      note.setAttribute('aria-label', '인용 ' + quote.id + ' 질문'); note.value = quote.feedback;
      note.oninput = () => { quote.feedback = note.value; edited(); };
      top.append(ref, remove); card.append(top, text, note); $('quotes').appendChild(card);
    }
    $('message').value = draft.message;
    renderTargets();
    status(draft.attempt?.status === 'sent' ? '연결된 GPT 대화에 전송했습니다.' : ['unknown', 'pending'].includes(draft.attempt?.status)
      ? '전송 결과를 GPT에서 확인해 주세요. 같은 요청은 자동으로 다시 보내지 않습니다.' : '');
    update();
  }
  async function sync(fresh) {
    state = fresh;
    let next = '';
    try { const q = F.current(fresh); next = String(fresh.resume.id) + ':' + q.id; } catch { /* 지원서 밖에서는 숨긴다. */ }
    if (next === identity) {
      if (draft && !draft.quotes.length && !draft.attempt && fresh) draft.answer = String(F.current(fresh).answer || '');
      update(); return loading;
    }
    save(); identity = next; const version = ++generation;
    panel.hidden = true; $('add').hidden = true; capture = null; draft = null;
    if (!next) return;
    loading = (async () => {
      await saveChain;
      const result = await call('load');
      if (version !== generation) return;
      draft = result.draft; items = result.items; selected = result.selected; render();
    })().catch(e => { if (version === generation) status(e.message); });
    return loading;
  }
  async function open() {
    await sync(await JSL.getState());
    if (!draft) { JSL.emit('toast', { message: '현재 문항의 질문창을 열지 못했습니다. 지원서와 확장 연결을 확인해 주세요.', kind: 'fail' }); return; }
    panel.hidden = false; render(); $('message').focus();
  }
  function captureSelection(event) {
    if (composing || sending || !draft) return;
    const ta = event.target;
    if (!(ta instanceof HTMLTextAreaElement) || !ta.matches('textarea.answer')) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    if (start === end || !ta.value.slice(start, end).trim()) { $('add').hidden = true; capture = null; return; }
    capture = { identity, start, end, answer: ta.value, ta };
    const rect = ta.getBoundingClientRect();
    const x = event.type === 'mouseup' ? pointer.x : rect.left + Math.min(180, rect.width / 2);
    const y = event.type === 'mouseup' ? pointer.y + 10 : rect.top + 12;
    $('add').textContent = panel.hidden ? 'GPT에 질문' : '인용 추가';
    $('add').style.left = Math.max(8, Math.min(innerWidth - 115, x)) + 'px';
    $('add').style.top = Math.max(8, Math.min(innerHeight - 44, y)) + 'px';
    $('add').hidden = false;
  }
  async function add() {
    const c = capture;
    if (!c || sending) return;
    try {
      const fresh = await JSL.getState();
      if (identity !== c.identity || !c.ta.isConnected || c.ta.value !== c.answer) throw Error('선택한 답변이 변경되었습니다. 다시 선택해 주세요.');
      F.check(draft, fresh);
      if (draft.answer !== c.answer) throw Error('편집 중인 답변을 다시 읽은 뒤 선택해 주세요.');
      const quote = F.add(draft, c.start, c.end);
      state = fresh; panel.hidden = false; $('add').hidden = true; render(); await save();
      root.querySelector('[data-quote-id="' + quote.id + '"] textarea')?.focus();
    } catch (e) { panel.hidden = false; status(e.message); update(); }
  }
  async function send() {
    if (sending || $('send').disabled || composing) return;
    const currentDraft = draft;
    try {
      const fresh = await JSL.getState(); F.check(currentDraft, fresh); F.validate(currentDraft, true);
      if (currentDraft !== draft) return;
      sending = true; currentDraft.attempt = { id: crypto.randomUUID(), status: 'pending' };
      await save(); lockInputs(true); update(); status('GPT 대화로 이동해 전송 결과를 확인하고 있습니다…');
      const result = await call('send', { draft: structuredClone(currentDraft), conversation: selected, attempt: currentDraft.attempt.id });
      currentDraft.attempt.status = result.status;
      currentDraft.attempt.error = result.error;
      if (result.status === 'blocked') delete currentDraft.attempt;
      await save(currentDraft);
      if (draft === currentDraft) status(result.status === 'sent' ? '연결된 GPT 대화에 전송했습니다.' : result.error);
    } catch (e) {
      if (currentDraft.attempt) currentDraft.attempt.status = 'unknown';
      await save(currentDraft);
      if (draft === currentDraft) status(e.message);
    } finally { sending = false; lockInputs(false); update(); }
  }
  function lockInputs(value) { root.querySelectorAll('textarea,select,.remove,.ref,#reset,#refresh').forEach(el => { el.disabled = value; }); }
  $('add').addEventListener('pointerdown', e => e.preventDefault());
  $('add').onclick = add;
  $('close').onclick = () => { panel.hidden = true; save(); };
  $('message').oninput = () => { draft.message = $('message').value; edited(); };
  $('send').onclick = e => { if (e.isTrusted) send(); };
  $('targets').onchange = async () => {
    try {
      selected = (await call('select', { conversation: $('targets').value })).selected;
      const item = items.find(t => t.conversation === selected); if (item) item.linked = true;
      renderTargets(); await save(); status(''); update();
    }
    catch (e) { selected = ''; $('targets').value = ''; status(e.message); update(); }
  };
  $('refresh').onclick = async () => {
    try { const result = await call('targets'); items = result.items; selected = result.selected; renderTargets(); update(); }
    catch (e) { status(e.message); }
  };
  $('reset').onclick = async () => {
    try {
      const fresh = await JSL.getState(), next = F.create(fresh);
      if (next.resumeId !== draft.resumeId || next.question.id !== draft.question.id) return sync(fresh);
      // 개별 질문도 버리지 않고 공통 질문에 옮긴다. 사용자가 새 인용 번호에 맞춰 고친다.
      next.message = [draft.message, ...draft.quotes.filter(q => q.feedback.trim()).map(q => '[이전 선택 ' + q.id + ': ' + q.text + ']\n' + q.feedback)].filter(Boolean).join('\n\n');
      if (next.message.length > 8000) throw Error('남겨둘 질문이 너무 깁니다. 질문을 줄인 뒤 인용을 다시 선택해 주세요.');
      next.nextId = draft.nextId; draft = next; state = fresh; render(); await save();
    } catch (e) { status(e.message); }
  };
  root.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault();
    if (e.key === 'Escape' && !e.isComposing) { panel.hidden = true; save(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing && e.isTrusted) { e.preventDefault(); send(); }
  });
  root.addEventListener('keyup', e => e.stopPropagation());
  ['keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy'].forEach(type => root.addEventListener(type, e => e.stopPropagation()));
  document.addEventListener('compositionstart', () => { composing = true; $('add').hidden = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; }, true);
  document.addEventListener('mouseup', e => { pointer = { x: e.clientX, y: e.clientY }; captureSelection(e); });
  document.addEventListener('select', captureSelection, true);
  document.addEventListener('keyup', captureSelection, true);
  document.addEventListener('scroll', () => { $('add').hidden = true; }, true);
  document.addEventListener('pointerdown', e => {
    if (e.target !== host && !e.target.matches?.('textarea.answer')) { capture = null; $('add').hidden = true; }
  }, true);
  document.addEventListener('input', e => {
    if (!e.target.matches?.('textarea.answer')) return;
    capture = null; $('add').hidden = true;
    if (draft && !draft.quotes.length && !draft.attempt) draft.answer = e.target.value;
    if (draft) { state = state && { ...state, qnas: state.qnas.map(q => String(q.id) === draft.question.id ? { ...q, answer: e.target.value } : q) }; update(); }
  }, true);
  JSL.onState(sync);
  sync(null);
  JSL.getState().then(sync);
  let lastPath = location.pathname, lastEditor = document.querySelector('textarea.answer');
  setInterval(() => {
    const editor = document.querySelector('textarea.answer');
    if (location.pathname !== lastPath || editor !== lastEditor) {
      lastPath = location.pathname; lastEditor = editor; capture = null; $('add').hidden = true;
      if (!/^\/resume\/\d+\/?$/.test(lastPath) || !editor) sync(null);
      else JSL.getState().then(sync);
    }
  }, 400);
  let tries = 0;
  const uiTimer = setInterval(() => {
    if (JSL.ui?.addAction) { clearInterval(uiTimer); JSL.ui.addAction('GPT 질문', open); }
    else if (++tries > 50) clearInterval(uiTimer);
  }, 100);
});
