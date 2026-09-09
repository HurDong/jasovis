// MAIN 월드 (자소서 목록 페이지 전용): resume_list의 Angular 스코프를 읽는 유일한 파일.
// 격리 월드(bridge.js)와 CustomEvent('JSL_REQ'/'JSL_RES'/'JSL_STATE')로만 통신한다.
// 목록 페이지 state: { page:'list', resumes:[{id, category, employmentId, employmentCompanyId, sample, qnaTotal, qnaFilled, endTime}] }
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
          employmentId: Number.isSafeInteger(Number(r.employment_id)) && Number(r.employment_id) > 0
            ? Number(r.employment_id) : null, // 우클릭 공고 바로가기. 기존 메모리만 읽는다.
          sample: Number(r.sample) === 1,
          employmentCompanyId: Number.isSafeInteger(Number(r.employment_company_id)) && Number(r.employment_company_id) > 0
            ? Number(r.employment_company_id) : null,
          qnaTotal: qnas.length,
          qnaFilled: qnas.filter(function (q) { return q.answer && String(q.answer).trim(); }).length,
          // 마감 임박 경고용. 순수 문자열 그대로 넘기고 판정은 격리 월드에서 한다.
          endTime: r.end_time == null ? null : String(r.end_time)
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

  // ── 정렬 감사/교정 (SPEC.md "목록 정렬 어긋남" 절) ──────────────
  //
  // 카드 순서는 클라이언트 정렬이 아니라 **서버가 자소서마다 매겨준 순서값**으로 그려진다.
  // 사이트의 `sort(key)`는 `POST /resume/scheduler_season_sort.json {season, sort}` 로
  // 그 값을 다시 받아와 적용한다(2026-08-10 실페이지에서 함수 본문 확인).
  // 그래서 자소서를 새로 만들면 그것만 낡은 순서값으로 끼어들어, 필터는 "공고 마감일순"인데
  // 화면 순서는 어긋난 상태가 된다. 서버에 저장되므로 **한 번 바로잡으면 다음에 새로
  // 만들기 전까지는 안 깨진다** — 매 로드마다 고칠 일이 아니다.
  //
  // 판정은 순서값을 읽지 않고 **렌더된 DOM 순서**(=화면의 진실)를 본다. 순서값이
  // total/duration/season 세 개나 있고 동점 처리에서 서로 갈려서, 어느 것이 렌더를
  // 지배하는지 단정할 수 없었기 때문이다.

  function findSortScope() {
    try {
      if (!window.angular) return null;
      const el = document.querySelector('[ng-click="sort(menu.key)"]');
      if (!el) return null;
      let s = window.angular.element(el).scope();
      while (s && !(s.sortKey && s.currentSeason)) s = s.$parent;
      return s || null;
    } catch (e) {
      return null;
    }
  }

  // 정렬 기준별 비교값. 방향은 실페이지에서 확인한 것만 다룬다:
  //   end_time = 마감 이른 순(오름차순), created_at = 최근 생성 순(내림차순).
  // 'title'은 방향을 확인하지 못했다 — 잘못 판정하면 멀쩡한 목록에 교정 POST를 날리게 되므로
  // 아예 감사 대상에서 뺀다(null 반환 = 판정 보류).
  function sortValue(node, key) {
    if (!node) return null;
    if (key === 'end_time') {
      const t = new Date(node.end_time || 0).getTime();
      return isNaN(t) ? null : t;
    }
    if (key === 'created_at') {
      const t = new Date(node.created_at || 0).getTime();
      return isNaN(t) ? null : -t;
    }
    return null;
  }

  // **감사는 '작성 중'(category_key="0") 섹션만 본다.**
  // 2026-08-10 실페이지 확인: 섹션마다 정렬 방향이 다르다. 마감이 남은 '작성 중'은
  // 임박 순(오름차순)인데, 제출 완료(1)·서류 불합(3)처럼 이미 지난 건은 최근 마감 순
  // (내림차순)이다. 전 섹션을 오름차순으로 보면 멀쩡한 목록을 어긋났다고 판정한다(실제로 오탐 냄).
  // 마감이 이미 지난 '작성 중' 카드도 방향을 확인하지 못해 검사에서 뺀다 —
  // 애초에 고치려는 건 "새로 담은 공고가 엉뚱한 자리에 있는 것"이고 그건 전부 미래 마감이다.
  function sortAudit() {
    const s = findSortScope();
    if (!s) return null;
    const key = s.sortKey;
    if (key !== 'end_time' && key !== 'created_at') {
      return { sortKey: key, checked: 0, needsFix: false, skipped: true };
    }

    const byId = {};
    (s.currentSeason.categories || []).forEach(function (c) {
      (c.resumeNodes || []).forEach(function (r) { byId[r.id] = r; });
    });

    const now = Date.now();
    let checked = 0;
    let needsFix = false;
    const uls = document.querySelectorAll('ul.itemlist[category_key="0"]');
    for (let u = 0; u < uls.length && !needsFix; u++) {
      // 접힌 섹션(ng-hide)은 건너뛴다. offsetParent는 display:none이면 null —
      // getBoundingClientRect와 달리 강제 리플로우를 부르지 않는다.
      if (!uls[u].offsetParent) continue;
      const lis = uls[u].querySelectorAll('li.resume-node[resume_node_id]');
      const vals = [];
      for (let i = 0; i < lis.length; i++) {
        const node = byId[Number(lis[i].getAttribute('resume_node_id'))];
        if (!node) continue;
        if (new Date(node.end_time || 0).getTime() < now) continue; // 이미 지난 마감은 제외
        const v = sortValue(node, key);
        if (v !== null) vals.push(v);
      }
      if (vals.length < 2) continue;
      checked += vals.length;
      // 같은 값(동일 마감일)은 순서가 임의라 어긋난 것으로 보지 않는다
      for (let j = 1; j < vals.length; j++) {
        if (vals[j - 1] > vals[j]) { needsFix = true; break; }
      }
    }
    return { sortKey: key, checked: checked, needsFix: needsFix, skipped: false };
  }

  // 교정은 우리가 순서값을 계산해 쓰는 게 아니라 **사이트 정렬 버튼을 그대로 클릭**한다
  // (SPEC 공통 원칙: 사이트 쓰기는 버튼 클릭 위임만). 라벨 문구가 바뀌어도 견디도록
  // 버튼 스코프의 menu.key로 찾는다.
  function sortFix() {
    const s = findSortScope();
    if (!s || !s.sortKey) return false;
    const btns = document.querySelectorAll('[ng-click="sort(menu.key)"]');
    for (let i = 0; i < btns.length; i++) {
      try {
        const bs = window.angular.element(btns[i]).scope();
        if (bs && bs.menu && bs.menu.key === s.sortKey) { btns[i].click(); return true; }
      } catch (e) { /* 다음 버튼 */ }
    }
    return false;
  }

  window.addEventListener('JSL_REQ', function (ev) {
    if (!isListPage()) return; // 다른 페이지에서는 침묵 (bridge-main이 응답하거나 타임아웃)
    const d = ev.detail || {};
    let res = { id: d.id, ok: false, data: null };
    try {
      if (d.action === 'getState') {
        res.data = snapshot();
        res.ok = res.data !== null;
      } else if (d.action === 'openListChat') {
        const scope = findScope();
        const id = Number(d.payload && d.payload.id);
        const resume = Number.isSafeInteger(id) && id > 0 && scope &&
          scope.resumesInCurrentSeason.find(function (r) { return Number(r.id) === id; });
        const companyId = Number(resume && resume.employment_company_id);
        const chatElement = document.querySelector('[ng-controller="ChatCtrl"]');
        const chat = chatElement && window.angular.element(chatElement).scope();
        if (Number.isSafeInteger(companyId) && companyId > 0 && chat &&
            typeof chat.open_chatroom === 'function' && chat.$parent &&
            typeof chat.$parent.open_chat_window === 'function') {
          // 사이트 편집 화면과 같은 공고 → 기업 채팅 연결을 사용한다.
          // 공고 ID를 채팅방 ID로 간주하지 않는다. 방 조회/진입은 원본 ChatCtrl에 위임한다.
          const open = function () {
            chat.$parent.open_chat_window();
            chat.$root.$broadcast('open_chat', { employment_company_id: companyId });
          };
          if (chat.$root.$$phase) open();
          else chat.$apply(open);
          res.ok = true; // 네이티브 열기 요청 전달 완료. 네트워크 완료를 의미하지 않는다.
        }
      } else if (d.action === 'getListResumeText') {
        const scope = findScope();
        const id = Number(d.payload && d.payload.id);
        const resume = Number.isSafeInteger(id) && id > 0 && scope &&
          scope.resumesInCurrentSeason.find(function (r) { return Number(r.id) === id; });
        if (resume && Array.isArray(resume.qnas) && resume.qnas.length) {
          const qnas = resume.qnas.slice().sort(function (a, b) { return (a.number || 0) - (b.number || 0); });
          res.data = { text: String(resume.name || '') + '\n\n' + qnas.map(function (q, index) {
            return String(q.number == null ? index + 1 : q.number) + '. ' + String(q.question || '') + '\n' + String(q.answer || '');
          }).join('\n\n') };
          res.ok = true;
        }
      } else if (d.action === 'getFullResumes') {
        res.data = fullResumes();
        res.ok = res.data !== null;
      } else if (d.action === 'sortAudit') {
        res.data = sortAudit();
        res.ok = res.data !== null;
      } else if (d.action === 'sortFix') {
        res.ok = sortFix();
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
