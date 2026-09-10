// 모든 사이트 접근 권한을 켜고 끄는 화면.
// 콘텐츠 스크립트에는 chrome.permissions API가 없어서(크롬 제약) 이 확장 페이지가 필요하다.
// 최초 1회만 들르면 되고, 그 뒤로는 자소서 대시보드의 버튼만으로 켜고 끈다.
(function () {
  'use strict';

  var ORIGINS = { origins: ['*://*/*'] };
  var state = document.getElementById('state');
  var grant = document.getElementById('grant');
  var revoke = document.getElementById('revoke');

  function paint(granted) {
    state.textContent = granted ? '허용됨 — 대시보드에서 켤 수 있습니다' : '허용되지 않음';
    state.className = granted ? 'on' : 'off';
    grant.hidden = granted;
    revoke.hidden = !granted;
  }

  function refresh() {
    chrome.permissions.contains(ORIGINS, paint);
  }

  grant.addEventListener('click', function () {
    // 사용자 조작 안에서 불러야 크롬이 확인 창을 띄운다.
    chrome.permissions.request(ORIGINS, function (granted) {
      if (chrome.runtime.lastError) { /* 사용자가 닫음 — 조용히 무시 */ }
      paint(!!granted);
    });
  });

  revoke.addEventListener('click', function () {
    // 권한을 걷기 전에 떠 있는 막대부터 끈다. 순서를 바꾸면 해제할 권한이 이미 없다.
    chrome.runtime.sendMessage({ type: 'relay:disable' }, function () {
      void chrome.runtime.lastError;
      chrome.permissions.remove(ORIGINS, function () { refresh(); });
    });
  });

  chrome.permissions.onAdded.addListener(refresh);
  chrome.permissions.onRemoved.addListener(refresh);
  refresh();
})();
