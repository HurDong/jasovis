// 목록 페이지: 전형 단계별 통과율 통계 바 (SPEC.md '통계 산정식' 참조)
// 포커스는 통과율 — 개수는 사이트가 이미 보여주므로 비율/분수 중심으로 표시한다.
JSL.register('list-stats', function () {
  'use strict';

  var BAR_ID = 'jsl-stats-bar';
  var lastHTML = '';

  // 카테고리 코드 (SPEC.md): 1 제출완료 / 2,3 서류 합불 / 6,7 1차 / 8,9 2차 / 4,5 최종
  function compute(resumes) {
    var c = {};
    resumes.forEach(function (r) { c[r.category] = (c[r.category] || 0) + 1; });
    var n = function (k) { return c[k] || 0; };

    var afterSeoryu = n(6) + n(7) + n(8) + n(9) + n(4) + n(5); // 1차 이후로 간 것 = 서류 통과 확정
    var after1st = n(8) + n(9) + n(4) + n(5);
    var after2nd = n(4) + n(5);

    return {
      applied: n(1) + n(2) + n(3) + afterSeoryu,
      waiting: n(1),
      seoryu: { pass: n(2) + afterSeoryu, done: n(2) + n(3) + afterSeoryu },
      first: { pass: n(6) + after1st, done: n(6) + n(7) + after1st },
      second: { pass: n(8) + after2nd, done: n(8) + n(9) + after2nd },
      final: { pass: n(4), done: n(4) + n(5) }
    };
  }

  // 표본 5 미만이면 %가 요동치므로 분수만, 이상이면 % + 분수
  function fmt(st) {
    if (st.done === 0) return '<b class="dim">–</b>';
    if (st.done < 5) return '<b>' + st.pass + '/' + st.done + '</b>';
    return '<b>' + (st.pass / st.done * 100).toFixed(1) + '%</b> <span class="frac">(' + st.pass + '/' + st.done + ')</span>';
  }

  function ensureStyle() {
    if (document.getElementById('jsl-stats-style')) return;
    var st = document.createElement('style');
    st.id = 'jsl-stats-style';
    st.textContent = [
      '#' + BAR_ID + '{display:flex;align-items:center;gap:18px;flex-wrap:wrap;',
      '  margin:6px 0 10px;padding:9px 16px;background:#fff;border:1px solid #f2e6dc;',
      '  border-radius:12px;font-size:12.5px;color:#6b5f53;',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;}',
      '#' + BAR_ID + ' .item{display:flex;align-items:baseline;gap:6px;white-space:nowrap;}',
      '#' + BAR_ID + ' .label{font-weight:600;color:#8a7c6d;}',
      '#' + BAR_ID + ' b{color:#ff6a00;font-weight:800;font-size:13.5px;}',
      '#' + BAR_ID + ' b.dim{color:#c4b3a1;}',
      '#' + BAR_ID + ' .frac{color:#b3a493;font-size:11px;}',
      '#' + BAR_ID + ' .sep{width:1px;height:14px;background:#f0e6db;}',
      '#' + BAR_ID + ' .brand{margin-left:auto;font-size:10.5px;color:#d9cbbc;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function render(stats) {
    ensureStyle();
    var html =
      '<span class="item"><span class="label">서류 통과율</span>' + fmt(stats.seoryu) + '</span>' +
      '<span class="sep"></span>' +
      '<span class="item"><span class="label">1차</span>' + fmt(stats.first) + '</span>' +
      '<span class="sep"></span>' +
      '<span class="item"><span class="label">2차</span>' + fmt(stats.second) + '</span>' +
      '<span class="sep"></span>' +
      '<span class="item"><span class="label">최종 합격</span>' + fmt(stats.final) + '</span>' +
      '<span class="sep"></span>' +
      '<span class="item"><span class="label">발표 대기</span><b>' + stats.waiting + '</b></span>' +
      '<span class="item"><span class="label">지원</span><b>' + stats.applied + '</b></span>' +
      '<span class="brand">자비스</span>';

    var bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      // 보드(.scheduler를 감싸는 .resume-list-body) 상단에 삽입, 못 찾으면 검색줄 아래 대안
      var body = document.querySelector('.resume-list-body');
      if (body) body.insertBefore(bar, body.firstChild);
      else return; // 구조 변경 시 조용히 포기 (다음 주기에 재시도)
      lastHTML = '';
    }
    if (html !== lastHTML) {
      bar.innerHTML = html;
      lastHTML = html;
    }
  }

  var lastStats = null;

  JSL.onState(function (state) {
    try {
      if (!state || state.page !== 'list' || !Array.isArray(state.resumes)) return;
      lastStats = compute(state.resumes);
      render(lastStats);
    } catch (e) { /* 예외 전파 금지 */ }
  });

  // 재렌더로 바가 사라졌으면 복구 (2초 state 주기 사이의 공백 대비)
  setInterval(function () {
    try {
      if (lastStats && !document.getElementById(BAR_ID)) render(lastStats);
    } catch (e) { /* 무시 */ }
  }, 1000);
});
