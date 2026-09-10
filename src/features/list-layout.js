// 목록 A안: 전체 전형 표시, 작성 중·제출 완료의 독립 스크롤과 작은 창 한 열 배치.
// 원래 카드/분류/이벤트는 보존한다. 공통 스크롤 위치를 쓰는 사이트의 왼쪽 가상 목록은
// 전체를 렌더하는 범위로 확장하고 CSS grid로 배치한다. 많은 카드일수록 DOM 비용이 늘어난다.
// 드래그 중에는 원본의 일반 목록 분기와 패널 안의 드롭 범위를 사용한다. 저장은 사이트가 맡는다.
// 높이 계산·구조 대기·SPA 해제 및 검증 범위는 SPEC.md 참조.
JSL.register('list-layout', function () {
  'use strict';

  var MIN_BOARD = 380;   // 이보다 짧아지면 보드가 못 쓰게 된다 — 차라리 바깥 스크롤을 허용한다
  var AI_MAX_RATIO = 0.20; // 자주 쓰는 작성 중·제출 완료 영역의 높이를 먼저 확보한다
  var STRUCTURE_WAIT = 6000; // 첫 렌더나 보드 교체 중에는 구조를 잠시 기다린다

  function onListPage() {
    return location.pathname.indexOf('/resume_list') === 0;
  }

  // 카드·헤더·dropzone은 옮기거나 복제하지 않는다. 사이트 이벤트와 category_key를 보존한다.
  var decorated = new Map();
  var anchor = null;
  var dragging = false;
  var suspended = [];
  var dragLists = [];
  var stageCounts = null;
  var stageCountKey = '';

  function decorateStages() {
    var steps = { '2': '01', '6': '02', '8': '03', '4': '04' };
    document.querySelectorAll('.scheduler .scheduler-column').forEach(function (col) {
      var lists = Array.from(col.querySelectorAll('ul.itemlist[category_key]')).filter(function (ul) {
        return /^[23456789]$/.test(ul.getAttribute('category_key'));
      });
      if (!lists.length) return;
      var first = lists[0].getAttribute('category_key');
      if (!steps[first]) return;
      decorateClass(col, 'jsl-stage');
      var title = col.querySelector(':scope > .title');
      if (title) decorateAttr(title, 'data-jsl-stage-number', steps[first]);
      var allEmpty = !!stageCounts;
      lists.forEach(function (ul) {
        var key = ul.getAttribute('category_key'), section = ul.closest('.list-container');
        if (!section) return;
        decorateAttr(section, 'data-jsl-result', ['2', '6', '8', '4'].indexOf(key) >= 0 ? 'pass' : 'fail');
        var empty = !!stageCounts && !stageCounts.get(Number(key)) && !ul.querySelector('li.resume-node');
        decorateAttr(section, 'data-jsl-empty', String(empty));
        if (!empty) allEmpty = false;
      });
      decorateAttr(col, 'data-jsl-empty-stage', String(allEmpty));
    });
  }

  function decorateClass(el, name) {
    if (el.classList.contains(name)) return;
    if (!decorated.has(el)) decorated.set(el, { classes: [], attrs: {} });
    decorated.get(el).classes.push(name);
    el.classList.add(name);
  }

  function decorateAttr(el, name, value) {
    if (!decorated.has(el)) decorated.set(el, { classes: [], attrs: {} });
    var attrs = decorated.get(el).attrs;
    if (!Object.prototype.hasOwnProperty.call(attrs, name)) attrs[name] = el.getAttribute(name);
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function decorate() {
    var column = document.querySelector('.scheduler-column.column2:not(.ai-resume-column)');
    if (!column) return;
    decorateClass(column, 'jsl-writing-column');
    decorateClass(column.parentElement, 'jsl-work-group');
    document.querySelectorAll('.scheduler-column.column2').forEach(function (el) {
      decorateClass(el, 'jsl-grid-column');
    });
    column.querySelectorAll('ul.itemlist[category_key]').forEach(function (ul) {
      var key = ul.getAttribute('category_key');
      if (['0', '1', '10'].indexOf(key) === -1) return;
      var pane = ul.closest('.list-container');
      if (!pane) return;
      decorateClass(pane, 'jsl-pane');
      decorateClass(pane, 'list-scroll-area');
      decorateAttr(pane, 'data-jsl-category', key);
      decorateAttr(pane, 'tabindex', '0');
      decorateAttr(pane, 'aria-label', ({ 0: '작성 중', 1: '제출 완료', 10: '미제출' })[key] + ' 자소서 목록');
    });
    decorateStages();
    var ctrl = column.closest('.scheduler-resume-list-ctrl');
    if (!anchor || !anchor.isConnected) {
      anchor = document.createElement('div');
      anchor.className = 'column2 jsl-render-anchor';
      anchor.setAttribute('aria-hidden', 'true');
      anchor.innerHTML = '<div class="list-scroll-area"></div>';
      ctrl.appendChild(anchor);
    }
    // SPA가 제거한 구조는 참조에서 빼서 재렌더마다 누적되지 않게 한다.
    decorated.forEach(function (_, el) { if (!el.isConnected) decorated.delete(el); });
    document.querySelectorAll('.scheduler li.resume-node[resume_node_id]').forEach(function (li) {
      if (li.hasAttribute('title') && !li.hasAttribute('data-jsl-card-title')) return;
      var name = li.querySelector('.name');
      var time = li.querySelector('.end-time .date, .soon-schedule .date');
      var text = name ? name.textContent.trim() : '';
      if (time) text += '\n' + time.textContent.trim();
      if (li.title !== text) li.title = text;
      if (!li.hasAttribute('data-jsl-card-title')) li.setAttribute('data-jsl-card-title', '1');
    });
  }

  function cleanup() {
    decorated.forEach(function (saved, el) {
      saved.classes.forEach(function (name) { el.classList.remove(name); });
      Object.keys(saved.attrs).forEach(function (name) {
        if (saved.attrs[name] === null) el.removeAttribute(name);
        else el.setAttribute(name, saved.attrs[name]);
      });
    });
    decorated.clear();
    if (anchor) anchor.remove();
    anchor = null;
    document.querySelectorAll('[data-jsl-card-title]').forEach(function (li) {
      li.removeAttribute('title');
      li.removeAttribute('data-jsl-card-title');
    });
  }

  // native DnD의 일반 목록 분기는 실제 카드 경계/DOM 순서로 삽입 위치를 정한다.
  // 드래그 동안만 왼쪽을 그 분기로 보내고, I()가 placeholder를 지우지 않도록
  // column2 렌더를 잠시 제외한다. anchor는 I()의 필수 스크롤 기준 노드를 유지한다.
  // pointer up의 capture 단계에서 복원하므로 사이트 q()/I()와 저장 처리는 원래대로 실행된다.
  // 네트워크 요청이나 별도의 정렬/이동 액션은 이 모듈에서 만들지 않는다.
  function prepareDrag(event) {
    if (dragging || !applied || !onListPage()) return;
    if (event.type === 'mousedown' && event.button !== 0) return;
    var card = event.target.closest && event.target.closest('.scheduler li.resume-node[resume_node_id]');
    if (!card || card.closest('.ai-creating')) return;
    document.documentElement.style.setProperty('--jsl-drag-h', card.getBoundingClientRect().height + 'px');
    suspended = Array.from(document.querySelectorAll('.scheduler-column.column2')).map(function (el) {
      return { el: el, hadColumn1: el.classList.contains('column1') };
    });
    dragging = true;
    // 미제출처럼 평소 접혀 있는 칸이 드래그 동안만 받을 자리를 열 수 있게 신호를 준다.
    // mousedown 캡처 단계라 사이트가 좌표를 재기 전이다 — 드래그 자체에는 영향이 없다.
    document.documentElement.classList.add('jsl-dragging');
    suspended.forEach(function (item) {
      item.el.classList.remove('column2');
      item.el.classList.add('column1');
    });
    dragLists = Array.from(document.querySelectorAll('.jsl-grid-column .dropzone > ul.itemlist:not(.header-itemlist)'));
    updateDragBounds();
  }

  // 원본 DnD는 overflow에 잘린 부분까지 ul의 사각형으로 판정한다. 스크롤 내용은
  // 그대로 두고 ul 자체의 하단만 현재 패널 바닥으로 제한해 아래 패널을 가리지 않게 한다.
  function updateDragBounds() {
    if (!dragging) return;
    dragLists.forEach(function (ul) {
      var pane = ul.closest('.list-scroll-area');
      var height = Math.max(0, pane.getBoundingClientRect().bottom - ul.getBoundingClientRect().top - 2);
      ul.style.setProperty('--jsl-hit-h', height + 'px');
    });
  }

  function restoreDrag() {
    if (!dragging) return;
    dragLists.forEach(function (ul) { ul.style.removeProperty('--jsl-hit-h'); });
    dragLists = [];
    suspended.forEach(function (item) {
      item.el.classList.add('column2');
      if (!item.hadColumn1) item.el.classList.remove('column1');
    });
    suspended = [];
    dragging = false;
    document.documentElement.classList.remove('jsl-dragging');
    document.documentElement.style.removeProperty('--jsl-drag-h');
    schedule(0);
  }

  document.addEventListener('mousedown', prepareDrag, true);
  document.addEventListener('touchstart', prepareDrag, { capture: true, passive: true });
  document.addEventListener('mouseup', restoreDrag, true);
  document.addEventListener('touchend', restoreDrag, true);
  document.addEventListener('touchcancel', restoreDrag, true);
  document.addEventListener('scroll', updateDragBounds, true);
  document.addEventListener('mousemove', updateDragBounds, true);
  document.addEventListener('touchmove', updateDragBounds, { capture: true, passive: true });
  window.addEventListener('blur', restoreDrag);

  // ── "아래에 카드가 더 있어요" 힌트 (SPEC.md "패널 아래 스크롤 힌트" 절) ──────────
  // 작성 중·제출 완료 패널이 안쪽 스크롤로 카드를 잘라 먹을 때만, 패널 바닥 가운데에
  // "N개 더" 알약을 띄운다. 누르면 그 dropzone을 한 화면 아래로 내린다.
  // 스크롤이 맨 아래에 닿거나 애초에 안 잘렸으면 감춘다. 표시는 list-design.css가 맡는다.
  var HINT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function hintFor(pane) {
    var hint = pane.querySelector(':scope > .jsl-morehint');
    if (!hint) {
      hint = document.createElement('button');
      hint.type = 'button';
      hint.className = 'jsl-morehint';
      hint.hidden = true;
      hint.addEventListener('click', function () {
        var dz = pane.querySelector(':scope > .dropzone');
        if (dz) dz.scrollBy({ top: Math.max(120, Math.round(dz.clientHeight * 0.85)), behavior: 'smooth' });
      });
      pane.appendChild(hint);
    }
    return hint;
  }

  function updateMoreHints() {
    if (!applied) return;
    var panes = document.querySelectorAll(
      '.scheduler .jsl-pane[data-jsl-category="0"], .scheduler .jsl-pane[data-jsl-category="1"]'
    );
    for (var i = 0; i < panes.length; i++) {
      var pane = panes[i];
      var hint = hintFor(pane);
      var dz = pane.querySelector(':scope > .dropzone');
      if (dragging || !dz || !dz.clientHeight || dz.classList.contains('ng-hide')) { hint.hidden = true; continue; }
      if (dz.scrollHeight - dz.scrollTop - dz.clientHeight <= 8) { hint.hidden = true; continue; }
      var fold = dz.getBoundingClientRect().bottom;
      var lis = dz.querySelectorAll('li.resume-node[resume_node_id]');
      var clipped = 0;
      for (var j = 0; j < lis.length; j++) {
        if (lis[j].getBoundingClientRect().top >= fold - 8) clipped++;
      }
      if (clipped <= 0) { hint.hidden = true; continue; }
      var label = clipped + '개 더';
      if (hint.getAttribute('data-jsl-n') !== String(clipped)) {
        hint.setAttribute('data-jsl-n', String(clipped));
        hint.innerHTML = HINT_ICON + label;
        hint.setAttribute('aria-label', '아래로 ' + label + ' 보기');
      }
      hint.hidden = false;
    }
  }

  var hintRaf = 0;
  document.addEventListener('scroll', function (event) {
    if (!applied || hintRaf) return;
    var t = event.target;
    if (!(t && t.nodeType === 1 && t.classList && t.classList.contains('dropzone'))) return;
    hintRaf = requestAnimationFrame(function () { hintRaf = 0; updateMoreHints(); });
  }, true);

  // 보드 위(글로벌 헤더·검색창·정렬줄·자비스 통계바)를 뺀 나머지가 보드 몫이다.
  // 바깥 스크롤러는 window가 아니라 .resume-list-tmpl-container다 (실측: document는 안 늘어남).
  function outerEl() {
    return document.querySelector('.resume-list-tmpl-container');
  }

  function computeBoard() {
    var scheduler = document.querySelector('.scheduler');
    var outer = outerEl();
    if (!scheduler || !outer || !scheduler.querySelector(
      '.scheduler-container > .scheduler-column > .list-scroll-area'
    )) return null;
    var sr = scheduler.getBoundingClientRect();
    var or_ = outer.getBoundingClientRect();
    // 스크롤 위치와 무관하게: 바깥 표시영역의 바닥 - 보드 상단
    return Math.round(or_.top + outer.clientHeight - sr.top);
  }

  // AI 칼럼은 카드 수에 따라 높이가 변한다. 우리가 높이를 씌운 뒤에도 내용 높이를 알 수 있게
  // scrollHeight로 잰다(우리가 건 height의 영향을 안 받는다).
  //
  // **0장이면 제목줄만 남긴다.** 이 칼럼은 실제로 쓰는 '자기소개서 작성 지원' 칼럼 바로 위에
  // 얹혀 있어서, 비어 있어도 151px을 먹고 그만큼 아래 칼럼을 깎는다(실측). 제목줄만 남기면
  // '만들기' 버튼은 그대로 보이면서 작성지원 칼럼이 730px → 842px이 된다.
  function computeAi(boardH) {
    var ai = document.querySelector('.scheduler-column.ai-resume-column');
    if (!ai) return 0;
    var title = ai.querySelector('.title');
    var titleH = title ? title.offsetHeight : 0;
    if (!ai.querySelectorAll('li.resume-node').length) return titleH + 6;
    var area = ai.querySelector('.list-scroll-area');
    var natural = titleH + (area ? area.scrollHeight : 0) + 8;
    return Math.max(0, Math.min(natural, 120, Math.round(boardH * AI_MAX_RATIO)));
  }

  var applied = false;
  var disabled = false;
  var missingSince = null;

  function apply() {
    if (disabled || dragging) return;
    if (!onListPage()) {
      missingSince = null;
      if (applied) release();
      return;
    }

    var boardH = computeBoard();
    if (boardH === null) {
      if (missingSince === null) missingSince = Date.now();
      if (Date.now() - missingSince >= STRUCTURE_WAIT) {
        disabled = true;
        release();
        if (mo) mo.disconnect();
        console.warn('[자비스] 목록 보드 구조를 찾지 못해 보드 높이 고정을 껐습니다.');
      } else schedule(500);
      return;
    }
    missingSince = null;
    if (boardH < MIN_BOARD) { release(); return; } // 화면이 너무 짧다 → 손대지 않는다
    decorate();

    var root = document.documentElement;
    // 변수는 .scheduler가 아니라 root에 건다 — Angular가 보드를 통째로 다시 그려도 안 날아간다.
    root.style.setProperty('--jsl-board-h', boardH + 'px');
    root.style.setProperty('--jsl-ai-h', computeAi(boardH) + 'px');
    root.classList.add('jsl-fit');
    var width = document.querySelector('.scheduler').clientWidth;
    root.classList.toggle('jsl-compact', width < 1440);
    root.classList.toggle('jsl-narrow', width < 1000);
    // 상단 도구 모음 압축으로 바뀐 보드 시작 위치를 같은 프레임에서 반영한다.
    boardH = computeBoard();
    root.style.setProperty('--jsl-board-h', boardH + 'px');
    root.style.setProperty('--jsl-ai-h', computeAi(boardH) + 'px');
    applied = true;

    // 보정 1회: 보드 아래에 뭐가 더 있으면(푸터·광고 등) 그만큼 덜 준다.
    // 사이트 여백을 우리가 모델링하는 대신 결과를 재서 깎는다.
    var outer = outerEl();
    if (outer) {
      var over = outer.scrollHeight - outer.clientHeight;
      if (over > 1) {
        var fixed = boardH - over;
        if (fixed >= MIN_BOARD) {
          root.style.setProperty('--jsl-board-h', fixed + 'px');
          root.style.setProperty('--jsl-ai-h', computeAi(fixed) + 'px');
        }
      }
    }

    try { updateMoreHints(); } catch (e) { /* 힌트는 부가 기능 — 실패해도 보드 배치는 유지 */ }
  }

  function release() {
    if (!applied) return;
    applied = false;
    restoreDrag();
    document.querySelectorAll('.scheduler .jsl-morehint').forEach(function (n) { n.remove(); });
    cleanup();
    document.documentElement.classList.remove('jsl-fit', 'jsl-compact', 'jsl-narrow', 'jsl-dragging');
    document.documentElement.style.removeProperty('--jsl-board-h');
    document.documentElement.style.removeProperty('--jsl-ai-h');
  }

  // ── 재적용 ────────────────────────────────────────
  // 사이트가 보드를 수시로 재생성한다(진행률 타일이 날아가는 것과 같은 원인).
  // 클래스와 변수는 root에 있어 살아남지만, AI 칼럼 높이와 헤더 높이는 다시 재야 한다.
  var mo = null;
  var timer = null;

  function schedule(delay) {
    if (disabled || timer) return; // 이미 예약됨 — 몰아치는 변경에 요청이 쌓이지 않게
    timer = setTimeout(function () {
      timer = null;
      try { apply(); } catch (e) { /* 예외 전파 금지 */ }
      if (mo) mo.takeRecords();    // 방금 우리가 만든 변경은 버린다 (자기 유발 루프 차단)
    }, delay);
  }

  window.addEventListener('resize', function () { schedule(120); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') schedule(0);
  });

  // 카드가 늘거나 줄면 AI 칼럼 높이가 달라질 수 있다
  JSL.onState(function (state) {
    try {
      if (!state || state.page !== 'list') { if (applied) release(); return; }
      if (Array.isArray(state.resumes)) {
        stageCounts = new Map();
        state.resumes.forEach(function (r) {
          var key = Number(r.category);
          stageCounts.set(key, (stageCounts.get(key) || 0) + 1);
        });
        var countKey = Array.from(stageCounts.entries()).sort(function (a, b) { return a[0] - b[0]; }).map(function (entry) { return entry.join(':'); }).join('|');
        if (applied && countKey === stageCountKey) return;
        stageCountKey = countKey;
      }
      schedule(0);
    } catch (e) { /* 무시 */ }
  });

  function affectsLayout(record) {
    var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    if (target && target.closest('.jsl-tile, .jsl-seg, .jsl-morehint')) return false;
    var relevant = '.scheduler, .resume-search-section, #jsl-stats-bar, #jsl-watch-section';
    if (record.type === 'childList') {
      var changed = Array.from(record.addedNodes).concat(Array.from(record.removedNodes));
      if (changed.length && changed.every(function (node) {
        return node.nodeType === 1 && node.matches('.jsl-tile, .jsl-seg, .jsl-morehint');
      })) return false;
      if (changed.some(function (node) { return node.nodeType === 1 && (node.matches(relevant) || node.querySelector(relevant)); })) return true;
    }
    return !!(target && target.closest(relevant));
  }
  mo = new MutationObserver(function (records) {
    if (records.some(affectsLayout)) schedule(0);
  });
  try {
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  } catch (e) { /* body 없음 — onState 주기만으로 동작 */ }

  // 첫 진입과 SPA 이동 모두 apply에서 같은 유예 시간으로 구조를 기다린다.
  schedule(0);
});
