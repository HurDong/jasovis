// 답변란에서 고른 곳 옆에 뜨는 GPT 질문 바. 고른 곳 하나에 질문 하나를 연결된 웹 GPT로 보내고,
// 온 수정안을 그 자리에서 보고 바꾼다. 답변 쓰기는 사용자가 바꾸기를 누를 때만 setAnswer로 한다. 탭은 옮기지 않는다.
JSL.register('gpt-feedback', function () {
  'use strict';
  if (window.__jslFeedback) return;
  window.__jslFeedback = true;
  const F = JSLFeedback;
  const marks = () => window.JSLFeedbackMarks || { set() {}, clear() {}, measure() { return null; } };
  // 보이는 답변란을 쓴다. 숨겨진 복제본이 있어도 사용자가 보는 칸과 비교한다.
  const editor = () => { const all = [...document.querySelectorAll('textarea.answer')]; return all.find(t => t.getClientRects().length) || all[0] || null; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const oneLine = text => String(text || '').replace(/\s+/g, ' ').trim();

  let state = null, identity = '', generation = 0, attempt = null, items = [], selected = '';
  let pick = null;          // 지금 고른 곳 { start, end, text, lost }
  let composing = false;    // 질문 칸이 열려 있다
  let request = '';         // 질문 칸에 쓴 글. 보내기 전까지 남긴다.
  let sending = false, working = false, picking = false, notice = '', collapsed = false;
  let applied = null;       // 방금 바꾼 곳 { attempt, at, length, review, timer }
  let dragging = false, ime = false, announced = '', lastSide = '';

  // ── 화면 ──
  const host = document.createElement('div');
  host.id = 'jsl-gpt-feedback';
  host.dataset.jslIsolate = 'true';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box}
    .float{position:fixed;left:0;top:0;z-index:2147483646;display:flex;flex-direction:column;
      font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;color:#332b24}
    .float[hidden]{display:none}
    .box{background:#fff;border:1px solid #f0e2d5;border-radius:12px;box-shadow:0 10px 28px rgba(58,34,15,.16)}
    .offer{display:flex;align-items:center;gap:8px;width:290px;height:36px;padding:0 6px 0 11px;cursor:text;font:inherit;text-align:left}
    .offer:hover{border-color:#ffb377}
    .gpt-icon{flex:none;display:flex;width:18px;height:18px;color:#292929}
    .gpt-icon svg{display:block;width:100%;height:100%}
    .offer .ph{flex:1;min-width:0;color:#a89a8b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    kbd{flex:none;font:600 10.5px/1 ui-monospace,Consolas,monospace;border:1px solid #e5d8ca;border-bottom-width:2px;border-radius:5px;
      padding:3px 5px;background:#fff;color:#8a6a4d}
    .compose{width:380px;padding:9px 10px 8px;border-color:#ff6a00;box-shadow:0 0 0 3px #fff1e8,0 10px 28px rgba(58,34,15,.16);display:flex;flex-direction:column;min-height:0}
    .quote-head{display:flex;align-items:flex-start;gap:8px}
    .quote-source{flex:1;min-width:0;background:#f4f4f4;border-left:3px solid #b5b5b5;border-radius:5px;padding:7px 9px}
    .field-label{display:block;font-size:11px;font-weight:700;line-height:1.4;color:#666}
    .quote{margin-top:3px;font-size:11.5px;line-height:1.5;color:#555;display:-webkit-box;-webkit-line-clamp:2;
      -webkit-box-orient:vertical;overflow:hidden;white-space:normal;overflow-wrap:anywhere}
    .question-label{display:flex;align-items:center;gap:6px;margin:10px 0 6px;font-size:12px;color:#333}
    textarea{display:block;width:100%;min-height:56px;max-height:150px;resize:none;border:1px solid #c9c9c9;outline:0;padding:8px 9px;margin:0;border-radius:6px;
      font:inherit;font-size:13px;line-height:1.55;color:#292929;background:#fff}
    textarea:focus{border-color:#ff6a00;box-shadow:0 0 0 1px #ff6a00}
    textarea::placeholder{color:#888}
    textarea[readonly]{color:#8a6a4d}
    .foot{flex:none;display:flex;align-items:center;gap:10px;margin-top:6px}
    .target{min-width:0;flex:1;display:flex;align-items:center;gap:3px;border:0;background:transparent;font:inherit;font-size:11.5px;
      color:#8a6a4d;cursor:pointer;padding:2px 0;text-align:left}
    .target span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .target.need{color:#e05e00;font-weight:700}
    .keys{flex:none;font-size:11px;color:#b8a794;white-space:nowrap}
    .primary{flex:none;border:0;background:#ff6a00;color:#fff;font:inherit;font-size:12.5px;font-weight:700;border-radius:8px;
      padding:6px 12px;cursor:pointer;white-space:nowrap}
    .primary:hover{background:#e05e00}
    .primary[disabled]{background:#f5ede4;color:#b8a794;cursor:default}
    .link{flex:none;border:0;background:transparent;font:inherit;font-size:12px;font-weight:700;color:#a89a8b;cursor:pointer;padding:2px 0;white-space:nowrap}
    .link:hover{color:#e05e00}
    .link.o{color:#e05e00}
    .link[disabled]{opacity:.5;cursor:default}
    .note{flex:none;margin-top:6px;font-size:11.5px;line-height:1.5;color:#c24d00;word-break:keep-all;overflow-wrap:anywhere;white-space:pre-line}
    .note.soft{color:#8a6a4d}
    .note[hidden]{display:none}
    .pick{flex:none;margin-top:6px;border:1px solid #f0e1d3;border-radius:9px;max-height:170px;overflow-y:auto}
    .pick[hidden]{display:none}
    .opt{display:flex;width:100%;gap:8px;align-items:center;border:0;border-top:1px solid #f8f1ea;background:#fff;padding:7px 9px;
      font:inherit;font-size:12px;color:#332b24;cursor:pointer;text-align:left}
    .opt:first-child{border-top:0}
    .opt:hover{background:#fff8f1}
    .opt.on{background:#fff1e8;font-weight:700}
    .opt span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .opt i{margin-left:auto;font-style:normal;font-size:10.5px;color:#a89a8b;flex:none}
    .pick-foot{display:flex;gap:10px;align-items:center;padding:6px 9px;border-top:1px solid #f8f1ea;font-size:11px;color:#a89a8b;line-height:1.45}
    .pick-foot .link{margin-left:auto;font-size:11.5px}
    .pill{display:flex;align-items:center;gap:9px;height:34px;padding:0 12px;border-radius:999px;border-color:#ffb377;
      font-size:12.5px;font-weight:700;color:#8a6a4d;white-space:nowrap}
    .pill .link{font-size:12px}
    .pill.hot{background:#ff6a00;border-color:#ff6a00;color:#fff}
    .pill.hot .link{color:#fff}
    .pill.hot .link:hover{color:#fff;text-decoration:underline}
    .spin{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid #ffd9bd;border-top-color:#ff6a00;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){.spin{animation:none}}
    .card{width:400px;padding:10px 12px 9px;display:flex;flex-direction:column;min-height:0;outline:none}
    .head{flex:none;display:flex;align-items:baseline;gap:8px}
    .head b{font-size:13px}
    .delta{font-size:11px;color:#8a6a4d;font-weight:600}
    .head .link{margin-left:auto}
    .scroll{min-height:0;overflow-y:auto;flex:1 1 auto}
    .asked{margin-top:5px;font-size:11.5px;color:#8a6a4d;background:#faf6f1;border-radius:7px;padding:4px 7px;
      overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .diag{margin-top:6px;font-size:12.5px;line-height:1.55;color:#5f5347;word-break:keep-all;overflow-wrap:anywhere;white-space:pre-line}
    .diff{margin-top:6px;border:1px solid #f0e1d3;border-radius:8px;padding:7px 9px;font-size:12.5px;line-height:1.65;
      word-break:keep-all;overflow-wrap:anywhere;white-space:pre-wrap}
    .diff s{display:block;color:#b8a794;text-decoration-color:#d9c7b5}
    .diff ins{display:block;margin-top:4px;text-decoration:none;background:#fff1e8;border-radius:5px;padding:2px 4px;color:#332b24}
    .check{margin-top:6px;font-size:11.5px;color:#a86a2f;overflow-wrap:anywhere}
    .card .foot{margin-top:9px}
    .card .foot .primary{margin-left:auto}
    button:focus-visible,.card:focus-visible{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px #e05e00}
    .card:focus-visible{box-shadow:0 0 0 2px #ffb377,0 10px 28px rgba(58,34,15,.16)}
  </style><div class="float" hidden></div>`;
  const float = root.querySelector('.float');
  (document.body || document.documentElement).appendChild(host);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function btn(className, text, onClick, act) {
    const node = el('button', className, text);
    node.type = 'button';
    if (act) node.dataset.act = act;
    node.addEventListener('pointerdown', e => e.preventDefault()); // 답변란의 선택과 질문 칸의 커서를 뺏지 않는다.
    node.addEventListener('click', e => { e.stopPropagation(); if (!node.disabled) onClick(e); });
    return node;
  }
  function toast(message, kind = 'info', extra = {}) { JSL.emit('toast', { message, kind, ...extra }); }
  async function call(type, payload = {}) {
    let result;
    try { result = await chrome.runtime.sendMessage({ type: 'feedback:' + type, ...payload }); }
    catch { throw Error('확장 연결이 끊겼습니다. 확장을 다시 로드했다면 자소설과 GPT 페이지도 새로고침해 주세요.'); }
    if (!result?.ok) throw Object.assign(Error(result?.error || '질문 요청을 처리하지 못했습니다.'), { busy: !!result?.busy });
    return result;
  }

  // ── 상태 ──
  const request0 = () => attempt?.request;
  function sameResume() { return !!request0() && String(state?.resume?.id) === request0().resumeId; }
  function here() {
    if (!sameResume()) return false;
    try { return String(F.current(state).id) === request0().questionId; } catch { return false; }
  }
  const quoteAt = text => F.locate(text, request0().quote.text, request0().quote.start);
  function decide() {
    const ta = editor();
    if (!ta || !identity || !ta.getClientRects().length) return '';
    if (composing && pick) return 'compose';
    if (pick && !dragging && !ime) return 'offer';
    if (applied) return 'applied';
    if (!attempt || !sameResume() || attempt.status === 'blocked') return '';
    if (!here()) return 'elsewhere';
    if (attempt.status !== 'sent') return 'unknown';
    if (!attempt.reply) return 'waiting';
    if (attempt.review?.state === 'applied') return '';
    return collapsed ? 'arrived' : 'result';
  }
  function elapsed() {
    if (!attempt?.sentAt) return '';
    const s = Math.max(0, Math.round((Date.now() - attempt.sentAt) / 1000));
    return s < 60 ? s + '초' : Math.floor(s / 60) + '분 ' + (s % 60) + '초';
  }
  function anchor(kind) {
    const ta = editor();
    if (!ta) return null;
    if (kind === 'offer' || kind === 'compose') return pick && !pick.lost ? { start: pick.start, end: pick.end } : null;
    if (kind === 'applied') return { start: applied.at, end: applied.at + applied.length };
    if (['waiting', 'result', 'arrived', 'unknown'].includes(kind)) {
      const at = quoteAt(ta.value);
      return at < 0 ? null : { start: at, end: at + request0().quote.text.length };
    }
    return null;
  }
  function updateMarks(kind) {
    const ta = editor(), ranges = [];
    if (ta && kind) {
      if (kind === 'compose' && pick && !pick.lost && document.activeElement !== ta) ranges.push({ start: pick.start, end: pick.end, kind: 'pick' });
      else if (kind === 'applied' && applied.highlight) ranges.push({ start: applied.at, end: applied.at + applied.length, kind: 'applied' });
      else {
        const range = ['waiting', 'result', 'arrived', 'unknown'].includes(kind) ? anchor(kind) : null;
        if (range) ranges.push({ ...range, kind: 'quote' });
      }
    }
    marks().set(ranges);
  }

  // ── 질문 칸 (한 번 만들고 내용만 바꾼다 — 쓰던 글과 커서를 지킨다) ──
  const compose = el('div', 'box compose');
  const cQuote = el('div', 'quote'), cInput = el('textarea'), cNote = el('div', 'note'), cPick = el('div', 'pick'), cFoot = el('div', 'foot');
  const cTarget = btn('target', '', async () => { picking = !picking; if (picking) await refreshTargets(); render(); cInput.focus(); }, 'target');
  const cSend = btn('primary', '보내기', () => send(), 'send');
  cInput.rows = 2;
  cInput.maxLength = F.LIMIT.request;
  cInput.placeholder = '이 문장에서 무엇이 궁금한가요?';
  cInput.setAttribute('aria-label', '고른 곳에 대한 GPT 질문');
  cFoot.append(cTarget, el('span', 'keys', '↵ 보내기 · Shift+↵ 줄바꿈'), cSend);
  const cHead = el('div', 'quote-head'), cSource = el('div', 'quote-source');
  cSource.append(el('span', 'field-label', '선택한 문장'), cQuote);
  const cLabel = el('label', 'field-label question-label');
  cLabel.append(gptIcon(), el('span', null, 'ChatGPT에게 질문'));
  cInput.id = 'jsl-feedback-question';
  cLabel.htmlFor = cInput.id;
  const cClose = btn('link', '✕', () => closeCompose(true), 'close-compose');
  cClose.setAttribute('aria-label', '질문 칸 닫기');
  cHead.append(cSource, cClose);
  compose.append(cHead, cLabel, cInput, cNote, cPick, cFoot);
  const grow = () => { cInput.style.height = 'auto'; cInput.style.height = Math.min(150, Math.max(56, cInput.scrollHeight + 2)) + 'px'; };
  cInput.addEventListener('input', () => { request = cInput.value; if (notice) { notice = ''; renderCompose(); } grow(); place(); });
  cInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCompose(true); }
  });
  cInput.addEventListener('focus', () => updateMarks(decide()));
  function renderCompose() {
    const chosen = items.find(t => t.conversation === selected);
    cQuote.textContent = pick ? '“' + oneLine(pick.text) + '”' : '';
    if (cInput.value !== request) { cInput.value = request; grow(); }
    cInput.readOnly = sending;
    const warn = pick?.lost ? '고른 곳이 바뀌었어요. 답변에서 다시 골라 주세요.'
      : notice || (attempt && sameResume() && !(attempt.review?.state === 'applied') ? '보내면 앞서 보낸 질문은 닫혀요.' : '');
    cNote.textContent = warn;
    cNote.hidden = !warn;
    cNote.className = 'note' + (!notice && !pick?.lost ? ' soft' : '');
    cTarget.replaceChildren(el('span', null, chosen ? '→ ' + chosen.title : '보낼 GPT 대화 고르기'), el('span', null, picking ? '▴' : '▾'));
    cTarget.classList.toggle('need', !chosen);
    cTarget.setAttribute('aria-label', '보낼 GPT 대화 ' + (chosen ? chosen.title + ' · 바꾸기' : '고르기'));
    cSend.textContent = sending ? '보내는 중…' : '보내기';
    cSend.disabled = sending || !!pick?.lost;
    cPick.hidden = !picking;
    if (picking) {
      const list = items.map(item => {
        const opt = btn('opt' + (item.conversation === selected ? ' on' : ''), null, () => choose(item.conversation));
        opt.append(el('span', null, item.title), el('i', null, item.linked ? '연결됨' : '연결하기'));
        return opt;
      });
      const foot = el('div', 'pick-foot', items.length ? '이 지원서를 쓰던 대화를 고르세요.' : '열린 GPT 대화가 없어요. 이 지원서를 쓰던 대화를 연 뒤 다시 찾아 주세요.');
      foot.append(btn('link', '다시 찾기', async () => { await refreshTargets(); render(); cInput.focus(); }));
      cPick.replaceChildren(...list, foot);
    }
  }

  // ── 그 밖의 모양 ──
  function gptIcon() {
    const icon = el('span', 'gpt-icon');
    // OpenAI mark: Simple Icons 13.0.0 (CC0), bundled inline; no remote image request.
    icon.innerHTML = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>';
    return icon;
  }
  function offer() {
    const node = btn('box offer', null, () => openCompose(), 'offer');
    node.setAttribute('aria-label', '고른 곳 GPT에게 질문 (Alt+Q)');
    const icon = gptIcon();
    node.append(icon, el('span', 'ph', '이 부분 GPT에게 질문'), el('kbd', null, 'Alt+Q'));
    return node;
  }
  function pill(parts, hot = false) {
    const node = el('div', 'box pill' + (hot ? ' hot' : ''));
    node.setAttribute('role', 'status');
    node.append(...parts);
    return node;
  }
  function card(title, { delta, body = [], foot = [], collapse = false } = {}) {
    const node = el('div', 'box card');
    node.tabIndex = -1;
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', title);
    const head = el('div', 'head');
    head.append(el('b', null, title));
    if (delta) head.append(el('span', 'delta', delta));
    if (collapse) head.append(btn('link', '접기', () => { collapsed = true; render(); editor()?.focus({ preventScroll: true }); }, 'collapse'));
    const scroll = el('div', 'scroll');
    scroll.append(...body.filter(Boolean));
    if (notice) scroll.append(el('div', 'note', notice));
    const bar = el('div', 'foot');
    bar.append(...foot);
    node.append(head, scroll, bar);
    return node;
  }
  const gptLink = (label = 'GPT에서 보기') => btn('link', label, () => focusGpt(), 'gpt');
  const asked = () => request0()?.request ? el('div', 'asked', '내 질문 · ' + request0().request) : null;
  function build(kind) {
    const r = request0(), item = attempt?.reply?.item;
    if (kind === 'offer') return offer();
    if (kind === 'applied') {
      const node = pill([el('span', null, '✓ 바꿨어요'), btn('link o', '되돌리기', () => undo(), 'undo')]);
      node.title = '사이트의 저장은 직접 눌러 주세요.';
      return node;
    }
    if (kind === 'elsewhere') {
      const done = !!attempt.reply;
      return pill([done ? null : el('span', 'spin'), el('span', null, r.number + '번 문항 질문 · ' + (done ? '답 도착' : 'GPT가 고치는 중')),
        btn('link', '가기', () => goQuestion(), 'go')].filter(Boolean), done);
    }
    if (kind === 'waiting') {
      if (attempt.lost) return pill([el('span', null, 'GPT 탭이 닫혔어요'), btn('link o', '다시 열기', () => focusGpt(), 'gpt'), btn('link', '취소', () => dismiss(), 'cancel')]);
      const slow = !attempt.streaming && attempt.sentAt && Date.now() - attempt.sentAt > 45000;
      const parts = [el('span', 'spin'), el('span', null, (attempt.streaming ? 'GPT가 답을 쓰는 중' : 'GPT가 고치는 중') + ' · ' + elapsed())];
      if (slow) parts.push(gptLink('GPT 탭 보기'));
      parts.push(btn('link', '취소', () => dismiss(), 'cancel'));
      return pill(parts);
    }
    if (kind === 'arrived') return pill([el('span', null, item?.status === 'ready' ? '수정안 도착' : 'GPT 답 도착'), btn('link', '보기', () => expand(), 'expand')], true);
    if (kind === 'unknown') {
      return card('보냈는지 확인하지 못했어요', { body: [el('div', 'diag', attempt.error || 'GPT 대화에서 확인해 주세요. 자동으로 다시 보내지 않아요.')],
        foot: [gptLink('GPT에서 확인'), btn('link', '보냈어요 · 답 기다리기', () => claim(), 'claim'), btn('primary', '다시 보내기', () => resend(), 'resend')] });
    }
    // result
    const quote = r.quote.text;
    if (attempt.review?.state === 'stale') {
      return card('원문이 바뀌어 넣지 못했어요', { body: [el('div', 'diag', '답을 기다리는 사이 고른 곳이 바뀌었어요. 수정안을 복사해 직접 넣을 수 있어요.'),
        item.replacement ? diffView(quote, item.replacement) : null],
        foot: [btn('link', '닫기', () => dismiss(), 'close'), btn('primary', '수정안 복사', () => copy(item.replacement), 'copy')] });
    }
    if (item.status === 'ready') {
      const change = item.replacement.length - quote.length;
      return card('수정안', { delta: (change >= 0 ? '+' : '−') + Math.abs(change) + '자', collapse: true,
        body: [asked(), item.diagnosis ? el('div', 'diag', item.diagnosis) : null, diffView(quote, item.replacement),
          item.ask ? el('div', 'check', '확인 · ' + item.ask) : null],
        foot: [btn('link', '버리기', () => dismiss(), 'discard'), gptLink(), btn('primary', '바꾸기 ↵', () => apply(), 'apply')] });
    }
    if (item.status === 'same') return card('바꿀 곳이 없대요', { body: [asked(), item.diagnosis ? el('div', 'diag', item.diagnosis) : null],
      foot: [gptLink(), btn('primary', '확인', () => dismiss(), 'close')] });
    if (item.status === 'note') return card('GPT 답', { collapse: true, body: [asked(), el('div', 'diag', item.diagnosis)],
      foot: [gptLink(), btn('primary', '닫기', () => dismiss(), 'close')] });
    if (item.status === 'ask') return card('확인이 필요해요', { collapse: true, body: [asked(), item.diagnosis ? el('div', 'diag', item.diagnosis) : null, el('div', 'check', item.ask)],
      foot: [btn('link', '닫기', () => dismiss(), 'close'), gptLink('GPT에서 답하기')] });
    return card('답을 읽지 못했어요', { body: [el('div', 'diag', item?.reason || '수정안 형식을 읽지 못했어요.')],
      foot: [btn('link', '닫기', () => dismiss(), 'close'), gptLink()] });
  }
  function diffView(from, to) {
    const node = el('div', 'diff');
    node.append(el('s', null, from), el('ins', null, to));
    return node;
  }
  let shown = '';
  function render() {
    const kind = decide();
    updateMarks(kind);
    if (!kind) { float.hidden = true; float.replaceChildren(); shown = ''; return; }
    const active = root.activeElement, act = active?.dataset?.act, cardFocus = active?.classList?.contains('card');
    let node;
    if (kind === 'compose') { renderCompose(); node = compose; }
    else node = build(kind);
    if (float.firstChild !== node) float.replaceChildren(node);
    if (shown !== kind) lastSide = '';
    shown = kind;
    float.hidden = false;
    place();
    if (kind !== 'compose' && (act || cardFocus)) (node.querySelector('[data-act="' + act + '"]') || node).focus({ preventScroll: true });
  }

  // ── 위치: 글을 가리지 않는 곳부터 ──
  // 큰 칸(질문 칸·수정안)은 답변란 옆 → 고른 줄 위 → 아래 순서, 작은 바는 고른 줄 바로 위 → 아래 → 옆.
  // 대시보드와 고른 줄은 가리지 않는다. 자리가 모자라면 위·아래 중 넓은 쪽에서 높이를 줄인다.
  function obstacles(lines) {
    const list = lines.map(r => ({ ...r, left: r.left - 2, right: r.right + 2 }));
    for (const [id, selector] of [['jsl-dashboard', '.wrap'], ['jsl-jd-panel', '.scroll, .toggle']]) {
      const panel = document.getElementById(id);
      if (!panel || getComputedStyle(panel).display === 'none') continue;
      // 공고 host는 화면 전체 크기이므로 실제 이미지 영역과 손잡이만 피한다.
      const parts = panel.shadowRoot?.querySelectorAll(selector) || [];
      for (const part of parts) {
        const r = part.getBoundingClientRect();
        if (r.width && r.height) list.push({ left: r.left - 6, right: r.right + 6, top: r.top - 6, bottom: r.bottom + 6 });
      }
    }
    return list;
  }
  function covered(ta) {
    const r = ta.getBoundingClientRect();
    const points = [[r.left + 12, r.top + 12], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 12, r.bottom - 12]];
    return points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && hit !== ta && !ta.contains(hit) && hit !== host && !hit.closest?.('#jsl-checkpoint, #jsl-dashboard');
    });
  }
  function place() {
    if (float.hidden) return;
    const ta = editor(), kind = shown;
    if (!ta) { float.hidden = true; return; }
    if (kind !== 'compose' && covered(ta)) { float.style.visibility = 'hidden'; return; }
    float.style.visibility = '';
    const pad = 8, gap = 8, vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
    float.style.maxHeight = (vh - pad * 2) + 'px';
    const range = anchor(kind), measured = range ? marks().measure(range.start, range.end) : null;
    const tr = ta.getBoundingClientRect(), box = measured?.box || tr, lines = measured?.lines || [];
    const big = kind === 'compose' || kind === 'result' || kind === 'unknown', node = float.firstElementChild;
    const natural = kind === 'compose' ? 380 : 400;
    // 칸 폭을 정하고 그 폭의 크기를 잰다. 큰 칸은 옆자리가 조금 좁으면 폭을 줄여서라도(최소 300px) 글 옆에 둔다.
    const size = width => {
      if (node && big) node.style.width = width + 'px';
      return { w: float.offsetWidth, h: float.offsetHeight };
    };
    const set = (left, top, w, maxH) => {
      float.style.left = Math.round(Math.max(pad, Math.min(vw - pad - w, left))) + 'px';
      float.style.top = Math.round(top) + 'px';
      if (maxH) float.style.maxHeight = Math.max(80, maxH) + 'px';
    };
    if (!lines.length) {
      // 고른 곳이 보이지 않는다(스크롤·다른 문항). 작은 바는 숨기고, 상태는 답변란 오른쪽 위에 붙인다.
      if (kind === 'offer' || tr.bottom < pad + 30 || tr.top > vh - 30) { float.style.visibility = kind === 'compose' ? '' : 'hidden'; if (kind !== 'compose') return; }
      const { w } = size(natural);
      set(Math.min(tr.right, vw - pad) - w - 8, Math.max(tr.top, pad) + 8, w);
      return;
    }
    const first = lines[0], last = lines[lines.length - 1], blocks = obstacles(lines);
    const room = { right: vw - pad - (box.right + gap), left: box.left - gap - pad };
    const spot = side => {
      const beside = side === 'right' || side === 'left';
      if (beside && big && room[side] < 300) return null;
      const { w, h } = size(beside && big ? Math.min(natural, Math.floor(room[side])) : natural);
      const x = Math.max(box.left, Math.min(first.left - 12, box.right - w));
      const top = beside ? Math.max(pad, Math.min(vh - pad - h, first.top - 12)) : side === 'above' ? first.top - gap - h : last.bottom + gap;
      const left = side === 'right' ? box.right + gap : side === 'left' ? box.left - gap - w : x;
      return { left, top, w, h };
    };
    const fits = c => !!c && c.left >= pad && c.top >= pad && c.left + c.w <= vw - pad && c.top + c.h <= vh - pad &&
      !blocks.some(b => c.left < b.right && c.left + c.w > b.left && c.top < b.bottom && c.top + c.h > b.top);
    const order = big ? ['right', 'left', 'above', 'below'] : ['above', 'below', 'right', 'left'];
    if (lastSide) order.unshift(lastSide); // 쓰는 동안 자리가 이리저리 바뀌지 않게 한 번 고른 쪽을 먼저 본다.
    for (const side of order) {
      const c = spot(side);
      if (fits(c)) { lastSide = side; set(c.left, c.top, c.w); return; }
    }
    const { w, h } = size(natural);
    const x = Math.max(box.left, Math.min(first.left - 12, box.right - w));
    const up = first.top - gap - pad, down = vh - pad - (last.bottom + gap);
    lastSide = '';
    if (up >= down) set(x, first.top - gap - Math.min(h, up), w, up);
    else set(x, last.bottom + gap, w, down);
  }
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); }); };

  // ── 불러오기 ──
  async function load(version) {
    const result = await call('load');
    if (version !== generation) return;
    attempt = result.attempt; items = result.items; selected = result.selected;
    // 끝난 질문 기록은 새로고침 뒤에 다시 보이지 않게 정리한다.
    if (attempt && (attempt.status === 'blocked' || (attempt.review?.state === 'applied' && applied?.attempt !== attempt.id))) {
      await call('dismiss', { attempt: attempt.id }).catch(() => {});
      attempt = null;
    }
    if (attempt && applied && applied.attempt !== attempt.id) finishApplied(false);
    announce();
    render();
  }
  let loading = null, loadAgain = false;
  // 알림·주기 확인·버튼이 겹쳐도 불러오기는 한 번씩 차례로 한다.
  function reloadAttempt() {
    if (loading) { loadAgain = true; return loading; }
    loading = (async () => {
      do {
        loadAgain = false;
        const version = generation;
        try { await load(version); }
        catch (e) { if (e.busy) { await wait(300); loadAgain = true; } }
      } while (loadAgain);
    })().finally(() => { loading = null; });
    return loading;
  }
  let resumeKey = '';
  async function sync(fresh) {
    state = fresh;
    let next = '', resume = '';
    try { const q = F.current(fresh); resume = String(fresh.resume.id); next = resume + ':' + q.id; } catch { /* 지원서 밖에서는 숨긴다. */ }
    if (next === identity) { render(); return; }
    identity = next;
    pick = null; composing = false; picking = false; notice = ''; collapsed = false; lastSide = '';
    if (applied) finishApplied(false);
    if (!next) { resumeKey = ''; attempt = null; render(); return; }
    render();
    if (resume !== resumeKey) { resumeKey = resume; generation++; attempt = null; }
    await reloadAttempt();
  }
  function announce() {
    if (!attempt?.reply || announced === attempt.id) return;
    announced = attempt.id;
    const ta = editor(), r = request0();
    const inView = ta && (() => { const b = ta.getBoundingClientRect(); return b.width && b.bottom > 0 && b.top < innerHeight; })();
    if (inView) return; // 답변란 옆 질문 바가 바로 보여 준다(다른 문항이면 그 문항으로 가는 바).
    toast('GPT 답 도착 · ' + r.number + '번 문항', 'info', { id: 'gpt-feedback-arrived',
      actions: [{ label: here() ? '보기' : r.number + '번 문항으로', primary: true, onClick: () => goQuestion() }] });
  }
  function goQuestion() {
    const r = request0();
    if (!r) return;
    collapsed = false;
    if (here()) { const ta = editor(); ta?.scrollIntoView({ block: 'center', behavior: 'smooth' }); render(); return; }
    JSL.action('switchQna', { number: r.number });
    JSL.emit('focus:answer', { number: r.number });
  }

  // ── 고르기 ──
  function readPick() {
    const ta = editor();
    if (!ta || document.activeElement !== ta) return undefined; // 답변란 밖(질문 칸 등)에서는 고른 곳을 그대로 둔다.
    const start = ta.selectionStart, end = ta.selectionEnd;
    if (start === end || !ta.value.slice(start, end).trim()) return null;
    return { start, end, text: ta.value.slice(start, end) };
  }
  function syncSelection() {
    if (!identity || sending) return;
    const next = readPick();
    if (next === undefined) return;
    if (next) {
      if (!pick || pick.start !== next.start || pick.end !== next.end || pick.text !== next.text) { pick = next; if (!composing) lastSide = ''; }
    } else if (!(composing && request.trim())) { pick = null; composing = false; picking = false; }
    render();
  }
  function openCompose() {
    if (!pick || sending) return;
    composing = true; notice = ''; lastSide = '';
    if (!items.length || !selected) refreshTargets().then(() => { if (composing) renderCompose(); });
    render();
    cInput.focus({ preventScroll: true });
    cInput.setSelectionRange(cInput.value.length, cInput.value.length);
  }
  function closeCompose(restore) {
    if (sending) return;
    const p = pick;
    composing = false; picking = false; notice = ''; pick = null;
    const ta = editor();
    // 선택을 되살리면 offer가 곧바로 다시 뜬다. 커서만 고른 곳 끝으로 돌린다.
    if (restore && ta && p && !p.lost) { ta.focus({ preventScroll: true }); ta.setSelectionRange(p.end, p.end); }
    render();
  }
  function expand() { collapsed = false; render(); requestAnimationFrame(() => float.querySelector('.card')?.focus({ preventScroll: true })); }

  // ── 보내기 ──
  async function refreshTargets() {
    try { const result = await call('targets'); items = result.items; selected = result.selected; }
    catch (e) { notice = e.message; }
  }
  async function choose(conversation) {
    try {
      selected = (await call('select', { conversation })).selected;
      const item = items.find(t => t.conversation === selected); if (item) item.linked = true;
      picking = false; notice = '';
    } catch (e) { notice = e.message; }
    render();
    cInput.focus({ preventScroll: true });
  }
  async function send() {
    if (sending || !pick) return;
    const version = generation, question = identity;
    let ask;
    try {
      if (pick.lost) throw Error('고른 곳이 바뀌었어요. 답변에서 다시 골라 주세요.');
      const fresh = await JSL.getState(), ta = editor();
      if (identity !== question) return;
      const q = F.current(fresh);
      if (!ta || !F.sameAnswer(q.answer, ta.value)) throw Error('답변을 반영하는 중이에요. 잠시 뒤 다시 눌러 주세요.');
      const at = F.locate(ta.value, pick.text, pick.start);
      if (at < 0) { pick.lost = true; throw Error('고른 곳이 바뀌었어요. 답변에서 다시 골라 주세요.'); }
      ask = F.ask(fresh, ta.value, at, at + pick.text.length, request);
      if (!selected) { picking = true; await refreshTargets(); throw Error('보낼 GPT 대화를 골라 주세요.'); }
    } catch (e) { notice = e.message; render(); cInput.focus({ preventScroll: true }); return; }
    const id = crypto.randomUUID();
    sending = true; notice = ''; picking = false;
    if (applied) finishApplied(false);
    render();
    let result;
    try { result = await call('send', { ask, conversation: selected, attempt: id }); }
    catch (e) { result = { status: 'blocked', error: e.message }; }
    sending = false;
    if (result.status === 'blocked') {
      await call('dismiss', { attempt: id }).catch(() => {});
      notice = '보내지 못했어요 · ' + result.error;
      if (identity === question) { render(); cInput.focus({ preventScroll: true }); }
      await reloadAttempt();
      return;
    }
    // 보냄(또는 확인 불가). 질문 칸을 닫고 쓰던 자리로 커서를 돌려준다.
    const back = pick;
    composing = false; pick = null; request = ''; cInput.value = ''; collapsed = false; announced = '';
    if (identity === question && back) {
      const ta = editor();
      if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(back.end, back.end); }
    }
    if (version === generation) await reloadAttempt();
  }
  async function claim() {
    if (!attempt) return;
    try { await call('claim', { attempt: attempt.id }); notice = ''; }
    catch (e) { notice = e.message; }
    await reloadAttempt();
  }
  async function resend() {
    if (!attempt?.request) return;
    const r = attempt.request, ta = editor(), at = ta ? quoteAt(ta.value) : -1;
    await call('dismiss', { attempt: attempt.id }).catch(() => {});
    attempt = null; notice = '';
    if (at < 0) { toast('고른 곳이 바뀌어 다시 보낼 수 없어요', 'fail', { sub: '답변에서 다시 골라 질문해 주세요.' }); render(); return; }
    pick = { start: at, end: at + r.quote.text.length, text: r.quote.text };
    request = r.request || '';
    openCompose();
  }
  async function focusGpt() {
    try { await call('focus', attempt ? { attempt: attempt.id } : { conversation: selected }); }
    catch (e) { notice = e.message; render(); }
  }

  // ── 바꾸기·버리기·되돌리기 ──
  async function writeAnswer(number, text) {
    const result = await JSL.action('setAnswer', { number, text });
    if (!result?.ok) return false;
    // 실제 사이트는 모델을 바꾼 뒤 입력칸 값을 조금 늦게 그린다. 값이 반영될 때까지 기다린다.
    let ok = false;
    for (let i = 0; i < 25 && !ok; i++) {
      await wait(60);
      const fresh = await JSL.getState();
      try { const q = F.current(fresh); ok = F.sameAnswer(q.answer, text) && editor()?.value === text; } catch { ok = false; }
    }
    // 검수 마커는 입력 이벤트로만 복제 층을 다시 그린다. 값이 바뀐 뒤 한 번 더 알려 옛 글이 남지 않게 한다.
    if (ok) editor().dispatchEvent(new Event('input', { bubbles: true }));
    return ok;
  }
  async function readCurrent() {
    const fresh = await JSL.getState(), ta = editor(), r = request0();
    let q;
    try { q = F.current(fresh); } catch { throw Error('질문한 문항을 연 뒤 바꿔 주세요.'); }
    if (String(fresh.resume.id) !== r.resumeId || String(q.id) !== r.questionId) throw Error('질문한 문항을 연 뒤 바꿔 주세요.');
    if (!ta || !F.sameAnswer(q.answer, ta.value)) throw Error('답변을 반영하는 중이에요. 잠시 뒤 다시 눌러 주세요.');
    return { q, text: ta.value };
  }
  async function task(fn) {
    if (working) return;
    working = true; notice = '';
    try { await fn(); }
    catch (e) { notice = e.message; }
    finally { working = false; render(); }
  }
  const apply = () => task(async () => {
    const item = attempt?.reply?.item, r = request0();
    if (item?.status !== 'ready' || attempt.review) return;
    const { q, text } = await readCurrent();
    const at = quoteAt(text);
    if (at < 0) {
      await call('review', { attempt: attempt.id, review: { state: 'stale' } });
      attempt.review = { state: 'stale' };
      return;
    }
    if (!(await writeAnswer(q.number, F.replaceAt(text, at, r.quote.text, item.replacement)))) throw Error('반영을 확인하지 못했어요. 답변란을 직접 확인해 주세요.');
    const review = { state: 'applied', at, replacement: item.replacement, original: r.quote.text };
    attempt.review = review;
    await call('review', { attempt: attempt.id, review }).catch(() => {});
    applied = { attempt: attempt.id, at, length: item.replacement.length, review, highlight: true,
      timer: setTimeout(() => finishApplied(true), 8000) };
    const changed = applied;
    changed.highlightTimer = setTimeout(() => {
      if (applied !== changed) return;
      changed.highlight = false;
      updateMarks(decide()); // 전체 교체 강조만 거두고 기존 커서 문장 검수 표시는 유지한다.
    }, 2000);
    editor()?.focus({ preventScroll: true });
  });
  function finishApplied(renderAfter) {
    if (!applied) return;
    clearTimeout(applied.timer);
    clearTimeout(applied.highlightTimer);
    const id = applied.attempt;
    applied = null;
    call('dismiss', { attempt: id }).catch(() => {});
    if (attempt?.id === id) attempt = null;
    if (renderAfter) render();
  }
  const undo = () => task(async () => {
    if (!applied) return;
    clearTimeout(applied.timer);
    clearTimeout(applied.highlightTimer);
    const r = applied.review, { q, text } = await readCurrent();
    const at = F.locate(text, r.replacement, r.at);
    if (at < 0) { finishApplied(false); toast('바꾼 뒤 직접 고친 곳이라 되돌리지 않았어요', 'fail', { sub: '답변란에서 확인해 주세요.' }); return; }
    if (!(await writeAnswer(q.number, F.replaceAt(text, at, r.replacement, r.original)))) throw Error('되돌리기를 확인하지 못했어요. 답변란을 직접 확인해 주세요.');
    await call('review', { attempt: applied.attempt, review: null }).catch(() => {});
    if (attempt?.id === applied.attempt) attempt.review = null;
    applied = null; collapsed = false;
  });
  async function dismiss() {
    if (!attempt) return;
    const id = attempt.id;
    attempt = null; notice = ''; collapsed = false;
    render();
    await call('dismiss', { attempt: id }).catch(() => {});
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('수정안을 복사했어요', 'ok'); }
    catch { toast('복사하지 못했어요', 'fail'); }
  }

  // ── 이벤트 ──
  // 질문 칸의 입력은 사이트 단축키·저장·검수 기능으로 새지 않게 막는다.
  root.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault();
    const inCard = e.target.closest?.('.card');
    if (!inCard) return;
    if (e.key === 'Escape') { e.preventDefault(); collapsed = true; render(); editor()?.focus({ preventScroll: true }); }
    else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); float.querySelector('.primary')?.click(); }
  });
  ['keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy'].forEach(type => root.addEventListener(type, e => e.stopPropagation()));
  // Alt+Q: 고른 곳이 있으면 질문 칸으로, 없으면 도착한 수정안으로.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (composing || pick) && !sending && !e.isComposing) {
      e.preventDefault(); e.stopImmediatePropagation(); closeCompose(true); return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyQ' || e.isComposing) return;
    const ta = editor(), inFloat = e.composedPath().includes(host);
    if (!inFloat && (!ta || e.target !== ta)) return;
    e.preventDefault(); e.stopPropagation();
    if (composing) { cInput.focus({ preventScroll: true }); return; }
    const next = inFloat ? pick : readPick();
    if (next) { pick = next; openCompose(); return; }
    const kind = decide();
    if (kind === 'arrived' || kind === 'result' || kind === 'unknown') { expand(); return; }
    const sentence = JSL.getCheckpointRange?.(ta);
    if (sentence) { pick = sentence; openCompose(); }
  }, true);
  document.addEventListener('selectionchange', () => { if (!dragging) syncSelection(); }, true);
  document.addEventListener('select', e => { if (e.target === editor()) syncSelection(); }, true);
  document.addEventListener('pointerdown', e => {
    if (e.composedPath().includes(host)) return;
    const ta = editor();
    if (!sending && (pick || composing)) closeCompose(false);
    if (e.target === ta) { dragging = true; return; }
  }, true);
  document.addEventListener('pointerup', () => { if (dragging) { dragging = false; setTimeout(syncSelection, 0); } }, true);
  document.addEventListener('keyup', e => { if (e.target === editor() && e.key !== 'Escape') syncSelection(); }, true);
  document.addEventListener('focusout', e => {
    if (e.target !== editor()) return;
    setTimeout(() => {
      const ta = editor();
      if (composing || document.activeElement === ta || root.activeElement) return;
      if (pick) { pick = null; render(); }
    }, 0);
  }, true);
  document.addEventListener('compositionstart', e => { if (e.target === editor()) { ime = true; render(); } }, true);
  document.addEventListener('compositionend', e => { if (e.target === editor()) { ime = false; syncSelection(); } }, true);
  document.addEventListener('input', e => {
    const ta = editor();
    if (e.target !== ta) return;
    if (pick) {
      const at = F.locate(ta.value, pick.text, pick.start);
      if (at < 0) pick.lost = true; else Object.assign(pick, { start: at, end: at + pick.text.length, lost: false });
      if (!composing && document.activeElement === ta) { const next = readPick(); pick = next || null; }
    }
    // 바꾼 곳을 사용자가 직접 고치면 되돌리기를 거둔다. 바꾸기·되돌리기가 스스로 낸 입력은 제외한다.
    if (applied && !working && F.locate(ta.value, applied.review.replacement, applied.at) < 0) finishApplied(false);
    render();
  }, true);
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== 'feedback:changed') return;
    reloadAttempt();
  });
  setInterval(() => {
    // 기다리는 동안 경과 시간을 갱신하고, 답변란 크기·스크롤 변화를 따라간다.
    if (shown === 'waiting' || shown === 'elsewhere') render(); else if (shown) place();
  }, 1000);
  setInterval(() => { if (!float.hidden && shown) place(); }, 300);
  setInterval(() => { if (attempt && (!attempt.reply || attempt.status !== 'sent')) reloadAttempt(); }, 5000);
  JSL.onState(sync);
  sync(null);
  JSL.getState().then(sync);
  let lastPath = location.pathname, lastEditor = editor();
  setInterval(() => {
    const current = editor();
    if (location.pathname !== lastPath || current !== lastEditor) {
      lastPath = location.pathname; lastEditor = current;
      if (!/^\/resume\/\d+\/?$/.test(lastPath) || !current) sync(null);
      else JSL.getState().then(sync);
    }
  }, 400);
});
