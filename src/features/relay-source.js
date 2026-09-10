// 자소서 편집 페이지에서 '자비스 호출' 기능의 보내는 쪽을 맡는다.
//  1) 열려 있는 자소서의 문항 스냅샷을 자소서별로 저장한다 (jslRelayDocs).
//  2) 대시보드에 켜기/끄기 버튼을 붙인다 (JSL.ui.addAction — dashboard.js는 건드리지 않는다).
//
// 탭을 여러 개 열어 두면 각 탭이 자기 자소서를 저장하고, 버튼을 누른 그 자소서가 화면에 뜬다.
// "마지막에 연 것"이 아니라 "마지막에 누른 것"이라 헷갈리지 않는다.
// 외부 통신은 없고 저장은 chrome.storage.local뿐이다 (PRIVACY.md).
JSL.register('relay-source', function () {
  'use strict';

  var DOCS = 'jslRelayDocs';
  var ON = 'jslRelayOn';
  var MAX_DOCS = 8;          // 오래된 자소서 스냅샷은 버린다
  var timer = null;
  var lastJson = '';
  var myId = null;           // 이 탭이 들고 있는 자소서 id
  var btn = null;
  var btnLabel = null;
  var relayOn = null;

  function snapshot(state) {
    var qnas = [];
    for (var i = 0; i < state.qnas.length; i++) {
      var q = state.qnas[i];
      if (!q || q.number == null) continue;
      qnas.push({
        number: q.number,
        question: String(q.question || '').trim(),
        answer: String(q.answer || ''),
        chars: String(q.answer || '').length
      });
    }
    var r = state.resume || {};
    return {
      resumeId: r.id != null ? String(r.id) : null,
      title: String(r.title || '').trim(),
      dDay: r.d_day != null ? String(r.d_day) : null,
      savedAt: Date.now(),
      qnas: qnas
    };
  }

  // state는 입력할 때마다 온다. 잠깐 모았다가 한 번 쓴다.
  function store(snap) {
    var json = JSON.stringify(snap.qnas) + '|' + snap.title;
    if (json === lastJson) return;
    lastJson = json;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      try {
        chrome.storage.local.get(DOCS, function (res) {
          if (chrome.runtime.lastError) return;
          var docs = (res && res[DOCS]) || {};
          docs[snap.resumeId] = snap;
          // 최근 저장 순으로 잘라낸다
          var ids = Object.keys(docs).sort(function (a, b) {
            return (docs[b].savedAt || 0) - (docs[a].savedAt || 0);
          });
          for (var i = MAX_DOCS; i < ids.length; i++) delete docs[ids[i]];
          var payload = {};
          payload[DOCS] = docs;
          chrome.storage.local.set(payload);
        });
      } catch (e) { /* 확장 컨텍스트 소멸 — 무시 */ }
    }, 400);
  }

  // ── 대시보드 버튼 ───────────────────────────────────────────────
  var LABEL_OFF = '자비스 호출';
  var LABEL_ON = '자비스 닫기';

  function paint() {
    if (!btn) return;
    var mine = relayOn != null && myId != null && String(relayOn) === String(myId);
    (btnLabel || btn).textContent = mine ? LABEL_ON : LABEL_OFF;
    btn.classList.toggle('on', mine);
    btn.setAttribute('aria-pressed', String(mine));
    btn.title = mine
      ? '모든 탭에서 닫기'
      : '다른 페이지에서도 이 자소서를 바로 복사하세요';
  }

  // 호출 버튼만 꾸민다. 배경이 꺼져도 라벨과 원래 호출 동작은 남는다.
  function decorateCallButton() {
    btn.classList.add('jsl-relay-call');
    btn.innerHTML = '<style>' +
      '.jsl-action-btn.jsl-relay-call{position:relative;isolation:isolate;overflow:hidden;' +
      'flex:1 0 100%;width:100%;height:38px;display:flex;align-items:center;justify-content:center;gap:8px;' +
      'background:#1c1917;border:1px solid #3c3733;color:#f0ece8;border-radius:10px;' +
      'box-shadow:0 2px 5px #00000016;transition:border-color .2s,box-shadow .2s;}' +
      '.jsl-action-btn.jsl-relay-call:hover,.jsl-action-btn.jsl-relay-call:focus-visible{' +
      'background:#1c1917;color:#f0ece8;border-color:#de9270;box-shadow:0 0 12px #00000022;}' +
      '.jsl-action-btn.jsl-relay-call:focus-visible{outline:2px solid #de9270;outline-offset:3px;}' +
      '.jsl-relay-call canvas{position:absolute;inset:0;width:100%;height:100%;z-index:-2;pointer-events:none;}' +
      '.jsl-relay-call:after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;' +
      'background:radial-gradient(ellipse 38% 150% at center,#090807a6,transparent);}' +
      '.jsl-relay-call .relay-label{font-size:13px;font-weight:600;line-height:18px;letter-spacing:.01em;' +
      'text-shadow:0 1px 4px #000,0 0 8px #000;}' +
      '.jsl-relay-call svg{width:15px;height:15px;flex:none;fill:none;stroke:#de9270;stroke-width:1.1;}' +
      '.jsl-action-btn.jsl-relay-call.on{border-color:#de9270;}' +
      '.jsl-relay-call.on .relay-core{fill:#de9270;}' +
      '@media(prefers-reduced-motion:reduce){.jsl-action-btn.jsl-relay-call{transition:none;}}' +
      '</style><canvas aria-hidden="true"></canvas>' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/>' +
      '<path d="M10 4.5a5.5 5.5 0 1 1-5.5 5.5"/><circle class="relay-core" cx="10" cy="10" r="2"/></svg>' +
      '<span class="relay-label"></span>';
    btnLabel = btn.querySelector('.relay-label');
    var canvas = btn.querySelector('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var hovered = false, focused = false, visible = false, broken = false;
    var frameId = 0, last = 0, time = 2, energy = 0;
    var width = 0, height = 0;

    function glow(x, y, radius, alpha) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, 'rgba(222,146,112,' + alpha + ')');
      g.addColorStop(.35, 'rgba(156,74,46,' + alpha * .65 + ')');
      g.addColorStop(1, 'rgba(156,74,46,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    function draw() {
      if (!width || !height) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = width, h = height;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1c1917'; ctx.fillRect(0, 0, w, h);
      glow(w * (.45 + Math.sin(time * .4) * .18), h * .6, w * .4, .14);
      ctx.globalAlpha = 1 - energy * .85;
      for (var j = 0; j < 4; j++) {
        ctx.beginPath();
        for (var x = 0; x <= w; x += 3) {
          var y = h * (.55 + Math.sin(x / w * 6 + time * .4 + j * .3) * .2);
          if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.strokeStyle = 'rgba(156,74,46,.27)'; ctx.lineWidth = .8; ctx.stroke();
      }
      // 호버 강도를 연속적으로 바꿔 마우스를 떼면 부드럽게 잦아들게 한다.
      ctx.globalAlpha = energy;
      if (energy > .001) {
        for (var i = 0; i < 125; i++) {
          var a = i * 2.39996;
          var p = (time * .65 + ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1)) % 1;
          var r = p * p;
          var dx = Math.cos(a) * w * .75 * r, dy = Math.sin(a) * h * 1.9 * r;
          ctx.beginPath();
          ctx.moveTo(w * .5 + dx * (.3 + .2 * (1 - p)), h * .5 + dy * (.3 + .2 * (1 - p)));
          ctx.lineTo(w * .5 + dx, h * .5 + dy);
          ctx.strokeStyle = 'rgba(' + (i % 4 === 0 ? '245,203,177' : '222,146,112') + ',' + p * .9 + ')';
          ctx.lineWidth = .4 + p * 1.1; ctx.stroke();
        }
        glow(w * .5, h * .5, w * .25, .45);
      }
      ctx.globalAlpha = 1;
    }

    function tick(now) {
      frameId = 0;
      if (broken || !btn.isConnected || !visible || document.hidden || reduced.matches) return;
      if (!last || now - last >= 1000 / 30) {
        var dt = last ? Math.min((now - last) / 1000, .06) : 1 / 30;
        last = now;
        energy += (Number(hovered || focused) - energy) * (1 - Math.exp(-dt * (hovered || focused ? 4 : 2.4)));
        time += dt * (.22 + energy * 1.9) * 1.4;
        try { draw(); } catch (e) { broken = true; console.warn('[자비스] 호출 배경을 그리지 못했습니다.'); return; }
      }
      frameId = requestAnimationFrame(tick);
    }

    function sync() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0; last = 0;
      if (broken || !btn.isConnected || !visible || document.hidden) return;
      if (reduced.matches) {
        energy = 0;
        try { draw(); } catch (e) { broken = true; console.warn('[자비스] 호출 배경을 그리지 못했습니다.'); }
      } else frameId = requestAnimationFrame(tick);
    }
    btn.addEventListener('mouseenter', function () { hovered = true; });
    btn.addEventListener('mouseleave', function () { hovered = false; });
    btn.addEventListener('focus', function () { focused = btn.matches(':focus-visible'); });
    btn.addEventListener('blur', function () { focused = false; });
    new ResizeObserver(function () { width = canvas.clientWidth; height = canvas.clientHeight; sync(); }).observe(btn);
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (!visible) { hovered = false; focused = false; energy = 0; }
      sync();
    }).observe(btn);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { hovered = false; focused = false; energy = 0; }
      sync();
    });
    reduced.addEventListener('change', sync);
  }

  function send(msg, done) {
    try {
      chrome.runtime.sendMessage(msg, function (res) {
        void chrome.runtime.lastError;   // 서비스워커가 자고 있으면 조용히 넘긴다
        done(res || {});
      });
    } catch (e) { done({}); }
  }

  function onClick() {
    if (!myId) { JSL.emit('toast', { message: '자소서를 불러오는 중입니다.', kind: 'fail' }); return; }
    var mine = relayOn != null && String(relayOn) === String(myId);
    if (mine) {
      send({ type: 'relay:disable' }, function () {
        JSL.emit('toast', { message: '자비스를 닫았습니다.' });
      });
      return;
    }
    send({ type: 'relay:enable', resumeId: myId }, function (res) {
      if (res.needPermission) {
        // 크롬은 확장 페이지에서만 권한을 물을 수 있다. 최초 1회만 여기로 보낸다.
        JSL.emit('toast', {
          message: '처음 한 번만 허용이 필요합니다.',
          kind: 'fail',
          sub: '방금 열린 설정 탭에서 “허용하기”를 눌러 주세요.'
        });
        send({ type: 'relay:options' }, function () { });
        return;
      }
      if (!res.ok) { JSL.emit('toast', { message: '자비스를 호출하지 못했습니다.', kind: 'fail' }); return; }
      JSL.emit('toast', { message: '자비스를 호출했습니다.' });
    });
  }

  function mount() {
    if (btn || !JSL.ui || !JSL.ui.addAction) return;
    btn = JSL.ui.addAction(LABEL_OFF, onClick);
    try { decorateCallButton(); } catch (e) { console.warn('[자비스] 호출 배경을 초기화하지 못했습니다.'); }
    paint();
  }

  if (JSL.ui && JSL.ui.ready && JSL.ui.ready.then) {
    JSL.ui.ready.then(function () { try { mount(); } catch (e) { /* 무시 */ } });
  }

  // 다른 탭에서 켜고 끄면 이 탭의 버튼 라벨도 따라간다.
  try {
    chrome.storage.local.get(ON, function (res) {
      if (chrome.runtime.lastError) return;
      relayOn = res && res[ON];
      paint();
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes[ON]) return;
      relayOn = changes[ON].newValue;
      paint();
    });
  } catch (e) { /* 무시 */ }

  JSL.onState(function (state) {
    try {
      if (!state || state.page === 'list' || !Array.isArray(state.qnas) || !state.qnas.length) return;
      var snap = snapshot(state);
      if (!snap.resumeId || !snap.qnas.length) return;
      myId = snap.resumeId;
      store(snap);
      paint();
    } catch (e) { /* 예외 전파 금지 */ }
  });
});
