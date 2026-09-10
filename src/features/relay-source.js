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
    btn.textContent = mine ? LABEL_ON : LABEL_OFF;
    btn.classList.toggle('on', mine);
    btn.title = mine
      ? '모든 탭에서 닫기'
      : '다른 페이지에서도 이 자소서를 바로 복사하세요';
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
