// 현재 답변에서 고칠 곳을 모아 연결된 웹 GPT에 보내고, 돌아온 수정안을 인용 단위로 받거나 뺀다.
// 화면은 대시보드 본문을 잠시 빌린다(JSL.ui.openView). 답변 쓰기는 사용자가 받기를 누른 인용만 setAnswer로 한다.
JSL.register('gpt-feedback', function () {
  'use strict';
  if (window.__jslFeedback) return;
  window.__jslFeedback = true;
  const F = JSLFeedback, VIEW = 'gpt-feedback';
  const marks = () => window.JSLFeedbackMarks || { set() {}, clear() {} };
  let state = null, identity = '', draft = null, attempt = null, items = [], selected = '', generation = 0;
  let sending = false, working = false, picking = false, notice = null, capture = null, suppressed = '', composing = false;
  let saveChain = Promise.resolve(), saveTimer, pointer = { x: 0, y: 0 }, actionBtn = null, announced = '', openWhenLoaded = '';
  // 보이는 답변란을 쓴다. 숨겨진 복제본이 있어도 사용자가 보는 칸과 비교한다.
  const editor = () => (() => { const all = [...document.querySelectorAll('textarea.answer')]; return all.find(t => t.getClientRects().length) || all[0] || null; })();
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ── 버블 ──
  const bubbleHost = document.createElement('div');
  bubbleHost.id = 'jsl-gpt-feedback';
  const bubbleRoot = bubbleHost.attachShadow({ mode: 'open' });
  bubbleRoot.innerHTML = `<style>
    :host{all:initial;position:relative;z-index:2147483646}
    .bubble{position:fixed;display:flex;background:#fff;border:1px solid #f0e2d5;border-radius:10px;overflow:hidden;
      box-shadow:0 6px 18px rgba(30,20,10,.16);font:600 12.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif}
    .bubble[hidden]{display:none}
    button{border:0;border-left:1px solid #f2e7db;background:#fff;color:#8a6a4d;font:inherit;padding:8px 11px;cursor:pointer;white-space:nowrap}
    button:first-child{border-left:0}
    button:hover{background:#ff6a00;color:#fff}
    button:focus-visible{outline:none;box-shadow:inset 0 0 0 2px #e05e00}
  </style><div class="bubble" role="toolbar" aria-label="GPT에 물어볼 곳 담기" hidden>
    <button data-kind="context">빠진 맥락</button><button data-kind="tone">AI 티</button><button data-kind="ask">질문</button></div>`;
  (document.body || document.documentElement).appendChild(bubbleHost);
  const bubble = bubbleRoot.querySelector('.bubble');
  const hideBubble = () => { bubble.hidden = true; capture = null; };

  // ── 대시보드 화면 ──
  const view = document.createElement('div');
  view.className = 'gq';
  view.dataset.jslIsolate = 'true';
  const actions = document.createElement('div');
  actions.className = 'gq-actions';
  actions.dataset.jslIsolate = 'true';
  const CSS = `
    .gq{padding:2px 0 6px}
    .gq-empty{padding:18px 18px 16px;text-align:center;color:#a89a8b;font-size:12px;line-height:1.6;word-break:keep-all}
    .gq .card{margin:5px 10px}.gq .card-body{cursor:default;padding:10px 12px}.gq .card-body:hover{background:transparent}
    .gq .line{gap:8px}.gq .line.top{align-items:flex-start}.gq .q{font-size:12.5px}
    .gq .st{margin-top:1px}
    .gq-kind{flex:none;border:1px solid #f6d9b6;background:#fff0df;color:#a86a2f;font-size:9.5px;font-weight:700;font-family:inherit;
      padding:2px 7px;border-radius:6px;cursor:pointer;white-space:nowrap}
    .gq-kind:hover{border-color:#ffb377;color:#e05e00}.gq-kind.static{cursor:default}.gq-kind.static:hover{border-color:#f6d9b6;color:#a86a2f}
    .gq-x{flex:none;border:0;background:transparent;color:#c9bdb2;font-size:15px;line-height:1;cursor:pointer;padding:0 2px;font-family:inherit}
    .gq-x:hover{color:#ff6a00}
    .gq-memo{display:block;width:calc(100% - 27px);margin:7px 0 0 27px;border:1px solid #f0e1d3;border-radius:8px;padding:6px 9px;
      font-size:12px;line-height:1.4;font-family:inherit;color:#332b24;background:#fff;outline:none}
    .gq-memo:focus{border-color:#ffb377;box-shadow:0 0 0 2px #fff1e8}.gq-memo::placeholder{color:#c3b5a8}.gq-memo.need{border-color:#ffb377}
    .gq-note{margin:6px 0 0 27px;font-size:12px;color:#5f5347;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere}
    .gq-note.warn{color:#c24d00}.gq-note.ask{color:#332b24}
    .gq-row{display:flex;align-items:center;gap:12px;margin:7px 0 0 27px}.gq-row .end{margin-left:auto}
    .gq-link{border:0;background:transparent;font-size:11.5px;font-weight:700;font-family:inherit;color:#e05e00;cursor:pointer;padding:0;white-space:nowrap}
    .gq-link:hover{text-decoration:underline}.gq-link.dim{color:#a89a8b}.gq-link[disabled]{opacity:.5;cursor:default;text-decoration:none}
    .gq-flow{flex:1;min-width:0;font-size:12.5px;line-height:1.65;color:#332b24;word-break:keep-all;overflow-wrap:anywhere}
    .gq-flow s{color:#b7a793}.gq-arrow{color:#b8a794;margin:0 3px}
    .gq-ins{background:#fff1e8;border-radius:4px;padding:1px 3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
    .gq .copy-btn{flex:none;margin-top:1px}.gq .copy-btn[disabled]{background:#f5ede4;color:#b8a794;cursor:default}
    .gq-done .q{color:#8a6a4d}.gq-done .q b{color:#5f5347;font-weight:600}
    .gq-status{display:flex;align-items:center;gap:10px;margin:5px 10px;padding:10px 12px;border-radius:12px;background:#fff8f1;
      border:1.5px solid #ffb377;font-size:12.5px;color:#332b24;line-height:1.45}
    .gq-status.plain{background:#fdf8f3;border:1px solid #f0e1d3}
    .gq-status .txt{flex:1;min-width:0;word-break:keep-all}.gq-status b{display:block;font-size:12.5px}
    .gq-status .sub{display:block;font-size:11px;color:#8a6a4d;margin-top:1px}
    .gq-status .btns{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
    .gq-spin{flex:none;width:16px;height:16px;border-radius:50%;border:2.5px solid #ffd9bd;border-top-color:#ff6a00;animation:gq-spin .8s linear infinite}
    @keyframes gq-spin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){.gq-spin{animation:none}}
    .gq-bang{flex:none;display:grid;place-items:center;width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 1.5px #ff6a00;
      color:#e05e00;font-size:11px;font-weight:800}
    .gq-sum{margin:4px 16px 2px;font-size:11.5px;color:#8a6a4d}.gq-sum b{color:#332b24}
    .gq-target{display:flex;align-items:center;gap:6px;margin:8px 16px 2px;font-size:11.5px;color:#8a6a4d}
    .gq-target b{min-width:0;color:#332b24;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gq-target .gq-link{margin-left:auto}
    .gq-pick{margin:5px 10px 2px;border:1px solid #f0e1d3;border-radius:10px;overflow:hidden;background:#fff}
    .gq-opt{display:flex;width:100%;gap:8px;align-items:center;border:0;border-top:1px solid #f8f1ea;background:#fff;padding:8px 10px;
      font-size:12px;font-family:inherit;color:#332b24;cursor:pointer;text-align:left}
    .gq-opt:first-child{border-top:0}.gq-opt:hover{background:#fff8f1}.gq-opt.on{background:#fff1e8;font-weight:700}
    .gq-opt span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gq-opt i{margin-left:auto;font-style:normal;font-size:10.5px;color:#a89a8b;flex:none}
    .gq-pick-foot{display:flex;gap:10px;align-items:center;padding:7px 10px;border-top:1px solid #f8f1ea;font-size:11px;color:#a89a8b;line-height:1.5}
    .gq-pick-foot .gq-link{margin-left:auto}
    .gq-locked{opacity:.55}
    .gq-actions{display:flex;gap:8px;align-items:center}
    .gq-actions .jsl-action-btn{order:0}
    .gq-actions .jsl-action-btn[disabled]{background:#f5ede4;border-color:#f0e1d3;color:#b8a794;box-shadow:none;cursor:default}
    .gq button:focus-visible,.gq-actions button:focus-visible{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px #e05e00}`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function btn(className, text, onClick, label) {
    const node = el('button', className, text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', e => { e.stopPropagation(); if (!node.disabled) onClick(e); });
    return node;
  }
  function toast(message, kind = 'info', extra = {}) { JSL.emit('toast', { message, kind, ...extra }); }
  async function call(type, payload = {}) {
    let result;
    try { result = await chrome.runtime.sendMessage({ type: 'feedback:' + type, ...payload }); }
    catch { throw Error('확장 연결이 끊겼습니다. 확장을 다시 로드했다면 자소설과 GPT 페이지도 새로고침해 주세요.'); }
    if (!result?.ok) throw Error(result?.error || '질문 요청을 처리하지 못했습니다.');
    return result;
  }
  function save(value = draft) {
    clearTimeout(saveTimer);
    if (!value) return saveChain;
    const copy = structuredClone(value);
    saveChain = saveChain.catch(() => {}).then(() => call('save', { draft: copy })).catch(e => { notice = { tone: 'attn', text: e.message }; render(); });
    return saveChain;
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 250); };

  // ── 상태 ──
  function phase() {
    if (sending) return 'sending';
    if (!attempt) return 'collect';
    if (attempt.status === 'sent') return attempt.reply ? 'review' : 'waiting';
    return 'unknown';
  }
  const reviewOf = id => (draft?.review || {})[id];
  function counts() {
    const out = { ready: 0, ask: 0, done: 0, pending: 0, stale: 0, invalid: 0, other: 0 };
    if (!attempt?.reply) return out;
    for (const q of draft.quotes) {
      const item = attempt.reply.items[q.id], r = reviewOf(q.id);
      if (!item || r?.state === 'dismissed') continue;
      if (r?.state === 'applied') out.done++;
      else if (r?.state === 'stale') out.stale++;
      else if (item.status === 'ready') { out.ready++; out.pending++; }
      else if (item.status === 'ask') out.ask++;
      else if (item.status === 'invalid') out.invalid++;
      else out.other++;
    }
    return out;
  }
  function activeQuestion(fresh = state) {
    try {
      const q = F.current(fresh);
      return draft && String(fresh.resume.id) === draft.resumeId && String(q.id) === draft.question.id ? q : null;
    } catch { return null; }
  }
  function rebase() {
    const ta = editor();
    if (!draft || phase() !== 'collect' || !ta || !activeQuestion()) return false;
    const next = F.rebase(draft, ta.value);
    if (next.answer === draft.answer && JSON.stringify(next.quotes) === JSON.stringify(draft.quotes)) return false;
    draft = next; saveSoon();
    return true;
  }
  function updateMarks() {
    const ta = editor();
    if (!draft || !ta || !activeQuestion() || !draft.quotes.length) { marks().clear(); return; }
    const text = ta.value, ranges = [], p = phase();
    for (const q of draft.quotes) {
      const r = reviewOf(q.id);
      if (r?.state === 'applied') {
        const at = F.locate(text, r.replacement, r.at);
        if (at >= 0) ranges.push({ start: at, end: at + r.replacement.length, kind: 'applied' });
        continue;
      }
      if (r?.state === 'dismissed' || q.lost) continue;
      const at = F.locate(text, q.text, p === 'review' ? F.hint(draft, q) : q.start);
      if (at >= 0) ranges.push({ start: at, end: at + q.text.length, kind: 'quote', label: q.id });
    }
    marks().set(ranges);
  }
  function updateActionLabel() {
    if (!actionBtn) return;
    const p = draft ? phase() : 'collect', c = counts();
    const suffix = p === 'waiting' || p === 'sending' ? ' · 답 기다리는 중' : p === 'review' && c.pending ? ' · 제안 ' + c.pending
      : p === 'collect' && draft?.quotes.length ? ' · ' + draft.quotes.length : '';
    actionBtn.textContent = 'GPT 질문' + suffix;
  }

  // ── 그리기 ──
  function statusBox({ tone = 'attn', spin = false, title, sub, buttons = [] }) {
    const box = el('div', 'gq-status' + (tone === 'plain' ? ' plain' : ''));
    box.setAttribute('role', 'status');
    box.append(spin ? el('span', 'gq-spin') : el('span', 'gq-bang', '!'));
    const txt = el('span', 'txt');
    txt.append(el('b', null, title));
    if (sub) { const s = el('span', 'sub', sub); if (spin) s.dataset.elapsed = 'true'; txt.append(s); }
    box.append(txt);
    if (buttons.length) { const b = el('span', 'btns'); b.append(...buttons); box.append(b); }
    return box;
  }
  function elapsed() {
    if (!attempt?.sentAt) return '';
    const s = Math.max(0, Math.round((Date.now() - attempt.sentAt) / 1000));
    return s < 60 ? s + '초' : Math.floor(s / 60) + '분 ' + (s % 60) + '초';
  }
  function waitingSub() {
    const seen = attempt?.seen?.length || 0, total = draft?.quotes.length || 0;
    return '인용 ' + total + '개' + (seen ? ' · ' + seen + '개 답 받는 중' : '') + ' · ' + elapsed();
  }
  const kindLabel = kind => F.KINDS[kind]?.label || kind;
  function quoteCard(q, { locked = false } = {}) {
    const card = el('div', 'card active gq-card' + (locked ? ' gq-locked' : ''));
    card.dataset.quoteId = q.id;
    const body = el('div', 'card-body'), line = el('div', 'line');
    line.append(el('span', 'st active', String(q.id)), el('span', 'q', q.text.replace(/\s+/g, ' ')));
    if (locked) line.append(el('span', 'gq-kind static', kindLabel(q.kind)));
    else {
      line.append(btn('gq-kind', kindLabel(q.kind), () => {
        const order = ['context', 'tone', 'ask'];
        q.kind = order[(order.indexOf(q.kind) + 1) % order.length];
        saveSoon(); render(); focusMemo(q.id, q.kind === 'ask');
      }, '인용 ' + q.id + ' 종류 바꾸기'));
      line.append(btn('gq-x', '×', () => {
        draft.quotes = draft.quotes.filter(x => x.id !== q.id);
        save(); render();
      }, '인용 ' + q.id + ' 빼기'));
    }
    body.append(line);
    if (q.lost) body.append(el('div', 'gq-note warn', '원문이 바뀌었어요 · 빼고 다시 담아 주세요'));
    else if (locked) { if (q.feedback.trim()) body.append(el('div', 'gq-note', q.feedback.trim())); }
    else {
      const memo = el('input', 'gq-memo' + (q.kind === 'ask' && !q.feedback.trim() ? ' need' : ''));
      memo.type = 'text'; memo.maxLength = 4000; memo.value = q.feedback;
      memo.placeholder = q.kind === 'ask' ? '무엇을 물어볼까요?' : '덧붙일 말 (선택)';
      memo.setAttribute('aria-label', '인용 ' + q.id + (q.kind === 'ask' ? ' 질문' : ' 덧붙일 말'));
      memo.addEventListener('input', () => {
        q.feedback = memo.value;
        memo.classList.toggle('need', q.kind === 'ask' && !memo.value.trim());
        saveSoon(); renderActions(); updateActionLabel();
      });
      body.append(memo);
    }
    card.append(body);
    return card;
  }
  function suggestionCard(q) {
    const item = attempt.reply.items[q.id] || { status: 'invalid', reason: 'GPT 답에서 이 인용을 찾지 못했습니다.' };
    const r = reviewOf(q.id), card = el('div', 'card gq-card'), body = el('div', 'card-body');
    card.dataset.quoteId = q.id;
    card.append(body);
    const focusGpt = label => btn('gq-link', label, () => focusGpt());
    if (r?.state === 'applied') {
      card.classList.add('done', 'gq-done');
      const line = el('div', 'line'), text = el('span', 'q');
      text.append(el('b', null, '받음 '), document.createTextNode(r.replacement.replace(/\s+/g, ' ')));
      line.append(el('span', 'st done', '✓'), text, btn('gq-link', '되돌리기', () => undo(q.id), '인용 ' + q.id + ' 되돌리기'));
      body.append(line); return card;
    }
    if (r?.state === 'dismissed') {
      card.classList.add('empty', 'gq-done');
      const line = el('div', 'line');
      line.append(el('span', 'st empty', '–'), el('span', 'q', '뺌 · ' + q.text.replace(/\s+/g, ' ')),
        btn('gq-link dim', '다시 보기', () => { delete draft.review[q.id]; save(); render(); }, '인용 ' + q.id + ' 다시 보기'));
      body.append(line); return card;
    }
    if (r?.state === 'stale') {
      card.classList.add('empty');
      const line = el('div', 'line');
      line.append(el('span', 'st empty', '!'), el('span', 'q', q.text.replace(/\s+/g, ' ')), el('span', 'gq-kind static', '원문 바뀜'));
      const row = el('div', 'gq-row');
      row.append(btn('gq-link', '수정안 복사', () => copy(item.replacement)), btn('gq-link dim', '다시 시도', () => { delete draft.review[q.id]; apply(q.id); }),
        btn('gq-link dim end', '빼기', () => dismiss(q.id)));
      body.append(line, el('div', 'gq-note warn', '답을 기다리는 사이 원문이 바뀌어 넣지 않았어요.'), row);
      return card;
    }
    if (item.status === 'ready') {
      card.classList.add('active');
      const line = el('div', 'line top'), flow = el('div', 'gq-flow');
      flow.append(el('s', null, q.text), el('span', 'gq-arrow', '→'), el('span', 'gq-ins', item.replacement));
      line.append(el('span', 'st active', String(q.id)), flow, btn('copy-btn', '받기', () => apply(q.id), '인용 ' + q.id + ' 받기'));
      body.append(line);
      if (item.ask) body.append(el('div', 'gq-note ask', '확인 필요 · ' + item.ask));
      const row = el('div', 'gq-row');
      row.append(el('span', 'gq-note', item.diagnosis || kindLabel(q.kind)));
      row.firstChild.style.margin = '0';
      row.append(btn('gq-link dim end', '빼기', () => dismiss(q.id), '인용 ' + q.id + ' 빼기'));
      body.append(row);
      return card;
    }
    const line = el('div', 'line');
    if (item.status === 'ask') {
      card.classList.add('empty');
      line.append(el('span', 'st empty', '?'), el('span', 'q', q.text.replace(/\s+/g, ' ')), el('span', 'gq-kind static', '확인 필요'));
      const row = el('div', 'gq-row');
      row.append(focusGpt('GPT에서 답하기 ↗'), btn('gq-link dim end', '닫기', () => dismiss(q.id)));
      body.append(line, el('div', 'gq-note ask', item.ask), row);
      return card;
    }
    if (item.status === 'same') {
      card.classList.add('empty');
      line.append(el('span', 'st done', '✓'), el('span', 'q', q.text.replace(/\s+/g, ' ')), el('span', 'gq-kind static', '그대로'));
      const row = el('div', 'gq-row');
      row.append(btn('gq-link dim end', '확인', () => dismiss(q.id)));
      body.append(line, el('div', 'gq-note', '바꿀 곳이 없대요' + (item.diagnosis ? ' · ' + item.diagnosis : '')), row);
      return card;
    }
    card.classList.add('empty');
    line.append(el('span', 'st empty', '!'), el('span', 'q', q.text.replace(/\s+/g, ' ')), el('span', 'gq-kind static', '읽지 못함'));
    const row = el('div', 'gq-row');
    row.append(focusGpt('GPT에서 보기 ↗'), btn('gq-link dim end', '닫기', () => dismiss(q.id)));
    body.append(line, el('div', 'gq-note warn', item.reason || '이 인용의 수정안을 찾지 못했어요.'), row);
    return card;
  }
  function targetRow() {
    const wrap = el('div');
    const chosen = items.find(t => t.conversation === selected);
    const row = el('div', 'gq-target');
    row.append(document.createTextNode('보낼 GPT 대화'));
    row.append(el('b', null, chosen ? chosen.title : '고르지 않음'));
    row.append(btn('gq-link', picking ? '닫기' : chosen ? '변경' : '고르기', async () => {
      picking = !picking;
      if (picking) await refreshTargets();
      render();
    }, '보낼 GPT 대화 ' + (picking ? '목록 닫기' : '고르기')));
    wrap.append(row);
    if (picking) {
      const pick = el('div', 'gq-pick');
      for (const item of items) {
        const opt = btn('gq-opt' + (item.conversation === selected ? ' on' : ''), null, () => choose(item.conversation));
        opt.append(el('span', null, item.title), el('i', null, item.linked ? '연결됨' : '연결하기'));
        pick.append(opt);
      }
      const foot = el('div', 'gq-pick-foot', items.length ? '이 지원서를 쓰던 대화를 고르세요.' : '열린 GPT 대화가 없어요. 이 지원서를 쓰던 대화를 연 뒤 다시 찾아 주세요.');
      foot.append(btn('gq-link', '다시 찾기', async () => { await refreshTargets(); render(); }));
      pick.append(foot);
      wrap.append(pick);
    }
    return wrap;
  }
  function sendBlocker() {
    if (!draft?.quotes.length) return '고칠 곳을 담아 주세요';
    if (draft.quotes.some(q => q.kind === 'ask' && !q.feedback.trim())) return '질문 내용을 적어 주세요';
    if (draft.quotes.some(q => q.lost)) return '원문이 바뀐 인용을 빼 주세요';
    if (!selected) return '보낼 GPT 대화를 골라 주세요';
    return '';
  }
  function action(text, onClick, { primary = false, disabled = false } = {}) {
    const node = btn('jsl-action-btn' + (primary ? ' primary' : ''), text, onClick);
    node.disabled = disabled || working;
    return node;
  }
  function renderActions() {
    const p = phase(), list = [];
    if (!draft) list.push(action('문항을 여는 중', () => {}, { primary: true, disabled: true }));
    else if (p === 'collect') {
      const blocker = sendBlocker();
      list.push(action(blocker || 'GPT로 보내기 · ' + draft.quotes.length, () => send(), { primary: true, disabled: !!blocker }));
    } else if (p === 'sending') list.push(action('보내는 중', () => {}, { primary: true, disabled: true }));
    else if (p === 'waiting') list.push(action('답을 기다리는 중', () => {}, { primary: true, disabled: true }));
    else if (p === 'unknown') list.push(action('보냈는지 확인이 필요해요', () => {}, { primary: true, disabled: true }));
    else {
      const c = counts();
      if (c.pending) {
        list.push(action('모두 빼기', () => dismissAll()));
        list.push(action('남은 ' + c.pending + '개 모두 받기', () => applyAll(), { primary: true }));
      } else list.push(action('새 질문', () => reset(), { primary: true }));
    }
    actions.replaceChildren(...list);
  }
  function render() {
    updateActionLabel();
    updateMarks();
    if (!JSL.ui?.isViewOpen?.(VIEW)) return;
    const root = view.getRootNode(), focused = root.activeElement || document.activeElement;
    const memoFocus = focused && view.contains(focused) && focused.classList.contains('gq-memo') ? { id: focused.closest('[data-quote-id]')?.dataset.quoteId,
      start: focused.selectionStart, end: focused.selectionEnd } : null;
    const nodes = [], p = phase();
    JSL.ui.updateView(VIEW, { meta: draft ? draft.question.number + '번 문항' : '' });
    if (!draft) nodes.push(el('div', 'gq-empty', '문항을 연 뒤 답변에서 고칠 곳을 드래그해 주세요.'));
    else {
      if (notice) nodes.push(statusBox({ tone: notice.tone, title: notice.text, sub: notice.sub,
        buttons: [btn('gq-link dim', '닫기', () => { notice = null; render(); })] }));
      if (p === 'collect') {
        if (!draft.quotes.length) nodes.push(el('div', 'gq-empty', '답변에서 고칠 곳을 드래그하고\n빠진 맥락 · AI 티 · 질문 중 하나를 눌러 담아 주세요.'));
        nodes.push(...draft.quotes.map(q => quoteCard(q)));
        if (draft.quotes.length) nodes.push(targetRow());
      } else if (p === 'sending') {
        nodes.push(statusBox({ spin: true, title: 'GPT 탭에서 보내는 중…', sub: '입력과 전송을 확인하고 자소설로 돌아와요' }));
        nodes.push(...draft.quotes.map(q => quoteCard(q, { locked: true })));
      } else if (p === 'waiting') {
        if (attempt.lost) nodes.push(statusBox({ title: '보낸 GPT 탭을 찾을 수 없어요', sub: '탭이 닫혔어요. 다시 열면 이어서 답을 기다려요.',
          buttons: [btn('gq-link', '다시 열기', () => focusGpt())] }));
        else nodes.push(statusBox({ spin: true, title: 'GPT가 답하는 중', sub: waitingSub(), buttons: [btn('gq-link', 'GPT에서 보기 ↗', () => focusGpt())] }));
        nodes.push(...draft.quotes.map(q => quoteCard(q, { locked: true })));
      } else if (p === 'unknown') {
        nodes.push(statusBox({ title: '보냈는지 확인하지 못했어요', sub: attempt.error || 'GPT 대화에서 확인해 주세요. 자동으로 다시 보내지 않아요.',
          buttons: [btn('gq-link', 'GPT에서 확인 ↗', () => focusGpt()), btn('gq-link dim', '보내지 않았다면 다시 보내기', () => resend())] }));
        nodes.push(...draft.quotes.map(q => quoteCard(q, { locked: true })));
      } else {
        const c = counts(), sum = el('div', 'gq-sum');
        const parts = [['수정안', c.ready], ['확인 필요', c.ask], ['받음', c.done], ['원문 바뀜', c.stale], ['읽지 못함', c.invalid]].filter(([, n]) => n);
        parts.forEach(([label, n], i) => { if (i) sum.append(' · '); sum.append(label + ' ', el('b', null, String(n))); });
        if (!parts.length) sum.textContent = '모두 처리했어요';
        nodes.push(sum, ...draft.quotes.map(q => suggestionCard(q)));
      }
    }
    view.replaceChildren(...nodes);
    renderActions();
    if (memoFocus?.id) {
      const memo = view.querySelector('[data-quote-id="' + memoFocus.id + '"] .gq-memo');
      if (memo) { memo.focus(); try { memo.setSelectionRange(memoFocus.start, memoFocus.end); } catch { /* 무시 */ } }
    }
  }
  function focusMemo(id, force) {
    if (!force) return;
    requestAnimationFrame(() => view.querySelector('[data-quote-id="' + id + '"] .gq-memo')?.focus());
  }
  function openView(expand = true) {
    if (!JSL.ui?.openView) return false;
    JSL.ui.openView({ id: VIEW, title: 'GPT 질문', meta: draft ? draft.question.number + '번 문항' : '', el: view, actions, css: CSS,
      onBack: () => { picking = false; } }, { expand });
    render();
    return true;
  }

  // ── 불러오기·동기화 ──
  async function load(version) {
    const result = await call('load');
    if (version !== generation) return;
    draft = result.draft; attempt = result.attempt; items = result.items; selected = result.selected;
    if (attempt && attempt.status === 'blocked') {
      notice = { tone: 'attn', text: '보내지 못했어요', sub: attempt.error };
      await call('dismiss', { attempt: attempt.id }).catch(() => {});
      delete draft.attempt; attempt = null; save();
    }
    if (draft.attempt && !attempt) { delete draft.attempt; save(); } // 워커가 기록을 잃었으면 다시 담을 수 있게 한다.
    if (!attempt && draft.review && Object.keys(draft.review).length) { draft.review = {}; save(); }
    rebase();
    if (openWhenLoaded && openWhenLoaded === draft.question.id) { openWhenLoaded = ''; openView(true); }
    announce();
    render();
  }
  async function sync(fresh) {
    state = fresh;
    let next = '';
    try { const q = F.current(fresh); next = String(fresh.resume.id) + ':' + q.id; } catch { /* 지원서 밖에서는 숨긴다. */ }
    if (next === identity) {
      if (draft && rebase()) render(); else updateMarks();
      return;
    }
    save(); identity = next; const version = ++generation;
    draft = null; attempt = null; notice = null; picking = false; hideBubble();
    render();
    if (!next) { marks().clear(); return; }
    try { await load(version); }
    catch (e) { if (version === generation) { notice = { tone: 'attn', text: e.message }; render(); } }
  }
  async function reloadAttempt() {
    const version = generation;
    try { await load(version); } catch (e) { if (version === generation) { notice = { tone: 'attn', text: e.message }; render(); } }
  }
  function announce() {
    if (!attempt?.reply || announced === attempt.id) return;
    announced = attempt.id;
    const c = counts();
    if (!c.pending && !c.ask && !c.invalid && !c.other) return;
    const visible = JSL.ui?.isViewOpen?.(VIEW);
    if (!visible) toast('GPT 답 도착 · ' + draft.question.number + '번 문항', 'info', { sub: '수정안을 확인하고 받거나 빼 주세요.', id: 'gpt-feedback-arrived',
      actions: [{ label: '제안 보기', primary: true, onClick: () => openView(true) }] });
  }

  // ── 담기 ──
  function captureSelection(event) {
    if (composing || !draft) return;
    const ta = event.target;
    if (!(ta instanceof HTMLTextAreaElement) || !ta.matches('textarea.answer')) return;
    const start = ta.selectionStart, end = ta.selectionEnd, key = start + ':' + end + ':' + ta.value.length;
    if (start === end || !ta.value.slice(start, end).trim()) { hideBubble(); suppressed = ''; return; }
    if (key === suppressed) return;
    capture = { identity, start, end, answer: ta.value, ta, key };
    const rect = ta.getBoundingClientRect();
    const x = event.type === 'mouseup' ? pointer.x : rect.left + Math.min(180, rect.width / 2);
    const y = event.type === 'mouseup' ? pointer.y + 12 : rect.top + 12;
    bubble.hidden = false;
    const w = bubble.offsetWidth || 220;
    bubble.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
    bubble.style.top = Math.max(8, Math.min(innerHeight - 44, y)) + 'px';
  }
  async function addQuote(kind) {
    const c = capture;
    hideBubble();
    if (!c) return;
    suppressed = c.key;
    try {
      if (identity !== c.identity || !c.ta.isConnected || c.ta.value !== c.answer || !draft) throw Error('선택한 답변이 바뀌었어요. 다시 드래그해 주세요.');
      if (phase() !== 'collect') {
        openView(true);
        toast('보낸 질문을 처리한 뒤 새로 담을 수 있어요', 'info');
        return;
      }
      if (draft.answer !== c.answer) draft = F.rebase(draft, c.answer);
      const quote = F.add(draft, c.start, c.end, kind);
      notice = null;
      openView(true);
      await save();
      focusMemo(quote.id, kind === 'ask');
    } catch (e) { toast(e.message, 'fail'); }
  }

  // ── 보내기 ──
  async function refreshTargets() {
    try { const result = await call('targets'); items = result.items; selected = result.selected; }
    catch (e) { notice = { tone: 'attn', text: e.message }; }
  }
  async function choose(conversation) {
    try {
      selected = (await call('select', { conversation })).selected;
      const item = items.find(t => t.conversation === selected); if (item) item.linked = true;
      picking = false; notice = null;
    } catch (e) { notice = { tone: 'attn', text: e.message }; }
    render();
  }
  async function send() {
    if (sending || working || !draft || phase() !== 'collect') return;
    const version = generation;
    try {
      const fresh = await JSL.getState();
      if (version !== generation) return;
      const q = activeQuestion(fresh), ta = editor();
      if (!q) throw Error('현재 문항이 바뀌었어요. 문항을 다시 열어 주세요.');
      if (!ta || !F.sameAnswer(q.answer, ta.value)) throw Error('답변을 반영하는 중이에요. 잠시 뒤 다시 눌러 주세요.');
      draft = F.rebase(draft, ta.value);
      F.validate(draft, true);
      if (!selected) throw Error('보낼 GPT 대화를 골라 주세요.');
    } catch (e) { notice = { tone: 'attn', text: e.message }; render(); return; }
    const id = crypto.randomUUID(), sentDraft = draft;
    sending = true; notice = null; picking = false;
    sentDraft.attempt = { id };
    await save(sentDraft); render();
    let result;
    try { result = await call('send', { draft: structuredClone(sentDraft), conversation: selected, attempt: id }); }
    catch (e) { result = { status: 'unknown', error: e.message }; }
    sending = false;
    if (draft !== sentDraft) return; // 보내는 사이 문항을 옮겼다. 그 문항의 화면은 다시 불러올 때 반영된다.
    if (result.status === 'blocked') {
      delete sentDraft.attempt;
      notice = { tone: 'attn', text: '보내지 못했어요', sub: result.error };
      await call('dismiss', { attempt: id }).catch(() => {});
      await save(sentDraft); render();
      return;
    }
    await reloadAttempt();
  }
  async function resend() {
    if (!attempt || phase() !== 'unknown') return;
    await call('dismiss', { attempt: attempt.id }).catch(() => {});
    delete draft.attempt; attempt = null;
    await save(); render();
    send();
  }
  async function focusGpt() {
    try { await call('focus', attempt ? { attempt: attempt.id } : { conversation: selected }); }
    catch (e) { notice = { tone: 'attn', text: e.message }; render(); }
  }

  // ── 받기·빼기·되돌리기 ──
  async function writeAnswer(number, text) {
    const result = await JSL.action('setAnswer', { number, text });
    await wait(120);
    const fresh = await JSL.getState(), q = activeQuestion(fresh);
    return !!(result?.ok && q && F.sameAnswer(q.answer, text) && editor()?.value === text);
  }
  async function readCurrent() {
    const fresh = await JSL.getState(), q = activeQuestion(fresh), ta = editor();
    if (!q) throw Error('이 질문의 문항을 연 뒤 받아 주세요.');
    if (!ta || !F.sameAnswer(q.answer, ta.value)) throw Error('답변을 반영하는 중이에요. 잠시 뒤 다시 눌러 주세요.');
    return { q, text: ta.value };
  }
  async function applyOne(id) {
    const quote = draft.quotes.find(q => q.id === id), item = attempt?.reply?.items[id];
    if (!quote || item?.status !== 'ready' || reviewOf(id)) return 'skip';
    const { q, text: answer } = await readCurrent();
    const at = F.locate(answer, quote.text, F.hint(draft, quote));
    if (at < 0) { draft.review[id] = { state: 'stale' }; return 'stale'; }
    const next = F.replaceAt(answer, at, quote.text, item.replacement);
    if (!(await writeAnswer(q.number, next))) throw Error('반영을 확인하지 못했어요. 답변란을 직접 확인해 주세요.');
    draft.review[id] = { state: 'applied', at, replacement: item.replacement, original: quote.text };
    return 'applied';
  }
  async function task(fn) {
    if (working) return;
    working = true; renderActions();
    try { await fn(); }
    catch (e) { notice = { tone: 'attn', text: e.message }; }
    finally { working = false; await save(); render(); }
  }
  const apply = id => task(async () => {
    draft.review = draft.review || {};
    const outcome = await applyOne(id);
    if (outcome === 'applied') toast('인용 ' + id + '을 바꿨어요', 'ok', { sub: '저장은 직접 눌러 주세요.' });
  });
  const applyAll = () => task(async () => {
    draft.review = draft.review || {};
    let applied = 0, stale = 0;
    for (const q of draft.quotes) {
      const outcome = await applyOne(q.id);
      if (outcome === 'applied') applied++;
      if (outcome === 'stale') stale++;
    }
    if (applied) toast(applied + '곳을 바꿨어요' + (stale ? ' · ' + stale + '곳은 원문이 바뀌어 넣지 않았어요' : ''), stale ? 'fail' : 'ok', { sub: '저장은 직접 눌러 주세요.' });
    else if (stale) toast('원문이 바뀌어 넣지 않았어요', 'fail');
  });
  const undo = id => task(async () => {
    const r = reviewOf(id), quote = draft.quotes.find(q => q.id === id);
    if (r?.state !== 'applied' || !quote) return;
    const { q, text: answer } = await readCurrent();
    const at = F.locate(answer, r.replacement, r.at);
    if (at < 0) { toast('직접 고친 곳이라 되돌리지 않았어요', 'fail', { sub: '답변란에서 확인해 주세요.' }); return; }
    if (!(await writeAnswer(q.number, F.replaceAt(answer, at, r.replacement, r.original)))) throw Error('되돌리기를 확인하지 못했어요. 답변란을 직접 확인해 주세요.');
    delete draft.review[id];
    toast('인용 ' + id + '을 되돌렸어요', 'ok');
  });
  function dismiss(id) { draft.review = draft.review || {}; draft.review[id] = { state: 'dismissed' }; save(); render(); }
  function dismissAll() {
    draft.review = draft.review || {};
    for (const q of draft.quotes) if (attempt?.reply?.items[q.id]?.status === 'ready' && !reviewOf(q.id)) draft.review[q.id] = { state: 'dismissed' };
    save(); render();
  }
  async function reset() {
    if (attempt) await call('dismiss', { attempt: attempt.id }).catch(() => {});
    try { draft = F.create(await JSL.getState()); }
    catch (e) { notice = { tone: 'attn', text: e.message }; render(); return; }
    attempt = null; notice = null; announced = '';
    await save(); render();
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('수정안을 복사했어요', 'ok'); }
    catch { toast('복사하지 못했어요', 'fail'); }
  }

  // ── 이벤트 ──
  bubble.addEventListener('pointerdown', e => e.preventDefault());
  bubble.addEventListener('click', e => { const kind = e.target.closest('button')?.dataset.kind; if (kind) addQuote(kind); });
  for (const node of [view, actions, bubbleRoot]) {
    node.addEventListener('keydown', e => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault();
      if (e.key === 'Escape' && node === bubbleRoot) hideBubble();
    });
    ['keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy'].forEach(type => node.addEventListener(type, e => e.stopPropagation()));
  }
  document.addEventListener('compositionstart', () => { composing = true; hideBubble(); }, true);
  document.addEventListener('compositionend', () => { composing = false; }, true);
  document.addEventListener('mouseup', e => { pointer = { x: e.clientX, y: e.clientY }; captureSelection(e); });
  document.addEventListener('select', captureSelection, true);
  document.addEventListener('keyup', e => { if (e.key !== 'Escape') captureSelection(e); else hideBubble(); }, true);
  document.addEventListener('scroll', e => { if (!bubbleRoot.contains(e.target)) hideBubble(); }, true);
  document.addEventListener('pointerdown', e => {
    if (e.target !== bubbleHost && !e.target.matches?.('textarea.answer')) hideBubble();
  }, true);
  document.addEventListener('input', e => {
    if (!e.target.matches?.('textarea.answer')) return;
    hideBubble();
    if (draft && rebase()) render(); else updateMarks();
  }, true);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== 'feedback:changed') return;
    if (draft && attempt?.id === message.attempt) { reloadAttempt(); return; }
    // 다른 문항에서 보낸 질문의 답. 지금 문항 화면을 바꾸지 않고 알린다.
    if (message.done && message.questionId && (!draft || message.questionId !== draft.question.id) && Number.isInteger(message.number)) {
      toast('GPT 답 도착 · ' + message.number + '번 문항', 'info', { id: 'gpt-feedback-arrived-' + message.questionId,
        actions: [{ label: message.number + '번 문항으로', primary: true, onClick: () => {
          openWhenLoaded = message.questionId;
          JSL.action('switchQna', { number: message.number });
          JSL.emit('focus:answer', { number: message.number });
        } }] });
    } else if (draft?.attempt?.id === message.attempt) reloadAttempt();
  });
  setInterval(() => {
    // 기다리는 중: 경과 시간만 갱신한다. 워커 알림을 놓쳐도 가끔 다시 묻는다.
    if (phase() === 'waiting' && JSL.ui?.isViewOpen?.(VIEW)) {
      const sub = view.querySelector('[data-elapsed]');
      if (sub) sub.textContent = waitingSub();
    }
  }, 1000);
  setInterval(() => { if (draft && (phase() === 'waiting' || phase() === 'unknown')) reloadAttempt(); }, 5000);
  JSL.onState(sync);
  sync(null);
  JSL.getState().then(sync);
  let lastPath = location.pathname, lastEditor = editor();
  setInterval(() => {
    const current = editor();
    if (location.pathname !== lastPath || current !== lastEditor) {
      lastPath = location.pathname; lastEditor = current; hideBubble();
      if (!/^\/resume\/\d+\/?$/.test(lastPath) || !current) { sync(null); JSL.ui?.closeView?.(VIEW); }
      else JSL.getState().then(sync);
    }
  }, 400);
  let tries = 0;
  const uiTimer = setInterval(() => {
    if (JSL.ui?.addAction) { clearInterval(uiTimer); actionBtn = JSL.ui.addAction('GPT 질문', () => { openView(true); }); updateActionLabel(); }
    else if (++tries > 50) clearInterval(uiTimer);
  }, 100);
});
