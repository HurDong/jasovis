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
    '  background:#fff;border:1px solid #dedede;border-right:0;border-radius:14px 0 0 14px;',
    '  box-shadow:0 4px 18px rgba(0,0,0,.10),0 1px 3px rgba(0,0,0,.07);user-select:none}',
    // 손잡이 — 점 세 개보다 가로 선 두 줄이 "끌 수 있다"로 읽힌다
    '.grip{display:flex;flex-direction:column;gap:2px;align-items:center;',
    '  padding:9px 0 7px;cursor:grab;width:100%}',
    '.grip:active{cursor:grabbing}',
    '.grip i{display:block;width:13px;height:1.5px;border-radius:2px;background:#d2d2d2}',
    '.chips{display:flex;flex-direction:column;gap:4px;padding:0 8px}',
    // 기본은 옅은 면. 테두리를 쓰지 않아 다섯 개가 나란해도 시끄럽지 않다.
    '.n{width:32px;height:30px;display:flex;align-items:center;justify-content:center;',
    '  border:0;border-radius:9px;background:#f4f4f4;color:#8c8c8c;',
    '  font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer;',
    '  transition:background-color .12s ease,color .12s ease}',
    // 복사한 것은 색을 더하지 않고 면을 걷어 뒤로 물린다
    '.n.done{background:transparent;color:#c8c8c8}',
    '.n:hover{background:#ff6813;color:#fff;box-shadow:0 2px 8px rgba(255,104,19,.38)}',
    '.n:focus-visible{outline:2px solid #ff6813;outline-offset:2px}',
    '.x{width:34px;height:26px;display:flex;align-items:center;justify-content:center;',
    '  margin:5px 0 6px;border:0;background:transparent;border-radius:7px;',
    '  color:#c3c3c3;font-size:11px;cursor:pointer}',
    '.x:hover{background:#f4f4f4;color:#767676}',
    // 말풍선 — 흰 카드 + 꼬리. 어두운 사이트 위에서도 흰 카드가 제일 확실하다.
    '.tip{position:absolute;right:56px;width:max-content;max-width:230px;',
    '  background:#fff;border:1px solid #dedede;border-radius:11px;padding:10px 13px;',
    '  box-shadow:0 10px 30px rgba(0,0,0,.13);pointer-events:none;opacity:0;',
    '  transform:translateX(4px);transition:opacity .11s ease,transform .11s ease}',
    '.tip.on{opacity:1;transform:translateX(0)}',
    '.tip .q{font-size:12px;font-weight:700;color:#1a1a1a;line-height:1.45;letter-spacing:-.01em}',
    '.tip .m{margin-top:5px;font-size:10.5px;color:#9a9a9a}',
    '.tip .m b{color:#ff6813;font-weight:700}',
    '.tip::after{content:"";position:absolute;right:-5px;top:14px;width:9px;height:9px;background:#fff;',
    '  border-right:1px solid #dedede;border-top:1px solid #dedede;transform:rotate(45deg)}',
    '@media (prefers-reduced-motion: reduce){.n,.tip{transition:none}}',
    '</style>',
    '<div class="wrap"><div class="bar"></div><div class="tip"></div></div>'
  ].join('');

  var bar = root.querySelector('.bar');
  var tip = root.querySelector('.tip');
  var data = null;
  var copied = {};      // 이번 세션에 복사한 문항 번호
  var mounted = false;
  var tipTimer = null;

  function showTip(chip, titleText, metaHTML) {
    tip.textContent = '';
    var q = document.createElement('div');
    q.className = 'q';
    q.textContent = titleText;                 // 문항 제목은 사이트가 아니라 사용자 데이터 — textContent로만 넣는다
    var m = document.createElement('div');
    m.className = 'm';
    m.innerHTML = metaHTML;                    // 우리가 만든 고정 문구뿐이다
    tip.appendChild(q);
    tip.appendChild(m);
    // 꼬리가 그 번호를 정확히 가리키게 세로 위치를 맞춘다.
    tip.style.top = (chip.offsetTop + chip.offsetHeight / 2 - 19) + 'px';
    tip.classList.add('on');
  }

  function hideTip() { tip.classList.remove('on'); }

  function copyQna(q, chip) {
    var text = q.answer || '';
    var label = q.question || ('문항 ' + q.number);
    function ok() {
      copied[q.number] = true;
      chip.classList.add('done');
      showTip(chip, label, '<b>복사됨</b> · Ctrl+V로 붙여넣기');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 1500);
    }
    function fail() {
      showTip(chip, '복사하지 못했습니다', '이 사이트가 클립보드를 막고 있습니다');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(hideTip, 2200);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, function () { if (execFallback(text)) ok(); else fail(); });
      } else if (execFallback(text)) { ok(); } else { fail(); }
    } catch (e) { fail(); }
  }

  // navigator.clipboard가 막힌 사이트(권한 정책 등)를 위한 폴백.
  function execFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var done = document.execCommand('copy');
      ta.remove();
      return done;
    } catch (e) { return false; }
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
        showTip(chip, label, (q.chars || 0) + '자 · <b>눌러서 복사</b>');
      });
      chip.addEventListener('mouseleave', function () {
        clearTimeout(tipTimer);
        tipTimer = setTimeout(hideTip, 80);
      });
      chip.addEventListener('click', function () { copyQna(q, chip); });
      chips.appendChild(chip);
    });
    bar.appendChild(chips);

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
        var top = Math.max(4, Math.min(startTop + (e.clientY - startY), window.innerHeight - 60));
        host.style.top = top + 'px';
        host.style.transform = 'none';
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
      if (mounted) { host.remove(); mounted = false; }
      return;
    }
    if (!data || data.resumeId !== next.resumeId) copied = {};   // 자소서가 바뀌면 복사 표시 초기화
    data = next;
    render();
    if (!mounted) { document.documentElement.appendChild(host); mounted = true; }
  }

  function load(items) {
    var pos = items && items[POS_KEY];
    if (pos) { host.style.top = pos; host.style.transform = 'none'; }
    apply(pick(items));
  }

  try {
    chrome.storage.local.get([DOCS_KEY, ON_KEY, POS_KEY], function (items) {
      if (chrome.runtime.lastError) return;
      load(items);
    });
    // 켜고 끄기(jslRelayOn)와 답변 수정(jslRelayDocs) 둘 다 이 막대에 즉시 반영된다.
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || (!changes[ON_KEY] && !changes[DOCS_KEY])) return;
      chrome.storage.local.get([DOCS_KEY, ON_KEY], function (items) {
        if (chrome.runtime.lastError) return;
        apply(pick(items));
      });
    });
  } catch (e) { /* 확장 컨텍스트 없음 — 아무것도 띄우지 않는다 */ }
})();
