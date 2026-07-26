// MAIN 월드: 페이지의 AngularJS 스코프에 접근하는 유일한 파일.
// 격리 월드(bridge.js)와 CustomEvent('JSL_REQ'/'JSL_RES'/'JSL_STATE')로만 통신한다.
(function () {
  'use strict';

  let scope = null;
  let warned = false;
  let lastPath = location.pathname;
  let lastStateSignature = '';
  let fastBroadcastTimer = null;
  let settleBroadcastTimer = null;
  let observedEditorPath = '';

  // 자소설닷컴은 SPA라 새로고침 없이 페이지가 바뀐다.
  // 이 파일은 모든 페이지에 주입되며, 자소서 편집 페이지에서만 동작한다.
  function isEditPage() {
    return /^\/resume\/\d+/.test(location.pathname);
  }

  function checkPathChange() {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      scope = null;   // 라우트가 바뀌면 스코프 캐시 무효화
      warned = false;
    }
  }

  function findScope() {
    try {
      if (!window.angular) return null;
      const el = document.querySelector('textarea.answer');
      if (!el) return null;
      let s = window.angular.element(el).scope();
      while (s && !s.resume) s = Object.getPrototypeOf(s);
      return s && s.resume ? s : null;
    } catch (e) {
      return null;
    }
  }

  function ensureScope() {
    if (!scope || !scope.resume) scope = findScope();
    if (!scope && !warned) {
      console.warn('[자비스] Angular 스코프를 찾지 못했습니다. 사이트 구조가 변경되었을 수 있습니다.');
      warned = true;
    }
    return scope;
  }

  // 현재 화면에 표시 중인 문항 인덱스 (0-기반).
  // 주의: qna.active 플래그는 갱신되지 않는 잔존값이라 쓰면 안 됨 (실페이지 검증됨).
  function findCurrentQnaIndex(s) {
    let c = s;
    while (c) {
      if ('currentQnaIndex' in c && typeof c.currentQnaIndex === 'number') return c.currentQnaIndex;
      c = Object.getPrototypeOf(c);
    }
    return null;
  }

  function snapshot() {
    const s = ensureScope();
    if (!s) return null;
    try {
      const r = s.resume;
      const currentIdx = findCurrentQnaIndex(s);
      const qnas = Object.values(s.qnas || {})
        .map(function (q) {
          return {
            id: q.id,
            number: q.number,
            question: q.question || '',
            answer: q.answer || '',
            total_count: q.total_count,
            is_character: q.is_character,
            include_space: q.include_space,
            count_mode: q.count_mode,
            active: !!q.active // 아래에서 currentQnaIndex 기준으로 재설정
          };
        })
        .sort(function (a, b) { return a.number - b.number; });
      if (currentIdx !== null && qnas[currentIdx]) {
        qnas.forEach(function (q, i) { q.active = (i === currentIdx); });
      }
      return {
        resume: {
          id: r.id,
          title: r.title,
          end_time: r.end_time,
          d_day: r.d_day,
          updated_at: r.updated_at,
          employment_company_id: r.employment_company_id
        },
        qnas: qnas
      };
    } catch (e) {
      return null;
    }
  }

  // 상태가 실제로 달라졌을 때만 격리 월드로 보낸다.
  // 답변 문자열까지 포함해 같은 글자 수의 수정도 놓치지 않는다.
  function broadcastState(force) {
    checkPathChange();
    if (!isEditPage()) {
      lastStateSignature = '';
      return;
    }
    if (!document.querySelector('textarea.answer')) return;
    const state = snapshot();
    if (!state) return;
    const signature = JSON.stringify(state);
    if (!force && signature === lastStateSignature) return;
    lastStateSignature = signature;
    window.dispatchEvent(new CustomEvent('JSL_STATE', { detail: state }));
  }

  // Angular 이벤트 처리가 끝난 다음 프레임에 즉시 반영하고,
  // 비동기 후처리까지 잡기 위해 80ms 뒤 한 번 더 확인한다.
  function scheduleStateBroadcast() {
    if (fastBroadcastTimer === null) {
      fastBroadcastTimer = setTimeout(function () {
        fastBroadcastTimer = null;
        requestAnimationFrame(function () { broadcastState(false); });
      }, 0);
    }
    if (settleBroadcastTimer !== null) clearTimeout(settleBroadcastTimer);
    settleBroadcastTimer = setTimeout(function () {
      settleBroadcastTimer = null;
      broadcastState(false);
    }, 80);
  }

  // ---- 액션 ----

  function clickByText(text) {
    const nodes = document.querySelectorAll('button, a, div, span');
    for (let i = 0; i < nodes.length; i++) {
      const e = nodes[i];
      if (e.children.length <= 1 && e.textContent.trim() === text && e.offsetWidth > 0) {
        e.click();
        return true;
      }
    }
    return false;
  }

  const actions = {
    switchQna: function (payload) {
      const num = payload && payload.number;
      if (!num) return { ok: false };
      // 1차: 컨트롤러 함수. $apply는 동기라 호출 직후 바로 실제 전환 여부를 확인할 수 있다.
      // 전환이 확인되면 2차(DOM 클릭)는 생략한다 — 예전엔 매번 둘 다 실행해서
      // 렌더가 두 번 돌며 버벅임이 있었다(클릭할 때마다 체감되는 지연의 원인이었음).
      const s = ensureScope();
      try {
        if (s && typeof s.switch_qna === 'function') {
          s.$apply(function () { s.switch_qna(num); });
          const idx = findCurrentQnaIndex(s);
          const sorted = Object.values(s.qnas || {}).sort(function (a, b) { return a.number - b.number; });
          if (idx !== null && sorted[idx] && Number(sorted[idx].number) === Number(num)) {
            scheduleStateBroadcast();
            return { ok: true };
          }
        }
      } catch (e) { /* 폴백으로 진행 */ }
      // 2차: 탭 DOM 클릭 (span.qna-number) — 스코프 호출로 전환이 안 됐을 때만
      const tabs = document.querySelectorAll('span.qna-number');
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i].textContent.trim() === String(num)) {
          (tabs[i].closest('[ng-click]') || tabs[i].parentElement || tabs[i]).click();
          scheduleStateBroadcast();
          return { ok: true };
        }
      }
      return { ok: false };
    },
    spellCheck: function () {
      // 툴바의 맞춤법검사 버튼은 토글이라, 패널이 이미 열려 있으면 닫혀버린다.
      // 패널이 열려 있으면(재검사하기 버튼이 보이면) 재검사를, 아니면 토글 버튼으로 연다.
      const recheck = document.querySelector('span.check-spell-button');
      if (recheck && recheck.offsetWidth > 0) { recheck.click(); return { ok: true }; }
      const btn = document.querySelector('div.function_button.spell');
      if (btn) { btn.click(); return { ok: true }; }
      return { ok: clickByText('맞춤법검사') };
    },
    save: function () {
      return { ok: clickByText('저장하기') };
    }
  };

  // ---- 통신 ----

  window.addEventListener('JSL_REQ', function (ev) {
    checkPathChange();
    if (!isEditPage()) return; // 다른 페이지에서는 침묵 (list-main이 응답하거나 타임아웃)
    const d = ev.detail || {};
    let res = { id: d.id, ok: false, data: null };
    try {
      if (d.action === 'getState') {
        res.data = snapshot();
        res.ok = res.data !== null;
      } else if (actions[d.action]) {
        const r = actions[d.action](d.payload);
        res.ok = !!(r && r.ok);
        res.data = r && r.data !== undefined ? r.data : null;
      }
    } catch (e) {
      res.ok = false;
    }
    window.dispatchEvent(new CustomEvent('JSL_RES', { detail: res }));
  });

  // 사이트에서 직접 문항 탭을 누른 경우: 다음 렌더 프레임에 바로 활성 문항 반영.
  document.addEventListener('click', function (ev) {
    try {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest('span.qna-number') || target.closest('[ng-click*="switch_qna"]')) {
        scheduleStateBroadcast();
      }
    } catch (e) { /* 이벤트 감지 실패는 2초 폴링이 보완 */ }
  }, true);

  // 답변 입력도 매 키 입력 후 다음 프레임에 반영한다(프레임당 최대 1회).
  document.addEventListener('input', function (ev) {
    try {
      const target = ev.target;
      if (target instanceof Element && target.matches('textarea.answer, textarea.qna-question')) {
        scheduleStateBroadcast();
      }
    } catch (e) { /* 이벤트 감지 실패는 2초 폴링이 보완 */ }
  }, true);

  window.addEventListener('popstate', scheduleStateBroadcast);
  window.addEventListener('hashchange', scheduleStateBroadcast);

  // 새로고침/SPA 진입 시 Angular가 textarea를 늦게 만들 수 있다.
  // 편집기 DOM이 실제로 생기는 순간 첫 state를 보내 2초 폴링을 기다리지 않는다.
  function detectEditorMount() {
    checkPathChange();
    const path = location.pathname;
    const ready = isEditPage() && !!document.querySelector('textarea.answer');
    if (!ready) {
      observedEditorPath = '';
      return;
    }
    if (observedEditorPath !== path) {
      observedEditorPath = path;
      scheduleStateBroadcast();
    }
  }

  try {
    const editorObserver = new MutationObserver(detectEditorMount);
    editorObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* MutationObserver 실패 시 아래 폴링이 보완 */ }
  detectEditorMount();

  // 2초 폴링은 이벤트를 놓쳤을 때만 쓰는 안전망. 동일 상태는 전송하지 않는다.
  setInterval(function () {
    broadcastState(false);
  }, 2000);
})();
