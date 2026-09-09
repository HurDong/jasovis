// 목록 페이지: '작성 중' 카드 하단에 작은 작성량 숫자 + 진행 막대 (SPEC.md 참조)
// 대상: category === 0 (작성 중)만. 미제출(10)은 제외.
// 작성 숫자/전체 문항 수와 주황 막대를 함께 표시한다. 큰 좌측 타일은 제거한다.
// 모든 문항을 채워도 제출 완료가 아니므로 완료 초록이나 '완료' 문구를 쓰지 않는다.
// 주의: 사이트가 카드 리스트를 수시로 재렌더해 주입 노드가 날아간다(실페이지 검증됨)
//       → onState(2초 주기) + MutationObserver로 재적용한다.
//
// 겸해서 '마감 임박' 경고도 여기서 붙인다(SPEC.md "마감 임박 경고" 절).
// 대상 카드 = 작성 중 + 문항이 있고 + 마감이 '내일 23:59' 이내. 작성량과 무관하다
// (사용자 결정: 다 쓴 카드도 똑같이 칠한다 — 어차피 마감이 코앞이면 눈에 띄어야 한다).
// 표시는 CSS가 맡고, 여기서는 li에 data-jsl-urgent 속성만 켠다/끈다.
JSL.register('list-progress', function () {
  'use strict';

  var MAX_SEG = 20;  // 세그먼트가 실오라기가 되지 않는 상한. 넘으면 비율로 근사한다.

  var progressById = {}; // { resumeId: {filled, total, endTime} }

  // 마감이 오늘~내일 23:59(로컬) 안이면 임박으로 본다. 이미 지난 마감도 그 경계보다
  // 앞이므로 포함된다 — 마감이 지났는데 아직 작성 중인 초안도 똑같이 급한 상태다.
  function urgentDeadline(endTime) {
    if (!endTime) return false;
    var t = new Date(endTime).getTime();
    if (isNaN(t)) return false;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 1);
    cutoff.setHours(23, 59, 59, 999);
    return t <= cutoff.getTime();
  }

  function isUrgent(p) {
    return !!p && p.total > 0 && urgentDeadline(p.endTime);
  }

  // 카드 오버레이 공용 스타일 1회 주입
  function ensureStyle() {
    if (document.getElementById('jsl-progress-style')) return;
    var st = document.createElement('style');
    st.id = 'jsl-progress-style';
    st.textContent = [
      // 작성량은 카드 하단 우측에 둔다. 본문 폭은 list-design.css가 처음부터 확보한다.
      '.scheduler ul.itemlist[category_key="0"] > li.resume-node[resume_node_id],',
      '.scheduler li.resume-node[data-jsl-inset]{padding-left:12px !important;padding-bottom:12px !important;}',
      'li.resume-node .jsl-tile{position:absolute;left:auto;top:auto;bottom:12px;right:65px;z-index:1;',
      '  display:flex;flex-direction:row;align-items:baseline;gap:1px;background:transparent;',
      '  font-variant-numeric:tabular-nums;pointer-events:none;white-space:nowrap;}',
      'li.resume-node .jsl-tile::before{content:"작성";font-size:11px;margin-right:4px;color:#686d75;}',
      'li.resume-node .jsl-num,li.resume-node .jsl-den{font-size:11px;line-height:1.5;font-weight:600;color:#292d32;}',
      'li.resume-node .jsl-seg{position:absolute;left:auto;right:12px;bottom:17px;width:44px;z-index:1;',
      '  display:flex;gap:1px;pointer-events:none;}',
      'li.resume-node .jsl-seg > span{flex:1;height:3px;background:#e3e6e9;}',
      'li.resume-node .jsl-seg > span.on{background:#f26200;}',
      'li.resume-node .jsl-t1 .jsl-num,li.resume-node .jsl-t2 .jsl-num,',
      'li.resume-node .jsl-t2 .jsl-den,li.resume-node .jsl-t2::before{color:#a84000;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // 높이에 영향을 주는 여백은 위의 CSS가 미리 확보한다. 페인트는 공간을 더 늘리지 않는다.
  function reserveSpace(li) {
    if (li.hasAttribute('data-jsl-inset')) return;
    var cs = getComputedStyle(li);
    if (cs.position === 'static') li.style.position = 'relative';
    li.style.overflow = 'hidden';
    li.setAttribute('data-jsl-inset', '1');
  }

  function releaseSpace(li) {
    if (!li.hasAttribute('data-jsl-inset')) return;
    li.removeAttribute('data-jsl-inset');
    li.style.paddingLeft = '';
    li.style.paddingBottom = '';
  }

  function paint(li, p) {
    var total = p.total;
    var filled = Math.min(p.filled, total);
    var key = filled + '/' + total;

    var tile = li.querySelector('.jsl-tile');
    // 이미 그려져 있고 값도 같으면 스킵
    if (tile && tile.getAttribute('data-key') === key) return;

    reserveSpace(li);

    if (!tile) {
      tile = document.createElement('div');
      tile.innerHTML = '<span class="jsl-num"></span><span class="jsl-den"></span>';
      li.appendChild(tile);
    }
    // 0 = 미작성 / 1 = 작성 중 / 2 = 전 문항 채움
    var s = filled === 0 ? 0 : (filled >= total ? 2 : 1);
    tile.className = 'jsl-tile jsl-t' + s;
    tile.setAttribute('data-key', key);
    tile.title = '문항 ' + filled + '/' + total + ' 작성';
    tile.querySelector('.jsl-num').textContent = String(filled);
    tile.querySelector('.jsl-den').textContent = '/ ' + total;

    var seg = li.querySelector('.jsl-seg');
    if (!seg) {
      seg = document.createElement('div');
      seg.className = 'jsl-seg';
      li.appendChild(seg);
    }
    var cells = Math.min(total, MAX_SEG);
    if (seg.childElementCount !== cells) {
      var html = '';
      for (var i = 0; i < cells; i++) html += '<span></span>';
      seg.innerHTML = html;
    }
    // 문항이 MAX_SEG를 넘으면 칸=문항 대응이 깨지므로 비율로 근사한다(숫자는 실제값 유지).
    var on = total <= MAX_SEG ? filled : Math.round((filled / total) * cells);
    for (var j = 0; j < cells; j++) seg.children[j].className = j < on ? 'on' : '';

    // 카드 본문이 주입 레이어 위로 오게 (이미 올려둔 노드는 다시 쓰지 않는다)
    for (var k = 0; k < li.children.length; k++) {
      var ch = li.children[k];
      if ((ch.className + '').indexOf('jsl-') === -1 && ch.style.zIndex !== '1') {
        ch.style.position = 'relative';
        ch.style.zIndex = '1';
      }
    }
  }

  function unpaint(li) {
    var tile = li.querySelector('.jsl-tile');
    var seg = li.querySelector('.jsl-seg');
    if (tile) tile.remove();
    if (seg) seg.remove();
    if (li.hasAttribute('data-jsl-urgent')) li.removeAttribute('data-jsl-urgent');
    releaseSpace(li);
  }

  var mo = null;

  // 상태 응답을 기다리는 동안에도 사이트의 첫 카드 측정에 여백이 반영되어야 한다.
  ensureStyle();

  function applyAll() {
    try {
      ensureStyle();
      var nodes = document.querySelectorAll('li.resume-node[resume_node_id]');
      for (var i = 0; i < nodes.length; i++) {
        var li = nodes[i];
        var id = Number(li.getAttribute('resume_node_id'));
        var p = progressById[id];
        // 문항이 0개면 보여줄 진행이 없다 — 빈 타일은 노이즈다
        if (p && p.total > 0) paint(li, p);
        else if (li.querySelector('.jsl-tile')) unpaint(li); // 작성 중에서 벗어난 카드 정리
        // 마감 임박 경고: 표시는 CSS, 여기서는 속성만 토글한다
        if (isUrgent(p)) li.setAttribute('data-jsl-urgent', '1');
        else if (li.hasAttribute('data-jsl-urgent')) li.removeAttribute('data-jsl-urgent');
      }
    } catch (e) {
      console.warn('[자비스] 진행률 오버레이 적용 오류', e);
    } finally {
      // 방금 우리가 만든 변경 기록은 버린다 — 안 버리면 자기 자신을 다시 트리거한다
      if (mo) mo.takeRecords();
    }
  }

  function ingest(state) {
    if (!state || state.page !== 'list' || !Array.isArray(state.resumes)) return false;
    progressById = {};
    state.resumes.forEach(function (r) {
      if (r.category === 0) { // 작성 중만 (미제출 10 제외 — 사용자 결정)
        progressById[r.id] = { filled: r.qnaFilled, total: r.qnaTotal, endTime: r.endTime || null };
      }
    });
    return true;
  }

  // 2초 주기 브로드캐스트를 기다리면 드래그·새로고침 반응이 최대 2초 늦다(실페이지 측정).
  // 변화가 감지된 시점에 직접 당겨온다. 브로드캐스트는 안전망으로만 남긴다.
  var pullTimer = null;
  var pulling = false;
  var lastPull = 0;
  var pendingSince = 0;
  var MIN_GAP = 250;  // 연속 변경 중 요청이 몰리지 않게 하는 하한
  var MAX_WAIT = 200; // 디바운스를 미룰 수 있는 상한

  function pull() {
    if (pulling) return; // 진행 중인 요청에 합류
    pulling = true;
    lastPull = Date.now();
    JSL.getState().then(function (state) {
      pulling = false;
      if (ingest(state)) applyAll();
    }, function () {
      pulling = false;
    });
  }

  // 디바운스에 상한을 둔다. 상한이 없으면 사이트가 카드를 재생성하는 동안 변경이
  // 60ms보다 촘촘히 쏟아져서 clearTimeout이 계속 걸리고, **변경이 멎을 때까지 재도색이
  // 통째로 밀린다** — 실측 715~800ms 동안 타일이 사라져 있었다(2026-08-10 영상 분석).
  // 그 사이 카드는 들여쓰기까지 풀린 사이트 원래 모습이라, 붙었다 떨어졌다 하는 것처럼 보인다.
  function schedulePull(delay) {
    var now = Date.now();
    if (!pendingSince) pendingSince = now;
    // 첫 변경으로부터 MAX_WAIT이 지났으면 더 미루지 않고 이미 걸린 타이머를 그대로 터뜨린다
    if (pullTimer && now - pendingSince >= MAX_WAIT) return;
    var wait = Math.max(delay, MIN_GAP - (now - lastPull));
    if (pullTimer) clearTimeout(pullTimer);
    pullTimer = setTimeout(function () {
      pullTimer = null;
      pendingSince = 0;
      pull();
    }, wait);
  }

  JSL.onState(function (state) {
    try {
      if (ingest(state)) applyAll();
    } catch (e) { /* 예외 전파 금지 */ }
  });

  // 재렌더·드래그 대응: 카드 영역이 바뀌면 상태를 즉시 다시 읽고 그린다
  mo = new MutationObserver(function (records) {
    if (location.pathname.indexOf('/resume_list') !== 0) return;
    var relevant = records.some(function (record) {
      var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target && target.closest('.jsl-tile, .jsl-seg')) return false;
      var nodes = Array.from(record.addedNodes).concat(Array.from(record.removedNodes));
      if (nodes.length && nodes.every(function (node) { return node.nodeType === 1 && node.matches('.jsl-tile, .jsl-seg'); })) return false;
      if (target && target.closest('li.resume-node')) return true;
      return nodes.some(function (node) { return node.nodeType === 1 && (node.matches('li.resume-node') || node.querySelector('li.resume-node')); });
    });
    if (relevant) schedulePull(60);
  });
  try {
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) { /* body 없음 등 — onState 주기 적용만으로 동작 */ }

  // 백그라운드 탭에서는 브라우저가 타이머를 조인다 → 돌아온 순간 상태가 낡아 있다
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') schedulePull(0);
  });

  // 초기 진입: 첫 브로드캐스트를 기다리지 않는다.
  // 목록 스코프가 아직 없을 수 있어 잠깐 재시도한다(그려지면 멈춤).
  var tries = 0;
  (function bootstrap() {
    if (++tries > 12) return; // 약 6초
    JSL.getState().then(function (state) {
      if (ingest(state) && Object.keys(progressById).length) {
        applyAll();
        return;
      }
      setTimeout(bootstrap, 500);
    }, function () {
      setTimeout(bootstrap, 500);
    });
  })();
});
