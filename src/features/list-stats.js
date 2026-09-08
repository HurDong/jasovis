// 목록 페이지: 전형 여정 트랙 (SPEC.md '통계 산정식' 참조)
// 통과율 산정식은 그대로 두고, 표시를 툴바 구석의 한 줄 바에서 보드 위 트랙으로 옮긴다.
// 각 단계 수치가 그 아래 카드 더미 바로 위에 서도록 보드와 같은 격자에 정렬한다.
JSL.register('list-stats', function () {
  'use strict';

  var TRACK_ID = 'jsl-track';
  var lastHTML = '';

  // 카테고리 코드 (SPEC.md): 0 작성중 / 1 제출완료 / 2,3 서류 합불 / 6,7 1차 / 8,9 2차 / 4,5 최종
  function compute(resumes) {
    var c = {};
    resumes.forEach(function (r) { c[r.category] = (c[r.category] || 0) + 1; });
    var n = function (k) { return c[k] || 0; };

    var afterSeoryu = n(6) + n(7) + n(8) + n(9) + n(4) + n(5); // 1차 이후로 간 것 = 서류 통과 확정
    var after1st = n(8) + n(9) + n(4) + n(5);
    var after2nd = n(4) + n(5);

    var applied = n(1) + n(2) + n(3) + afterSeoryu;
    var seoryu = { pass: n(2) + afterSeoryu, done: n(2) + n(3) + afterSeoryu };
    var first = { pass: n(6) + after1st, done: n(6) + n(7) + after1st };
    var second = { pass: n(8) + after2nd, done: n(8) + n(9) + after2nd };
    var final = { pass: n(4), done: n(4) + n(5) };

    // 도달 = 앞 단계를 통과해 이 단계로 흘러온 수. 대기 = 도달했는데 결과가 안 나온 수.
    seoryu.reach = applied;
    first.reach = seoryu.pass;
    second.reach = first.pass;
    final.reach = second.pass;
    [seoryu, first, second, final].forEach(function (s) {
      s.wait = Math.max(0, s.reach - s.done);
    });

    return {
      writing: n(0),
      submitted: n(1),
      resolved: applied - n(1),
      applied: applied,
      stages: [
        { key: 'seoryu', name: '서류전형', st: seoryu },
        { key: 'first', name: '1차 전형', st: first },
        { key: 'second', name: '2차 전형', st: second },
        { key: 'final', name: '3차 전형(최종)', st: final }
      ]
    };
  }

  // 표본 5 미만이면 %가 요동치므로 분수만, 이상이면 %
  function label(st) {
    if (!st.done) return '–';
    if (st.done < 5) return st.pass + '/' + st.done;
    return Math.round(st.pass / st.done * 100) + '%';
  }

  var ARC = 'M8 36 A28 28 0 0 1 64 36';
  var ARC_LEN = Math.PI * 28;

  function gauge(st, i) {
    var has = st.done > 0;
    var rate = has ? st.pass / st.done * 100 : 0;
    var fill = has
      ? '<path d="' + ARC + '" fill="none" stroke="var(--jsl-stage-' + i + ')" stroke-width="8"'
        + ' stroke-linecap="round" stroke-dasharray="' + (ARC_LEN * rate / 100).toFixed(1)
        + ' ' + ARC_LEN.toFixed(1) + '"/>'
      : '';
    return '<span class="jsl-gauge' + (has ? '' : ' none') + '">'
      + '<svg width="72" height="42" viewBox="0 0 72 42" aria-hidden="true">'
      + '<path d="' + ARC + '" fill="none" stroke="#ebedf0" stroke-width="8" stroke-linecap="round"/>'
      + fill + '</svg><b>' + label(st) + '</b></span>';
  }

  // 지나온 구간의 화살촉은 그 단계 색, 아직 결과가 없는 구간은 회색.
  function chevron(st, i) {
    var color = st.done > 0 ? 'var(--jsl-stage-' + i + ')' : '#dcdfe3';
    var arm = function (cls, x) {
      return '<path class="' + cls + '" d="M' + x + ' 4l6 6-6 6" fill="none" stroke="' + color
        + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
    };
    return '<span class="jsl-link"><svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true">'
      + arm('c1', 7) + arm('c2', 15) + '</svg></span>';
  }

  function build(s) {
    var total = s.writing + s.applied;
    var seg = function (flex, cls) {
      return flex > 0 ? '<span class="' + cls + '" style="flex:' + flex + '"></span>' : '';
    };
    // 화살촉은 다음 단계를 가리키므로 앞 칸의 꼬리에 붙인다. 남는 폭 한가운데에 놓인다.
    var next = function (i) {
      return i < s.stages.length ? chevron(s.stages[i].st, i) : '';
    };

    var html = '<div class="jsl-tn jsl-entry"><div class="jsl-bd">'
      + '<div class="jsl-k">전체</div>'
      + '<div class="jsl-big">' + total + '<em>건</em></div>'
      + '<div class="jsl-comp">'
        + seg(s.writing, 'w') + seg(s.submitted, 's') + seg(s.resolved, 'r') + '</div>'
      + '<div class="jsl-legend">'
        + '<span class="w">작성 중 ' + s.writing + '</span>'
        + '<span class="s">제출 완료 ' + s.submitted + '</span>'
        + '<span class="r">결과 확인 ' + s.resolved + '</span>'
      + '</div></div>' + next(0) + '</div>';

    s.stages.forEach(function (stage, i) {
      var st = stage.st;
      var tail = st.wait ? ' · 대기 ' + st.wait : '';
      html += '<div class="jsl-tn"><div class="jsl-bd">'
        + gauge(st, i)
        + '<div class="jsl-meta"><div class="jsl-k"><b>' + stage.name + '</b> 통과율</div>'
        + '<div class="jsl-tf">'
          + (st.done ? '<b>' + st.pass + '</b> 통과 / ' + st.done + ' 결과' + tail
                     : '결과 없음' + tail)
        + '</div></div></div>' + next(i + 1) + '</div>';
    });
    return html;
  }

  // 보드 바로 위에 둔다. 사이트 노드는 옮기지 않고 형제로만 끼운다.
  function mount() {
    var board = document.querySelector('.scheduler-resume-list-ctrl .scheduler')
      || document.querySelector('.scheduler');
    if (!board || !board.parentElement) return null;
    var track = document.getElementById(TRACK_ID);
    if (!track) {
      track = document.createElement('div');
      track.id = TRACK_ID;
      lastHTML = '';
    }
    if (track.nextElementSibling !== board) board.parentElement.insertBefore(track, board);
    return track;
  }

  // 통계 바를 쓰던 흔적을 걷는다.
  function dropOldBar() {
    var bar = document.getElementById('jsl-stats-bar');
    if (bar) bar.remove();
    var body = document.querySelector('.resume-search-body.jsl-stats-toolbar');
    if (body) body.classList.remove('jsl-stats-toolbar');
    var style = document.getElementById('jsl-stats-style');
    if (style) style.remove();
  }

  function render(s) {
    dropOldBar();
    var track = mount();
    if (!track) return;
    var html = build(s);
    if (html !== lastHTML) {
      track.innerHTML = html;
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

  // 재렌더로 트랙이 사라졌으면 복구 (2초 state 주기 사이의 공백 대비)
  setInterval(function () {
    try {
      if (!lastStats) return;
      var track = document.getElementById(TRACK_ID);
      if (!track || !track.parentElement || !track.nextElementSibling
        || !track.nextElementSibling.classList.contains('scheduler')) render(lastStats);
    } catch (e) { /* 무시 */ }
  }, 1000);
});
