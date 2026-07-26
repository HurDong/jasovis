// 붙여넣기 자동 맞춤법검사 (Agent C) — SPEC.md 참조
// 흐름: paste 감지(textarea.answer) → 1.5초 디바운스 → 토스트 예고 → JSL.action('spellCheck')
//       + paste 약 200ms 후 글자수 초과 판정(JSL.ui.setWarning / 토스트)
JSL.register('spellcheck', function () {
  'use strict';

  var STORAGE_KEY = 'jslAutoSpell'; // 자동검사 on/off (기본 true)
  var DEBOUNCE_MS = 1500;           // 연속 붙여넣기 대비 디바운스
  var COUNT_DELAY_MS = 200;         // Angular 모델 반영 대기
  var COOLDOWN_MS = 5000;           // 검사 패널 중복 트리거 방지 쿨다운

  var enabled = true;        // 자동검사 활성 여부
  var debounceTimer = null;  // 디바운스 타이머
  var lastRunAt = 0;         // 마지막 자동 실행 시각
  var toggleBtn = null;      // 대시보드 토글 버튼

  // ---- 설정 저장/복원 (chrome.storage.local) ----
  function loadSetting() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(STORAGE_KEY, function (res) {
        try {
          if (res && typeof res[STORAGE_KEY] === 'boolean') enabled = res[STORAGE_KEY];
          renderToggle();
        } catch (e) { /* 무시 */ }
      });
    } catch (e) { /* storage 사용 불가 — 기본값 유지 */ }
  }

  function saveSetting() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      var obj = {};
      obj[STORAGE_KEY] = enabled;
      chrome.storage.local.set(obj);
    } catch (e) { /* 무시 */ }
  }

  // ---- 토글 스위치 표시 갱신 (.on 클래스로 스위치 상태 표현 — 스타일은 dashboard 담당) ----
  function renderToggle() {
    if (!toggleBtn) return;
    try {
      toggleBtn.classList.toggle('on', enabled);
      toggleBtn.title = enabled ? '붙여넣기 시 자동 맞춤법검사 켜짐' : '자동 맞춤법검사 꺼짐';
    } catch (e) { /* 무시 */ }
  }

  // ---- 글자수 규칙 (SPEC.md) 에 따른 초과분 계산 ----
  function checkOverflow() {
    JSL.getState().then(function (state) {
      try {
        if (!state || !state.qnas || !state.qnas.length) return; // state null 내성
        var active = null;
        for (var i = 0; i < state.qnas.length; i++) {
          if (state.qnas[i] && state.qnas[i].active) { active = state.qnas[i]; break; }
        }
        if (!active) return;

        var limit = active.total_count;
        var hasLimit = typeof limit === 'number' && limit > 0; // 0이거나 없으면 제한 없음
        var answer = typeof active.answer === 'string' ? active.answer : '';
        var len = active.include_space === false
          ? answer.replace(/\s/g, '').length   // 공백 제외 기준
          : answer.length;                      // 공백 포함 기준

        var over = hasLimit ? (len - limit) : 0;

        if (over > 0) {
          if (JSL.ui && typeof JSL.ui.setWarning === 'function') {
            try { JSL.ui.setWarning(active.number, over + '자 초과'); } catch (e) { /* 무시 */ }
          }
          JSL.emit('toast', { message: '제한 ' + over + '자 초과 — 줄여야 합니다', kind: 'fail' });
        } else {
          if (JSL.ui && typeof JSL.ui.setWarning === 'function') {
            try { JSL.ui.setWarning(active.number, null); } catch (e) { /* 무시 */ }
          }
        }
      } catch (e) { console.warn('[자비스] 글자수 판정 오류', e); }
    }).catch(function () { /* 무시 */ });
  }

  // ---- 맞춤법검사 자동 실행 (디바운스 후) ----
  function runSpellCheck() {
    try {
      if (!enabled) return;
      var now = Date.now();
      if (now - lastRunAt < COOLDOWN_MS) return; // 쿨다운: 패널 중복 트리거 방지
      lastRunAt = now;
      JSL.emit('toast', { message: '맞춤법검사 자동 실행' });
      JSL.action('spellCheck').then(function (r) {
        if (!r || !r.ok) console.warn('[자비스] 맞춤법검사 실행 실패');
      }).catch(function () { /* 무시 */ });
    } catch (e) { console.warn('[자비스] 자동 맞춤법검사 오류', e); }
  }

  // ---- paste 감지: document 위임(capture) — textarea 교체에도 동작 ----
  document.addEventListener('paste', function (ev) {
    try {
      var t = ev.target;
      if (!t || !t.closest) return;
      // 대상이 textarea.answer(또는 그 내부)일 때만 반응
      if (!t.closest('textarea.answer')) return;

      // 붙여넣기 직후 글자수 초과 판정 (Angular 모델 반영 대기)
      setTimeout(checkOverflow, COUNT_DELAY_MS);

      // 자동검사 꺼져 있으면 검사만 생략 (글자수 판정은 항상 수행)
      if (!enabled) return;

      // 디바운스: 연속 붙여넣기 대비
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        runSpellCheck();
      }, DEBOUNCE_MS);
    } catch (e) { console.warn('[자비스] paste 처리 오류', e); }
  }, true);

  // ---- 대시보드 토글 버튼 (UI 없으면 기능만 동작) ----
  function setupToggle() {
    try {
      if (!JSL.ui || !JSL.ui.ready || typeof JSL.ui.addAction !== 'function') return;
      // 5초 내 ready 안 되면 UI 추가 포기 (SPEC.md)
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve('timeout'); }, 5000); });
      Promise.race([JSL.ui.ready, timeout]).then(function (r) {
        if (r === 'timeout') return;
        try {
          toggleBtn = JSL.ui.addAction('자동 맞춤법 교정', function () {
            enabled = !enabled;
            saveSetting();
            renderToggle();
            JSL.emit('toast', { message: enabled ? '자동 맞춤법검사 켜짐' : '자동 맞춤법검사 꺼짐' });
          }, { variant: 'toggle', slot: 'header' });
          renderToggle();
        } catch (e) { console.warn('[자비스] 토글 버튼 추가 실패', e); }
      }).catch(function () { /* 무시 */ });
    } catch (e) { /* 무시 */ }
  }

  loadSetting();
  // JSL.ui는 dashboard init 이후 채워질 수 있으므로 다음 틱에 확인
  setTimeout(setupToggle, 0);
});
