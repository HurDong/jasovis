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
    applyGptAnswers: function (packet) {
      // Validate the entire batch against fresh model state before the first write.
      scope = findScope();
      const before = snapshot();
      try {
        // MAIN has its own guard: isolated-world globals are intentionally inaccessible.
        if (!before || location.pathname.match(/^\/resume\/(\d+)\/?$/)?.[1] !== String(packet?.resumeId) ||
            packet?.version !== 1 || String(packet.resumeId) !== String(before.resume.id) ||
            !Array.isArray(packet.answers) || !packet.answers.length || packet.answers.length > 100) throw Error('지원서 연결 정보가 다릅니다.');
        const ids = new Set(), numbers = new Set();
        packet.answers.forEach(function (a) {
          const matches = before.qnas.filter(q => String(q.id) === String(a.id));
          if (!/^\d+$/.test(String(a.id)) || !Number.isSafeInteger(a.number) || a.number < 1 ||
              ids.has(String(a.id)) || numbers.has(a.number) || typeof a.text !== 'string' || !a.text.trim() || a.text.length > 100000 ||
              matches.length !== 1 || Number(matches[0].number) !== a.number || matches[0].question !== a.question ||
              typeof a.expectedAnswer !== 'string' || matches[0].answer !== a.expectedAnswer) {
            throw Error('문항 ID·번호·질문 또는 답변 형식이 다릅니다.');
          }
          ids.add(String(a.id)); numbers.add(a.number);
        });
      }
      catch (e) { return { ok: false, data: { error: e.message } }; }
      const s = scope;
      const targets = packet.answers.map(a => Object.values(s.qnas).find(q => String(q.id) === String(a.id)));
      const originals = targets.map(q => q.answer || '');
      let failure = null;
      const write = function () {
        try {
          targets.forEach(function (q, i) { q.answer = packet.answers[i].text; });
          targets.forEach(function (q) {
            if (typeof s.qna_change === 'function') s.qna_change(q);
            if (typeof s.answer_keyup === 'function') s.answer_keyup(q);
          });
        } catch (e) {
          targets.forEach(function (q, i) { q.answer = originals[i]; });
          failure = e;
        }
      };
      try {
        if ((s.$root || s).$$phase) { write(); s.$evalAsync(function () {}); }
        else s.$apply(write);
      } catch (e) { failure = e; }
      const ta = document.querySelector('textarea.answer');
      if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
      scheduleStateBroadcast();
      return { ok: !failure, data: { error: failure ? '입력 중 오류가 발생했습니다. 현재 답변을 확인해 주세요.' : null } };
    },
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
    // 답변 본문 쓰기 — 스코프에 직접 넣는다. (실페이지 검증 2026-08-04)
    //
    // 왜 DOM(textarea)에 값을 넣지 않고 스코프에 쓰는가:
    //   화면에 보이는 textarea.answer는 "지금 연 문항" 하나뿐이라, DOM 경로로 가면
    //   문항마다 탭을 전환해야 한다. 반면 ng-model이 `qna.answer`라서 스코프에 쓰면
    //   비활성 문항도 탭 전환 없이 그대로 반영되고 그 문항 글자수 카운터까지 갱신된다.
    //   (이 기능의 목적 자체가 "문항 이동 없이 붙여넣기"다.)
    //
    // 같이 불러야 하는 것들 — 하나라도 빠지면 실제로 티가 난다:
    //   · `qna_change(qna)` / `answer_keyup(qna)`: 사이트가 ng-change/ng-keyup로 걸어둔
    //     글자수·하이라이트 갱신 훅. 타이핑과 같은 뒤처리를 태워준다.
    //   · 보이는 textarea에 `input` 디스패치: checkpoint.js가 textarea 글자색을 투명하게
    //     만들고 자기 미러 레이어에 글자를 그리는데, 그 미러는 input 이벤트로만 다시 그린다.
    //     스코프만 바꾸면 미러가 옛 글을 그린 채 남아 **붙여넣은 글이 화면에서 안 보인다.**
    //     (비활성 문항에 썼을 때도 그냥 쏜다 — 값이 그대로라 아무 일도 일어나지 않는다.)
    //
    // 반환 data.before = 덮어쓰기 전 원문. 되돌리기(undo)는 이 값을 다시 넣는 것으로 끝난다.
    setAnswer: function (payload) {
      const num = payload && Number(payload.number);
      if (!num) return { ok: false };
      const s = ensureScope();
      if (!s || !s.qnas) return { ok: false };
      let target = null;
      const keys = Object.keys(s.qnas);
      for (let i = 0; i < keys.length; i++) {
        if (Number(s.qnas[keys[i]].number) === num) { target = s.qnas[keys[i]]; break; }
      }
      if (!target) return { ok: false };
      const before = target.answer || '';
      const text = payload.text == null ? '' : String(payload.text);
      const write = function () {
        target.answer = text;
        if (typeof s.qna_change === 'function') s.qna_change(target);
        if (typeof s.answer_keyup === 'function') s.answer_keyup(target);
      };
      try {
        // 이미 digest 중이면 $apply가 예외를 던진다 — 그 경우엔 그냥 쓰고 다음 사이클에 맡긴다.
        const root = s.$root || s;
        if (root.$$phase) { write(); if (typeof s.$evalAsync === 'function') s.$evalAsync(function () {}); }
        else s.$apply(write);
      } catch (e) {
        return { ok: false };
      }
      try {
        const ta = document.querySelector('textarea.answer');
        if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) { /* 미러 동기화 실패는 치명적이지 않다 */ }
      scheduleStateBroadcast();
      return { ok: true, data: { before: before } };
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
