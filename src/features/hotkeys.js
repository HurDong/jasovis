// 단축키 기능 (Agent D) — SPEC.md '확정 키맵' 참조
// Alt+1~9: 문항 전환 / Alt+C: 활성 문항 복사 / Alt+Shift+C: 전체 복사
// F7: 맞춤법검사 / Ctrl+S: 저장 / Alt+/: 단축키 도움말
JSL.register('hotkeys', function () {
  'use strict';

  // 도움말 목록. 예전엔 ' · '로 이어붙인 한 문자열이었는데, 토스트가 3줄 텍스트
  // 벽이 되어 스캔이 안 됐다 — 항목을 그대로 넘기고 렌더는 dashboard(키캡 목록)에 맡긴다.
  // keys 표기: '+'는 동시 누르기, '/'는 대안 키 (dashboard의 renderKeys가 해석)
  // {group}은 구분 헤더 한 줄. 9항목을 한 덩이로 늘어놓으면 눈이 미끄러져서 3덩이로 나눴다.
  var HELP_ITEMS = [
    { group: '문항 이동' },
    { keys: 'Alt+1 / Alt+9', desc: '문항 전환' },
    { group: '복사 · 검사' },
    { keys: 'Alt+C', desc: '활성 문항 복사' },
    { keys: 'Alt+Shift+C', desc: '전체 복사' },
    { keys: 'F7', desc: '맞춤법검사' },
    { keys: 'Ctrl+S', desc: '저장' },
    // 아래 묶음은 checkpoint 기능이 답변 textarea에 직접 붙여 처리한다 (여기선 안내만)
    { group: '검수 (답변란)' },
    { keys: 'Tab / Shift+Tab', desc: '다음 / 이전 문장' },
    { keys: 'Alt+↓ / Alt+↑', desc: '위와 동일 (별칭)' },
    { keys: 'Esc', desc: '답변란 벗어나기' },
    { keys: 'Alt+/', desc: '이 안내 열기·닫기' }
  ];

  function showHelp() {
    JSL.emit('toast', { kind: 'help', title: '단축키', items: HELP_ITEMS });
  }

  // 활성 문항 번호 추적 (state는 null일 수 있음 — 조용히 견딘다)
  var activeNumber = null;
  JSL.onState(function (state) {
    try {
      if (state && state.qnas && state.qnas.length) {
        for (var i = 0; i < state.qnas.length; i++) {
          if (state.qnas[i].active) { activeNumber = state.qnas[i].number; return; }
        }
      }
    } catch (e) { /* 무시 */ }
  });

  function toast(message, kind) {
    JSL.emit('toast', { message: message, kind: kind });
  }

  // 액션 실행: ok:false면 공통 실패 토스트. 예외 전파 금지.
  function runAction(name, payload) {
    var fail = function () { toast('동작 실패 — 사이트 구조가 바뀌었을 수 있어요', 'fail'); };
    try {
      JSL.action(name, payload).then(function (r) {
        if (!r || !r.ok) fail();
      }).catch(fail);
    } catch (e) {
      fail();
    }
  }

  // 활성 문항 복사 (SPEC: 'copy:qna' payload {number})
  function copyActiveQna() {
    if (activeNumber != null) {
      JSL.emit('copy:qna', { number: activeNumber });
    } else {
      // 아직 state를 못 받았으면 번호 없이 전달 (copy 기능이 활성 문항으로 처리)
      JSL.emit('copy:qna', {});
    }
  }

  // keydown 판정. 처리했으면 true 반환.
  function handleKey(e) {
    // SPA 대응: 자소서 편집 화면이 아닐 땐 단축키 비활성 (브라우저 기본 동작 유지)
    if (!document.querySelector('textarea.answer')) return false;
    // Alt+1 ~ Alt+9 — e.code 기준 (한글 IME에서도 안정적)
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      var number = parseInt(e.code.slice(5), 10);
      runAction('switchQna', { number: number });
      return true;
    }

    // Alt+C / Alt+Shift+C
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
      if (e.shiftKey) {
        JSL.emit('copy:full');
      } else {
        copyActiveQna();
      }
      return true;
    }

    // Alt+/ — 단축키 도움말
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'Slash') {
      showHelp();
      return true;
    }

    // F7 — 맞춤법검사
    if (e.key === 'F7' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      runAction('spellCheck', {});
      return true;
    }

    // Ctrl+S — 저장 (preventDefault로 크롬 페이지저장 차단)
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === 'KeyS') {
      e.preventDefault(); // 크롬 '페이지 저장' 차단 (아래에서 한 번 더 호출돼도 무해)
      toast('저장 요청');
      runAction('save', {});
      return true;
    }

    return false;
  }

  // capture 단계 리스너 — textarea 포커스 중에도 동작
  document.addEventListener('keydown', function (e) {
    try {
      if (e.isComposing) return; // 한글 조합 중이면 무시
      if (handleKey(e)) {
        // 처리한 키만 기본 동작/전파 차단. 처리 안 한 키는 건드리지 않는다.
        e.preventDefault();
        e.stopPropagation();
      }
    } catch (err) {
      // 예외 전파 금지
      console.warn('[자비스] hotkeys 처리 오류', err);
    }
  }, true);

  // 대시보드 위젯에 도움말 버튼 추가 (JSL.ui 5초 내 미준비 시 생략)
  (function attachHelpButton() {
    var start = Date.now();
    (function wait() {
      try {
        if (JSL.ui && JSL.ui.ready) {
          var timedOut = false;
          var timer = setTimeout(function () { timedOut = true; }, Math.max(0, 5000 - (Date.now() - start)));
          JSL.ui.ready.then(function () {
            clearTimeout(timer);
            if (timedOut) return; // 5초 초과 — 버튼 추가 생략
            try {
              // 헤더 더보기 메뉴에 항목 추가 (컬러 이모지 대신 텍스트 라벨 — Shadow DOM엔 아이콘 폰트가 없음)
              var helpBtn = JSL.ui.addAction('단축키 안내', showHelp, { slot: 'header' });
              if (helpBtn) helpBtn.title = '단축키 도움말';
            } catch (e) { /* UI 추가 실패는 기능에 영향 없음 */ }
          }).catch(function () { clearTimeout(timer); });
          return;
        }
      } catch (e) { /* 무시 */ }
      if (Date.now() - start < 5000) {
        setTimeout(wait, 200); // JSL.ui가 아직 없음(dashboard 로드 대기)
      }
      // 5초 경과 시 조용히 포기 — 단축키 자체는 계속 동작
    })();
  })();
});
