// 기업 채용 사이트 위에 띄우는 세로 복사 바 (구조 1안 + 디자인 A안).
// 서비스워커가 registerContentScripts로 등록해 두면 모든 탭에서 이 파일이 돈다.
//
// 사이트 DOM은 읽지도 쓰지도 않는다 — 입력칸을 찾아 넣는 게 아니라 우리 막대만 얹는다.
// 그래서 기업마다 따로 만들 필요가 없다. 붙여넣기는 사용자가 Ctrl+V로 한다.
// 스타일 충돌을 막으려고 Shadow DOM 안에서만 그린다 (AGENTS.md).
//
// 번호를 누르면 그 문항이 바로 복사된다 — 고른 뒤 복사를 또 누르지 않는다.
// 문항이 뭔지는 번호에 마우스를 올렸을 때 왼쪽에 뜨는 말풍선이 알려준다. 평소 폭은 48px 그대로다.
// 색은 주황과 무채색만 쓴다. 복사한 번호는 색을 더하는 대신 면을 걷어 뒤로 물린다.
(function () {
  'use strict';

  var HOST_ID = 'jsl-relay-host';
  var POS_KEY = 'jslRelayPos';
  var DOCS_KEY = 'jslRelayDocs';
  var ON_KEY = 'jslRelayOn';
  var P = globalThis.JSLRelayProfile;
  var PROFILE_KEY = 'jslRelayProfile';
  var profile = null, profileError = '', activeCategory = null;
  // 분류별로 고른 항목과 항목별 복사 진행. 이 탭에서만 기억하고 항목 내용이 바뀌면 새로 시작한다.
  var selectedRecord = {}, progress = {};
  // 패널 안 편집 상태. 입력 중인 값은 여기에 두어 storage 변경으로 다시 그려도 잃지 않는다.
  // field: 칸 하나 수정, new: 새 항목, delete: 삭제 확인, json: JSON 붙여넣기
  var edit = null, saving = false, notice = null;

  // 등록된 콘텐츠 스크립트라 페이지마다 한 번씩 돈다. 이미 붙어 있으면 그대로 둔다
  // (중복 주입 시 지워버리면 새로고침마다 깜빡인다).
  if (document.getElementById(HOST_ID)) return;

  var host = document.createElement('div');
  host.id = HOST_ID;
  // 사이트 CSS가 흘러들지 않게 한다. 위치만 우리가 정하고 나머지는 초기화.
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:50%;right:0;transform:translateY(-50%)';
  var root = host.attachShadow({ mode: 'open' });

  root.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0;',
    '  font-family:Pretendard,-apple-system,"Segoe UI",system-ui,sans-serif}',
    '.wrap{position:relative}',
    '.bar{display:flex;flex-direction:column;align-items:center;width:48px;',
    '  background:#292929;border:1px solid #3f3f3f;border-right:0;border-radius:14px 0 0 14px;',
    '  box-shadow:0 5px 17px #00000028;user-select:none}',
    // 손잡이 — 점 세 개보다 가로 선 두 줄이 "끌 수 있다"로 읽힌다
    '.grip{display:flex;flex-direction:column;gap:2px;align-items:center;',
    '  padding:9px 0 7px;cursor:grab;width:100%}',
    '.grip:active{cursor:grabbing}',
    '.grip i{display:block;width:13px;height:1.5px;border-radius:2px;background:#999}',
    '.chips{display:flex;flex-direction:column;gap:4px;padding:0 8px}',
    // 흰 채용 페이지에서도 패널과 번호가 보이도록 차콜 면과 밝은 글자를 쓴다.
    '.n{width:32px;height:30px;display:flex;align-items:center;justify-content:center;',
    '  border:0;border-radius:9px;background:#414141;color:#f3f3f3;',
    '  font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer;',
    '  transition:background-color .12s ease,color .12s ease}',
    // 복사한 것은 색을 더하지 않고 면을 걷어 뒤로 물린다
    '.n.done{background:transparent;color:#aaa}',
    '.n:hover{background:#ff6813;color:#fff;box-shadow:0 2px 8px rgba(255,104,19,.38)}',
    '.n:focus-visible{outline:2px solid #ff6813;outline-offset:2px}',
    '.x{width:34px;height:26px;display:flex;align-items:center;justify-content:center;',
    '  margin:5px 0 6px;border:0;background:transparent;border-radius:7px;',
    '  color:#aaa;font-size:11px;cursor:pointer}',
    '.x:hover{background:#414141;color:#fff}',
    // 말풍선 — 흰 카드 + 꼬리. 어두운 사이트 위에서도 흰 카드가 제일 확실하다.
    '.tip{position:absolute;right:56px;width:230px;max-width:calc(100vw - 64px);',
    '  background:#fff;border:1px solid #dedede;border-radius:11px;padding:10px 13px;',
    '  box-shadow:0 10px 30px rgba(0,0,0,.13);pointer-events:none;opacity:0;',
    '  transform:translateX(4px);transition:opacity .11s ease,transform .11s ease}',
    '.tip.on{opacity:1;transform:translateX(0)}',
    // 문항 대조용 앞부분만 두 줄로 표시한다. 복사할 답변 원문은 줄이지 않는다.
    '.tip .q{font-size:12px;font-weight:600;color:#1a1a1a;line-height:1.45;letter-spacing:-.01em;',
    '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;',
    '  max-height:34.8px;overflow:hidden;overflow-wrap:anywhere}',
    '.tip.status{width:max-content}',
    '.tip.copied .q{color:#ff6813}',
    '.tip::after{content:"";position:absolute;right:-5px;top:14px;width:9px;height:9px;background:#fff;',
    '  border-right:1px solid #dedede;border-top:1px solid #dedede;transform:rotate(45deg)}',
    '@media (prefers-reduced-motion: reduce){.n,.tip{transition:none}}',
    '.bar{max-height:calc(100dvh - 8px);overflow-y:auto;scrollbar-width:none}',
    '.divider{width:20px;border:0;border-top:1px solid #494949;margin:7px 0}',
    '.categories{display:flex;flex-direction:column;gap:4px}',
    '.category{width:32px;height:30px;padding:0;border:0;border-radius:9px;background:transparent;',
    'color:#ccc;font-size:10px;font-weight:500;letter-spacing:-.5px;cursor:pointer}',
    '.category[aria-expanded=true]{background:#414141;color:#fff}',
    '.category:hover{background:#ff6813;color:#fff}',
    'button:focus-visible{outline:2px solid #ff6813;outline-offset:2px}',
    '.profile-panel{position:absolute;right:56px;top:0;width:326px;max-width:calc(100vw - 64px);',
    'background:#292929;border:1px solid #3f3f3f;border-radius:14px;box-shadow:0 5px 17px #00000028;',
    'color:#f3f3f3;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#555 #292929}',
    '.profile-panel[hidden]{display:none}',
    '.profile-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #414141;font-size:14px;font-weight:600}',
    '.profile-head strong{flex:0 0 auto}',
    '.profile-head button,.profile-manage,.more{background:transparent;border:0;color:#aaa;cursor:pointer;font-size:11px;padding:3px 4px}',
    '.profile-head button:hover,.profile-manage:hover,.more:hover{color:#fff}',
    // 헤더 번호로 항목을 고르고, 필드는 세로 진행선 위에 둔다. 주황은 다음 칸 점과 호버에만 쓴다.
    '.profile-picks{flex:1;display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
    '.profile-head .pick{width:24px;height:24px;padding:0;border:1px solid #4a4a4a;border-radius:50%;background:transparent;color:#bbb;',
    'font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;cursor:pointer}',
    '.profile-head .pick:hover{border-color:#ff6813;color:#fff}',
    '.profile-head .pick.fin{color:#6f6f6f;border-style:dashed}',
    '.profile-head .pick[aria-pressed=true]{background:#f3f3f3;border:1px solid #f3f3f3;color:#1e1e1e}',
    '.record-title{padding:11px 16px 0}.record-title strong{display:block;font-size:13px;font-weight:600;overflow-wrap:anywhere}',
    '.record-meta{display:block;font-size:11px;color:#8a8a8a;font-variant-numeric:tabular-nums}',
    '.rail{list-style:none;margin:8px 14px 8px 22px;border-left:1px solid #474747}',
    '.step{position:relative;padding-left:6px}',
    '.step:before{content:"";position:absolute;left:-4px;top:13px;width:7px;height:7px;border-radius:50%;',
    'background:#292929;border:1.5px solid #5a5a5a}',
    '.step.done:before{background:#6a6a6a;border-color:#6a6a6a}.step.cur:before{background:#ff6813;border-color:#ff6813}',
    '.field{display:grid;grid-template-columns:52px minmax(0,1fr);column-gap:8px;align-items:baseline;width:100%;padding:6px 8px;',
    'border:0;border-radius:7px;background:transparent;color:#f3f3f3;text-align:left;font-size:12px;line-height:1.5;cursor:pointer}',
    '.field:hover{background:#333}.field-label{font-size:11px;color:#8f8f8f}',
    '.field-value{white-space:pre-wrap;overflow-wrap:anywhere}',
    '.step.done .field{color:#7d7d7d}.step.done .field-label{color:#6f6f6f}',
    '.step.cur .field:not(.long) .field-value{font-size:13.5px;font-weight:700}',
    '.field:disabled{opacity:.55;cursor:default;background:transparent}',
    '.field.long .field-value{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.field.long.expanded .field-value{display:block}',
    '.step.cur .field{background:#333}',
    '.step-actions{display:flex;align-items:center;gap:6px;padding:0 8px 6px 68px}.step-actions:empty{display:none}.more{margin-left:auto}',
    // 복사하고 다음은 패널 아래 같은 자리에 고정한다. 지금 복사할 값과 평평한 주황 단색 버튼만 둔다.
    '.profile-bottom{position:sticky;bottom:0;background:#292929;border-top:1px solid #3a3a3a}',
    '.dock{padding:12px 12px 2px}',
    '.dock-head{display:flex;align-items:flex-start;gap:8px;margin:0 2px 10px}',
    '.dock-restart{flex:0 0 auto;padding:1px 0;border:0;background:transparent;color:#aaa;font-size:11px;cursor:pointer}',
    '.dock-restart:hover{color:#fff;text-decoration:underline}',
    '.dock-value{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:1.4;letter-spacing:-.01em;color:#f3f3f3;white-space:pre-wrap;overflow-wrap:anywhere;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.dock-value.finished{font-size:12.5px;font-weight:500;line-height:1.5;color:#aaa;word-break:keep-all}',
    '.dock-value.enter{animation:dock-in .16s ease-out}@keyframes dock-in{from{opacity:.3}to{opacity:1}}',
    '.next{display:block;width:100%;height:42px;border:0;border-radius:9px;background:#ff6813;color:#fff;',
    'font-size:13.5px;font-weight:600;letter-spacing:-.01em;cursor:pointer;transition:background-color .12s ease}',
    '.next:hover{background:#f05f0c}',
    '.next:focus-visible{outline:2px solid #f3f3f3;outline-offset:2px}',
    '@media (prefers-reduced-motion: reduce){.dock-value.enter{animation:none}.next{transition:none}}',
    '.profile-footer{padding:10px 12px;display:flex;gap:6px;align-items:center;font-size:11px;color:#aaa}',
    '.profile-status{flex:1;overflow-wrap:anywhere}.profile-status.error{color:#ff9a5c}',
    '.profile-empty{padding:16px;font-size:12px;line-height:1.6;color:#ccc;word-break:keep-all}',
    // 패널 안 편집: 입력칸은 어두운 면, 저장·추가만 주황 단색으로 둔다.
    '.profile-head .pick.add{border-style:dashed;color:#aaa}',
    '.profile-head .pick.add[aria-pressed=true]{border-style:solid}',
    '.record-row{display:flex;align-items:baseline;gap:8px}.record-row strong{flex:1;min-width:0}',
    '.title-action{flex:0 0 auto;padding:2px 0;border:0;background:transparent;color:#8a8a8a;font-size:11px;cursor:pointer}',
    '.title-action:hover{color:#fff}',
    '.delete-ask{display:flex;align-items:center;gap:6px;margin-top:6px;padding:6px 6px 6px 10px;border-radius:8px;background:#333;font-size:11.5px;color:#ddd}',
    '.delete-ask span{flex:1}',
    '.mini{height:26px;padding:0 10px;border:1px solid #4a4a4a;border-radius:6px;background:transparent;color:#ddd;font-size:11px;cursor:pointer}',
    '.mini.primary{border-color:#ff6813;background:#ff6813;color:#fff}',
    '.step .field{padding-right:32px}',
    '.pen{position:absolute;right:2px;top:4px;height:22px;min-width:26px;padding:0 6px;border:0;border-radius:6px;',
    'background:#444;color:#f3f3f3;font-size:12px;cursor:pointer;opacity:0}',
    '.step:hover .pen,.pen:focus-visible{opacity:1}.pen:hover{background:#ff6813;color:#fff}',
    '.field-edit{display:grid;grid-template-columns:52px minmax(0,1fr) 26px 26px;gap:6px;align-items:center;padding:4px 2px 2px 8px}',
    '.field-edit:has(textarea){align-items:start}',
    '.edit-input{width:100%;min-width:0;height:30px;padding:0 8px;border:1px solid #4a4a4a;border-radius:7px;background:#1f1f1f;',
    'color:#f3f3f3;font-size:12.5px;line-height:1.5;font-family:inherit}',
    'textarea.edit-input{height:auto;padding:6px 8px;resize:vertical}',
    '.edit-input:focus{outline:none;border-color:#ff6813}',
    '.edit-ok,.edit-cancel{height:26px;border:0;border-radius:6px;font-size:12px;cursor:pointer}',
    '.edit-ok{background:#ff6813;color:#fff}.edit-cancel{background:#3d3d3d;color:#ddd}',
    '.edit-hint{padding:2px 8px 6px 66px;font-size:10.5px;color:#888}',
    '.edit-variants{display:flex;gap:4px;padding:8px 16px 0}',
    '.variant{height:26px;padding:0 10px;border:1px solid #4a4a4a;border-radius:999px;background:transparent;color:#bbb;font-size:11px;cursor:pointer}',
    '.variant[aria-pressed=true]{background:#f3f3f3;border-color:#f3f3f3;color:#1e1e1e}',
    '.edit-form{display:flex;flex-direction:column;gap:8px;padding:10px 14px 12px}',
    '.edit-row{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;align-items:center}.edit-row:has(textarea){align-items:start}',
    '.edit-label{font-size:11px;color:#9a9a9a;overflow-wrap:anywhere}',
    '.btns{display:flex;gap:8px}',
    '.solid{flex:1;width:100%;height:42px;border:0;border-radius:9px;background:#ff6813;color:#fff;font-size:13.5px;font-weight:600;cursor:pointer}',
    '.solid:hover{background:#f05f0c}',
    '.ghost{flex:0 0 auto;height:42px;padding:0 16px;border:1px solid #4a4a4a;border-radius:9px;background:transparent;color:#ddd;font-size:13px;cursor:pointer}',
    '.ghost:hover{background:#333}',
    '.solid:disabled,.ghost:disabled,.mini:disabled,.edit-ok:disabled{opacity:.5;cursor:default}',
    '.json{padding:10px 14px 12px}',
    '.json-help{font-size:11px;line-height:1.55;color:#9a9a9a;word-break:keep-all}',
    '.json-sample{margin:6px 0 8px;padding:0;border:0;background:transparent;color:#ccc;font-size:11px;text-decoration:underline;cursor:pointer}',
    '.json-area{min-height:150px;font:11px/1.5 Consolas,"SFMono-Regular",monospace}',
    '.json-error{margin-top:8px;padding:8px 10px;border-radius:8px;background:#3a2a22;color:#ffb38a;font-size:11.5px;line-height:1.5;overflow-wrap:anywhere}',
    '.json-preview{margin-top:8px;padding:9px 10px;border-radius:8px;background:#333;font-size:11.5px;line-height:1.55;overflow-wrap:anywhere}',
    '.json-preview strong{display:block;margin-bottom:2px;font-size:12.5px}',
    '.json-line b{margin-right:6px;color:#fff}.json-line span{color:#bbb}.json-note{color:#9a9a9a}',
    '</style>',
    '<div class="wrap"><div class="bar"></div><section class="profile-panel" aria-label="내 이력" hidden></section><div class="tip"></div></div>'
  ].join('');

  // 패널 입력칸의 키 입력이 사이트 단축키로 올라가지 않게 shadow root에서 멈춘다.
  // (캡처 단계로 먼저 듣는 사이트 스크립트까지 막을 수는 없다.)
  ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'cut', 'copy'].forEach(function (type) {
    root.addEventListener(type, function (e) { if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.stopPropagation(); });
  });

  var bar = root.querySelector('.bar');
  var tip = root.querySelector('.tip');
  var panel = root.querySelector('.profile-panel');
  var data = null;
  var copied = {};      // 이번 세션에 복사한 문항 번호
  var mounted = false;
  var tipTimer = null;

  function showTip(chip, titleText, kind) {
    tip.textContent = '';
    tip.classList.toggle('status', !!kind);
    tip.classList.toggle('copied', kind === 'copied');
    var q = document.createElement('div');
    q.className = 'q';
    q.textContent = titleText.replace(/\s+/g, ' ').trim(); // 표시만 정리하고 사용자 데이터는 textContent로 넣는다
    tip.appendChild(q);
    // 꼬리가 그 번호를 정확히 가리키게 세로 위치를 맞춘다.
    tip.style.top = (chip.getBoundingClientRect().top - host.getBoundingClientRect().top + chip.offsetHeight / 2 - 19) + 'px';
    tip.classList.add('on');
  }

  function hideTip() { tip.classList.remove('on'); }

  function placePanel() {
    if (!mounted) return;
    var height = window.innerHeight;
    var rect = host.getBoundingClientRect();
    if (rect.top < 4 || rect.bottom > height - 4) {
      host.style.top = Math.max(4, Math.min(rect.top, height - bar.offsetHeight - 4)) + 'px';
      host.style.transform = 'none';
    }
    if (panel.hidden) return;
    panel.style.maxHeight = Math.max(80, height - 16) + 'px';
    var top = host.getBoundingClientRect().top;
    panel.style.top = (Math.max(8, Math.min(top, height - panel.offsetHeight - 8)) - top) + 'px';
  }

  function element(tag, className, text) {
    var el = document.createElement(tag); el.className = className || '';
    if (text != null) el.textContent = text;
    if (tag === 'button') el.type = 'button';
    return el;
  }

  function nextField(record, after) {
    for (var i = after + 1; i < record.fields.length; i++) if (record.fields[i][1]) return i;
    return -1;
  }

  function progressKey(category, index, record) { return category + '\n' + index + '\n' + JSON.stringify(record); }

  function progressOf(index, record) {
    var key = progressKey(activeCategory, index, record);
    return progress[key] || (progress[key] = { done: {}, next: nextField(record, -1) });
  }

  function finished(record, state) {
    return record.fields.some(function (pair) { return pair[1]; }) &&
      record.fields.every(function (pair, i) { return !pair[1] || state.done[i]; });
  }

  // 제목 아래에는 날짜 필드(시작일·종료일·취득일 등)만 이어서 보여 항목을 구분한다.
  function recordMeta(record) {
    return record.fields.filter(function (pair) { return /일(자)?$/.test(pair[0]) && pair[1]; })
      .map(function (pair) { return pair[1]; }).join(' – ');
  }

  // 저장 결과 안내는 저장 직후 storage 변경으로 다시 그려져도 잠시 유지한다.
  function note(text, error) { notice = { text: text, error: !!error, until: Date.now() + (error ? 8000 : 4000) }; }
  function say(text, error) {
    note(text, error);
    var status = panel.querySelector('.profile-status');
    if (status) { status.textContent = text; status.classList.toggle('error', !!error); }
  }

  function focusOn(key) {
    var el = panel.querySelector('[data-focus="' + key + '"]');
    if (el) { el.focus({ preventScroll: true }); if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); }
  }

  function cancelEdit() { edit = null; renderProfile(); }

  function textInput(label, value, multiline, focusKey, onInput) {
    var input = element(multiline ? 'textarea' : 'input', 'edit-input');
    if (multiline) input.rows = 4; else input.type = 'text';
    input.value = value; input.maxLength = 10000; input.spellcheck = false;
    input.setAttribute('aria-label', label); input.dataset.focus = focusKey;
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  }

  // 항상 최신 저장본을 읽어 고친 뒤 검증·저장하고 다시 읽어 확인한다. 다른 탭의 변경을 덮어쓰지 않는다.
  function saveProfile(mutate) {
    return chrome.storage.local.get(PROFILE_KEY).then(function (items) {
      var current = items[PROFILE_KEY] == null ? P.empty() : P.validate(items[PROFILE_KEY]);
      var value = P.validate(mutate(JSON.parse(JSON.stringify(current))));
      var change = {}; change[PROFILE_KEY] = value;
      return chrome.storage.local.set(change).then(function () { return chrome.storage.local.get(PROFILE_KEY); }).then(function (check) {
        if (JSON.stringify(P.validate(check[PROFILE_KEY])) !== JSON.stringify(value)) throw new Error('저장한 내용을 다시 읽어 확인하지 못했습니다.');
        return value;
      });
    });
  }

  function run(mutate, done) {
    if (saving) return;
    saving = true;
    panel.querySelectorAll('.btns button, .edit-ok, .mini').forEach(function (b) { b.disabled = true; });
    var pending;
    try { pending = saveProfile(mutate); } catch (e) { pending = Promise.reject(e); }
    pending.then(function (value) {
      saving = false; profile = value; profileError = '';
      done(value); renderProfile();
    }, function (e) {
      saving = false; renderProfile();
      var message = e && e.message ? e.message : String(e);
      if (/context invalidated/i.test(message) || !(globalThis.chrome && chrome.runtime && chrome.runtime.id)) message = '확장을 다시 로드한 뒤 페이지를 새로고침해 주세요.';
      say('저장하지 못했습니다. ' + message, true);
    });
  }

  function renderProfile() {
    var active = root.activeElement, focusKey = active && active.dataset ? active.dataset.focus : null;
    var selStart = focusKey && typeof active.selectionStart === 'number' ? active.selectionStart : null, selEnd = selStart == null ? null : active.selectionEnd;
    var keepScroll = edit ? panel.scrollTop : 0;
    panel.replaceChildren(); panel.hidden = !activeCategory;
    root.querySelectorAll('.category').forEach(function (b) { b.setAttribute('aria-expanded', String(b.textContent === activeCategory)); });
    if (!activeCategory) return;
    hideTip();
    var category = activeCategory;
    if (edit && edit.category !== category) edit = null;
    var list = profile ? profile.categories[category] : [];
    var index = Math.max(0, Math.min(selectedRecord[category] || 0, list.length - 1));
    selectedRecord[category] = index;
    var heading = element('div', 'profile-head');
    heading.appendChild(element('strong', '', category));
    var choices = element('div', 'profile-picks');
    list.forEach(function (record, i) {
      var b = element('button', 'pick', String(i + 1));
      b.title = record.title; b.setAttribute('aria-label', (i + 1) + '. ' + record.title);
      b.setAttribute('aria-pressed', String(i === index && !(edit && edit.kind !== 'field' && edit.kind !== 'delete')));
      if (finished(record, progressOf(i, record))) b.classList.add('fin');
      b.addEventListener('click', function () { edit = null; selectedRecord[category] = i; renderProfile(); });
      choices.appendChild(b);
    });
    if (profile && !profileError && list.length < 50) {
      var add = element('button', 'pick add', '+'); add.setAttribute('aria-label', category + ' 추가');
      add.setAttribute('aria-pressed', String(!!(edit && edit.kind === 'new')));
      add.addEventListener('click', function () { startNew(category, ''); });
      choices.appendChild(add);
    }
    heading.appendChild(choices);
    var collapse = element('button', '', '접기');
    collapse.addEventListener('click', function () { edit = null; activeCategory = null; renderProfile(); });
    heading.appendChild(collapse); panel.appendChild(heading);
    var feedback = element('span', 'profile-status', '값을 누르면 복사하고 다음 칸으로'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    var bottom = element('div', 'profile-bottom');
    if (profileError) panel.appendChild(element('p', 'profile-empty', profileError));
    else if (edit && edit.kind === 'json') renderJson(category, feedback, bottom);
    else if (edit && edit.kind === 'new') renderNew(category, feedback, bottom);
    else if (!list.length) renderEmpty(category, bottom);
    else renderRecord(list[index], index, feedback, bottom);
    if (notice && notice.until > Date.now()) { feedback.textContent = notice.text; feedback.classList.toggle('error', notice.error); }
    var footer = element('div', 'profile-footer'); footer.appendChild(feedback);
    if (profile && !profileError && !(edit && edit.kind === 'json')) {
      var json = element('button', 'profile-manage', 'JSON으로 추가');
      json.addEventListener('click', function () { edit = { kind: 'json', category: category, text: '', preview: null, error: '' }; renderProfile(); focusOn('json'); });
      footer.appendChild(json);
    }
    bottom.appendChild(footer); panel.appendChild(bottom);
    if (keepScroll) panel.scrollTop = keepScroll;
    if (focusKey) {
      var again = panel.querySelector('[data-focus="' + focusKey + '"]');
      if (again) { again.focus({ preventScroll: true }); if (selStart != null && again.setSelectionRange) again.setSelectionRange(selStart, selEnd); }
    }
    placePanel();
  }

  function renderEmpty(category, bottom) {
    panel.appendChild(element('p', 'profile-empty', '등록된 ' + category + ' 정보가 없습니다. 아래에서 바로 추가하거나 JSON으로 여러 개를 넣을 수 있습니다.'));
    var dock = element('div', 'dock'), add = element('button', 'solid', '+ ' + category + ' 추가');
    add.addEventListener('click', function () { startNew(category, ''); });
    dock.appendChild(add); bottom.appendChild(dock);
  }

  function startNew(category, variant) {
    var labels = variant ? P.alternates[category][variant] : P.templates[category];
    edit = { kind: 'new', category: category, variant: variant, labels: labels.slice(), values: labels.map(function () { return ''; }) };
    renderProfile(); focusOn('new-0');
  }

  // 새 항목: 분류의 기본 칸을 채우고 추가한다. 첫 칸이 항목 이름이 된다.
  function renderNew(category, feedback, bottom) {
    var draft = edit;
    var title = element('div', 'record-title'); title.appendChild(element('strong', '', '새 ' + category)); panel.appendChild(title);
    var alternates = P.alternates[category];
    if (alternates) {
      var variants = element('div', 'edit-variants');
      [['', category === '어학' ? '공인시험' : '기본']].concat(Object.keys(alternates).map(function (name) { return [name, name]; })).forEach(function (option) {
        var b = element('button', 'variant', option[1]); b.setAttribute('aria-pressed', String(draft.variant === option[0]));
        b.addEventListener('click', function () { if (draft.variant !== option[0]) startNew(category, option[0]); });
        variants.appendChild(b);
      });
      panel.appendChild(variants);
    }
    var form = element('div', 'edit-form');
    draft.labels.forEach(function (label, i) {
      var row = element('label', 'edit-row'); row.appendChild(element('span', 'edit-label', label));
      var multiline = /내용|내역/.test(label);
      var input = textInput(label, draft.values[i], multiline, 'new-' + i, function (value) { draft.values[i] = value; });
      if (i === 0) input.maxLength = 200;
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
        else if (e.key === 'Enter' && !e.isComposing && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); addNew(); }
      });
      row.appendChild(input); form.appendChild(row);
    });
    panel.appendChild(form);
    var dock = element('div', 'dock'), btns = element('div', 'btns');
    var cancel = element('button', 'ghost', '취소'), ok = element('button', 'solid', '추가');
    cancel.addEventListener('click', cancelEdit); ok.addEventListener('click', addNew);
    btns.appendChild(cancel); btns.appendChild(ok); dock.appendChild(btns); bottom.appendChild(dock);
    feedback.textContent = '첫 칸(' + draft.labels[0] + ')이 항목 이름이 됩니다';
    function addNew() {
      var labels = draft.labels.slice(), values = draft.values.slice();
      if (!values[0].trim()) { say(labels[0] + ' 칸을 입력해 주세요.', true); focusOn('new-0'); return; }
      run(function (data) {
        var records = data.categories[category];
        if (records.length >= 50) throw new Error('분류별 최대 50개까지 등록할 수 있습니다.');
        var record = { title: values[0].slice(0, 200), fields: labels.map(function (label, i) { return [label, values[i]]; }) };
        if (records.some(function (item) { return JSON.stringify(item) === JSON.stringify(record); })) throw new Error('같은 항목이 이미 있습니다.');
        records.push(record);
        return data;
      }, function (value) {
        edit = null; selectedRecord[category] = value.categories[category].length - 1;
        note(values[0] + ' 추가됨');
      });
    }
  }

  function jsonSample(category) {
    var sample = { version: 1, categories: {} };
    sample.categories[category] = [{ fields: P.templates[category].map(function (label) { return [label, '']; }) }];
    return JSON.stringify(sample, null, 1);
  }

  function summarize(base, result) {
    var added = {}, total = 0;
    P.categories.forEach(function (name) {
      added[name] = result.value.categories[name].slice(base.categories[name].length).map(function (record) { return record.title; });
      total += added[name].length;
    });
    return { added: added, total: total, duplicates: result.duplicates, conflicts: result.conflicts };
  }

  // JSON 추가는 확인(미리보기) → 추가하고 저장 두 단계다. 확인 뒤 글을 고치면 미리보기를 지운다.
  function renderJson(category, feedback, bottom) {
    var draft = edit;
    var title = element('div', 'record-title'); title.appendChild(element('strong', '', 'JSON으로 추가')); panel.appendChild(title);
    var box = element('div', 'json');
    box.appendChild(element('p', 'json-help', '저장 형식의 JSON을 붙여넣으세요. 여러 분류를 한 번에 넣을 수 있고 각 항목의 첫 칸이 이름이 됩니다. 이미 있는 같은 항목과 이름이 같은 항목은 건너뜁니다.'));
    var sample = element('button', 'json-sample', category + ' 형식 예시 넣기');
    sample.addEventListener('click', function () {
      if (draft.text.trim()) { say('입력칸을 비운 뒤 예시를 넣을 수 있습니다.', true); return; }
      draft.text = jsonSample(category); draft.preview = null; draft.error = ''; renderProfile(); focusOn('json');
    });
    box.appendChild(sample);
    var area = textInput('붙여넣을 이력 JSON', draft.text, true, 'json', function (value) {
      draft.text = value;
      if (draft.preview || draft.error) { draft.preview = null; draft.error = ''; renderProfile(); }
    });
    area.maxLength = 400000; area.rows = 9; area.classList.add('json-area');
    area.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); if (!draft.preview) check(); } });
    box.appendChild(area);
    if (draft.error) { var error = element('p', 'json-error', draft.error); error.setAttribute('role', 'alert'); box.appendChild(error); }
    if (draft.preview) {
      var preview = element('div', 'json-preview'), result = draft.preview;
      preview.appendChild(element('strong', '', result.total ? result.total + '개를 추가합니다' : '추가할 새 항목이 없습니다'));
      P.categories.forEach(function (name) {
        if (!result.added[name].length) return;
        var line = element('div', 'json-line');
        line.appendChild(element('b', '', name + ' ' + result.added[name].length));
        line.appendChild(element('span', '', result.added[name].join(', ')));
        preview.appendChild(line);
      });
      if (result.duplicates) preview.appendChild(element('div', 'json-note', '이미 있는 같은 항목 ' + result.duplicates + '개는 건너뜁니다'));
      if (result.conflicts.length) preview.appendChild(element('div', 'json-note', '이름이 같아 제외: ' + result.conflicts.join(', ')));
      box.appendChild(preview);
    }
    panel.appendChild(box);
    var dock = element('div', 'dock'), btns = element('div', 'btns');
    var left, right;
    if (!draft.preview) {
      left = element('button', 'ghost', '취소'); left.addEventListener('click', cancelEdit);
      right = element('button', 'solid', '확인'); right.addEventListener('click', check);
    } else {
      left = element('button', 'ghost', '다시 편집');
      left.addEventListener('click', function () { draft.preview = null; renderProfile(); focusOn('json'); });
      right = element('button', 'solid', draft.preview.total ? '추가하고 저장' : '닫기');
      right.addEventListener('click', draft.preview.total ? commit : cancelEdit);
    }
    btns.appendChild(left); btns.appendChild(right); dock.appendChild(btns); bottom.appendChild(dock);
    feedback.textContent = draft.preview ? '내용을 확인한 뒤 저장하세요' : '확인을 누르면 저장 전에 미리 보여 줍니다';
    if (draft.preview || draft.error) {
      var shown = box.querySelector('.json-preview, .json-error');
      requestAnimationFrame(function () { if (shown.isConnected) panel.scrollTop = Math.max(0, shown.offsetTop - 80); });
    }
    function check() {
      if (!draft.text.trim()) { draft.error = 'JSON을 붙여넣어 주세요.'; renderProfile(); return; }
      try { draft.preview = summarize(profile, P.merge(profile, draft.text)); draft.error = ''; }
      catch (e) { draft.preview = null; draft.error = e.message; }
      renderProfile();
    }
    function commit() {
      var text = draft.text, result = null;
      run(function (data) {
        var merged = P.merge(data, text);
        result = summarize(data, merged);
        if (!result.total) throw new Error('추가할 새 항목이 없습니다.');
        return merged.value;
      }, function (value) {
        var names = P.categories.filter(function (name) { return result.added[name].length; });
        edit = null;
        if (names.length) { activeCategory = names[0]; selectedRecord[names[0]] = value.categories[names[0]].length - result.added[names[0]].length; }
        note(names.map(function (name) { return name + ' ' + result.added[name].length + '개'; }).join(', ') + '를 추가했습니다');
      });
    }
  }

  // 값을 누르면 복사하고 다음 빈칸 아닌 필드로 넘어간다. 칸의 ✎로 그 값만 고쳐 바로 저장한다.
  // 핵심 동작인 '복사하고 다음'은 위치를 옮기지 않고 패널 아래에 고정해, 지금 복사할 값을 함께 보여준다.
  function renderRecord(record, index, feedback, bottom) {
    var category = activeCategory, state = progressOf(index, record);
    var title = element('div', 'record-title'), row = element('div', 'record-row');
    row.appendChild(element('strong', '', record.title));
    var deleting = edit && edit.kind === 'delete' && edit.index === index;
    if (!deleting) {
      var remove = element('button', 'title-action', '삭제'); remove.setAttribute('aria-label', record.title + ' 삭제');
      remove.addEventListener('click', function () { edit = { kind: 'delete', category: category, index: index, snapshot: JSON.stringify(record) }; renderProfile(); });
      row.appendChild(remove);
    }
    title.appendChild(row);
    var meta = recordMeta(record);
    if (meta) title.appendChild(element('span', 'record-meta', meta));
    if (deleting) {
      var ask = element('div', 'delete-ask'), no = element('button', 'mini', '취소'), yes = element('button', 'mini primary', '삭제');
      ask.appendChild(element('span', '', '이 항목을 삭제할까요?'));
      yes.setAttribute('aria-label', '삭제 확인');
      no.addEventListener('click', cancelEdit);
      yes.addEventListener('click', function () {
        var snapshot = edit.snapshot;
        run(function (data) {
          var records = data.categories[category];
          if (JSON.stringify(records[index]) !== snapshot) throw new Error('다른 탭에서 이 항목이 바뀌었습니다. 확인한 뒤 다시 시도해 주세요.');
          records.splice(index, 1);
          return data;
        }, function () { edit = null; selectedRecord[category] = Math.max(0, index - 1); note(record.title + ' 삭제됨'); });
      });
      ask.appendChild(no); ask.appendChild(yes); title.appendChild(ask);
    }
    panel.appendChild(title);
    var rail = element('ol', 'rail'), steps = [];
    record.fields.forEach(function (pair, i) {
      var label = pair[0], value = pair[1];
      var step = element('li', 'step'), actions = element('div', 'step-actions');
      if (edit && edit.kind === 'field' && edit.index === index && edit.field === i) {
        var draft = edit, multiline = /내용|내역/.test(label) || /[\r\n]/.test(draft.draft) || draft.draft.length > 65;
        var box = element('div', 'field-edit');
        box.appendChild(element('span', 'field-label', label));
        var input = textInput(label, draft.draft, multiline, 'field', function (next) { draft.draft = next; });
        if (i === 0) input.maxLength = 200;
        var ok = element('button', 'edit-ok', '✓'), no = element('button', 'edit-cancel', '✕');
        ok.setAttribute('aria-label', label + ' 저장'); no.setAttribute('aria-label', label + ' 수정 취소');
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          else if (e.key === 'Enter' && !e.isComposing && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); saveField(); }
        });
        ok.addEventListener('click', saveField); no.addEventListener('click', cancelEdit);
        box.appendChild(input); box.appendChild(ok); box.appendChild(no); step.appendChild(box);
        step.appendChild(element('div', 'edit-hint', multiline ? 'Ctrl+Enter 저장 · Esc 취소' : 'Enter 저장 · Esc 취소'));
        steps.push(step); rail.appendChild(step);
        return;
      }
      var b = element('button', 'field'); b.setAttribute('aria-label', label + ' 복사');
      b.appendChild(element('span', 'field-label', label));
      b.appendChild(element('span', 'field-value', value || '미입력'));
      b.disabled = !value;
      b.addEventListener('click', function () { copyField(i); });
      var pen = element('button', 'pen', '✎'); pen.setAttribute('aria-label', label + ' 수정');
      pen.addEventListener('click', function () {
        edit = { kind: 'field', category: category, index: index, field: i, snapshot: JSON.stringify(record), draft: value };
        renderProfile(); focusOn('field');
      });
      step.appendChild(b); step.appendChild(pen); step.appendChild(actions);
      if (value.length > 65) {
        b.classList.add('long');
        var more = element('button', 'more', '전체 보기'); more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', function () {
          var expanded = b.classList.toggle('expanded'); more.textContent = expanded ? '접기' : '전체 보기'; more.setAttribute('aria-expanded', String(expanded)); placePanel();
        }); actions.appendChild(more);
      }
      steps.push(step); rail.appendChild(step);
    });
    panel.appendChild(rail);

    function saveField() {
      var i = edit.field, next = edit.draft, snapshot = edit.snapshot, label = record.fields[i][0];
      if (i === 0 && !next.trim()) { say(label + ' 칸은 비울 수 없습니다.', true); focusOn('field'); return; }
      if (next === record.fields[i][1]) { cancelEdit(); return; }
      run(function (data) {
        var current = data.categories[category][index];
        if (!current || JSON.stringify(current) !== snapshot) throw new Error('다른 탭에서 이 항목이 바뀌었습니다. 취소한 뒤 다시 수정해 주세요.');
        current.fields[i][1] = next;
        if (i === 0) current.title = next.slice(0, 200);
        return data;
      }, function (value) {
        // 고친 항목의 복사 진행은 이어서 쓴다. 다음 칸이 비었으면 그 뒤로 옮긴다.
        var updated = value.categories[category][index], old = progress[progressKey(category, index, record)];
        if (old && updated) {
          if (old.next !== -1 && !updated.fields[old.next][1]) old.next = nextField(updated, old.next);
          progress[progressKey(category, index, updated)] = old;
        }
        edit = null; note(label + ' 수정됨');
      });
    }

    var list = profile.categories[category], target = -1;
    var dock = element('div', 'dock'), dockHead = element('div', 'dock-head');
    var shown = element('div', 'dock-value'), restart = element('button', 'dock-restart', '처음부터 다시'), next = element('button', 'next');
    dockHead.appendChild(shown); dockHead.appendChild(restart);
    dock.appendChild(dockHead); dock.appendChild(next); bottom.appendChild(dock);

    // 마지막 칸 뒤에는 같은 자리의 버튼으로 다음 항목에 넘어간다. 뒤에 항목이 없으면 앞의 끝나지 않은 항목으로 돌아간다.
    function nextRecord() {
      if (index + 1 < list.length) return index + 1;
      for (var j = 0; j < index; j++) if (!finished(list[j], progressOf(j, list[j]))) return j;
      return -1;
    }

    function sync(reveal) {
      steps.forEach(function (step, i) {
        step.classList.toggle('done', !!state.done[i]);
        step.classList.toggle('cur', i === state.next);
      });
      shown.classList.remove('enter');
      restart.hidden = true; target = -1;
      if (state.next === -1) {
        target = nextRecord();
        shown.className = 'dock-value finished';
        if (target === -1) {
          shown.textContent = '마지막 칸까지 복사했습니다';
          next.textContent = '처음부터 다시'; next.setAttribute('aria-label', '처음부터 다시');
        } else {
          shown.textContent = '마지막 칸까지 복사했습니다\n다음은 ' + list[target].title;
          next.textContent = '다음 ' + category + '으로';
          next.setAttribute('aria-label', (target + 1) + '번 ' + category + '으로 넘어가기');
          restart.hidden = false;
        }
      } else {
        var label = record.fields[state.next][0];
        shown.className = 'dock-value'; shown.textContent = record.fields[state.next][1];
        next.textContent = '복사하고 다음'; next.setAttribute('aria-label', label + ' 복사하고 다음 칸으로');
        if (reveal) {
          void shown.offsetWidth; shown.classList.add('enter');
          var step = steps[state.next], top = step.offsetTop, end = top + step.offsetHeight;
          var visible = panel.clientHeight - bottom.offsetHeight;
          if (top < panel.scrollTop) panel.scrollTop = top - 8;
          else if (end > panel.scrollTop + visible) panel.scrollTop = end - visible + 8;
        }
      }
      var chosen = panel.querySelector('.pick[aria-pressed=true]');
      if (chosen) chosen.classList.toggle('fin', finished(record, state));
      placePanel();
    }
    function copyField(i) {
      var label = record.fields[i][0];
      writeClipboard(record.fields[i][1]).then(function () {
        state.done[i] = true; state.next = nextField(record, i);
        if (dock.isConnected) { say(label + ' 복사됨' + (state.next === -1 ? ' · 마지막 칸' : '')); sync(true); }
      }, function () { say('복사하지 못했습니다. 다시 눌러 주세요.', true); });
    }
    function startOver() {
      state.done = {}; state.next = nextField(record, -1);
      say('처음 칸부터 다시 복사합니다'); panel.scrollTop = 0; sync(false);
    }
    next.addEventListener('click', function () {
      if (state.next !== -1) { copyField(state.next); return; }
      if (target === -1) { startOver(); return; }
      var focused = root.activeElement === next, moved = target;
      edit = null; selectedRecord[category] = moved; note((moved + 1) + '번 ' + category + '으로 넘어왔습니다');
      renderProfile(); panel.scrollTop = 0;
      var again = panel.querySelector('.next');
      if (focused && again) again.focus({ preventScroll: true });
    });
    restart.addEventListener('click', startOver);
    sync(false);
  }

  function readProfile(items) {
    try {
      if (!P) throw new Error('확장을 다시 로드한 뒤 페이지를 새로고침해 주세요.');
      profile = items[PROFILE_KEY] == null ? P.empty() : P.validate(items[PROFILE_KEY]);
      profileError = '';
    } catch (e) { profile = null; profileError = '내 이력을 읽지 못했습니다. ' + e.message; }
  }

  function writeClipboard(text) {
    return Promise.resolve().then(function () {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      throw new Error('clipboard unavailable');
    }).catch(function () { if (!execFallback(text)) throw new Error('copy failed'); });
  }

  function copyQna(q, chip) {
    var text = q.answer || '';
    function ok() {
      copied[q.number] = true;
      chip.classList.add('done');
      showTip(chip, '복사됨', 'copied');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 1500);
    }
    function fail() {
      showTip(chip, '복사하지 못했습니다', 'error');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 2200);
    }
    writeClipboard(text).then(ok, fail);
  }

  // navigator.clipboard가 막힌 사이트(권한 정책 등)를 위한 폴백.
  function execFallback(text) {
    var previous = root.activeElement;
    var ta;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      root.appendChild(ta);
      ta.select();
      var done = document.execCommand('copy');
      return done;
    } catch (e) { return false; }
    finally { if (ta) ta.remove(); if (previous && previous.isConnected) previous.focus({ preventScroll: true }); }
  }

  function render() {
    bar.textContent = '';
    hideTip();

    var grip = document.createElement('div');
    grip.className = 'grip';
    grip.title = '끌어서 위아래로 옮기기';
    grip.appendChild(document.createElement('i'));
    grip.appendChild(document.createElement('i'));
    bar.appendChild(grip);
    enableDrag(grip);

    var chips = document.createElement('div');
    chips.className = 'chips';
    data.qnas.forEach(function (q) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'n' + (copied[q.number] ? ' done' : '');
      chip.textContent = q.number;
      var label = q.question || ('문항 ' + q.number);
      chip.setAttribute('aria-label', label + ' 복사');
      chip.addEventListener('mouseenter', function () {
        clearTimeout(tipTimer);
        showTip(chip, label);
      });
      chip.addEventListener('mouseleave', function () {
        clearTimeout(tipTimer);
        tipTimer = setTimeout(hideTip, 80);
      });
      chip.addEventListener('click', function () { copyQna(q, chip); });
      chips.appendChild(chip);
    });
    bar.appendChild(chips);
    bar.appendChild(element('hr', 'divider'));
    var categories = element('div', 'categories');
    ['어학', '자격증', '수상', '교육'].forEach(function (name) {
      var button = element('button', 'category', name);
      button.setAttribute('aria-expanded', String(activeCategory === name));
      button.addEventListener('click', function () { edit = null; activeCategory = activeCategory === name ? null : name; renderProfile(); });
      categories.appendChild(button);
    });
    bar.appendChild(categories);

    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '✕';
    x.title = '모든 탭에서 닫기';
    x.setAttribute('aria-label', x.title);
    // ✕는 이 탭만이 아니라 전부 끈다 — 다른 탭의 막대는 storage 변화를 보고 스스로 사라진다.
    x.addEventListener('click', function () {
      try { chrome.runtime.sendMessage({ type: 'relay:disable' }, function () { void chrome.runtime.lastError; }); }
      catch (e) { /* 무시 */ }
      host.remove();
      mounted = false;
      activeCategory = null;
    });
    bar.appendChild(x);
  }

  // 드래그 이동 + 위치 기억. 세로만 옮긴다(오른쪽 가장자리에 붙는 모양을 유지).
  function enableDrag(handle) {
    handle.addEventListener('mousedown', function (down) {
      down.preventDefault();
      hideTip();
      var startY = down.clientY;
      var startTop = host.getBoundingClientRect().top;
      function move(e) {
        var top = Math.max(4, Math.min(startTop + (e.clientY - startY), window.innerHeight - bar.offsetHeight - 4));
        host.style.top = top + 'px';
        host.style.transform = 'none';
        placePanel();
      }
      function up() {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        try { chrome.storage.local.set(Object.fromEntries([[POS_KEY, host.style.top]])); } catch (e) { /* 무시 */ }
      }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });
  }

  // 어느 자소서를 띄울지는 jslRelayOn이 정한다 — 대시보드에서 마지막으로 누른 그 자소서다.
  function pick(items) {
    var on = items && items[ON_KEY];
    if (!on) return null;
    var docs = (items && items[DOCS_KEY]) || {};
    var doc = docs[String(on)];
    if (!doc || !Array.isArray(doc.qnas)) return null;
    doc = Object.assign({}, doc);
    doc.qnas = doc.qnas.filter(function (q) { return q && q.number != null; });
    return doc.qnas.length ? doc : null;
  }

  function apply(next) {
    if (!next) {                       // 꺼졌거나 스냅샷이 없다 — 막대를 걷는다
      data = null;
      activeCategory = null;
      if (mounted) { host.remove(); mounted = false; }
      return;
    }
    if (!data || data.resumeId !== next.resumeId) copied = {};   // 자소서가 바뀌면 복사 표시 초기화
    data = next;
    render();
    if (!mounted) { document.documentElement.appendChild(host); mounted = true; }
    renderProfile(); placePanel();
  }

  function load(items) {
    readProfile(items);
    var pos = items && items[POS_KEY];
    if (pos) { host.style.top = pos; host.style.transform = 'none'; }
    apply(pick(items));
  }

  try {
    chrome.storage.local.get([DOCS_KEY, ON_KEY, POS_KEY, PROFILE_KEY], function (items) {
      if (chrome.runtime.lastError) return;
      load(items);
    });
    // 켜고 끄기(jslRelayOn)와 답변 수정(jslRelayDocs) 둘 다 이 막대에 즉시 반영된다.
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || (!changes[ON_KEY] && !changes[DOCS_KEY] && !changes[PROFILE_KEY])) return;
      chrome.storage.local.get([DOCS_KEY, ON_KEY, PROFILE_KEY], function (items) {
        if (chrome.runtime.lastError) return;
        readProfile(items); apply(pick(items));
      });
    });
  } catch (e) { /* 확장 컨텍스트 없음 — 아무것도 띄우지 않는다 */ }
  window.addEventListener('resize', placePanel);
})();
