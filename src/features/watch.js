// 준비중 공고 담아두기 (watch) — SPEC.md "준비중 공고 담아두기" 절 참조
//
// 문제: 자소서 문항이 아직 안 열린("자기소개서 준비중") 공고는 자소설닷컴에 자소서로
//   등록할 방법이 없다. 열람만 하고 나가면 그대로 잊혀 지원 자체를 놓친다.
// 해결: 공고 모달에서 "담아두기" → 자기소개서 목록(/resume_list) 맨 위 전용 섹션에
//   카드로 계속 띄운다. 토스트·데스크톱 알림은 쓰지 않는다(사용자 결정: 과함).
//   목록을 열 때마다 상태를 다시 조회해 카드가 스스로 3단계로 바뀐다.
//
// 판정 근거 (2026-08-10 실API 확인):
//   GET /api/v1/employment_companies/:id?skip_read_log=true
//     → employments[].has_resume 가 그 모집부문의 자소서 문항 개설 여부.
//       전부 false = 화면의 "자기소개서 준비중", 하나라도 true = "자기소개서 작성".
//       105406(서울특별시 통합채용) 49개 부문 전부 false,
//       105566(KT&G) 17개·105572(한국전력기술) 12개는 전부 true 로 확인.
//     ※ 목록 API(/api/v1/employment_companies?start_date=..)의 employments 에는
//       has_resume 가 아예 없다. 반드시 상세를 봐야 한다.
//   같은 응답의 employment_page_url = 회사 자체 채용 사이트(서울시는 seoul.saramin.co.kr).
//     자소설닷컴에 끝내 문항이 안 올라오는 공고가 있어서, 마감이 닥치면 이 링크로 유도한다.
//   GET /api/v1/resumes 의 resume.employment_id 를 employments[].id 와 맞추면
//     "이미 이 공고로 자소서를 만들었는지"가 나온다 (chat-jd.js가 쓰는 그 경로).
//
// 화면 두 곳:
//   1) /recruit?ec=<id> 공고 모달 — React(Next.js). 헤더 버튼줄(채용 사이트/공유/즐겨찾기)
//      바로 아래에 배너 한 줄. 리렌더로 노드가 날아가므로 폴링으로 다시 꽂는다.
//   2) /resume_list 자기소개서 목록 — AngularJS. '자기소개서 작성 지원' 보드의
//      .list-scroll-area 맨 앞에 전용 섹션을 하나 더 얹는다. 이 보드가 이미
//      작성 중 / 제출 완료 / 미제출 접이식 섹션 스택이라 한 칸 더 얹는 게 같은 문법이고,
//      사이트 카드와 안 섞여서 "작성 중 (4)" 개수와 어긋나지도 않는다.
JSL.register('watch', function () {
  'use strict';

  var KEY = 'jslWatch';
  var BAR_ID = 'jsl-watch-bar';
  var SEC_ID = 'jsl-watch-section';

  var STALE_DAYS = 2;          // 마감 D-2까지 문항이 안 열리면 회사 채용 사이트로 유도
  var DETAIL_TTL = 5 * 60000;  // 공고 상세 재조회 간격
  var TICK = 400;              // 모달 재주입 폴링 (React가 우리 노드를 날린다)

  var store = null;            // { "<ecId>": entry } — 로드되기 전엔 null
  var detailCache = {};        // ecId -> { at, p }
  var resumesPromise = null;   // 내 자소서 전체 (한 번만)
  var collapsed = false;       // 목록 섹션 접힘 (탭 수명 동안만 기억)

  // ── 저장소 ────────────────────────────────────────────────
  function load(cb) {
    try {
      chrome.storage.local.get(KEY, function (res) {
        store = (res && res[KEY]) || {};
        cb();
      });
    } catch (e) {
      store = {};
      cb();
    }
  }

  function save() {
    try {
      var payload = {};
      payload[KEY] = store;
      chrome.storage.local.set(payload);
    } catch (e) { /* 저장 실패는 무시 — 다음 담기 때 다시 시도 */ }
  }

  // ── API ───────────────────────────────────────────────────
  function api(url) {
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function loadDetail(ecId) {
    var c = detailCache[ecId];
    if (c && Date.now() - c.at < DETAIL_TTL) return c.p;
    var p = api('/api/v1/employment_companies/' + ecId + '?skip_read_log=true');
    detailCache[ecId] = { at: Date.now(), p: p };
    return p;
  }

  function getResumes() {
    if (!resumesPromise) {
      resumesPromise = api('/api/v1/resumes').then(function (list) {
        return Array.isArray(list) ? list : [];
      });
    }
    return resumesPromise;
  }

  // ── 판정 ──────────────────────────────────────────────────
  // 모집부문이 하나라도 문항을 열었으면 "열림". 부문이 아예 없는 공고는 판단 보류(준비중 아님).
  function isOpen(d) {
    var emps = (d && d.employments) || [];
    for (var i = 0; i < emps.length; i++) if (emps[i].has_resume) return true;
    return false;
  }

  function isPending(d) {
    var emps = (d && d.employments) || [];
    return emps.length > 0 && !isOpen(d);
  }

  function daysLeft(endTime) {
    if (!endTime) return null;
    var t = new Date(endTime).getTime();
    if (isNaN(t)) return null;
    return Math.ceil((t - Date.now()) / 86400000);
  }

  function ddayText(endTime) {
    var d = daysLeft(endTime);
    if (d === null) return '상시';
    if (d < 0) return '마감';
    if (d === 0) return '오늘 마감';
    return 'D-' + d + '일';
  }

  function fmtEnd(endTime) {
    var d = new Date(endTime);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function entryFrom(d) {
    return {
      id: d.id,
      name: d.name || '',
      title: d.title || '',
      endTime: d.end_time || null,
      pageUrl: d.employment_page_url || null,
      addedAt: Date.now()
    };
  }

  function shadow(host, css) {
    var sh = host.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent = css;
    sh.appendChild(st);
    return sh;
  }

  // ══════════════════════════════════════════════════════════
  //  1) 공고 모달 — 담아두기 배너
  // ══════════════════════════════════════════════════════════

  var BAR_CSS = [
    ':host{all:initial;display:block;}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:Pretendard,-apple-system,"Malgun Gothic",sans-serif;}',
    '.bar{display:flex;align-items:center;gap:11px;margin-top:10px;padding:10px 12px;',
    '  border:1px solid #ffd9bd;background:#fff3ea;border-radius:6px;}',
    '.bar.done{border-color:#e3e5e9;background:#f4f5f7;}',
    '.ic{flex:0 0 23px;width:23px;height:23px;border-radius:50%;background:#f26200;color:#fff;',
    '  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;line-height:1;}',
    '.bar.done .ic{background:#c74f00;}',
    '.tx{flex:1;min-width:0;}',
    '.t1{display:block;font-size:12.5px;font-weight:700;color:#c74f00;letter-spacing:-.01em;}',
    '.bar.done .t1{color:#1f2229;}',
    '.t2{display:block;font-size:11.5px;line-height:1.5;color:#72757d;margin-top:2px;}',
    'button{flex:0 0 auto;height:32px;padding:0 15px;border:0;border-radius:5px;cursor:pointer;',
    '  background:#f26200;color:#fff;font-size:12.5px;font-weight:700;white-space:nowrap;}',
    'button:hover{background:#d95500;}',
    '.bar.done button{background:transparent;color:#c74f00;border:1px solid #ffb98a;}',
    '.bar.done button:hover{background:#fff3ea;}'
  ].join('\n');

  var barHost = null;
  var barShadow = null;
  var barEcId = null;      // 지금 배너가 물고 있는 공고
  var barSig = null;       // 다시 그릴 필요 판정용

  function ecFromUrl() {
    var m = /[?&]ec=(\d+)/.exec(location.search);
    return m ? Number(m[1]) : null;
  }

  // 헤더 버튼줄(채용 사이트 / 채용 공고 공유 / 공고 즐겨찾기)을 찾는다.
  // Tailwind 클래스는 해시처럼 생겨서 못 믿는다 — 버튼 텍스트로 잡고 grid 컨테이너까지 올라간다.
  function findBarAnchor() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || '').indexOf('공고 즐겨찾기') < 0) continue;
      var grid = btns[i].closest('.grid');
      if (grid && grid.getBoundingClientRect().width > 0) return grid;
    }
    return null;
  }

  function removeBar() {
    if (barHost && barHost.parentNode) barHost.parentNode.removeChild(barHost);
    barHost = null;
    barShadow = null;
    barSig = null;
  }

  function drawBar(ecId, d) {
    var anchor = findBarAnchor();
    if (!anchor) { removeBar(); return; }

    var watched = !!(store && store[ecId]);
    var open = isOpen(d);
    var pending = isPending(d);

    // 준비중도 아니고 담아두지도 않았으면 배너를 띄울 이유가 없다
    if (!pending && !watched) { removeBar(); return; }

    var sig = ecId + '|' + (watched ? 'w' : '-') + '|' + (open ? 'o' : '-');
    var attached = barHost && barHost.parentNode === anchor.parentNode;
    if (attached && barSig === sig) return;

    if (!attached) {
      removeBar();
      barHost = document.createElement('div');
      barHost.id = BAR_ID;
      barShadow = shadow(barHost, BAR_CSS);
      anchor.insertAdjacentElement('afterend', barHost);
    }
    barSig = sig;

    var t1, t2, label, done;
    if (open && watched) {
      done = true;
      t1 = '담아둔 공고 — 자소서 문항이 열렸어요';
      t2 = '아래 모집부문에서 자기소개서를 만들면 목록의 대기 카드는 저절로 사라집니다.';
      label = '담기 취소';
    } else if (watched) {
      done = true;
      t1 = '담아뒀어요 — 자기소개서 목록에서 계속 보입니다';
      t2 = '마감(' + fmtEnd(d.end_time) + ')까지 문항이 안 열리면 회사 채용 사이트 링크로 바뀝니다.';
      label = '담기 취소';
    } else {
      done = false;
      t1 = '자소서 문항이 아직 안 열린 공고예요';
      t2 = '담아두면 자기소개서 목록에 계속 띄워두고, 문항이 열리면 카드가 바뀝니다.';
      label = '담아두기';
    }

    var bar = document.createElement('div');
    bar.className = 'bar' + (done ? ' done' : '');
    bar.innerHTML =
      '<span class="ic">' + (done ? '✓' : '!') + '</span>' +
      '<span class="tx"><span class="t1"></span><span class="t2"></span></span>' +
      '<button type="button"></button>';
    bar.querySelector('.t1').textContent = t1;
    bar.querySelector('.t2').textContent = t2;

    var btn = bar.querySelector('button');
    btn.textContent = label;
    btn.addEventListener('click', function () {
      if (!store) return;
      if (store[ecId]) delete store[ecId];
      else store[ecId] = entryFrom(d);
      save();
      barSig = null;
      drawBar(ecId, d);
    });

    // 이전 배너 내용만 갈아끼운다 (style 노드는 유지)
    var old = barShadow.querySelector('.bar');
    if (old) barShadow.removeChild(old);
    barShadow.appendChild(bar);
  }

  function syncBar() {
    var ecId = ecFromUrl();
    if (!ecId) {
      if (barHost) removeBar();
      barEcId = null;
      return;
    }
    if (!findBarAnchor()) { // 모달이 아직 안 떴거나 닫혔다
      if (barHost) removeBar();
      return;
    }
    if (ecId !== barEcId) {
      barEcId = ecId;
      removeBar();
    }
    loadDetail(ecId).then(function (d) {
      if (!d || ecFromUrl() !== ecId) return;
      drawBar(ecId, d);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  2) 자기소개서 목록 — 전용 섹션
  // ══════════════════════════════════════════════════════════

  // 사이트 카드 실측값(2026-08-10): 336x70, bg #fafafa, border 1px #eee, radius 4px,
  //   .name 13px #333 / .d-day 11px 흰글자 bg #999 radius 3px / .date 12px #777
  //   섹션 머리글 .list-title 12px #777, 컨테이너 margin-bottom 15px
  var SEC_CSS = [
    ':host{all:initial;display:block;margin-bottom:15px;}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:Pretendard,-apple-system,"Malgun Gothic",sans-serif;}',
    '.hd{display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer;',
    '  font-size:12px;line-height:17px;color:#c74f00;font-weight:700;user-select:none;}',
    '.hd .tag{background:#f26200;color:#fff;border-radius:3px;padding:1px 5px;',
    '  font-size:9.5px;font-weight:800;letter-spacing:.03em;}',
    '.hd .arrow{margin-left:auto;color:#ffb98a;font-size:11px;}',
    '.zone{display:flex;flex-wrap:wrap;gap:5px;}',
    '.zone.hide{display:none;}',
    // 좌측 들여쓰기 53px = 사이트 카드와 같은 값(사이트 7px + list-progress 타일 46px).
    // 자비스 섹션 카드와 바로 아래 '작성 중' 카드의 제목 시작선이 어긋나면 눈에 띈다.
    '.card{position:relative;width:336px;max-width:100%;min-height:70px;padding:10px 24px 12px 53px;',
    '  border:1.5px dashed #ffb98a;border-radius:4px;background:#fff3ea;cursor:pointer;}',
    '.card:hover{border-color:#f26200;}',
    '.mark{position:absolute;left:0;top:0;bottom:0;width:46px;display:flex;align-items:center;',
    '  justify-content:center;font-size:17px;line-height:1;border-right:1px dashed #ffb98a;}',
    '.nm{font-size:13px;line-height:18px;color:#c74f00;font-weight:600;letter-spacing:-.01em;}',
    '.sub{margin-top:5px;display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:#777;}',
    '.dday{background:#999;color:#fff;border-radius:3px;padding:1px 6px;font-size:11px;font-weight:700;}',
    '.go{display:block;margin-top:4px;font-size:11.5px;line-height:16px;font-weight:700;color:#c74f00;}',
    // 문항 열림 — 주황 반전 (초록은 쓰지 않는다: SPEC 공통 원칙)
    '.card.ready{border:1.5px solid #f26200;background:#f26200;}',
    '.card.ready .mark{border-right:1px solid rgba(255,255,255,.45);color:#fff;}',
    '.card.ready .nm{color:#fff;}',
    '.card.ready .sub{color:rgba(255,255,255,.85);}',
    '.card.ready .dday{background:rgba(255,255,255,.25);}',
    '.card.ready .go{color:#fff;}',
    // 마감 임박인데 안 열림 — 무채색 경고
    '.card.stale{border:1.5px solid #a2a5ac;background:#f4f5f7;}',
    '.card.stale .mark{border-right:1px solid #e3e5e9;}',
    '.card.stale .nm{color:#1f2229;}',
    '.card.stale .go{color:#3a3d45;text-decoration:underline;}',
    '.x{position:absolute;right:5px;top:4px;width:18px;height:18px;border:0;background:transparent;',
    '  cursor:pointer;color:#ffb98a;font-size:12px;line-height:1;padding:0;}',
    '.x:hover{color:#c74f00;}',
    '.card.ready .x{color:rgba(255,255,255,.7);}',
    '.card.ready .x:hover{color:#fff;}',
    '.card.stale .x{color:#a2a5ac;}'
  ].join('\n');

  var secHost = null;
  var secShadow = null;
  var secSig = null;
  var lastRows = null;   // 마지막으로 계산한 행 (재주입 때 재조회 없이 다시 그리기)

  // 재삽입 폭주 방지.
  // 우리 섹션은 사이트가 관리하는 .list-scroll-area 안에 들어간다. 사이트가 그 안을
  // 다시 그리면 우리 노드가 밀려나고, 우리가 다시 꽂으면 높이가 바뀌어 사이트가 또 다시
  // 그리는 싸움이 날 수 있다. 그렇게 되면 카드가 계속 재생성되고 **진행률 타일이 붙었다
  // 떨어졌다** 하는 깜빡임으로 보인다(2026-08-10 영상). 무한 루프 대신 몇 번 만에 포기한다.
  var insertLog = [];
  var insertPausedUntil = 0;
  var floodWarned = false;

  function canInsert() {
    var now = Date.now();
    if (now < insertPausedUntil) return false;
    insertLog = insertLog.filter(function (t) { return now - t < 3000; });
    if (insertLog.length >= 6) {
      insertPausedUntil = now + 15000;
      insertLog = [];
      if (!floodWarned) {
        floodWarned = true;
        console.warn('[자비스] 대기 공고 섹션이 계속 밀려나 재삽입을 15초 쉽니다.');
      }
      return false;
    }
    insertLog.push(now);
    return true;
  }

  // '자기소개서 작성 지원' 보드의 스크롤 영역.
  // AI 마스터 자소서 보드(.ai-resume-column)도 같은 클래스라 반드시 걸러내야 한다.
  function findListArea() {
    var cols = document.querySelectorAll('.scheduler-column.column2');
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].classList.contains('ai-resume-column')) continue;
      var sa = cols[i].querySelector('.list-scroll-area');
      if (sa) return sa;
    }
    return null;
  }

  // 담아둔 공고들의 현재 상태를 계산한다. 계산 중 정리(이미 자소서를 만들었거나 마감)도 같이 한다.
  function computeRows() {
    var ids = Object.keys(store || {});
    if (!ids.length) return Promise.resolve([]);
    return Promise.all([
      Promise.all(ids.map(function (id) { return loadDetail(id); })),
      getResumes()
    ]).then(function (r) {
      var details = r[0], resumes = r[1] || [];

      // 내 자소서는 공고가 아니라 모집부문(employment_id)에 매여 있다 (SPEC 참조)
      var mineEmp = {};
      resumes.forEach(function (rs) {
        if (rs.trashed_at || rs.removed_at) return;
        mineEmp[rs.employment_id] = true;
      });

      var rows = [];
      var dropped = false;

      ids.forEach(function (id, i) {
        var e = store[id];
        var d = details[i];

        // 조회 실패(오프라인/일시 오류)는 지우지 않는다 — 저장해 둔 값으로 그냥 보여준다
        if (!d) {
          rows.push({ id: Number(id), name: e.name, title: e.title, endTime: e.endTime,
            pageUrl: e.pageUrl, state: 'waiting' });
          return;
        }

        // 이 공고로 자소서를 이미 만들었으면 목록에서 뺀다 (할 일이 끝났다)
        var made = (d.employments || []).some(function (x) { return mineEmp[x.id]; });
        var left = daysLeft(d.end_time);
        if (made || (left !== null && left < 0)) {
          delete store[id];
          dropped = true;
          return;
        }

        // 저장 당시 없던 정보(마감 변경, 채용 사이트 추가)를 따라간다
        e.name = d.name || e.name;
        e.title = d.title || e.title;
        e.endTime = d.end_time || e.endTime;
        e.pageUrl = d.employment_page_url || e.pageUrl;

        var state;
        if (isOpen(d)) state = 'ready';
        else if (left !== null && left <= STALE_DAYS) state = 'stale';
        else state = 'waiting';

        rows.push({ id: Number(id), name: e.name, title: e.title, endTime: e.endTime,
          pageUrl: e.pageUrl, state: state });
      });

      if (dropped) save();

      // 마감 임박 순 — 급한 게 위로
      rows.sort(function (a, b) {
        var ta = a.endTime ? new Date(a.endTime).getTime() : Infinity;
        var tb = b.endTime ? new Date(b.endTime).getTime() : Infinity;
        return ta - tb;
      });
      return rows;
    });
  }

  function removeSection() {
    if (secHost && secHost.parentNode) secHost.parentNode.removeChild(secHost);
    secHost = null;
    secShadow = null;
    secSig = null;
  }

  function cardFor(row) {
    var card = document.createElement('div');
    card.className = 'card' + (row.state === 'ready' ? ' ready' : row.state === 'stale' ? ' stale' : '');

    var mark = row.state === 'ready' ? '!' : row.state === 'stale' ? '⚠' : '⏳';
    var go;
    if (row.state === 'ready') go = '문항 열렸어요 · 자소서 만들기 →';
    else if (row.state === 'stale') go = row.pageUrl ? '자소설엔 아직 안 올라옴 · 회사 사이트에서 지원 →' : '아직 문항이 안 열렸어요 · 공고 확인 →';
    else go = '문항 대기 중 · 공고 보기';

    card.innerHTML =
      '<button class="x" type="button" title="담기 취소">✕</button>' +
      '<span class="mark"></span>' +
      '<div class="nm"></div>' +
      '<div class="sub"><span class="dday"></span><span class="when"></span></div>' +
      '<span class="go"></span>';

    card.querySelector('.mark').textContent = mark;
    card.querySelector('.nm').textContent = (row.name ? row.name + ' ' : '') + (row.title || '');
    card.querySelector('.dday').textContent = ddayText(row.endTime);
    card.querySelector('.when').textContent = row.endTime ? '~ ' + fmtEnd(row.endTime) : '';
    card.querySelector('.go').textContent = go;

    card.addEventListener('click', function () {
      // 회사 자체 채용 사이트는 새 탭(외부 이동), 자소설 공고는 같은 탭
      if (row.state === 'stale' && row.pageUrl) window.open(row.pageUrl, '_blank', 'noopener');
      else location.href = '/recruit?ec=' + row.id;
    });
    card.querySelector('.x').addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!store) return;
      delete store[row.id];
      save();
      // lastRows에서도 빼야 한다 — 안 빼면 재렌더가 방금 지운 카드를 되살린다
      lastRows = (lastRows || []).filter(function (r) { return r.id !== row.id; });
      secSig = null;
      renderSection(lastRows);
    });
    return card;
  }

  // rows 가 null 이면 마지막 계산값을 다시 쓴다 (재주입 시 재조회 방지)
  function renderSection(rows) {
    if (rows) lastRows = rows;
    rows = lastRows || [];

    var area = findListArea();
    if (!area || !rows.length) { removeSection(); return; }

    var sig = rows.map(function (r) { return r.id + r.state; }).join(',') + '|' + (collapsed ? 'c' : 'o');
    var attached = secHost && secHost.parentNode === area;
    if (attached && secSig === sig) return;

    if (!attached) {
      if (!canInsert()) return; // 폭주 중 — 이번 판은 건너뛴다
      removeSection();
      secHost = document.createElement('div');
      secHost.id = SEC_ID;
      secShadow = shadow(secHost, SEC_CSS);
      area.insertBefore(secHost, area.firstChild);
    }
    secSig = sig;

    var old = secShadow.querySelector('.wrap');
    if (old) secShadow.removeChild(old);

    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<div class="hd"><span class="tag">자비스</span>' +
      '<span class="ttl"></span><span class="arrow"></span></div>' +
      '<div class="zone"></div>';
    wrap.querySelector('.ttl').textContent = '문항 열리면 쓸 공고 (' + rows.length + ')';
    wrap.querySelector('.arrow').textContent = collapsed ? '▸' : '▾';

    var zone = wrap.querySelector('.zone');
    if (collapsed) zone.classList.add('hide');
    else rows.forEach(function (r) { zone.appendChild(cardFor(r)); });

    wrap.querySelector('.hd').addEventListener('click', function () {
      collapsed = !collapsed;
      secSig = null;
      renderSection(null);
    });

    secShadow.appendChild(wrap);
  }

  var refreshTimer = null;
  function refreshSection(delay) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      if (!findListArea()) return;
      computeRows().then(renderSection, function () { /* 예외 전파 금지 */ });
    }, delay);
  }

  // ══════════════════════════════════════════════════════════
  //  구동
  // ══════════════════════════════════════════════════════════

  load(function () {
    var mo = null;

    function tick() {
      try {
        syncBar();
        // Angular가 카드 목록을 재렌더하면 우리 섹션도 같이 날아간다 → 붙어 있는지만 확인하고 다시 꽂는다
        if (findListArea() && (!secHost || !secHost.parentNode)) renderSection(null);
      } catch (e) { /* 예외 전파 금지 */ }
      finally { if (mo) mo.takeRecords(); }
    }

    // 목록 쪽 재렌더 감지 (list-progress와 같은 패턴: 자기 유발 변경은 takeRecords로 버린다)
    try {
      mo = new MutationObserver(function () {
        if (!findListArea()) return;
        if (!secHost || !secHost.parentNode) {
          renderSection(null);
          mo.takeRecords();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* 폴링만으로도 동작한다 */ }

    setInterval(tick, TICK);
    tick();

    refreshSection(0);
    // 목록에 머무는 동안 상태가 바뀔 수 있다(문항 개설·마감). 상세 TTL과 같은 주기로 다시 본다.
    setInterval(function () { if (findListArea()) refreshSection(0); }, DETAIL_TTL);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refreshSection(0);
    });

    // 다른 탭(공고 모달)에서 담거나 뺀 걸 목록 탭이 따라간다
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[KEY]) return;
        store = changes[KEY].newValue || {};
        secSig = null;
        barSig = null;
        refreshSection(0);
      });
    } catch (e) { /* 탭 간 동기화 없이도 동작한다 */ }
  });
});
