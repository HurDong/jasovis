// 대시보드 기능 (Agent A) — 플로팅 위젯. SPEC.md의 JSL.ui 계약을 구현한다.
// 디자인 V-4: 헤더 3차선 분리(신원/도구/상태) + 더보기(⋯) 드롭다운.
//   - 헤더 1줄에 제목+D-day+아이콘들+접기가 몰려 있던 걸 정리: 헤더에는 제목·D-day·
//     더보기(⋯)·접기 4개만 남긴다. 기능이 addAction({slot:'header'})로 꽂는 버튼들은
//     더보기를 눌러야 나오는 드롭다운 메뉴에 한 줄씩 쌓인다(라벨+스위치형 메뉴 행).
//     등록된 버튼이 하나도 없으면 더보기 자체를 숨겨 빈 메뉴가 뜨는 일이 없게 한다.
//   - 진행 영역(세그먼트 바+상태 요약)은 얇은 구분선으로 헤더와 분리된 독립 구역.
//     요약도 굵은 글자 나열 대신 점 칩(완료/작성중/미작성)으로 스캔하기 쉽게.
// 디자인 V-3: 커서(스텝퍼) 상태 모델 + 세그먼트 헤더 게이지.
//   - 상태는 글자수 임계값이 아니라 "지금 연 탭(active) + 내용 유무"로 자동 판정:
//     · 미작성 = 내용 없음(effective 0)
//     · 작성중 = 지금 연 탭(active)이고 내용 있음 (딱 하나)
//     · 완료   = 지나온 문항(비활성 + 내용 있음)
//     탭을 옮기면 지나온 게 완료로, 지금 게 작성중으로 자동 전환(기존 switchQna에 얹힘).
//   - 번호 동그라미가 곧 상태 칩: 미작성=빈 회색 링 / 작성중=꽉 찬 주황 / 완료=초록 체크.
//     색만이 아니라 모양(빈 링/체크)으로도 구분해 색약·저대비에서도 읽힌다.
//   - 헤더 진행바는 문항 수만큼 세그먼트(각 칸 = 그 문항 채움비율을 상태색으로).
//   - 미작성 카드는 점선(스켈레톤 오해)을 걷어내고 다른 카드와 같은 solid 카드로,
//     "시작 →" 대신 원래 제한 글자수 `0/800`을 보여준다.
//   - 작성중(활성) 카드만 확장: 카테고리 칩(JSL.categorizeQuestion 재사용) + 큰 글자수 +
//     채움막대 + 복사. 완료 카드는 초록 체크 + 글자수로 접어서 뒤로 물린다.
// 액션줄: 전체 복사(primary) + 답변 뱅크. 뜸한 설정(단축키/자동맞춤법)은 헤더 더보기(⋯) 메뉴.
// 기본 위치: 화면 왼쪽 중앙 도킹. 헤더 드래그로 이동, 위치/접힘은 chrome.storage에 기억.
(function () {
  'use strict';

  var COLLAPSE_KEY = 'jslDashboardCollapsed';
  var POS_KEY = 'jslDashboardPos';

  // 복사 아이콘 (Shadow DOM 안이라 외부 아이콘 폰트 없이 인라인 SVG)
  var COPY_ICON_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="8" y="8" width="12" height="12" rx="2"/>' +
    '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';

  // 토스트 종류 아이콘 (stroke 2 / 14px — 위젯 다른 아이콘과 같은 규격)
  function strokeIcon(size, body) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + body + '</svg>';
  }
  var TOAST_ICONS = {
    info: strokeIcon(14, '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>'),
    ok: strokeIcon(14, '<path d="M20 6.5 9.5 17 4 11.5"/>'),
    fail: strokeIcon(14, '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>')
  };
  var KEYBOARD_ICON_SVG = strokeIcon(13,
    '<rect x="2" y="6" width="20" height="12" rx="2"/>' +
    '<path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/>');
  var CLOSE_ICON_SVG = strokeIcon(12, '<path d="M5 5l10 10M15 5 5 15"/>');

  // 더보기(⋯) 트리거 아이콘
  var MORE_ICON_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

  // ── 내부 상태 ──────────────────────────────────────────────
  var host = null;            // 호스트 엘리먼트 (position:fixed)
  var shadow = null;          // ShadowRoot
  var els = {};               // 주요 엘리먼트 캐시
  var lastState = null;       // 마지막 수신 state
  var gotState = false;       // state를 한 번이라도 받았는가
  var collapsed = false;      // 접힘 상태
  var qnaActions = [];        // addQnaAction 등록 목록 [{number, labelHTML, onClick, el}]
  var warnings = new Map();   // 문항별 경고 문구 (number -> text)
  var actionQueue = [];       // 렌더 전 addAction 호출 대기열 [{btn, slot}]

  // ── JSL.ui 계약 (다른 기능이 소비) ─────────────────────────
  var readyResolve;
  var readyPromise = new Promise(function (res) { readyResolve = res; });

  // 클릭한 버튼 자체에 성공/실패 펄스를 준다. onClick이 Promise<boolean>을
  // 반환하는 경우에만 동작하므로(복사 액션들이 그렇게 되어 있다), 프라미스를
  // 반환하지 않는 다른 액션 버튼에는 아무 영향이 없다.
  function flashButton(btn, ok) {
    if (!btn) return;
    var cls = ok ? 'jsl-copy-ok' : 'jsl-copy-fail';
    var other = ok ? 'jsl-copy-fail' : 'jsl-copy-ok';
    btn.classList.remove(other);
    btn.classList.remove(cls);
    void btn.offsetWidth; // 연타 시 애니메이션이 재시작되도록 강제 리플로우
    btn.classList.add(cls);
    setTimeout(function () { btn.classList.remove(cls); }, ok ? 650 : 1100);
  }

  function runAndFlash(btn, onClick, e) {
    var result;
    try { result = onClick(e); } catch (err) { console.warn('[자비스] 액션 오류', err); return; }
    if (result && typeof result.then === 'function') {
      result.then(function (ok) { flashButton(btn, ok !== false); }, function () { flashButton(btn, false); });
    }
  }

  // 액션 버튼을 슬롯에 부착
  function attachActionBtn(btn, slot) {
    if (slot === 'header' && els.headerBtns) {
      els.headerBtns.appendChild(btn);
      updateMoreVisibility();
    }
    else if (els.actions) els.actions.appendChild(btn);
    else actionQueue.push({ btn: btn, slot: slot });
  }

  JSL.ui = {
    // 대시보드 렌더 완료 시 resolve
    ready: readyPromise,

    // 위젯 공용 버튼 추가, 버튼 엘리먼트 반환
    // opts (선택): {slot:'footer'|'header', variant:'primary'|'toggle'}
    //  - slot 'header': 하단 액션줄 대신 헤더 우측 "더보기(⋯)" 메뉴 안에 한 줄로 쌓인다.
    //    라벨+스위치형으로 렌더되므로 아이콘 HTML만 넘겨도 메뉴 행처럼 자연스럽게 보인다.
    //  - variant 'primary': 주황 채움 강조
    //  - variant 'toggle': on/off는 호출측이 .on 클래스로 제어. 라벨+스위치형으로 렌더된다
    //    (뜸하게 건드리는 설정을 액션줄/헤더 공간을 차지하지 않고 메뉴 안에 넣을 때 사용).
    addAction: function (labelHTML, onClick, opts) {
      opts = opts || {};
      var isHeader = opts.slot === 'header';
      var btn = document.createElement('button');
      btn.className = isHeader ? 'jsl-header-btn' : 'jsl-action-btn';
      if (opts.variant === 'primary') btn.classList.add('primary');
      if (opts.variant === 'toggle') {
        btn.classList.add('toggle');
        btn.innerHTML = '<span class="tlabel">' + labelHTML + '</span><span class="sw"></span>';
      } else {
        btn.innerHTML = labelHTML;
      }
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        runAndFlash(btn, onClick, e);
      });
      attachActionBtn(btn, opts.slot);
      return btn;
    },

    // 문항 카드의 복사 버튼 — 등록 목록을 보관해 재렌더 후에도 유지.
    // 렌더 시점의 문항 상태에 따라 완료=인라인 아이콘 / 작성중=강조 버튼으로 그려진다.
    addQnaAction: function (number, labelHTML, onClick) {
      var entry = { number: Number(number), labelHTML: labelHTML, onClick: onClick, el: null };
      qnaActions.push(entry);
      renderBody(); // 이미 렌더된 카드에 즉시 반영
      return entry.el;
    },

    // 문항 행에 경고 문구 표시/해제 (text가 null이면 해제)
    setWarning: function (number, text) {
      if (text === null || text === undefined || text === '') warnings.delete(Number(number));
      else warnings.set(Number(number), String(text));
      renderBody();
    }
  };

  // ── 유틸 ──────────────────────────────────────────────────
  // 글자수 규칙 (SPEC.md '글자수 규칙' 절)
  function countInfo(qna) {
    var answer = String(qna.answer || '');
    var withSpace = answer.length;                       // 공백 포함
    var noSpace = answer.replace(/\s/g, '').length;      // 공백 제외
    var bytes = new Blob([answer]).size;                 // UTF-8 바이트
    var limit = Number(qna.total_count) || 0;            // 0이거나 없으면 제한 없음
    // include_space가 false면 제한 비교는 공백 제외 기준
    var effective = qna.include_space === false ? noSpace : withSpace;
    var empty = answer.replace(/\s/g, '') === '';        // 공백뿐이면 미작성
    return { withSpace: withSpace, noSpace: noSpace, bytes: bytes, limit: limit, effective: effective, empty: empty };
  }

  // 문항 상태 판정 (커서 모델). stage: 'empty' | 'active' | 'done', over는 별도 플래그.
  // active-but-empty(지금 연 탭인데 아직 빈칸)는 stage 'empty' + active:true로 다뤄
  // "미작성이지만 지금 여기"를 카드에서 표시한다. 작성중(stage 'active')은 내용이 있을 때만.
  function qnaState(qna) {
    var c = countInfo(qna);
    var over = c.limit > 0 && c.effective > c.limit;
    var stage;
    if (c.empty) stage = 'empty';
    else if (qna.active) stage = 'active';
    else stage = 'done';
    return { stage: stage, over: over, c: c, active: !!qna.active };
  }

  // 그 문항 채움 비율 (세그먼트/막대 공용). 제한 없으면 내용 유무로 0/1.
  function fillRatio(s) {
    if (s.over) return 1;
    if (s.c.limit > 0) return Math.min(1, s.c.effective / s.c.limit);
    return s.c.empty ? 0 : 1;
  }

  // 전체 요약: 완료/작성중/미작성 개수 + 총 글자수
  function summarize(qnas) {
    var done = 0, writing = 0, empty = 0, totalChars = 0;
    qnas.forEach(function (qna) {
      var s = qnaState(qna);
      totalChars += s.c.withSpace;
      if (s.stage === 'empty') empty++;
      else if (s.stage === 'active') writing++;
      else done++;
    });
    return { done: done, writing: writing, empty: empty, totalChars: totalChars, total: qnas.length };
  }

  // 작성중 문항의 대표 카테고리 — bank가 노출한 분류기를 방어적으로 재사용(없으면 null)
  function primaryCategory(qna) {
    try {
      if (JSL.categorizeQuestion) {
        var tags = JSL.categorizeQuestion(qna.question || '');
        if (tags && tags.length && tags[0] !== '기타') return tags[0];
      }
    } catch (e) { /* 무시 */ }
    return null;
  }

  // D-day 계산: resume.d_day 우선, 없으면 end_time으로 산출
  function computeDday(resume) {
    if (!resume) return null;
    var d = resume.d_day;
    if (d !== undefined && d !== null && d !== '' && !isNaN(Number(d))) return Number(d);
    if (resume.end_time) {
      var end = new Date(resume.end_time);
      if (!isNaN(end.getTime())) {
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        return Math.round((endDay - today) / 86400000);
      }
    }
    return null;
  }

  // 문항 질문 미리보기 — 줄바꿈/연속 공백 정리 (말줄임은 CSS가 담당)
  function questionPreview(qna) {
    var q = String(qna.question || '').replace(/\s+/g, ' ').trim();
    return q || '문항 ' + qna.number;
  }

  function saveStorage(key, value) {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        var obj = {}; obj[key] = value;
        chrome.storage.local.set(obj);
      }
    } catch (e) { /* storage 실패는 무시 */ }
  }

  // ── 렌더: 헤더 ────────────────────────────────────────────
  // 세그먼트 진행바 채우기 (문항별 1칸, 채움 폭=비율, 색=상태)
  function renderSegments(qnas) {
    els.segbar.innerHTML = '';
    qnas.forEach(function (qna) {
      var s = qnaState(qna);
      var seg = document.createElement('div');
      seg.className = 'seg';
      var fill = document.createElement('div');
      fill.className = 'seg-fill ' + (s.over ? 'over' : s.stage);
      fill.style.width = Math.round(fillRatio(s) * 100) + '%';
      seg.appendChild(fill);
      els.segbar.appendChild(seg);
    });
  }

  function renderHeader() {
    if (!els.title) return;
    var resume = lastState && lastState.resume;
    els.title.textContent = resume && resume.title ? resume.title : '자비스';
    els.title.title = els.title.textContent;

    var qnas = (lastState && lastState.qnas) || [];
    if (qnas.length) {
      renderSegments(qnas);
      var sum = summarize(qnas);
      els.sub.classList.remove('plain');
      els.sub.innerHTML =
        '<span class="chips">' +
        '<span class="chip cdone"><i></i>완료 ' + sum.done + '</span>' +
        '<span class="chip cwrite"><i></i>작성중 ' + sum.writing + '</span>' +
        '<span class="chip cempty"><i></i>미작성 ' + sum.empty + '</span>' +
        '</span>' +
        (sum.totalChars > 0 ? '<span class="charcount">' + sum.totalChars.toLocaleString() + '자</span>' : '');
    } else {
      els.segbar.innerHTML = '';
      els.sub.classList.add('plain');
      els.sub.textContent = gotState ? '자소서 데이터 없음' : 'JASOVIS';
    }

    var dday = computeDday(resume);
    if (dday === null) {
      els.dday.textContent = '';
      els.dday.className = 'dday hidden';
    } else {
      els.dday.textContent = dday > 0 ? 'D-' + dday : (dday === 0 ? 'D-DAY' : '마감');
      // 마감 3일 이내면 강조
      els.dday.className = 'dday' + (dday <= 3 ? ' urgent' : '');
    }
  }

  // ── 렌더: 본문 ────────────────────────────────────────────
  // 한 줄 글자수 표기 HTML
  function countHTML(s) {
    var c = s.c;
    if (s.over) return '<b>' + (c.effective - c.limit) + '자 초과</b>';
    if (c.limit > 0) return '<b>' + c.effective + '</b><span class="dim">/' + c.limit + '</span>';
    return '<b>' + c.effective + '</b><span class="dim">자</span>';
  }

  // 확장(작성중) 카드의 큰 글자수 HTML
  function bigCountHTML(s) {
    var c = s.c;
    if (s.over) {
      return '<b>' + c.effective + '</b><span class="dim"> / ' + c.limit + '</span>' +
        ' <span class="ov">' + (c.effective - c.limit) + '자 초과</span>';
    }
    if (c.limit > 0) return '<b>' + c.effective + '</b><span class="dim"> / ' + c.limit + '</span>';
    return '<b>' + c.effective + '</b><span class="dim">자</span>';
  }

  // 등록된 복사 액션을 카드에 그린다. kind: 'btn'(강조) | 'ic'(인라인 아이콘)
  function appendCopy(parent, num, kind) {
    qnaActions.forEach(function (entry) {
      if (entry.number !== num) return;
      var b = document.createElement('button');
      if (kind === 'btn') {
        b.className = 'copy-btn';
        b.innerHTML = COPY_ICON_SVG + '<span>' + (entry.labelHTML || '복사') + '</span>';
      } else {
        b.className = 'copy-ic';
        b.innerHTML = COPY_ICON_SVG;
        b.title = '이 문항 답변 복사';
      }
      b.addEventListener('click', function (e) {
        e.stopPropagation(); // 카드 클릭(문항 전환)과 분리
        runAndFlash(b, entry.onClick, e);
      });
      entry.el = b;
      parent.appendChild(b);
    });
  }

  function renderBody() {
    if (!els.body) return;
    els.body.innerHTML = '';

    if (!lastState || !Array.isArray(lastState.qnas) || lastState.qnas.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'empty-msg';
      emptyMsg.textContent = gotState ? '자소서 데이터를 찾지 못했습니다' : '자소서를 불러오는 중입니다';
      els.body.appendChild(emptyMsg);
      return;
    }

    lastState.qnas.forEach(function (qna) {
      var num = Number(qna.number);
      var s = qnaState(qna);
      var c = s.c;
      var expanded = s.stage === 'active' && !c.empty; // 작성중(내용 있음)만 확장

      // 카드: 클릭 영역(문항 전환) 하나 + 상태별 내용
      var card = document.createElement('div');
      card.className = 'card ' + s.stage + (s.over ? ' over' : '') + (qna.active ? ' cur' : '');

      // 클릭 영역은 div로 두되 키보드로도 도달·실행 가능하게 한다.
      // <button>으로 바꾸면 안쪽의 복사 버튼과 버튼 중첩이 되어 HTML이 깨지므로
      // role/tabindex + Enter·Space 처리로 대신한다 (문항 전환이 마우스 전용이었던
      // 문제를 고치기 위함 — qna-nav를 없앤 뒤로는 Alt+숫자 말고 길이 없었다).
      var content = document.createElement('div');
      content.className = 'card-body';
      content.title = '클릭하면 문항 ' + num + '(으)로 이동';
      content.setAttribute('role', 'button');
      content.setAttribute('tabindex', '0');
      content.setAttribute('aria-label', '문항 ' + num + '(으)로 이동');
      if (qna.active) content.setAttribute('aria-current', 'true');
      var goToQna = function () {
        JSL.action('switchQna', { number: num });
        JSL.emit('focus:answer', { number: num }); // 전환 후 커서도 본문으로 (checkpoint가 구독)
      };
      content.addEventListener('click', goToQna);
      content.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault(); // Space의 페이지 스크롤 차단
        goToQna();
      });

      // 1줄: 상태 동그라미 + 질문 (+카테고리/글자수/복사)
      var line = document.createElement('div');
      line.className = 'line';

      var st = document.createElement('span');
      st.className = 'st ' + s.stage;
      st.textContent = s.stage === 'done' ? '✓' : num;
      line.appendChild(st);

      var q = document.createElement('span');
      q.className = 'q';
      q.textContent = questionPreview(qna);
      line.appendChild(q);

      if (expanded) {
        var cat = primaryCategory(qna);
        if (cat) {
          var catEl = document.createElement('span');
          catEl.className = 'cat';
          catEl.textContent = cat;
          line.appendChild(catEl);
        }
      } else {
        // 완료/미작성/활성-빈칸은 한 줄에 글자수를 바로 붙인다 (원래 제한 글자수 노출)
        var cnt = document.createElement('span');
        cnt.className = 'cnt ' + s.stage + (s.over ? ' over' : '');
        cnt.innerHTML = countHTML(s);
        line.appendChild(cnt);
        if (s.stage === 'done') appendCopy(line, num, 'ic'); // 완료는 인라인 복사 아이콘
      }
      content.appendChild(line);

      // 작성중(활성·내용) 확장: 큰 글자수+복사 한 줄 → 채움막대 단독 줄 → 보조줄(공백제외)
      if (expanded) {
        var row = document.createElement('div');
        row.className = 'act-row';

        var big = document.createElement('span');
        big.className = 'bigcnt' + (s.over ? ' over' : '');
        big.innerHTML = bigCountHTML(s);
        row.appendChild(big);

        appendCopy(row, num, 'btn');
        content.appendChild(row);

        var fill = document.createElement('div');
        fill.className = 'fill';
        var fin = document.createElement('div');
        fin.className = 'fill-in' + (s.over ? ' over' : '');
        fin.style.width = Math.round(fillRatio(s) * 100) + '%';
        fill.appendChild(fin);
        content.appendChild(fill);

        var sub = document.createElement('div');
        sub.className = 'card-sub';
        sub.textContent = '공백제외 ' + c.noSpace.toLocaleString() + '자';
        content.appendChild(sub);
      }

      card.appendChild(content);
      els.body.appendChild(card);

      // 외부 기능(setWarning) 경고 문구 — 카드 아래 표시
      var warn = warnings.get(num);
      if (warn) {
        var w = document.createElement('div');
        w.className = 'card-warn';
        w.textContent = '⚠ ' + warn;
        els.body.appendChild(w);
      }
    });
  }

  function renderAll() {
    try {
      renderHeader();
      renderBody();
    } catch (e) {
      console.warn('[자비스] 대시보드 렌더 오류', e);
    }
  }

  // ── 접기/펼치기 ────────────────────────────────────────────
  function applyCollapsed() {
    if (!els.wrap) return;
    els.wrap.classList.toggle('collapsed', collapsed);
    els.toggle.textContent = collapsed ? '＋' : '－';
    els.toggle.title = collapsed ? '펼치기' : '접기';
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    applyCollapsed();
    saveStorage(COLLAPSE_KEY, collapsed);
  }

  // ── 헤더 더보기(⋯) 메뉴 ────────────────────────────────────
  // 기능들이 addAction({slot:'header'})로 꽂는 버튼을 한 곳에 모아 보여준다.
  // 등록된 버튼이 없으면 트리거 자체를 숨겨 빈 메뉴가 뜨지 않게 한다.
  function updateMoreVisibility() {
    if (!els.moreWrap || !els.headerBtns) return;
    els.moreWrap.classList.toggle('hidden', els.headerBtns.children.length === 0);
  }

  function openMenu() {
    if (!els.moreWrap) return;
    els.moreWrap.classList.add('open');
    els.moreBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onMenuOutsideClick);
    document.addEventListener('keydown', onMenuKeydown);
  }

  function closeMenu() {
    if (!els.moreWrap) return;
    els.moreWrap.classList.remove('open');
    els.moreBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onMenuOutsideClick);
    document.removeEventListener('keydown', onMenuKeydown);
  }

  function toggleMenu() {
    if (els.moreWrap && els.moreWrap.classList.contains('open')) closeMenu();
    else openMenu();
  }

  // 메뉴 바깥 클릭 시 닫기
  function onMenuOutsideClick(e) {
    if (els.moreWrap && els.moreWrap.contains(e.target)) return;
    closeMenu();
  }

  function onMenuKeydown(e) {
    if (e.key === 'Escape') closeMenu();
  }

  // ── 드래그 이동 (헤더를 잡고 끈다) ─────────────────────────
  // 창 폭이 나중에 좁아져도(예: 화면 분할) 패널 전체가 항상 보이도록, 일부만
  // 걸쳐놓는 것을 허용하지 않고 좌우 여백 안에 통째로 들어오게 고정한다.
  // (예전엔 최대 100px만 남기고 가장자리 밖으로 걸치는 것도 허용했는데, 넓은
  // 창에서 오른쪽 끝으로 옮겨두면 좁은 창에서 열었을 때 거의 안 보이는
  // 문제가 있었다 — 실제로 보고됨.)
  function clampPos(left, top) {
    var rect = host.getBoundingClientRect();
    var w = rect.width || 344;
    var maxLeft = Math.max(8, window.innerWidth - w - 8);
    var maxTop = window.innerHeight - 48;
    return {
      left: Math.max(8, Math.min(left, maxLeft)),
      top: Math.max(8, Math.min(top, maxTop))
    };
  }

  function applyPos(pos) {
    host.style.left = pos.left + 'px';
    host.style.top = pos.top + 'px';
    host.style.bottom = 'auto';
    host.style.transform = 'none';
  }

  function setupDrag() {
    var dragging = false;
    var startX = 0, startY = 0, startLeft = 0, startTop = 0;

    els.header.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('button')) return; // 헤더 버튼은 드래그 제외
      dragging = true;
      var rect = host.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      els.header.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      applyPos(clampPos(startLeft + (e.clientX - startX), startTop + (e.clientY - startY)));
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      els.header.classList.remove('dragging');
      var rect = host.getBoundingClientRect();
      saveStorage(POS_KEY, { left: rect.left, top: rect.top });
    });
  }

  // ── 토스트 ────────────────────────────────────────────────
  // 위치: 화면 우하단 고정. 예전엔 위젯 바로 위에 붙였는데, 위젯이 왼쪽 중앙 도킹이라
  // 답변란을 보고 있는 시선에서 가장 먼 자리였다. 우하단은 웹 표준 알림 자리고 본문을 안 가린다.
  //
  // 시안 C(주황 반전): 성공 = 브랜드 주황 채움 + 흰 글자(액션줄 primary 버튼과 같은 언어),
  // 정보 = 크림 + 주황 테두리, 실패 = 흰 바탕 + 빨강. 색 종류를 늘리지 않고
  // 주황의 농도/반전으로만 위계를 만든다. 초록은 쓰지 않는다.
  var TOAST_CSS = [
    ':host{all:initial;}',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    '.toasts{display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic",',
    '  "Apple SD Gothic Neo",sans-serif;font-size:12.5px;line-height:1.5;}',
    // 공통 골격 — 테두리는 1px 투명으로 깔아둬서 종류가 바뀌어도 폭/높이가 안 흔들린다
    '.toast{position:relative;display:flex;gap:10px;align-items:flex-start;width:100%;',
    '  overflow:hidden;border-radius:12px;padding:11px 13px 12px;border:1px solid transparent;',
    '  animation:jsl-toast-in .18s ease-out;}',
    '.toast .tmsg{flex:1;min-width:0;font-weight:600;word-break:keep-all;}',
    '.toast .tsub{display:block;margin-top:2px;font-size:11px;font-weight:400;opacity:.78;}',
    // 종류는 색만이 아니라 아이콘(i/체크/엑스)으로도 구분한다 — 색약·저대비 대응
    '.badge{flex:none;width:22px;height:22px;border-radius:50%;display:flex;',
    '  align-items:center;justify-content:center;}',
    '.badge svg{display:block;}',
    // 남은 시간 바 — transform만 애니메이션해서 레이아웃/리페인트 비용이 없다
    '.tbar{position:absolute;left:0;right:0;bottom:0;height:2px;transform-origin:left;',
    '  animation:jsl-toast-drain linear forwards;}',
    // info는 원래 크림 바탕 + 연주황 테두리 + 연갈색 글자였는데, 흰 사이트 배경 위에서
    // 거의 안 보였다(실제로 보고됨: "저장 요청 같은 게 너무 연하다"). 배경을 흰색으로 올리고
    // 배지를 주황 solid로 채운 뒤 글자를 위젯 본문과 같은 잉크색으로 바꿔서 또렷하게 만든다.
    // 성공(ok)의 "면 전체가 주황"과는 여전히 구분된다 — info는 점(배지)만 주황.
    '.toast.info{background:#fff;border-color:#ffb377;color:#2a2320;',
    '  box-shadow:0 8px 24px rgba(58,36,16,.16);}',
    '.toast.info .badge{background:#ff6a00;color:#fff;}',
    '.toast.info .tbar{background:#ff6a00;}',
    '.toast.ok{background:linear-gradient(180deg,#ff7a1a,#ff6a00);color:#fff;',
    '  box-shadow:0 8px 22px rgba(255,106,0,.34);}',
    '.toast.ok .badge{background:rgba(255,255,255,.22);color:#fff;}',
    '.toast.ok .tbar{background:rgba(255,255,255,.55);}',
    // fail도 같은 문법으로 맞춘다 — 흰 카드 + solid 배지 + 진한 글자 + 진한 바.
    // (연한 배지/테두리는 info와 같은 이유로 눈에 안 들어왔다)
    '.toast.fail{background:#fff;border-color:#efa8a8;color:#a82f2f;',
    '  box-shadow:0 8px 24px rgba(58,36,16,.16);}',
    '.toast.fail .badge{background:#ef4444;color:#fff;}',
    '.toast.fail .tbar{background:#ef4444;}',
    // 우하단에서 올라오며 등장. 나가는 모션은 더 짧게(180→120ms) 해서 반응이 빠르게 느껴지게.
    '@keyframes jsl-toast-in{from{opacity:0;transform:translateY(8px) scale(.97);}',
    '  to{opacity:1;transform:none;}}',
    '@keyframes jsl-toast-drain{from{transform:scaleX(1);}to{transform:scaleX(0);}}',
    '.toast.gone{opacity:0;transform:translateY(3px) scale(.98);',
    '  transition:opacity .12s ease-in,transform .12s ease-in;}',
    // 같은 알림을 연타하면 새로 쌓지 않고 기존 토스트를 한 번 튕겨준다
    '@keyframes jsl-toast-bump{0%{transform:none;}35%{transform:scale(1.03);}100%{transform:none;}}',
    '.toast.bump{animation:jsl-toast-bump .22s ease-out;}',
    // ── 단축키 안내 (kind:"help") — 시안 H2 크림 시트 ────────
    // 6~8개 항목을 " · "로 이어붙인 텍스트 벽이었다. 그룹 헤더로 3덩이로 나누고
    // 항목마다 키캡 + 설명 2열로 쪼갠다. 자동소멸도 끈다(다 읽기 전에 사라지면 안 된다).
    // 다른 토스트는 344px 고정폭인데 도움말만 width:auto로 둔다 — 키캡+설명이 짧아서
    // 고정폭으로 두면 오른쪽에 빈 공간이 크게 남았다(실제로 보고됨).
    // 컨테이너가 align-items:flex-end라 줄어든 카드는 그대로 오른쪽 끝에 붙는다.
    '.toast.help{display:block;width:auto;max-width:100%;padding:13px 15px 15px;background:#fff;',
    '  border-color:#ece0d0;color:#3d342c;box-shadow:0 8px 24px rgba(58,36,16,.16);',
    '  pointer-events:auto;}',
    '.toast.help .khead{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;',
    '  color:#8a7a6a;margin-bottom:11px;padding-bottom:10px;border-bottom:1px solid #f8f1ea;}',
    '.toast.help .khead svg{display:block;flex:none;}',
    '.toast.help .ktitle{flex:1;min-width:0;font-size:12.5px;color:#2a2320;}',
    '.kclose{flex:none;border:0;background:transparent;color:#c3b4a4;cursor:pointer;padding:3px;',
    '  margin:-3px -5px -3px 0;display:inline-flex;border-radius:6px;font-family:inherit;',
    '  transition:background .15s,color .15s;}',
    '.kclose:hover{background:#fff1e8;color:#ff6a00;}',
    '.kclose svg{display:block;}',
    '.klist{display:grid;grid-template-columns:auto 1fr;gap:7px 12px;align-items:center;}',
    '.kgroup{grid-column:1/-1;font-size:9.5px;font-weight:700;letter-spacing:.07em;',
    '  color:#ff6a00;margin:6px 0 1px;}',
    '.kgroup:first-child{margin-top:0;}',
    '.kkeys{display:flex;align-items:center;gap:3px;flex-wrap:wrap;justify-content:flex-end;}',
    // 키캡: 아래 테두리를 두껍게 줘서 실제 키처럼 보이게 (무채색 바탕 + 주황 계열 글자)
    '.kcap{background:#f6f0e9;border:1px solid #e4d8c8;border-bottom-width:2px;border-radius:5px;',
    '  padding:1px 6px;font-size:10.5px;font-weight:700;color:#7a5f45;white-space:nowrap;}',
    '.ksep{color:#c0b0a0;font-size:10px;}',
    '.kdesc{font-size:12px;color:#3d342c;word-break:keep-all;}',
    // 모션 최소화 설정을 켠 사용자에게는 페이드만 남기고 전부 끈다
    '@media (prefers-reduced-motion:reduce){',
    '  .toast{animation:none;}.toast.bump{animation:none;}',
    '  .tbar{animation:none;transform:scaleX(0);}',
    '  .toast.gone{transition:opacity .12s linear;transform:none;}}'
  ];

  var toastHost = null;  // 토스트 전용 호스트 (위젯 호스트와 분리)
  var toastBox = null;   // 그 안의 .toasts 컨테이너

  // 위젯 호스트에는 transform:translateY(-50%)가 걸려 있다. transform은 containing block을
  // 만들기 때문에 그 안에서 position:fixed를 주면 뷰포트가 아니라 위젯 박스 기준으로 잡힌다.
  // 그래서 화면 우하단에 고정하려면 body에 직접 붙는 별도 호스트가 필요하다.
  function ensureToastLayer() {
    if (toastBox) return toastBox;
    toastHost = document.createElement('div');
    toastHost.id = 'jsl-toasts';
    toastHost.style.cssText = 'position:fixed;right:20px;bottom:20px;width:344px;' +
      'max-width:calc(100vw - 40px);z-index:2147483647;pointer-events:none;';
    var sh = toastHost.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent = TOAST_CSS.join('\n');
    sh.appendChild(st);
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    // 스크린리더가 복사 성공/실패를 읽어주도록. polite라 타이핑을 끊지 않는다.
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    sh.appendChild(toastBox);
    (document.body || document.documentElement).appendChild(toastHost);
    return toastBox;
  }

  // payload: {message, sub, kind:'info'|'ok'|'fail'|'help', items:[{keys,desc}|{group}], duration}
  // kind는 색+아이콘을 함께 바꾼다(색만으로 성공/실패를 구분하지 않는다).
  // kind:'help'는 items를 키캡 목록으로 렌더하고 자동소멸하지 않는다 — 클릭·Esc로 닫는다.
  var TOAST_MS = 3200;       // transient 알림 표시 시간 (예전 2.5초는 문장 하나도 빠듯했다)
  var TOAST_MAX = 3;         // 동시에 쌓이는 최대 개수
  var liveToasts = [];       // [{el, key, timer}] — 연타 병합·개수 제한용

  function dismissToast(rec) {
    var i = liveToasts.indexOf(rec);
    if (i >= 0) liveToasts.splice(i, 1);
    if (rec.timer) clearTimeout(rec.timer);
    rec.el.classList.add('gone');
    setTimeout(function () { rec.el.remove(); }, 200);
    if (rec.onDismiss) rec.onDismiss();
  }

  // 'Alt+Shift+C' → [Alt][+][Shift][+][C], 'Tab / Shift+Tab' → 슬래시로 갈라 각각 키캡.
  //
  // 대안 키 구분자는 "공백을 두른 슬래시"일 때만이다. 슬래시 자체가 키인 조합(Alt+/)이
  // 있어서, 그냥 split('/')로 자르면 'Alt+/'가 ['Alt+', '']로 쪼개져
  // [Alt][+][빈 키캡] / [빈 키캡]으로 깨졌다(실제로 보고됨).
  function renderKeys(box, keys) {
    String(keys).split(/\s+\/\s+/).forEach(function (group, gi) {
      if (gi) box.appendChild(makeSpan('ksep', '/'));
      group.trim().split('+').forEach(function (cap, ci) {
        var label = cap.trim();
        if (!label) return; // 'Ctrl+' 처럼 꼬리가 빈 표기가 와도 빈 키캡을 만들지 않는다
        if (ci) box.appendChild(makeSpan('ksep', '+'));
        box.appendChild(makeSpan('kcap', label));
      });
    });
  }

  function makeSpan(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function buildHelpToast(t, payload) {
    t.classList.add('help');
    var head = document.createElement('div');
    head.className = 'khead';
    head.innerHTML = KEYBOARD_ICON_SVG;
    head.appendChild(makeSpan('ktitle', payload.title || '단축키'));
    var close = document.createElement('button');
    close.className = 'kclose';
    close.innerHTML = CLOSE_ICON_SVG;
    close.title = '닫기 (Esc)';
    close.setAttribute('aria-label', '단축키 안내 닫기');
    head.appendChild(close);
    t.appendChild(head);

    var list = document.createElement('div');
    list.className = 'klist';
    (payload.items || []).forEach(function (item) {
      if (!item) return;
      // {group:'복사 · 검사'} 항목은 구분 헤더 한 줄 (2열을 통째로 차지)
      if (item.group) { list.appendChild(makeSpan('kgroup', item.group)); return; }
      var keys = document.createElement('span');
      keys.className = 'kkeys';
      renderKeys(keys, item.keys || '');
      list.appendChild(keys);
      list.appendChild(makeSpan('kdesc', item.desc || ''));
    });
    t.appendChild(list);
    return close;
  }

  function showToast(payload) {
    if (!els.toasts) return;
    // 예전 호출부(문자열 하나만 넘기던 형태)도 그대로 받는다
    if (typeof payload === 'string' || payload == null) payload = { message: payload };
    var kind = payload.kind || 'info';
    var isHelp = kind === 'help';
    var message = String(payload.message == null ? '' : payload.message);

    // 같은 알림 연타(Ctrl+S 연속 저장 등)는 새로 쌓지 않고 기존 것을 튕기고 타이머만 리셋.
    // 예전엔 누른 만큼 박스가 쌓여 화면을 밀어 올렸다.
    // sub까지 key에 넣는다 — 같은 문항을 고쳐서 다시 복사하면 글자수가 달라지므로,
    // 그때는 병합하지 말고 새 토스트로 보여줘야 숫자가 낡지 않는다.
    var key = kind + '|' + message + '|' + (payload.sub || '');
    if (!isHelp) {
      for (var i = 0; i < liveToasts.length; i++) {
        if (liveToasts[i].key === key) {
          var rec = liveToasts[i];
          rec.el.classList.remove('bump');
          void rec.el.offsetWidth; // 애니메이션 재시작 (리플로우 강제)
          rec.el.classList.add('bump');
          if (rec.timer) clearTimeout(rec.timer);
          rec.timer = setTimeout(function () { dismissToast(rec); }, TOAST_MS);
          return;
        }
      }
    }
    // 도움말은 한 번에 하나만 (연속 호출 시 토글처럼 닫히게)
    if (isHelp) {
      var opened = null;
      liveToasts.forEach(function (r) { if (r.key.indexOf('help|') === 0) opened = r; });
      if (opened) { dismissToast(opened); return; }
    }

    var t = document.createElement('div');
    t.className = 'toast ' + kind;
    var record = { el: t, key: key, timer: null, onDismiss: null };

    if (isHelp) {
      var closeBtn = buildHelpToast(t, payload);
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        dismissToast(record);
      });
      t.addEventListener('click', function () { dismissToast(record); });
      // Esc로도 닫는다. capture에서 잡고 전파를 끊어서, 답변란에 캐럿이 있어도
      // checkpoint의 Esc(포커스 해제)가 같이 발동하지 않게 한다.
      var onEsc = function (e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        dismissToast(record);
      };
      document.addEventListener('keydown', onEsc, true);
      record.onDismiss = function () { document.removeEventListener('keydown', onEsc, true); };
    } else {
      var ic = document.createElement('span');
      ic.className = 'badge';
      ic.innerHTML = TOAST_ICONS[kind] || TOAST_ICONS.info;
      t.appendChild(ic);
      var msg = makeSpan('tmsg', message);
      // sub: 본문 아래 한 단계 작은 보조 줄 (예: '799자 · 공백제외 616자')
      if (payload.sub) msg.appendChild(makeSpan('tsub', String(payload.sub)));
      t.appendChild(msg);
      var bar = document.createElement('span');
      bar.className = 'tbar';
      var ms = typeof payload.duration === 'number' ? payload.duration : TOAST_MS;
      bar.style.animationDuration = ms + 'ms';
      t.appendChild(bar);
      record.timer = setTimeout(function () { dismissToast(record); }, ms);
    }

    els.toasts.appendChild(t);
    liveToasts.push(record);
    while (liveToasts.length > TOAST_MAX) dismissToast(liveToasts[0]);
  }

  // ── 초기화 ────────────────────────────────────────────────
  function init() {
    try {
      host = document.createElement('div');
      host.id = 'jsl-dashboard';
      // 기본 위치: 왼쪽 중앙 도킹 (드래그로 이동 가능, 위치는 기억됨)
      // 상세 페이지에서는 state 수신 여부와 무관하게 항상 상주한다.
      var initialDisplay = /^\/resume\/\d+/.test(location.pathname) ? '' : 'none';
      host.style.cssText = 'position:fixed;left:16px;top:50%;transform:translateY(-50%);z-index:2147483647;display:' + initialDisplay + ';';
      shadow = host.attachShadow({ mode: 'open' });

      var style = document.createElement('style');
      style.textContent = [
        ':host{all:initial;}',
        '*{box-sizing:border-box;margin:0;padding:0;}',
        // 크림 외피 + 흰 본문 투톤. 숫자는 모노스페이스(HUD 문법).
        // 키보드 포커스 링 — 크림(#fdf8f3)·흰색·주황(#ff6a00) 배경이 섞여 있어서
        // 단색 링은 어딘가에서 반드시 묻힌다. 흰 안쪽 + 주황 바깥의 이중 링으로
        // 세 배경 모두에서 보이게 한다. :focus-visible이라 마우스 클릭 때는 안 뜬다.
        '.card-body:focus-visible,.copy-btn:focus-visible,.copy-ic:focus-visible,',
        '.jsl-action-btn:focus-visible,.jsl-header-btn:focus-visible,',
        '.jsl-more-btn:focus-visible,.toggle-collapse:focus-visible{',
        '  outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px #e05e00;}',
        '.wrap{position:relative;width:344px;background:#fdf8f3;border-radius:20px;',
        '  border:1px solid #f0e2d5;box-shadow:0 10px 30px rgba(30,20,10,.14);overflow:hidden;',
        '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;',
        '  font-size:14px;color:#332b24;line-height:1.45;}',
        '.sub,.cnt,.bigcnt,.st,.seg-fill{font-variant-numeric:tabular-nums;}',
        // 헤더 — 드래그 핸들. 신원(제목+D-day) 차선만 남기고, 도구는 더보기 메뉴로.
        '.header{display:flex;align-items:center;gap:8px;padding:15px 16px 0;',
        '  cursor:grab;user-select:none;}',
        '.header.dragging{cursor:grabbing;}',
        '.title{flex:1;min-width:0;font-weight:700;font-size:15px;color:#1f1a15;',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.dday{flex:none;font-weight:700;font-size:12.5px;color:#ff6a00;background:#fff;',
        '  border:1px solid #ffd9bd;border-radius:999px;padding:5px 11px;}',
        '.dday.urgent{color:#fff;background:#ef4444;border-color:#ef4444;}',
        '.dday.hidden{display:none;}',
        '.toggle-collapse{flex:none;min-width:26px;height:26px;border:none;border-radius:8px;',
        '  background:transparent;color:#b8a794;font-size:14px;line-height:1;cursor:pointer;padding:0 4px;}',
        '.toggle-collapse:hover{background:#fff1e8;color:#ff6a00;}',
        // 더보기(⋯) — 뜸한 설정 버튼들을 여기 한 군데로 모아 헤더를 가볍게 유지
        '.more-wrap{position:relative;flex:none;display:inline-flex;}',
        '.more-wrap.hidden{display:none;}',
        '.jsl-more-btn{flex:none;width:26px;height:26px;border:none;border-radius:8px;',
        '  background:transparent;color:#b8a794;display:inline-flex;align-items:center;',
        '  justify-content:center;cursor:pointer;padding:0;}',
        '.jsl-more-btn:hover{background:#fff1e8;color:#ff6a00;}',
        '.more-wrap.open .jsl-more-btn{background:#fff1e8;color:#ff6a00;}',
        // 드롭다운 패널 — 트리거 우측 하단에 앵커, 열고닫힘은 투명도+스케일로 은은하게
        '.header-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:184px;',
        '  background:#fff;border:1px solid #f0e2d5;border-radius:12px;',
        '  box-shadow:0 10px 26px rgba(30,20,10,.18);padding:6px;z-index:5;',
        '  opacity:0;transform:translateY(-4px) scale(.98);transform-origin:top right;',
        '  pointer-events:none;transition:opacity .14s ease,transform .14s ease;}',
        '.more-wrap.open .header-menu{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}',
        '.jsl-header-btn{display:flex;align-items:center;gap:9px;width:100%;text-align:left;',
        '  border:0;background:transparent;color:#5f5347;font-size:12.5px;font-weight:600;',
        '  font-family:inherit;padding:9px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;}',
        '.jsl-header-btn:hover{background:#fff1e8;color:#ff6a00;}',
        '.jsl-header-btn.toggle{justify-content:space-between;}',
        '.jsl-header-btn.toggle.on{color:#e05e00;}',
        // 진행 영역 — 얇은 구분선으로 헤더와 분리된 독립 차선(세그먼트 바 + 상태 칩줄)
        '.progress{margin:10px 16px 0;padding:10px 0 12px;border-top:1px solid #f2e6d8;}',
        '.segbar{display:flex;gap:4px;}',
        '.seg{flex:1;height:7px;border-radius:3px;background:#efe1d0;overflow:hidden;}',
        '.seg-fill{height:100%;border-radius:3px;width:0;transition:width .4s ease;}',
        '.seg-fill.done{background:#1d9e75;}',
        '.seg-fill.active{background:#ff6a00;}',
        '.seg-fill.empty{background:transparent;}',
        '.seg-fill.over{background:#ef4444;}',
        '.sub{margin-top:9px;display:flex;align-items:center;justify-content:space-between;',
        '  gap:8px;font-size:11px;color:#8a6a4d;letter-spacing:.01em;}',
        '.sub.plain{display:block;color:#a89a8b;}',
        '.chips{display:flex;gap:9px;flex-wrap:wrap;}',
        '.chip{display:inline-flex;align-items:center;gap:4px;font-weight:600;white-space:nowrap;}',
        '.chip i{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;}',
        '.chip.cdone{color:#0f6e56;}',
        '.chip.cwrite{color:#e05e00;}',
        '.chip.cempty{color:#a3937f;}',
        '.charcount{flex:none;color:#b7a793;}',
        // 본문 — 흰 패널
        '.panel{background:#fff;border-radius:18px 18px 0 0;}',
        '.body{max-height:436px;overflow-y:auto;padding:7px 0 2px;}',
        '.body::-webkit-scrollbar{width:4px;}',
        '.body::-webkit-scrollbar-thumb{background:#eddfd2;border-radius:2px;}',
        '.collapsed .panel{display:none;}',
        '.empty-msg{padding:22px 15px;color:#a89a8b;text-align:center;font-size:12px;}',
        // 문항 카드 — 상태별 solid 카드 (점선 없음)
        '.card{margin:5px 10px;border-radius:12px;border:1px solid #ece0d0;background:#fff;overflow:hidden;}',
        '.card.empty{border-color:#efe4d6;background:#fefbf7;}',
        '.card.done{border-color:#e6ddcf;}',
        '.card.active{border:1.5px solid #ffb377;background:#fff8f1;}',
        '.card.over{border-color:#f2bcbc;}',
        '.card-body{padding:11px 12px;cursor:pointer;}',
        '.card-body:hover{background:rgba(255,106,0,.03);}',
        '.card.empty .card-body:hover{background:rgba(255,106,0,.045);}',
        '.line{display:flex;align-items:center;gap:10px;}',
        // 상태 동그라미 (번호/체크) — 색+모양으로 단계 구분
        '.st{flex:none;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;',
        '  justify-content:center;font-size:10.5px;font-weight:700;box-sizing:border-box;}',
        '.st.empty{border:1.5px solid #dccbb6;color:#b0a08c;background:#fff;}',
        '.st.active{background:#ff6a00;color:#fff;}',
        '.st.done{background:#1d9e75;color:#fff;font-size:11px;}',
        // 지금 연 탭인데 아직 빈칸이면(active-empty) 링만 주황으로 "여기"를 표시
        '.card.cur.empty .st.empty{border-color:#ffb377;color:#e05e00;}',
        '.card.over .st.active{background:#ef4444;}',
        // 질문 텍스트 — 미작성이어도 또렷하게(흐림은 게이지/보조요소에만)
        '.q{flex:1;min-width:0;font-size:13px;color:#3d342c;',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.card.active .q{font-weight:600;color:#1f1a15;}',
        '.card.done .q{color:#5f5347;}',
        '.card.empty .q{color:#7d7160;}',
        // 카테고리 칩 (작성중 문항만)
        '.cat{flex:none;font-size:9.5px;font-weight:700;color:#a86a2f;background:#fff0df;',
        '  border:1px solid #f6d9b6;padding:2px 7px;border-radius:6px;white-space:nowrap;}',
        // 한 줄 글자수
        '.cnt{flex:none;font-size:11.5px;white-space:nowrap;}',
        '.cnt b{font-weight:700;}',
        '.cnt .dim{color:#c9bdb2;}',
        '.cnt.done{color:#0f6e56;}',
        '.cnt.done .dim{color:#9dc4b3;}',
        '.cnt.empty{color:#b7a793;}',
        '.cnt.empty .dim{color:#d0c3b2;}',
        '.cnt.over,.cnt.over b{color:#ef4444;font-weight:700;}',
        // 작성중 확장줄 — 큰 글자수+복사가 한 줄(양끝 정렬), 채움막대는 그 아래 단독 줄
        '.act-row{display:flex;align-items:center;justify-content:space-between;gap:9px;',
        '  margin-top:10px;padding-left:29px;}',
        '.bigcnt{flex:none;font-size:19px;font-weight:700;color:#e05e00;line-height:1;white-space:nowrap;}',
        '.bigcnt .dim{font-weight:400;font-size:12px;color:#c9bdb2;}',
        '.bigcnt.over{color:#ef4444;}',
        '.bigcnt .ov{color:#ef4444;font-size:11px;font-weight:700;}',
        '.fill{height:8px;background:#f5e4d3;border-radius:999px;overflow:hidden;margin:8px 0 0 29px;}',
        '.fill-in{height:100%;background:#ff6a00;border-radius:999px;width:0;transition:width .4s ease;}',
        '.fill-in.over{background:#ef4444;}',
        '.card-sub{margin-top:7px;padding-left:29px;font-size:10.5px;color:#b3a493;}',
        '.card-warn{margin:0 14px 5px;font-size:12px;font-weight:700;color:#ef4444;}',
        // 복사 — 작성중은 강조 버튼, 완료는 인라인 아이콘
        '.copy-btn{flex:none;display:inline-flex;align-items:center;gap:4px;border:0;cursor:pointer;',
        '  background:#ff6a00;color:#fff;font-size:11.5px;font-weight:700;font-family:inherit;',
        '  padding:5px 11px;border-radius:7px;transition:background .15s,transform .1s;}',
        '.copy-btn:hover{background:#f25e00;}',
        '.copy-btn:active{transform:scale(.93);}',
        '.copy-btn svg{display:block;}',
        '.copy-ic{flex:none;border:0;background:transparent;color:#bcae9d;cursor:pointer;',
        '  padding:3px;display:inline-flex;border-radius:6px;transition:background .15s,color .15s,transform .1s;}',
        '.copy-ic:hover{color:#ff6a00;background:#fff1e8;}',
        '.copy-ic:active{transform:scale(.88);}',
        '.copy-ic svg{display:block;}',
        // 복사 결과 피드백 — 클릭한 버튼 자체가 잠깐 초록/빨강으로 펄스된다.
        // 토스트만으로는 "눌렸는지·성공했는지"가 손 위치에서 멀어 놓치기 쉬웠다는
        // 피드백을 받아, 클릭한 지점에서 바로 보이도록 추가했다(실제로 보고됨).
        '@keyframes jsl-pulse-ok{0%{box-shadow:0 0 0 0 rgba(30,166,114,.5);}',
        '  70%{box-shadow:0 0 0 9px rgba(30,166,114,0);}100%{box-shadow:0 0 0 0 rgba(30,166,114,0);}}',
        '@keyframes jsl-pulse-fail{0%{box-shadow:0 0 0 0 rgba(224,62,62,.45);}',
        '  70%{box-shadow:0 0 0 9px rgba(224,62,62,0);}100%{box-shadow:0 0 0 0 rgba(224,62,62,0);}}',
        '.jsl-copy-ok{animation:jsl-pulse-ok .6s ease-out;color:#1ea672 !important;',
        '  background:#e8f8f1 !important;}',
        '.jsl-copy-fail{animation:jsl-pulse-fail .5s ease-out 2;color:#e03e3e !important;',
        '  background:#fdecec !important;}',
        // 액션줄 — 전체 복사(primary) + 답변 뱅크
        '.actions{display:flex;flex-wrap:wrap;gap:8px;padding:11px 16px 14px;',
        '  border-top:1px solid #f8f1ea;background:#fff;align-items:center;}',
        '.actions:empty{display:none;}',
        '.jsl-action-btn{flex:1 1 auto;order:2;text-align:center;border:1px solid #f0e1d3;background:#fdf8f3;',
        '  color:#8a6a4d;border-radius:10px;font-size:13px;padding:9px 11px;cursor:pointer;',
        '  font-weight:600;white-space:nowrap;font-family:inherit;}',
        '.jsl-action-btn:hover{background:#fff1e8;border-color:#ffd6b8;color:#ff6a00;}',
        '.jsl-action-btn.primary{order:1;flex:1.4 1 auto;background:#ff6a00;border-color:#ff6a00;color:#fff;',
        '  font-weight:700;box-shadow:0 2px 7px rgba(255,106,0,.3);}',
        '.jsl-action-btn.primary:hover{background:#f25e00;border-color:#f25e00;color:#fff;}',
        // 액션줄 라벨+스위치 토글 (on/off는 .on 클래스 — 호출측이 제어)
        '.jsl-action-btn.toggle{order:3;flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;',
        '  border:none;background:transparent;padding:4px 2px;font-size:11px;color:#8a6a4d;}',
        '.jsl-action-btn.toggle:hover{background:transparent;color:#ff6a00;}',
        '.jsl-action-btn.toggle .sw{width:30px;height:17px;border-radius:999px;background:#e5d8ca;',
        '  position:relative;display:inline-block;transition:background .2s;}',
        '.jsl-action-btn.toggle .sw::after{content:"";position:absolute;top:2px;left:2px;',
        '  width:13px;height:13px;border-radius:50%;background:#fff;transition:left .2s;}',
        '.jsl-action-btn.toggle.on .sw{background:#ff6a00;}',
        '.jsl-action-btn.toggle.on .sw::after{left:15px;}',
        // 헤더 더보기 메뉴의 토글 행도 같은 스위치 비주얼 재사용
        '.jsl-header-btn.toggle .tlabel{display:inline-flex;align-items:center;gap:8px;}',
        '.jsl-header-btn.toggle .sw{width:30px;height:17px;border-radius:999px;background:#e5d8ca;',
        '  position:relative;display:inline-block;flex:none;transition:background .2s;}',
        '.jsl-header-btn.toggle .sw::after{content:"";position:absolute;top:2px;left:2px;',
        '  width:13px;height:13px;border-radius:50%;background:#fff;transition:left .2s;}',
        '.jsl-header-btn.toggle.on .sw{background:#ff6a00;}',
        '.jsl-header-btn.toggle.on .sw::after{left:15px;}'
        // 토스트 스타일은 이 shadow root에 없다 — 화면 우하단 별도 레이어(TOAST_CSS)로 옮겼다.
      ].join('\n');
      shadow.appendChild(style);

      // 구조: 헤더(드래그) + 진행영역 + 흰 패널[본문+액션줄]. 토스트는 별도 레이어.
      var wrap = document.createElement('div');
      wrap.className = 'wrap';

      var header = document.createElement('div');
      header.className = 'header';
      header.title = '드래그해서 위치를 옮길 수 있어요';

      var title = document.createElement('div');
      title.className = 'title';
      title.textContent = '자비스';

      var dday = document.createElement('span');
      dday.className = 'dday hidden';

      // 헤더 우측: 더보기(⋯) 메뉴 — 기능이 꽂는 슬롯 버튼들을 한 곳에 모은다 + 접기 버튼
      var moreWrap = document.createElement('span');
      moreWrap.className = 'more-wrap hidden';

      var moreBtn = document.createElement('button');
      moreBtn.className = 'jsl-more-btn';
      moreBtn.innerHTML = MORE_ICON_SVG;
      moreBtn.title = '더보기';
      moreBtn.setAttribute('aria-haspopup', 'true');
      moreBtn.setAttribute('aria-expanded', 'false');
      moreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMenu();
      });

      var headerBtns = document.createElement('div');
      headerBtns.className = 'header-menu';
      headerBtns.setAttribute('role', 'menu');
      // 메뉴 안 클릭: 토글(설정)이 아니면 캡처 단계에서 먼저 닫아 액션 후 자동으로 접힌다.
      // 토글은 열어둔 채로 둬 여러 설정을 연달아 바꿀 수 있게 한다.
      headerBtns.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('button');
        if (btn && !btn.classList.contains('toggle')) closeMenu();
      }, true);

      moreWrap.appendChild(moreBtn);
      moreWrap.appendChild(headerBtns);

      var toggle = document.createElement('button');
      toggle.className = 'toggle-collapse';
      toggle.textContent = '－';
      toggle.title = '접기';
      toggle.addEventListener('click', function (e) { e.stopPropagation(); toggleCollapsed(); });

      header.appendChild(title);
      header.appendChild(dday);
      header.appendChild(moreWrap);
      header.appendChild(toggle);
      wrap.appendChild(header);

      // 진행 영역 (세그먼트 바 + 상태 요약줄)
      var progress = document.createElement('div');
      progress.className = 'progress';
      var segbar = document.createElement('div');
      segbar.className = 'segbar';
      var sub = document.createElement('div');
      sub.className = 'sub plain';
      sub.textContent = 'JASOVIS';
      progress.appendChild(segbar);
      progress.appendChild(sub);
      wrap.appendChild(progress);

      var panel = document.createElement('div');
      panel.className = 'panel';
      var body = document.createElement('div');
      body.className = 'body';
      panel.appendChild(body);
      var actions = document.createElement('div');
      actions.className = 'actions';
      panel.appendChild(actions);
      wrap.appendChild(panel);

      shadow.appendChild(wrap);
      (document.body || document.documentElement).appendChild(host);

      els = {
        wrap: wrap, header: header, title: title, sub: sub, dday: dday, toggle: toggle,
        body: body, actions: actions, toasts: ensureToastLayer(), headerBtns: headerBtns,
        segbar: segbar, moreWrap: moreWrap, moreBtn: moreBtn
      };

      // 렌더 전에 들어온 addAction 버튼 부착
      actionQueue.forEach(function (item) { attachActionBtn(item.btn, item.slot); });
      actionQueue = [];
      updateMoreVisibility();

      setupDrag();

      // 창 크기 변경(예: Windows 화면 분할 단축키로 창을 반으로 스냅) 대응.
      // 로드 시점 clampPos만으로는 이미 떠 있는 페이지에서 창 크기만 바뀌는
      // 경우를 못 잡는다 — 새로고침이 없으면 위치 재계산이 아예 안 일어나서
      // 패널이 화면 밖에 남아있게 된다(실제로 보고됨). 커스텀 위치가 적용된
      // 적이 있을 때만(transform이 'none'으로 바뀐 뒤) 반응하고, 기본값인
      // 세로 중앙 정렬 상태는 그대로 반응형으로 둔다.
      window.addEventListener('resize', function () {
        if (host.style.transform !== 'none') return;
        var rect = host.getBoundingClientRect();
        applyPos(clampPos(rect.left, rect.top));
      });

      // 접힘/위치 상태 복원
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([COLLAPSE_KEY, POS_KEY], function (res) {
            try {
              collapsed = !!(res && res[COLLAPSE_KEY]);
              applyCollapsed();
              var pos = res && res[POS_KEY];
              if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
                applyPos(clampPos(pos.left, pos.top));
              }
            } catch (e) { /* 무시 */ }
          });
        }
      } catch (e) { /* storage 접근 실패는 무시 */ }

      // 초기 화면: 데이터 대기 문구
      renderAll();
      readyResolve();

      // state 구독 (2초 주기) — null도 조용히 견딘다
      // 목록 페이지 state(page:'list')는 이 위젯 대상이 아니다.
      // SPA 전환 직후 이전 편집 화면이 잠깐 남아 보이지 않도록 즉시 숨긴다.
      JSL.onState(function (state) {
        if (state && state.page === 'list') {
          lastState = null;
          host.style.display = 'none';
          return;
        }
        if (state) {
          gotState = true;
          lastState = state;
          host.style.display = '';
        } else {
          lastState = null;
        }
        renderAll();
      });

      // 상세 페이지에서는 Angular/DOM 로딩 상태와 무관하게 항상 상주한다.
      // 자소서 상세 URL을 실제로 벗어났을 때만 숨긴다.
      setInterval(function () {
        var show = /^\/resume\/\d+/.test(location.pathname) ? '' : 'none';
        host.style.display = show;
        // 토스트 레이어는 별도 호스트라 같이 숨겨줘야 한다 (목록 페이지에 남지 않게)
        if (toastHost) toastHost.style.display = show;
      }, 500);

      // 토스트 구독
      JSL.on('toast', function (payload) {
        showToast(payload); // {message, kind, items, duration} — showToast가 형태를 흡수한다
      });

      // 10초 내 state가 한 번도 안 오면 안내 문구 상태로 조용히 대기
      setTimeout(function () {
        if (!gotState) {
          lastState = null;
          renderAll();
        }
      }, 10000);
    } catch (e) {
      // 예외 전파 금지 — 콘솔 경고 1회 후 비활성
      console.warn('[자비스] 대시보드 초기화 실패', e);
      readyResolve(); // 대기 중인 기능이 영원히 멈추지 않도록 resolve는 해 준다
    }
  }

  JSL.register('dashboard', init);
})();
