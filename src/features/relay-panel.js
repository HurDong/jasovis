// 기업 채용 사이트 위에 띄우는 세로 복사 바 (시안 1안 — 폭 46px).
// 팝업의 버튼이 chrome.scripting.executeScript로 이 파일을 그 탭에 한 번 주입한다.
// activeTab 권한이라 아이콘을 누른 그 탭에만, 그 순간에만 접근한다.
//
// 사이트 DOM은 읽지도 쓰지도 않는다 — 입력칸을 찾아 넣는 게 아니라 우리 막대만 얹는다.
// 그래서 기업마다 따로 만들 필요가 없다. 붙여넣기는 사용자가 Ctrl+V로 한다.
// 스타일 충돌을 막으려고 Shadow DOM 안에서만 그린다 (AGENTS.md).
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
  // 사이트 CSS가 흘러들지 않게 한다. position/z-index만 우리가 정하고 나머지는 초기화.
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:50%;right:0;transform:translateY(-50%)';
  var root = host.attachShadow({ mode: 'open' });

  root.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:Pretendard,-apple-system,"Segoe UI",system-ui,sans-serif}',
    '.bar{display:flex;flex-direction:column;align-items:center;gap:5px;width:46px;padding:8px 7px;',
    '  background:#fff;border:1px solid #ddd;border-right:0;border-radius:10px 0 0 10px;',
    '  box-shadow:0 6px 26px rgba(0,0,0,.20),0 1px 3px rgba(0,0,0,.10);user-select:none}',
    '.grip{width:100%;text-align:center;color:#c6c6c6;font-size:12px;line-height:1;letter-spacing:-2px;cursor:grab}',
    '.grip:active{cursor:grabbing}',
    '.c{width:30px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:7px;',
    '  border:1px solid #ddd;background:#fff;font-size:11px;font-weight:700;color:#777;cursor:pointer;',
    '  font-variant-numeric:tabular-nums}',
    '.c:hover{border-color:#bbb;color:#333}',
    '.c.ok{background:#f5f5f5;border-color:#eee;color:#bcbcbc}',
    '.c.cur{background:#ff6813;border-color:#ff6813;color:#fff}',
    '.cp{width:30px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:7px;',
    '  background:#ff6813;border:0;color:#fff;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.16)}',
    '.cp:hover{background:#f05f0c}',
    '.cp svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.2}',
    '.cp.done{background:#1f7a4d}',
    '.sep{width:22px;height:1px;background:#eee;flex:none}',
    '.x{width:30px;height:22px;display:flex;align-items:center;justify-content:center;border:0;',
    '  background:transparent;color:#bbb;font-size:12px;cursor:pointer;border-radius:6px}',
    '.x:hover{background:#f5f5f5;color:#777}',
    '.empty{width:100%;text-align:center;font-size:9.5px;line-height:1.5;color:#999;padding:2px 0}',
    '.tip{position:absolute;right:52px;white-space:nowrap;background:#1e1e1e;color:#fff;font-size:11px;',
    '  font-weight:700;padding:5px 9px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .12s}',
    '.tip.on{opacity:1}',
    '</style>',
    '<div class="bar" part="bar"></div>',
    '<div class="tip"></div>'
  ].join('');

  var bar = root.querySelector('.bar');
  var tip = root.querySelector('.tip');
  var data = null;
  var cur = 0;          // 현재 문항 인덱스
  var copied = {};      // 이번 세션에 복사한 문항 (회색 처리용)
  var mounted = false;

  function showTip(text, y) {
    tip.textContent = text;
    tip.style.top = (y != null ? y : 8) + 'px';
    tip.classList.add('on');
    clearTimeout(showTip.t);
    showTip.t = setTimeout(function () { tip.classList.remove('on'); }, 1400);
  }

  function copyCurrent(btn) {
    if (!data || !data.qnas[cur]) return;
    var text = data.qnas[cur].answer || '';
    var num = data.qnas[cur].number;
    function ok() {
      copied[num] = true;
      btn.classList.add('done');
      showTip(num + '번 복사됨 · Ctrl+V', btn.offsetTop);
      setTimeout(function () { btn.classList.remove('done'); }, 900);
      if (cur < data.qnas.length - 1) { cur += 1; render(); }  // 복사하면 다음 문항으로
      else render();
    }
    function fail() { showTip('복사 실패', btn.offsetTop); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, function () { execFallback(text) ? ok() : fail(); });
      } else {
        execFallback(text) ? ok() : fail();
      }
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

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/></svg>';

  function render() {
    bar.textContent = '';
    var grip = document.createElement('div');
    grip.className = 'grip';
    grip.textContent = '⋯';
    grip.title = '끌어서 옮기기';
    bar.appendChild(grip);
    enableDrag(grip);

    if (!data || !data.qnas.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '자소설에서 자소서를 먼저 열어 주세요';
      bar.appendChild(e);
      bar.appendChild(closeBtn());
      return;
    }

    data.qnas.forEach(function (q, i) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'c' + (i === cur ? ' cur' : (copied[q.number] ? ' ok' : ''));
      c.textContent = q.number;
      c.title = q.question ? (q.number + '. ' + q.question) : ('문항 ' + q.number);
      c.addEventListener('click', function () { cur = i; render(); });
      bar.appendChild(c);

      // 복사 버튼은 항상 '현재 문항' 바로 아래에 붙는다 — 위치가 문항 따라 움직이지만
      // 지금 무엇을 복사하는지가 눈으로 붙어 보이는 쪽을 택했다(시안 1안).
      if (i === cur) {
        var cp = document.createElement('button');
        cp.type = 'button';
        cp.className = 'cp';
        cp.innerHTML = ICON;
        cp.title = (q.chars || 0) + '자 복사';
        cp.addEventListener('click', function () { copyCurrent(cp); });
        bar.appendChild(cp);
        var s = document.createElement('div');
        s.className = 'sep';
        bar.appendChild(s);
      }
    });
    bar.appendChild(closeBtn());
  }

  function closeBtn() {
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '✕';
    x.title = '닫기';
    // ✕는 이 탭만이 아니라 전부 끈다 — 다른 탭의 막대는 storage 변화를 보고 스스로 사라진다.
    x.addEventListener('click', function () {
      try { chrome.runtime.sendMessage({ type: 'relay:disable' }, function () { void chrome.runtime.lastError; }); }
      catch (e) { /* 무시 */ }
      host.remove();
    });
    return x;
  }

  // 드래그 이동 + 위치 기억. 세로만 옮긴다(오른쪽 가장자리에 붙는 모양을 유지).
  function enableDrag(handle) {
    handle.addEventListener('mousedown', function (down) {
      down.preventDefault();
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
    var changed = !data || data.resumeId !== next.resumeId;
    data = next;
    if (changed) { cur = 0; copied = {}; }
    else if (cur >= data.qnas.length) cur = 0;
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
