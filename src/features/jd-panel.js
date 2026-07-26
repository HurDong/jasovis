// 채용공고 JD 패널. 이력서와 연결된 채용공고 이미지/본문을 자소설닷컴 화면 왼쪽의
// 빈 여백에 "배경처럼" 띄운다 — 카드/모달처럼 보이지 않게 테두리·그림자·배경색 없이
// 이미지 자체만 놓고, 남는 세로 공간을 최대한 채운다(이미지는 상단바 바로 아래부터
// 꽉 채움 — 버튼 자리를 이미지 쪽에서 빼오지 않는다). 접기 버튼은 왼쪽 문항 탭(1,2..)
// 바로 위, 그 탭과 같은 가로 위치의 작은 흰 원형 버튼 — 이미지 영역 밖의 원래 빈 틈이라
// 이미지를 침범하지 않는다.
// 이력서 스코프의 resume.employment_company_id -> GET /api/v1/employment_companies/:id 로 조회.
// 이 API의 content 필드는 회사가 올린 원문 HTML인데, 실페이지 확인 결과 상당수가
// <img> 태그 하나뿐인 "포스터 이미지형" 공고였다(텍스트 0자). 그래서 태그를 걷어낸
// 순수 텍스트 길이로 텍스트형/이미지형을 자동 판별해 다르게 렌더링한다.
// 지원자수·조회수 같은 부가 메타는 자리만 차지한다는 피드백으로 전부 뺐다 — 이미지형은
// 이미지만, 텍스트형은 본문만 보여준다.
(function () {
  'use strict';

  var COLLAPSE_KEY = 'jslJdPanelCollapsed';

  var host = null;
  var shadow = null;
  var els = {};
  var collapsed = false;
  var lastCompanyId = null;   // 마지막으로 fetch한 employment_company_id (중복 fetch 방지)
  var fetchToken = 0;         // 응답이 늦게 와서 최신 상태를 덮어쓰는 것 방지

  function saveStorage(key, value) {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        var obj = {}; obj[key] = value;
        chrome.storage.local.set(obj);
      }
    } catch (e) { /* storage 실패는 무시 */ }
  }

  // content HTML -> { text, imageUrl }
  // 태그 제거는 표시/판별용 최소 구현이며, 문항 답변에는 전혀 관여하지 않는다.
  function parseContent(html) {
    var raw = String(html || '');
    var imgMatch = raw.match(/<img[^>]+src="([^"]+)"/i);
    var text = raw
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text: text, imageUrl: imgMatch ? imgMatch[1] : null };
  }

  // ── 렌더 ──────────────────────────────────────────────────
  // 이미지 로드가 끝나기 전엔 opacity:0으로 숨겨두고(레이아웃 안 잡힌 상태가 깜빡이지
  // 않게), 로드 완료 시 'loaded'를 붙여 살짝 페이드인한다.
  function renderEmpty(message) {
    if (!els.scroll) return;
    els.scroll.innerHTML = '';
    var e = document.createElement('div');
    e.className = 'empty';
    e.textContent = message;
    els.scroll.appendChild(e);
    els.scroll.classList.add('loaded');
  }

  function renderJob(job) {
    if (!els.scroll) return;
    els.scroll.innerHTML = '';
    els.scroll.classList.remove('loaded');

    var parsed = parseContent(job.content);
    if (parsed.text && parsed.text.length >= 15) {
      var wrap = document.createElement('div');
      wrap.className = 'jd-text-wrap';
      var head = document.createElement('div');
      head.className = 'job-title';
      head.textContent = job.title || '';
      wrap.appendChild(head);
      var textEl = document.createElement('div');
      textEl.className = 'jd-text';
      textEl.textContent = parsed.text;
      wrap.appendChild(textEl);
      els.scroll.appendChild(wrap);
      els.scroll.classList.add('loaded');
    } else if (parsed.imageUrl) {
      var link = document.createElement('a');
      link.className = 'jd-image-link';
      link.href = job.employment_page_url || parsed.imageUrl; // 이미지 파일이 아니라 채용 사이트로 이동
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = '채용 사이트에서 원본 공고 보기';
      var img = document.createElement('img');
      img.className = 'jd-image';
      img.alt = job.title || '채용공고 이미지';
      img.addEventListener('load', function () { els.scroll.classList.add('loaded'); });
      img.addEventListener('error', function () { els.scroll.classList.add('loaded'); });
      img.src = parsed.imageUrl;
      link.appendChild(img);
      els.scroll.appendChild(link);
    } else {
      renderEmpty('이 공고는 미리보기를 지원하지 않아요');
    }
  }

  function fetchJob(companyId) {
    var token = ++fetchToken;
    renderEmpty('불러오는 중…');
    host.style.display = '';
    applyBounds();
    fetch('/api/v1/employment_companies/' + companyId + '?skip_read_log=true', { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (token !== fetchToken) return; // 그 사이 문항/이력서가 바뀌어 최신 요청이 아니면 버림
        if (!data) { renderEmpty('공고 정보를 불러오지 못했어요'); return; }
        renderJob(data);
      })
      .catch(function () {
        if (token !== fetchToken) return;
        renderEmpty('공고 정보를 불러오지 못했어요');
      });
  }

  // ── 레이아웃 계산 ─────────────────────────────────────────
  // 사이트 상단바(.gnb) + 그 아래 두 번째 툴바(.function_bar, "맞춤법검사/저장기록/..." 줄)와
  // 왼쪽 문항 탭(span.qna-number)/에디터 카드(.resume-editor-wrapper)의 실제 위치를 매번
  // 측정해서, 그 사이 빈 여백에만 정확히 들어가도록 top/left/width를 정한다. 창 크기·줌
  // 배율마다 여백 크기가 달라서 고정값을 쓰면 툴바를 침범하거나 본문을 가린다.
  // (처음엔 .gnb만 봤다가 그 아래 .function_bar까지 가리는 걸 실페이지에서 확인하고 추가함.)
  // 토글 버튼(사용자 선택안 C1 + F4): 접힘/펼침 모두 화면 왼쪽 끝(left:0)에 붙는
  // 같은 주황 세로 손잡이이고, 자리는 절대 움직이지 않는다. 라벨과 셰브런 방향만
  // 바뀐다 — 접힘은 "공고 ›", 펼침은 "‹ 접기".
  //
  // 왜 이렇게 됐나 (히스토리):
  //  - 원래는 작은 흰 원형 버튼이었는데, 접힌 상태에서 존재 자체를 못 알아채고
  //    "공고가 안 뜬다"고 오해했다(실제로 보고됨). 그래서 접힘을 눈에 띄는
  //    주황 세로 손잡이로 바꿨다.
  //  - 펼침은 한때 문항 탭 위의 흰 알약("접기")으로 뒀는데, 알약이 탭보다 넓어서
  //    오른쪽 자소서 카드의 제목 줄을 파고들었다(실제로 보고됨). 탭 아래로 옮기는
  //    안도 검토했지만 그 자리는 사이트의 문항 추가/삭제 버튼(add_qna/removeMode)이
  //    이미 쓰고 있어서 역시 겹친다. 결국 사이트 UI가 전혀 없는 화면 왼쪽 끝에
  //    두 상태를 다 고정하는 쪽이 겹침이 구조적으로 불가능해서 이걸로 정했다.
  var TOGGLE_SIZE = 34;   // (폴백용) 문항 탭을 못 찾았을 때의 기준 크기
  var HANDLE_W = 28;      // 세로 손잡이 폭
  var HANDLE_H = 100;     // 세로 손잡이 높이
  // 손잡이가 항상 왼쪽 끝을 차지하므로, 펼친 공고 이미지는 그 오른쪽에서 시작해야
  // 손잡이가 이미지를 덮지 않는다.
  var PANEL_LEFT = HANDLE_W + 6;

  function svgChevron(dir) {
    var pts = dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6';
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="' + pts + '"/></svg>';
  }

  // 포스터(이미지)가 숨어 있다는 걸 알려주는 사진 아이콘
  var SVG_PHOTO =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M15 8h.01"/>' +
    '<path d="M4 15l4-4a3 5 0 0 1 3 0l5 5"/><path d="M14 14l1-1a3 5 0 0 1 3 0l2 2"/></svg>';

  var COLLAPSED_HTML = SVG_PHOTO + '<span class="vlabel">공고</span>' + svgChevron('right');
  var EXPANDED_HTML = svgChevron('left') + '<span class="vlabel">접기</span>';

  function computeBounds() {
    var margin = 16;
    var navBottom = 0;
    ['.function_bar', '.gnb'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) navBottom = Math.max(navBottom, el.getBoundingClientRect().bottom);
    });

    var boundaryLeft = window.innerWidth * 0.42; // 셀렉터를 못 찾았을 때의 보수적 기본값
    var editorEl = document.querySelector('.resume-editor-wrapper');
    if (editorEl) {
      var er = editorEl.getBoundingClientRect();
      if (er.width > 0) boundaryLeft = Math.min(boundaryLeft, er.left);
    }
    document.querySelectorAll('span.qna-number').forEach(function (t) {
      var el = t.closest('[ng-click]') || t.parentElement || t;
      var r = el.getBoundingClientRect();
      if (r.width > 0) boundaryLeft = Math.min(boundaryLeft, r.left);
    });

    var top = Math.max(navBottom, 0) + margin;
    // 손잡이: 접힘·펼침 모두 화면 왼쪽 끝, 이미지가 시작되는 높이에서 출발.
    // 화면이 짧으면 아래로 넘치지 않게 클램프한다.
    var handleTop = Math.min(top, Math.max(navBottom + 4, window.innerHeight - HANDLE_H - margin));
    // 상한을 고정 640px로 뒀더니, 맞춤법/채팅 패널을 둘 다 닫아 실제 여백(boundaryLeft)이
    // 640을 넘는 흔한 경우에 그 초과분이 그대로 죽은 여백으로 남는 문제가 있었다(실제로
    // 보고됨). 패널이 열려 있을 때는 여백이 자연히 640 밑이라 문제가 안 보였을 뿐 — 상한
    // 자체가 뷰포트와 무관한 고정값이라 "닫혀서 넓어진 경우"에만 손해였다.
    // 단순히 뷰포트 비율(0.36)로만 바꾸면 1440px 안팎의 일반 노트북 화면에서는 오히려
    // 640보다 낮은 값(518px)이 나와, 원래 캡에 걸린 적도 없던 화면까지 더 좁아지는
    // 회귀가 생긴다. 그래서 640을 바닥으로 깔아 기존에 문제없던 화면은 그대로 두고,
    // 그 바닥을 넘어서는 진짜 넓은 화면에서만 비율대로 위로 늘어나게 한다.
    var maxWidth = Math.max(640, window.innerWidth * 0.36);
    return {
      top: top,
      left: PANEL_LEFT,
      width: Math.max(140, Math.min(maxWidth, boundaryLeft - PANEL_LEFT - margin)),
      maxHeight: Math.max(120, window.innerHeight - top - margin),
      handleTop: handleTop
    };
  }

  function applyBounds() {
    if (!els.scroll) return;
    var b = computeBounds();
    els.scroll.style.top = b.top + 'px';
    els.scroll.style.left = b.left + 'px';
    els.scroll.style.width = b.width + 'px';
    els.scroll.style.maxHeight = b.maxHeight + 'px';
    // 손잡이 자리는 상태와 무관하게 고정 — 버튼이 튀지 않게 하는 게 F4의 핵심.
    els.toggle.style.top = b.handleTop + 'px';
    els.toggle.style.left = '0px';
  }

  // ── 접기/펼치기 ────────────────────────────────────────────
  function applyCollapsed() {
    if (!els.wrap) return;
    els.wrap.classList.toggle('collapsed', collapsed);
    els.toggle.title = collapsed ? '채용공고 펼치기' : '채용공고 접기';
    els.toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    // 모양·자리는 그대로, 라벨과 셰브런 방향만 상태에 맞게 바꾼다.
    els.toggle.innerHTML = collapsed ? COLLAPSED_HTML : EXPANDED_HTML;
    applyBounds();
  }

  function toggleCollapsed() {
    collapsed = !collapsed;
    applyCollapsed();
    saveStorage(COLLAPSE_KEY, collapsed);
  }

  // ── 초기화 ────────────────────────────────────────────────
  function init() {
    try {
      host = document.createElement('div');
      host.id = 'jsl-jd-panel';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:none;pointer-events:none;';
      shadow = host.attachShadow({ mode: 'open' });

      var style = document.createElement('style');
      style.textContent = [
        ':host{all:initial;}',
        '*{box-sizing:border-box;margin:0;padding:0;}',
        // 카드/모달 느낌을 빼기 위해 배경·테두리·그림자를 두지 않는다. 이미지 자체가
        // 왼쪽 여백 위에 그냥 놓여 있는 것처럼 보이게 하는 게 목표.
        // 위치/크기(top/left/width/max-height)는 실제 사이트 레이아웃(gnb, 문항 탭,
        // 에디터 카드)을 매번 측정해서 JS가 인라인으로 지정한다 — 창 크기마다 빈 여백의
        // 크기가 달라서 고정값으로는 상단바를 침범하거나 본문을 가릴 수 있기 때문.
        // 스크롤은 필요하지만(공고 이미지가 화면보다 김) 눈에 띄면 위젯처럼 보이니 숨긴다
        // (휠/드래그로는 여전히 스크롤됨).
        '.scroll{position:fixed;overflow-y:auto;overflow-x:hidden;pointer-events:auto;',
        '  scrollbar-width:none;-ms-overflow-style:none;',
        '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,',
        '  "Malgun Gothic","Apple SD Gothic Neo",sans-serif;',
        '  opacity:0;transition:opacity .25s ease;}',
        '.scroll.loaded{opacity:1;}',
        '.scroll::-webkit-scrollbar{display:none;}',
        '.collapsed .scroll{display:none;}',
        '.empty{padding:10px 2px;color:#98a2b3;text-align:center;font-size:12px;}',
        '.jd-text-wrap{padding-right:4px;}',
        '.job-title{font-weight:700;font-size:14px;color:#333;margin-bottom:8px;}',
        '.jd-text{font-size:13px;color:#4a4a4a;white-space:pre-wrap;}',
        // 카드처럼 안 보이게: 테두리·그림자·둥근모서리·hover 효과 없이 이미지 그 자체만.
        '.jd-image-link{display:block;}',
        '.jd-image{display:block;width:100%;height:auto;}',
        // 토글 — 접힘·펼침 공통: 화면 왼쪽 끝에 붙는 주황 세로 손잡이(서랍 손잡이 은유).
        // 모양·자리는 두 상태가 완전히 같고, 안의 라벨과 셰브런 방향만 바뀐다.
        '.toggle{position:fixed;width:' + HANDLE_W + 'px;height:' + HANDLE_H + 'px;padding:0;',
        '  border:none;border-radius:0 12px 12px 0;background:#ff6a00;color:#fff;cursor:pointer;',
        '  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;',
        '  pointer-events:auto;font-family:inherit;line-height:1;',
        '  box-shadow:2px 2px 10px rgba(255,106,0,.3);transition:background .15s;}',
        '.toggle:hover{background:#f25e00;}',
        '.toggle svg{display:block;flex:none;}',
        '.toggle .vlabel{writing-mode:vertical-rl;font-size:11px;letter-spacing:1px;}'
      ].join('\n');
      shadow.appendChild(style);

      var wrap = document.createElement('div');
      wrap.className = 'wrap';

      var scroll = document.createElement('div');
      scroll.className = 'scroll';
      wrap.appendChild(scroll);

      var toggle = document.createElement('button');
      toggle.className = 'toggle';
      toggle.title = '채용공고 접기';
      // 아이콘은 유니코드 화살표(⌄) 대신 SVG로 고정 — 폰트마다 크기·굵기가 들쭉날쭉해서.
      // 실제 내용은 applyCollapsed가 상태(공고/접기)에 맞게 다시 채운다.
      toggle.innerHTML = EXPANDED_HTML;
      toggle.addEventListener('click', toggleCollapsed);
      wrap.appendChild(toggle);

      shadow.appendChild(wrap);
      (document.body || document.documentElement).appendChild(host);

      els = { wrap: wrap, scroll: scroll, toggle: toggle };
      applyBounds();
      window.addEventListener('resize', applyBounds);

      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([COLLAPSE_KEY], function (res) {
            try {
              collapsed = !!(res && res[COLLAPSE_KEY]);
              applyCollapsed();
            } catch (e) { /* 무시 */ }
          });
        }
      } catch (e) { /* storage 접근 실패는 무시 */ }

      JSL.onState(function (state) {
        if (!state || state.page === 'list' || !state.resume || !state.resume.employment_company_id) {
          host.style.display = 'none';
          lastCompanyId = null;
          return;
        }
        var id = state.resume.employment_company_id;
        if (id === lastCompanyId) return; // 같은 공고면 재조회 안 함(타이핑마다 오는 state 이벤트 방어)
        lastCompanyId = id;
        fetchJob(id);
      });

      // bridge-main은 편집 페이지를 벗어나면 state 이벤트 자체를 안 보낸다.
      // 그래서 페이지 이탈 감지는 여기서 별도로 polling한다(대시보드와 동일 패턴).
      // 같은 루프에서 레이아웃도 재계산한다 — 사이트 쪽 배너/알림 등으로 상단바 높이가
      // resize 이벤트 없이 바뀌는 경우까지 방어하기 위함.
      setInterval(function () {
        if (!/^\/resume\/\d+/.test(location.pathname)) {
          host.style.display = 'none';
          lastCompanyId = null;
          return;
        }
        applyBounds();
      }, 500);
    } catch (e) {
      console.warn('[자비스] JD 패널 초기화 실패', e);
    }
  }

  JSL.register('jd-panel', init);
})();
