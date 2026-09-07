// 목록 정렬 어긋남 자동 교정 — SPEC.md "목록 정렬 어긋남" 절 참조
//
// 증상: 공고를 한꺼번에 여러 개 담고 자소서 목록에 오면, 필터는 "공고 마감일순"인데
//   카드는 넣은 순으로 늘어서 있다. 정렬 버튼을 다시 누르면 고쳐진다.
// 원인: 카드 순서는 클라이언트 정렬이 아니라 서버가 자소서마다 매겨준 순서값으로 그려진다.
//   사이트의 sort(key)가 POST /resume/scheduler_season_sort.json 로 그 값을 다시 받아오는
//   구조라, 새로 만든 자소서만 낡은 순서값으로 끼어든다.
// 고침: 어긋났을 때만 사이트 정렬 버튼을 한 번 대신 눌러준다(클릭 위임).
//
// **비용 설계** — "매 로드마다 느려지지 않겠냐"는 우려에 대한 답:
//   - 감사는 DOM 속성 읽기 + 숫자 비교뿐이다. 레이아웃을 건드리지 않는다
//     (접힌 섹션 판정도 getBoundingClientRect가 아니라 offsetParent로 한다).
//   - 순서가 멀쩡하면 **네트워크 0회, DOM 쓰기 0회**. 아무 일도 안 한다.
//   - 교정 결과는 서버에 저장된다 → 다음 로드부터는 이미 맞으므로 감사만 하고 끝난다.
//     즉 실제로 도는 건 "공고를 새로 담은 직후 한 번"뿐이다.
//   - 페이지 로드당 교정은 최대 MAX_FIX회, 간격 MIN_GAP 이상. POST 루프를 구조적으로 막는다.
JSL.register('list-sort', function () {
  'use strict';

  // 교정은 서버에 저장되므로 페이지 로드당 **한 번이면 충분하다.** 2회로 뒀더니 교정이
  // 부른 재렌더가 다시 감사를 부르는 경로가 생겼다 — 사이트는 카드를 재생성할 때마다
  // 진행률 타일을 날려서, 재렌더 한 번이 그대로 화면 깜빡임이 된다.
  var MAX_FIX = 1;
  var MIN_GAP = 30000;    // 교정 사이 최소 간격
  var SETTLE = 1800;      // 교정 POST가 반영될 때까지 기다리는 시간

  var fixes = 0;
  var lastFix = 0;
  var busy = false;
  var lastIds = '';       // 카드 구성이 바뀌었는지 판정용
  var gaveUp = false;

  function onListPage() {
    return location.pathname.indexOf('/resume_list') === 0;
  }

  function audit() {
    return JSL.action('sortAudit').then(function (r) {
      return r && r.ok ? r.data : null;
    });
  }

  function run(retry) {
    if (busy || gaveUp || !onListPage()) return;
    if (fixes >= MAX_FIX) return;
    if (Date.now() - lastFix < MIN_GAP) return;

    busy = true;
    audit().then(function (a) {
      if (!a || a.skipped || !a.needsFix || a.checked < 2) { busy = false; return; }

      fixes++;
      lastFix = Date.now();
      JSL.action('sortFix').then(function (r) {
        if (!r || !r.ok) {
          // 정렬 버튼을 못 찾았다 = 사이트 구조 변경. 조용히 포기한다.
          gaveUp = true;
          console.warn('[자비스] 목록 정렬 버튼을 찾지 못해 자동 교정을 껐습니다.');
          busy = false;
          return;
        }
        setTimeout(function () {
          busy = false;
          if (retry) return; // 재시도의 재시도는 하지 않는다
          audit().then(function (b) {
            if (b && b.needsFix) {
              // 한 번 더 눌러도 안 맞으면 우리가 판정을 잘못하고 있는 것이다.
              // 계속 POST를 날리느니 끈다.
              gaveUp = true;
              console.warn('[자비스] 정렬 교정 후에도 순서가 맞지 않아 자동 교정을 껐습니다.');
            }
          });
        }, SETTLE);
      });
    }, function () {
      busy = false;
    });
  }

  // 카드 "구성"이 바뀐 순간에만 다시 본다 — 타이핑·드래그마다 도는 걸 막는다.
  // **정렬해서 담는다**: 순서까지 포함하면 우리가 고쳐서 순서가 바뀐 것 자체가 다시 감사를
  // 부르는 되먹임이 된다. 우리가 알고 싶은 건 "자소서가 늘거나 줄었나"뿐이다.
  JSL.onState(function (state) {
    try {
      if (!state || state.page !== 'list' || !Array.isArray(state.resumes)) return;
      var ids = state.resumes.map(function (r) { return r.id; }).sort().join(',');
      if (ids === lastIds) return;
      lastIds = ids;
      if (!state.resumes.length) return;
      // 렌더가 끝난 뒤에 봐야 DOM 순서가 진실이다
      setTimeout(function () { run(false); }, 300);
    } catch (e) { /* 예외 전파 금지 */ }
  });
});
