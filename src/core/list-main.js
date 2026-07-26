// MAIN 월드 (자소서 목록 페이지 전용): resume_list의 Angular 스코프를 읽는 유일한 파일.
// 격리 월드(bridge.js)와 CustomEvent('JSL_REQ'/'JSL_RES'/'JSL_STATE')로만 통신한다.
// 목록 페이지 state 스키마: { page:'list', resumes:[{id, category, qnaTotal, qnaFilled}] }
(function () {
  'use strict';

  let warned = false;

  // SPA 대응: 모든 페이지에 주입되며, 목록 페이지에서만 동작한다.
  function isListPage() {
    return location.pathname.indexOf('/resume_list') === 0;
  }

  function findScope() {
    try {
      if (!window.angular) return null;
      const el = document.querySelector('[ng-repeat="category_area in column.list"]');
      if (!el) return null;
      let s = window.angular.element(el).scope();
      while (s && !s.resumesInCurrentSeason) s = Object.getPrototypeOf(s);
      return s && s.resumesInCurrentSeason ? s : null;
    } catch (e) {
      return null;
    }
  }

  function snapshot() {
    const s = findScope();
    if (!s) {
      if (!warned) {
        console.warn('[자비스] 목록 스코프를 찾지 못했습니다. 사이트 구조가 변경되었을 수 있습니다.');
        warned = true;
      }
      return null;
    }
    try {
      const resumes = (s.resumesInCurrentSeason || []).map(function (r) {
        const qnas = r.qnas || [];
        return {
          id: r.id,
          category: r.category, // 숫자 코드 (SPEC.md 카테고리 맵 참조)
          qnaTotal: qnas.length,
          qnaFilled: qnas.filter(function (q) { return q.answer && String(q.answer).trim(); }).length
        };
      });
      return { page: 'list', resumes: resumes };
    } catch (e) {
      return null;
    }
  }

  // 답변 뱅크 일괄 수집용: 현재 시즌 전체 자소서의 문항 전문 반환
  function fullResumes() {
    const s = findScope();
    if (!s) return null;
    try {
      return {
        resumes: (s.resumesInCurrentSeason || []).map(function (r) {
          return {
            id: r.id,
            title: String(r.name == null ? '' : r.name),
            qnas: (r.qnas || []).map(function (q) {
              return { id: q.id, number: q.number, question: q.question || '', answer: q.answer || '' };
            })
          };
        })
      };
    } catch (e) {
      return null;
    }
  }

  window.addEventListener('JSL_REQ', function (ev) {
    if (!isListPage()) return; // 다른 페이지에서는 침묵 (bridge-main이 응답하거나 타임아웃)
    const d = ev.detail || {};
    let res = { id: d.id, ok: false, data: null };
    try {
      if (d.action === 'getState') {
        res.data = snapshot();
        res.ok = res.data !== null;
      } else if (d.action === 'getFullResumes') {
        res.data = fullResumes();
        res.ok = res.data !== null;
      }
    } catch (e) {
      res.ok = false;
    }
    window.dispatchEvent(new CustomEvent('JSL_RES', { detail: res }));
  });

  // 2초 주기 상태 브로드캐스트 (목록 페이지에서만)
  setInterval(function () {
    if (!isListPage()) return;
    const state = snapshot();
    if (state) {
      window.dispatchEvent(new CustomEvent('JSL_STATE', { detail: state }));
    }
  }, 2000);
})();
