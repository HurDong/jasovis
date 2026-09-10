// 다른 사이트(기업 채용 플랫폼)에서 쓸 문항 스냅샷을 저장한다.
// 여기서는 '보내는 쪽'만 맡는다 — 실제 패널은 relay-panel.js가 그 사이트에 주입된다.
// 스냅샷은 chrome.storage.local 한 칸('jslRelay')만 쓰고, 열려 있는 자소서가 바뀌면 덮어쓴다.
// 외부로 나가는 통신은 없다. 저장 위치도 로컬뿐이다 (PRIVACY.md).
JSL.register('relay-source', function () {
  'use strict';

  var KEY = 'jslRelay';
  var timer = null;
  var lastJson = '';

  // 편집 페이지 state에서 패널이 쓸 것만 추린다. 답변 본문은 복사용으로 필요하지만
  // 패널이 화면에 그리지는 않는다(사용자 결정: 본문은 안 보여준다).
  function snapshot(state) {
    var qnas = [];
    for (var i = 0; i < state.qnas.length; i++) {
      var q = state.qnas[i];
      if (!q) continue;
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

  // state는 입력할 때마다 온다. 매번 쓰면 storage가 시끄러우니 잠깐 모았다가 한 번 쓴다.
  function write(snap) {
    var json = JSON.stringify(snap.qnas) + '|' + snap.resumeId + '|' + snap.title;
    if (json === lastJson) return;   // 글자수만 흔들리는 재전송은 버린다
    lastJson = json;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      try {
        chrome.storage.local.set(Object.fromEntries([[KEY, snap]]));
      } catch (e) { /* 확장 컨텍스트가 사라진 뒤의 호출 — 조용히 무시 */ }
    }, 400);
  }

  JSL.onState(function (state) {
    try {
      // 목록 화면이나 스코프를 못 찾은 상태는 그냥 넘긴다. 이전 스냅샷은 지우지 않는다 —
      // 자소설 탭을 닫고 채용 사이트에서 쓰는 게 이 기능의 본래 용도다.
      if (!state || state.page === 'list' || !Array.isArray(state.qnas) || !state.qnas.length) return;
      var snap = snapshot(state);
      if (!snap.resumeId || !snap.qnas.length) return;
      write(snap);
    } catch (e) { /* 예외 전파 금지 */ }
  });
});
