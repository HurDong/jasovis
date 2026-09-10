// 검수 위치 마커 기능 — 답변 textarea 안에서 캐럿이 있는 문장에 지속적으로
// 테두리+배경 하이라이트를 씌운다. 다른 탭 갔다 오거나 문항을 전환해도
// 마지막 캐럿 위치를 문항별로 기억해서 같은 자리에 표시를 복원한다.
// 답변란에서 Tab / Shift+Tab으로 하이라이트를 다음·이전
// 문장으로 넘길 수 있다 — 마우스 없이 한 문장씩 읽어 내려가는 검수용.
// (Alt+↓ / Alt+↑는 예전엔 이 기능의 별칭이었지만, 문항 전환 단축키로 재배정됐다 — hotkeys.js 참조)
//
// 구현 방식: textarea는 원래 위치(position 값)를 유지한 채 배경/글자색을
// 완전히 투명하게 만든다 (caret-color만 원래 색으로 남겨 캐럿은 보이게).
// 그 밑에 폰트/여백을 그대로 복제한 백드롭 레이어가 실제 보이는 글자를
// 원래 색 그대로 그리고, 캐럿이 속한 문장 구간에만 배경색+테두리 박스를
// 씌운다. textarea 값이 바뀔 때마다 백드롭 텍스트도 그대로 복사하므로
// 항상 진짜 텍스트와 100% 동기화된다. textarea가 투명해서, 사이트 CSS의
// 중첩 stacking context 때문에 백드롭이 앞뒤 어느 쪽에 그려지든 글자가
// 가려지는 문제가 생기지 않는다 (실제로 z-index만 믿었다가 하이라이트가
// 텍스트를 덮어버리는 버그를 겪고 이 방식으로 바꿨다).
//
// 주의: 사이트 CSS가 지저분해서(SPEC.md) 폰트 계산이 완벽히 안 맞을 수 있다.
// 실제 페이지에서 픽셀이 어긋나면 COPY_PROPS/패딩 보정값을 조정할 것.
JSL.register('checkpoint', function () {
  'use strict';

  var STORAGE_KEY = 'jslCheckpoint'; // { [qnaId]: charOffset }
  var SAVE_DEBOUNCE_MS = 500;
  var REATTACH_POLL_MS = 400;

  var MARK_BG = '#fff1e8';
  var MARK_BORDER = '#ffb377';
  var MARK_BORDER_IDLE = '#ffcda8'; // 포커스 없을 때(=책갈피 상태)의 옅은 테두리

  var offsets = {};        // storage 캐시 { qnaId: offset }
  var activeQnaId = null;  // 현재 활성 문항 id (state.qnas[].id)
  var activeNumber = null; // 현재 활성 문항 번호 (focus:answer 대기 판정용)
  var currentTa = null;    // 현재 오버레이가 붙은 textarea
  var host = null;         // 백드롭 호스트 (position:fixed)
  var shadow = null;
  var markEl = null;       // 백드롭 안의 하이라이트 span
  var textNode1 = null;    // 하이라이트 앞부분 텍스트 노드
  var textNode2 = null;    // 하이라이트 뒷부분 텍스트 노드
  var markPre = null;      // 하이라이트 문장 중 캐럿 앞부분
  var markPost = null;     // 하이라이트 문장 중 캐럿 뒷부분
  var caretEl = null;      // 우리가 직접 그리는 깜빡이는 캐럿 (네이티브 캐럿은 stacking 문제로 못 믿음)
  var saveTimer = null;
  var rafPending = false;
  var interacted = false;  // 이 textarea에서 사용자가 직접 클릭/입력했는가
  var taOrigColor = null;  // attach 시점의 textarea 원래 글자색 (조합 중 임시 복원용)
  var composing = false;   // 한글 등 IME 조합 중인가
  var colorTrusted = false; // 위 색을 신뢰할 수 있는가 (아래 refreshTextColorIfNeeded 참조)
  var ro = null;           // textarea 박스 변화 감시 (ResizeObserver)
  var focused = false;     // 답변란에 포커스가 있는가 (아래 두 상태 구분에 사용)

  // ---- storage ----
  function loadOffsets() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(STORAGE_KEY, function (res) {
        try { offsets = (res && res[STORAGE_KEY]) || {}; } catch (e) { /* 무시 */ }
      });
    } catch (e) { /* 무시 */ }
  }

  function saveOffset(qnaId, offset) {
    if (qnaId == null) return;
    offsets[qnaId] = offset;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) return;
        var payload = {};
        payload[STORAGE_KEY] = offsets;
        chrome.storage.local.set(payload);
      } catch (e) { /* 무시 */ }
    }, SAVE_DEBOUNCE_MS);
  }

  // ---- 문장 경계 탐색: caret이 속한 [start, end) 문자 범위 반환 ----
  function findSentenceRange(text, caret) {
    var n = text.length;
    if (n === 0) return { start: 0, end: 0 };
    caret = Math.max(0, Math.min(caret, n));
    var start = 0;
    var i = 0;
    while (i < n) {
      var ch = text[i];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
        var j = i;
        while (j + 1 < n && /[.!?…]/.test(text[j + 1])) j++;
        var end = j + 1;
        var k = end;
        while (k < n && /\s/.test(text[k]) && text[k] !== '\n') k++;
        // 판정 범위는 다음 문장 시작(k) 전까지로 잡는다 — 문장 끝(end)까지만 잡으면
        // 마침표 뒤 공백 구간(end~k)의 캐럿이 어느 문장에도 안 걸려서, 안전망이
        // "캐럿을 포함하도록 범위를 넓히다가" 다음 문장까지 통째로 삼켜버리는
        // 버그가 있었다(실제로 보고됨: 커서를 한 칸만 옮겨도 하이라이트가 다음
        // 문장까지 번짐). 화면에 그리는 범위(start~end)는 그대로 문장만 딱 맞게.
        // k === n이면(이 문장이 마지막이고 뒤에 더 이상 문자가 없으면) 텍스트
        // 맨 끝(caret === n)도 이 문장 소속으로 쳐준다.
        if (caret >= start && (caret < k || k === n)) return { start: start, end: end };
        start = k;
        i = k;
        continue;
      }
      if (ch === '\n') {
        if (caret >= start && caret <= i) return { start: start, end: i };
        start = i + 1;
      }
      i++;
    }
    return { start: start, end: n };
  }

  // 텍스트를 드래그/Ctrl+A로 선택하면 브라우저가 textarea 위에 직접 선택 박스를
  // 그린다(백드롭과 별개로 textarea 자신이 그림 → 백드롭보다 위에 얹힘).
  //
  // 세 가지를 다 겪었다:
  //  1) 반투명 주황(.22) + 글자 투명 — 배경이 너무 옅어서 선택한 티가 거의 안 남.
  //  2) 불투명 주황 + 흰 글자 — 단어 하나는 또렷했지만 문단 전체를 드래그하면
  //     반전된 블록이 화면을 뒤덮어 오히려 안 읽혔다.
  //  3) 반투명 주황(.4) + 글자 투명 — 읽히긴 했지만, 브랜드색인 주황 자체가
  //     "선택 중"이라는 느낌보다 별도 하이라이트처럼 보여 낯설다는 피드백을 받았다
  //     (실제로 보고됨: "일반적인 텍스트 드래그처럼 갔으면").
  // 그래서 색 자체를 바꿨다 — 브라우저/OS 어디서나 텍스트를 드래그하면 뜨는
  // 익숙한 파란 톤으로. 투명도 낮춰 반투명 유지 + 글자 투명(백드롭의 원래 검은
  // 글자가 그 파란 톤 아래로 그대로 비침)은 그대로 둔다 — 이 부분(형광펜 방식)은
  // 이미 검증됐고, 문제는 색이 파랑이 아니라 주황이었다는 점뿐이었다.
  // 실제 페이지 DOM의 textarea용이라 (샤도우 DOM이 아니라) 문서 head에 직접 넣는다.
  var SELECTION_STYLE_ID = 'jsl-checkpoint-selection-style';
  function ensureSelectionStyle() {
    if (document.getElementById(SELECTION_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = SELECTION_STYLE_ID;
    style.textContent =
      'textarea.answer::selection{background:rgba(51,144,255,.32);color:transparent;}' +
      'textarea.answer::-moz-selection{background:rgba(51,144,255,.32);color:transparent;}';
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- 백드롭 DOM 준비 ----
  function ensureHost() {
    ensureSelectionStyle();
    if (host) return;
    host = document.createElement('div');
    host.id = 'jsl-checkpoint';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:0;';
    shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;}',
      '*{box-sizing:border-box;margin:0;padding:0;}',
      '.layer{position:absolute;left:0;top:0;overflow:hidden;',
      '  border-color:transparent;background:transparent;}',
      // border는 인라인 요소라도 실제 폭에 더해져서 문장이 하이라이트될 때마다
      // 그 뒤 텍스트가 미세하게 밀리는 원인이 된다(실제로 보고된 문제).
      // box-shadow(inset)는 레이아웃에 전혀 관여하지 않는 순수 페인트 효과라
      // 똑같은 테두리처럼 보이면서도 뒤 텍스트 위치에 영향을 주지 않는다.
      '.mark{background:' + MARK_BG + ';border-radius:4px;',
      '  box-shadow:inset 0 0 0 1.5px ' + MARK_BORDER + ';',
      '  box-decoration-break:clone;-webkit-box-decoration-break:clone;}',
      '@keyframes jsl-blink{0%,45%{opacity:1;}50%,95%{opacity:0;}100%{opacity:1;}}',
      // width:0인 채로 흐름에 끼워 넣어서 뒤 글자를 밀어내지 않게 하고,
      // 실제 보이는 바는 절대위치 ::after로 겹쳐 그린다 (네이티브 캐럿처럼 레이아웃에 영향 없음)
      '.caret{position:relative;display:inline-block;width:0;height:1em;vertical-align:text-bottom;}',
      '.caret::after{content:"";position:absolute;left:0;top:0;width:1.5px;height:100%;',
      '  background:currentColor;animation:jsl-blink 1s steps(1,end) infinite;}'
    ].join('\n');
    shadow.appendChild(style);

    var layer = document.createElement('div');
    layer.className = 'layer';
    textNode1 = document.createTextNode('');
    markEl = document.createElement('span');
    markEl.className = 'mark';
    markPre = document.createTextNode('');
    caretEl = document.createElement('span');
    caretEl.className = 'caret';
    markPost = document.createTextNode('');
    markEl.appendChild(markPre);
    markEl.appendChild(caretEl);
    markEl.appendChild(markPost);
    textNode2 = document.createTextNode('');
    layer.appendChild(textNode1);
    layer.appendChild(markEl);
    layer.appendChild(textNode2);
    shadow.appendChild(layer);

    els_layer = layer;
    (document.body || document.documentElement).appendChild(host);
  }
  var els_layer = null;

  // textarea의 폰트/여백을 백드롭에 그대로 복제 (최초 부착 시 1회)
  var COPY_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
    'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'boxSizing', 'direction', 'tabSize',
    // 한글 사이트는 영단어가 중간에 잘리지 않게 word-break을 커스텀으로
    // 지정해두는 경우가 많다(예: keep-all). 이걸 안 베끼면 실제 textarea와
    // 백드롭의 줄바꿈 지점이 달라져서 "STOMP" 같은 영단어가 우리 쪽에서만
    // 중간에 쪼개지는 문제가 생긴다(실제로 보고됨).
    'wordBreak'
  ];

  function applyMirrorStyle(cs, origColor) {
    COPY_PROPS.forEach(function (p) {
      try { els_layer.style[p] = cs[p]; } catch (e) { /* 무시 */ }
    });
    els_layer.style.whiteSpace = 'pre-wrap';
    els_layer.style.wordWrap = 'break-word';
    els_layer.style.overflowWrap = 'break-word';
    // getBoundingClientRect는 항상 border-box 치수라 레이어도 강제로 맞춘다
    // (원본 textarea가 content-box여도 무관하게 rect.width/height를 그대로 씀)
    els_layer.style.boxSizing = 'border-box';
    // 실제 보이는 글자는 이제 이 레이어가 그린다 (원래 textarea 글자색 그대로)
    els_layer.style.color = origColor;
  }

  // ---- 위치 동기화 (rAF로 스로틀) ----
  // 주의: rAF는 탭이 숨겨지면 아예 실행되지 않는다. 그래서 "반드시 지금 맞춰야"
  // 하는 경로(폴링·가시성 복귀)에서는 schedulePosition이 아니라 positionNow를
  // 직접 부른다 — 안 그러면 다른 탭 갔다 왔을 때 글자가 낡은 위치에 남는다.
  function schedulePosition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      positionNow();
    });
  }

  // 폰트/레이아웃을 다시 베껴온다. 웹폰트가 attach 이후에 로드되면 attach 시점에
  // 복사한 metrics가 폴백 폰트 기준이라, 줄바꿈 지점과 자간이 실제 textarea와
  // 어긋난 채 계속 남는다(재부착이 없으면 영구적).
  function remirror() {
    if (!currentTa || !els_layer) return;
    try {
      var saved = currentTa.style.color;
      currentTa.style.color = '';
      var cs = getComputedStyle(currentTa);
      var color = (colorTrusted && taOrigColor) ? taOrigColor : cs.color;
      currentTa.style.color = saved;
      applyMirrorStyle(cs, color);
      positionNow();
    } catch (e) { /* 무시 */ }
  }

  // 로드 직후엔 사이트 레이아웃이 여러 번 움직인다(Angular 렌더, 이미지 리플로우 등).
  // 그 변화는 input/click/resize 어디에도 안 걸려서 400ms 폴링까지 기다려야 했고,
  // 그동안 글자가 옛 위치에 남아 "본문이 아래에 있다가 제자리로 튀는" 것처럼 보였다
  // (실제로 보고됨). 부착 직후 잠깐만 촘촘히 따라붙어 그 구간을 넘긴다.
  var burstTimers = [];
  function burstSync() {
    clearBurst();
    [0, 60, 140, 260, 420, 650, 900, 1400].forEach(function (ms) {
      burstTimers.push(setTimeout(positionNow, ms));
    });
  }
  function clearBurst() {
    burstTimers.forEach(clearTimeout);
    burstTimers = [];
  }

  function positionNow() {
    if (!currentTa || !host) return;
    try {
      var rect = currentTa.getBoundingClientRect();
      host.style.left = rect.left + 'px';
      host.style.top = rect.top + 'px';
      els_layer.style.width = rect.width + 'px';
      els_layer.style.height = rect.height + 'px';
      els_layer.scrollTop = currentTa.scrollTop;
      els_layer.scrollLeft = currentTa.scrollLeft;
    } catch (e) { /* 무시 */ }
  }

  // ---- 하이라이트 갱신 (캐럿도 이 레이어가 직접 그린다) ----
  function updateHighlight(offset) {
    if (!currentTa || !els_layer) return;
    try {
      var text = currentTa.value || '';
      var n = text.length;
      var caret = Math.max(0, Math.min(offset, n));
      var range = findSentenceRange(text, caret);
      // 캐럿이 항상 문장 범위 안에 오도록 보정 (안전망)
      var start = Math.min(range.start, caret);
      var end = Math.max(range.end, caret);
      var hasContent = end > start && text.slice(start, end).trim() !== '';

      // 문서 전체(start===0 && end===n)가 마침표(.!?…) 하나 없이 한 덩어리로 잡히면,
      // "아직 안 끝난 첫 문장"이 아니라 "지금까지 쓴 전체"가 통째로 잡힌 것이다
      // (findSentenceRange가 문장 경계를 못 찾아 텍스트 끝까지를 폴백으로 반환하기
      // 때문). 빈 칸에 막 쓰기 시작했을 때 방금 친 글자 전체가 박스로 뒤덮이는
      // 문제였다(실제로 보고됨) — 이 경우만 하이라이트를 꺼서, 문장 하나를
      // 다 쓴 뒤 이어 쓰는 정상적인 경우(문서 뒷부분, start!==0)는 그대로 둔다.
      //
      // end===n 조건이 붙은 이유: 예전엔 start===0만 봤는데, 그러면 마침표 없이
      // 줄바꿈으로 끝나는 첫 줄(자소서 제목 "[...]" 줄이 대표적)이 영구히 억제됐다.
      // Tab으로 맨 위 문장까지 거슬러 올라가면 하이라이트가 사라진 것처럼 보인다.
      // 첫 줄은 '\n'에서 끊기므로 end < n이고, "빈 칸에 막 쓰기 시작한" 진짜
      // 억제 대상만 문서 끝까지(end===n) 한 덩어리로 잡힌다.
      if (start === 0 && end === n && !/[.!?…]/.test(text.slice(start, end))) hasContent = false;

      // 드래그로 실제 범위를 선택 중(caret가 아니라 selectionStart~selectionEnd)이면
      // 문장 박스를 잠깐 꺼둔다. 이 박스는 캐럿 "위치"만 보고 항상 문장 전체를 감싸므로,
      // 문장 안에서 단어 몇 개만 드래그해도 그 작은 선택이 훨씬 큰 문장 박스에 묻혀
      // "드래그한 게 안 보인다"는 느낌을 준다(실제로 보고됨). 선택 중엔 네이티브 파란
      // ::selection만 보이게 양보하고, 선택이 캐럿 하나로 다시 좁혀지면(클릭 한 번) 원래대로
      // 문장 박스가 돌아온다.
      var hasSelection = currentTa.selectionStart != null &&
        currentTa.selectionEnd != null && currentTa.selectionEnd !== currentTa.selectionStart;

      textNode1.nodeValue = text.slice(0, start);
      markPre.nodeValue = text.slice(start, caret);
      markPost.nodeValue = text.slice(caret, end);
      // 테두리는 .mark의 box-shadow(inset)로 그려진다 — 레이아웃에 영향을 안 주려고
      // border 대신 쓴 것이다. 그래서 껄 때도 box-shadow를 꺼야 한다. 예전엔
      // borderColor만 투명하게 했는데 .mark엔 border가 없어서 아무 효과가 없었고,
      // 박스를 숨겨야 하는 상황에서도 주황 테두리만 계속 남아 있었다(실제로 보고됨).
      //
      // 포커스 유무로 두 상태를 구분한다:
      //  - 포커스 있음(지금 편집 중): 채운 배경 + 실선 테두리 + 깜빡이는 캐럿
      //  - 포커스 없음(마지막 검수 위치): 배경 없이 점선 테두리만, 캐럿 숨김
      //    → 타이핑이 안 되는 상태인데 캐럿이 계속 깜빡여 커서가 거기 있는 것처럼
      //      보이던 문제를 없애고, 위치 기억은 "책갈피"로 계속 보여준다.
      var showMark = hasContent && !hasSelection;
      markEl.style.background = (showMark && focused) ? MARK_BG : 'transparent';
      markEl.style.boxShadow = (showMark && focused) ? 'inset 0 0 0 1.5px ' + MARK_BORDER : 'none';
      if (showMark && !focused) {
        markEl.style.outline = '1.5px dashed ' + MARK_BORDER_IDLE;
        markEl.style.outlineOffset = '-1px';
      } else {
        markEl.style.outline = 'none';
      }
      caretEl.style.visibility = (hasSelection || !focused) ? 'hidden' : '';
      textNode2.nodeValue = text.slice(end) + ' '; // 마지막 줄 높이 보정용 트레일링 스페이스
      schedulePosition();
    } catch (e) { /* 무시 */ }
  }

  function currentOffset() {
    try {
      return currentTa.selectionStart != null ? currentTa.selectionStart : 0;
    } catch (e) { return 0; }
  }

  // 답변란이 비어 있을 때 사이트는 플레이스홀더("답변을 입력하세요")용 연회색을
  // 글자색으로 준다(실측: 빈 칸 rgb(187,187,187) vs 내용 있음 rgb(51,51,51)).
  // attach가 빈 상태에서 일어나면(새로고침 직후 등) 그 회색을 진짜 글자색으로
  // 착각해 백드롭에 물려버려서, 이후 입력·붙여넣기한 글자가 전부 회색으로
  // 보이는 문제가 있었다(실제로 보고됨). 그래서 빈 상태의 색은 신뢰하지 않고,
  // 내용이 생긴 뒤 처음으로 다시 읽어 확정한다.
  // 우리가 이미 ta.style.color를 transparent로 덮어썼으므로, 읽는 순간만
  // 인라인 값을 비워 원래 색을 얻고 곧바로 복원한다(중간에 페인트가 없어 깜빡임 없음).
  function refreshTextColorIfNeeded() {
    if (!currentTa || colorTrusted) return;
    var isPlaceholder = false;
    try { isPlaceholder = currentTa.matches(':placeholder-shown'); } catch (e) { isPlaceholder = false; }
    if (isPlaceholder) return; // 아직 비어 있으면 그릴 글자도 없으니 다음 기회에
    var saved = currentTa.style.color;
    currentTa.style.color = '';
    var real = getComputedStyle(currentTa).color;
    currentTa.style.color = saved;
    taOrigColor = real;
    colorTrusted = true;
    if (els_layer) els_layer.style.color = real;
    try { currentTa.style.caretColor = real; } catch (e) { /* 무시 */ }
  }

  function onFocus() {
    focused = true;
    onInteract();
  }

  function onBlur() {
    focused = false;
    // 값은 그대로, 표시만 "책갈피" 상태로 바꾼다 (캐럿 숨김 + 점선 테두리)
    updateHighlight(currentTa ? currentOffset() : 0);
  }

  function onInteract() {
    if (!currentTa || composing) return; // 조합 중엔 host가 숨겨져 있고 값도 아직 안 정해졌다
    refreshTextColorIfNeeded();
    interacted = true;
    var offset = currentOffset();
    updateHighlight(offset);
    if (activeQnaId != null) saveOffset(activeQnaId, offset);
  }

  // 화살표 등 캐럿 이동 키는 누르고 있으면 keydown만 반복되고 keyup은 뗄 때 딱 한 번만
  // 온다. keyup만 듣고 있으면 여러 문장을 훌쩍 지나 마지막 위치에서야 딱 한 번
  // 갱신되어 "1번째에서 바로 6번째로 순간이동"한 것처럼 보인다(실제로 보고된 문제).
  // keydown은 브라우저가 캐럿을 옮기기 전에 먼저 오므로, 옮긴 뒤인 다음 렌더
  // 프레임에 읽어야 정확한 위치를 얻는다 — 그래야 눌려있는 동안에도 한 문장씩
  // 지나가는 게 보인다.
  var NAV_KEYS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Home: 1, End: 1, PageUp: 1, PageDown: 1 };
  function onNavKeyDown(e) {
    if (!NAV_KEYS[e.key]) return;
    requestAnimationFrame(onInteract);
  }

  // ---- 문장 단위 이동 (검수용) ----
  // 하이라이트는 항상 "캐럿이 속한 문장"을 따라가므로, 다음 문장으로 표시를
  // 옮기는 일은 캐럿을 그 문장 첫 글자로 옮기는 것과 똑같다 — 별도 상태가 없다.
  function isSpace(ch) { return /\s/.test(ch); }

  // dir > 0 다음 문장 / dir < 0 이전 문장. 처음·끝에서는 아무것도 하지 않는다
  // (Tab이 갑자기 포커스를 밖으로 던지는 것보다 그 자리에 머무는 게 덜 놀랍다).
  function moveSentence(dir) {
    if (!currentTa || composing) return false;
    var text = currentTa.value || '';
    var n = text.length;
    if (!n) return false;
    var range = findSentenceRange(text, currentOffset());
    var target = -1;
    if (dir > 0) {
      // 문장 끝 뒤의 공백·빈 줄을 모두 건너뛰면 다음 문장 첫 글자다
      var p = range.end;
      while (p < n && isSpace(text[p])) p++;
      if (p < n) target = p;
    } else {
      // 캐럿이 문장 중간이어도 그 문장은 이미 하이라이트된 상태이므로,
      // Shift+Tab은 항상 "한 문장 앞"으로 간다 (문장 머리로 되돌아오지 않는다).
      var q = range.start - 1;
      while (q >= 0 && isSpace(text[q])) q--;
      if (q >= 0) target = findSentenceRange(text, q).start;
    }
    if (target < 0) return false;
    // 문장 시작이 들여쓰기 공백일 수 있다 — 첫 글자까지 밀어준다
    while (target < n && isSpace(text[target])) target++;
    try {
      currentTa.setSelectionRange(target, target);
    } catch (e) {
      return false;
    }
    onInteract();        // 하이라이트 갱신 + 문항별 위치 저장
    scrollMarkIntoView();
    return true;
  }

  // 코드로 캐럿을 옮길 때는 브라우저가 스크롤을 따라 움직여주지 않는다
  // (사용자가 직접 누른 키만 해당). 백드롭은 textarea의 폰트·여백을 그대로
  // 복제한 레이어라, 그 안의 .mark 위치를 재면 textarea 안에서의 위치를
  // 그대로 얻을 수 있다 — 별도 측정용 미러를 만들 필요가 없다.
  function scrollMarkIntoView() {
    if (!currentTa || !markEl || !els_layer) return;
    try {
      els_layer.scrollTop = currentTa.scrollTop; // 측정 전 스크롤 기준을 맞춘다
      var mr = markEl.getBoundingClientRect();
      if (!mr.height) return; // 하이라이트가 꺼진 상태(빈 답변 등)
      var cs = getComputedStyle(currentTa);
      var padTop = parseFloat(cs.paddingTop) || 0;
      var borderTop = parseFloat(cs.borderTopWidth) || 0;
      var lr = els_layer.getBoundingClientRect();
      var y = (mr.top - lr.top) + els_layer.scrollTop - borderTop - padTop; // 내용 좌표계
      var s = currentTa.scrollTop;
      var view = currentTa.clientHeight;  // padding 포함
      var top = s - padTop;               // 지금 보이는 내용 구간 [top, top+view)
      var margin = 8;
      var next = s;
      if (y < top + margin) next = y + padTop - margin;
      else if (y + mr.height > top + view - margin) next = y + mr.height + padTop - view + margin;
      var max = Math.max(0, currentTa.scrollHeight - currentTa.clientHeight);
      next = Math.max(0, Math.min(next, max));
      if (next !== s) { currentTa.scrollTop = next; onScroll(); }
    } catch (e) { /* 무시 */ }
  }

  // Tab / Shift+Tab — 다음/이전 문장.
  // 답변 textarea에 직접 붙는 리스너라 다른 입력칸의 Tab 포커스 이동은 그대로다.
  // 답변란에서 Tab의 기본 동작은 '다음 컨트롤로 포커스 이동'인데 작성 중엔 거의
  // 쓰지 않으므로 검수 이동에 내준다 — 밖으로 나가려면 Esc로 답변란을 벗어난 뒤
  // Tab을 쓰면 된다(아래 Esc 처리).
  // Alt+↓/Alt+↑는 예전엔 여기 별칭이었지만 hotkeys.js의 문항 전환으로 넘어갔다
  // (hotkeys가 document capture에서 먼저 가로채 여기까진 오지 않는다).
  function onKeyDown(e) {
    if (e.isComposing || composing) return; // 한글 조합 중 Tab은 조합 확정용일 수 있다
    var isTab = e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (isTab) {
      e.preventDefault();
      e.stopPropagation();
      moveSentence(e.shiftKey ? -1 : 1);
      return;
    }
    // Esc — 답변란에서 빠져나온다. Tab을 가로챈 대신 남겨두는 탈출구.
    // preventDefault는 하지 않는다 (사이트가 Esc로 뭘 닫든 그대로 두려고).
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      try { currentTa.blur(); } catch (err) { /* 무시 */ }
      return;
    }
    onNavKeyDown(e);
  }

  // ---- 부착/해제 ----
  function detach() {
    if (currentTa) {
      try {
        currentTa.style.background = '';
        currentTa.style.position = '';
        currentTa.style.zIndex = '';
        currentTa.style.color = '';
        currentTa.style.caretColor = '';
      } catch (e) { /* 무시 */ }
      currentTa.removeEventListener('input', onInteract);
      currentTa.removeEventListener('click', onInteract);
      currentTa.removeEventListener('keyup', onInteract);
      currentTa.removeEventListener('keydown', onKeyDown);
      currentTa.removeEventListener('focus', onFocus);
      currentTa.removeEventListener('blur', onBlur);
      currentTa.removeEventListener('scroll', onScroll);
      currentTa.removeEventListener('select', onInteract);
      currentTa.removeEventListener('compositionstart', onCompositionStart);
      currentTa.removeEventListener('compositionend', onCompositionEnd);
    }
    if (ro) { try { ro.disconnect(); } catch (e) { /* 무시 */ } ro = null; }
    clearBurst();
    currentTa = null;
    interacted = false;
    composing = false;
    if (host) { host.style.display = 'none'; host.style.visibility = ''; }
  }

  function onScroll() {
    if (!currentTa || !els_layer) return;
    els_layer.scrollTop = currentTa.scrollTop;
    els_layer.scrollLeft = currentTa.scrollLeft;
  }

  // ---- 한글 등 IME 조합 대응 ----
  // 조합 중인 글자(아직 완성 안 된 자모)는 textarea.value에 안 실리는 경우가
  // 많아서 우리 백드롭이 그 부분을 모른다. 그런데 textarea 글자색은 계속
  // transparent라, 브라우저가 조합 중 텍스트를 자기 방식(점선 밑줄+회색 배경 등)
  // 으로 그려도 우리 배경과 안 맞아 어색한 회색 박스처럼 보인다(실제로 보고됨).
  // 조합이 진행되는 동안만 원래 글자색을 되살리고 백드롭을 숨겨서, 그 구간은
  // 브라우저 네이티브 표시 그대로 보이게 하고 조합이 끝나면 다시 우리 방식으로 되돌린다.
  function onCompositionStart() {
    if (!currentTa) return;
    composing = true;
    try { currentTa.style.color = taOrigColor || ''; } catch (e) { /* 무시 */ }
    if (host) host.style.visibility = 'hidden';
  }

  function onCompositionEnd() {
    if (!currentTa) return;
    composing = false;
    try { currentTa.style.color = 'transparent'; } catch (e) { /* 무시 */ }
    if (host) host.style.visibility = '';
    onInteract();
  }

  function attach(ta) {
    ensureHost();
    currentTa = ta;
    interacted = false;
    // 부착 시점의 실제 포커스 상태를 반영 (탭 전환 후 재부착되는 경우 포함)
    focused = document.activeElement === ta;
    host.style.display = '';

    // 원래 레이아웃은 건드리지 않고 배경/글자만 투명 + 살짝 위 스택으로.
    // 진짜 보이는 글자는 백드롭이 그리고, textarea는 캐럿·선택영역·입력만 담당한다.
    // (사이트 CSS가 중첩 stacking context를 쓰면 z-index 숫자로 앞뒤를 100% 보장 못 하는데,
    //  textarea 쪽을 완전히 투명하게 만들어두면 어느 쪽이 위에 그려지든 글자가 가려지지 않는다)
    var cs = getComputedStyle(ta);
    var origColor = cs.color;
    taOrigColor = origColor;
    composing = false;
    // 빈 칸이면 이 색은 플레이스홀더용 회색이라 신뢰하지 않는다(refreshTextColorIfNeeded 참조)
    try { colorTrusted = !ta.matches(':placeholder-shown'); } catch (e) { colorTrusted = true; }
    if (cs.position === 'static') ta.style.position = 'relative';
    if (!ta.style.zIndex) ta.style.zIndex = '1';
    ta.style.background = 'transparent';
    ta.style.color = 'transparent';
    // 캐럿은 백드롭이 직접 그린다(.caret). 네이티브 캐럿까지 살려두면 둘이 미세하게
    // 어긋난 위치에서 같이 깜빡여 커서가 두 개로 보인다 — 예전엔 우리 캐럿이 없던
    // 시절의 코드가 남아 origColor로 켜져 있었다.
    ta.style.caretColor = 'transparent';

    applyMirrorStyle(cs, origColor);

    ta.addEventListener('input', onInteract);
    ta.addEventListener('click', onInteract);
    ta.addEventListener('keyup', onInteract);
    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('focus', onFocus);
    ta.addEventListener('blur', onBlur);
    ta.addEventListener('scroll', onScroll);
    // 드래그로 선택 범위가 바뀔 때마다(마우스를 놓기 전, 드래그 도중에도) 문장 박스
    // 억제 여부를 실시간으로 갱신하기 위해 select도 구독한다 — click/keyup만 듣고 있으면
    // 마우스를 놓을 때까지는 문장 박스가 그대로 남아 있어 드래그 중엔 여전히 뭉개져 보였다.
    ta.addEventListener('select', onInteract);
    ta.addEventListener('compositionstart', onCompositionStart);
    ta.addEventListener('compositionend', onCompositionEnd);

    // textarea 박스 자체가 바뀌는 리플로우(사이트 패널 열림, 창 폭 변화 등)를 직접 감지.
    // 이벤트로는 안 잡히는 변화까지 즉시 따라가게 한다.
    try {
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(function () { positionNow(); });
        ro.observe(ta);
      }
    } catch (e) { /* 무시 */ }

    burstSync();

    // 저장된 위치가 있으면 상호작용 전에도 그 문장을 먼저 보여준다
    var restored = activeQnaId != null && typeof offsets[activeQnaId] === 'number'
      ? offsets[activeQnaId]
      : currentOffset();
    updateHighlight(restored);
  }

  // 문항을 전환해도 비활성 문항의 textarea.answer가 DOM에서 사라지지 않고
  // CSS로만 숨겨지는 경우가 있다 (querySelector 첫 매치는 항상 같은 문항일 수 있음).
  // offsetParent가 null이면 자신 또는 조상이 display:none이라는 뜻이므로 걸러낸다.
  function findVisibleAnswerTa() {
    var list = document.querySelectorAll('textarea.answer');
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) return list[i];
    }
    return list.length ? list[0] : null; // 다 안 보이는 상태면 폴백으로 첫 번째
  }

  // ---- 활성 textarea 재탐지 (전환 시 DOM 노드가 바뀌거나, 숨겨진 채 남는 경우 모두 대응) ----
  function ensureAttached() {
    try {
      var ta = findVisibleAnswerTa();
      if (!ta) { detach(); return; }
      if (ta !== currentTa) {
        detach();
        attach(ta);
      } else {
        // 사이트가 프로그래매틱으로 값을 채우는 경우(임시저장 복원 등)엔 우리 input
        // 핸들러가 안 불리므로, 폴링에서도 글자색 확정을 한 번씩 재시도한다.
        refreshTextColorIfNeeded();
        positionNow(); // rAF를 거치지 않는다 — 숨겨진 탭에서도 폴링은 동작해야 한다
      }
    } catch (e) { /* 무시 */ }
  }

  // ---- 문항 전환 후 커서를 본문으로 ('focus:answer' 구독) ----
  // 단축키·내비 버튼으로 문항만 바뀌고 커서는 밖에 남아 있으면, 결국 답변란을
  // 한 번 클릭해야 해서 키보드로 옮긴 의미가 없다(실제로 보고됨).
  // 캐럿은 그 문항에 저장해둔 검수 위치로 되돌린다 — 없으면 글 맨 끝(이어 쓰기 좋은 자리).
  //
  // 전환은 비동기다: 요청 직후엔 아직 이전 문항의 textarea가 보일 수 있고
  // activeQnaId도 다음 state 브로드캐스트가 와야 갱신된다. 그래서 즉시 포커스하지 않고
  // 목표 문항이 실제로 활성화될 때까지 짧게 폴링한다(끝내 안 되면 조용히 포기).
  var FOCUS_POLL_MS = 30;
  // 이제 "focus()를 불렀다"가 아니라 "실제로 들어갔다"를 성공 기준으로 쓰므로,
  // 전환이 느리거나 Angular가 포커스를 한 번 걷어가는 경우까지 버틸 여유를 준다.
  // 끝내 못 넣으면 조용히 포기한다(사이트 기본 동작을 막지 않는다).
  var FOCUS_TIMEOUT_MS = 3000;
  var focusTimer = null;

  function focusAnswerNow(wantNumber) {
    if (wantNumber != null && activeNumber !== wantNumber) return false;
    var ta = findVisibleAnswerTa();
    // 전환 중엔 아무 것도 안 보일 수 있다. 이때 findVisibleAnswerTa가 폴백으로 주는
    // '숨은 첫 번째'에 포커스하면 엉뚱한 문항으로 커서가 간다 — 보이는 것만 받는다.
    if (!ta || ta.offsetParent === null) return false;
    // 오버레이 부착은 해보되, 실패해도 커서 이동은 계속한다. 예전에는 부착 결과
    // (currentTa === ta)를 통과 조건으로 걸었는데, ensureAttached는 내부 예외를 삼키므로
    // 부착이 한 번 어긋나면 캐럿이 영영 안 들어가고 사용자는 본문을 마우스로 눌러야 했다.
    // 검수 하이라이트가 붙는지와 캐럿이 본문에 들어가는지는 별개의 일이다.
    try { ensureAttached(); } catch (e) { /* 무시 */ }
    try {
      var text = ta.value || '';
      var saved = (activeQnaId != null && typeof offsets[activeQnaId] === 'number')
        ? offsets[activeQnaId] : text.length;
      var pos = Math.max(0, Math.min(saved, text.length));
      // 선택 범위를 포커스보다 먼저 잡는다 — 순서를 바꾸면 focus 핸들러(onInteract)가
      // 아직 0인 캐럿 위치를 읽어 저장해둔 검수 위치를 0으로 덮어쓴다.
      ta.setSelectionRange(pos, pos);
      ta.focus();
    } catch (e) {
      return false;
    }
    // focus()를 불렀다고 들어간 게 아니다 — 전환 직후엔 Angular가 다시 그리면서
    // 방금 준 포커스를 걷어가기도 한다. 실제로 들어갔을 때만 성공으로 보고,
    // 아니면 false를 돌려 폴링이 계속 재시도하게 한다.
    if (document.activeElement !== ta) return false;
    // 하이라이트 갱신은 오버레이가 실제로 이 textarea에 붙었을 때만 의미가 있다.
    if (currentTa === ta) {
      onInteract();      // 하이라이트 갱신 (+ 같은 위치로 저장)
      scrollMarkIntoView();
    }
    return true;
  }

  JSL.on('focus:answer', function (payload) {
    var wantNumber = payload && payload.number != null ? Number(payload.number) : null;
    var deadline = Date.now() + FOCUS_TIMEOUT_MS;
    if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; } // 연타 시 이전 대기는 버린다
    (function tick() {
      focusTimer = null;
      try {
        if (focusAnswerNow(wantNumber)) return;
      } catch (e) { /* 무시 */ }
      if (Date.now() < deadline) focusTimer = setTimeout(tick, FOCUS_POLL_MS);
    })();
  });

  loadOffsets();

  JSL.onState(function (state) {
    try {
      if (!state || state.page === 'list' || !Array.isArray(state.qnas)) return;
      var active = null;
      for (var i = 0; i < state.qnas.length; i++) {
        if (state.qnas[i] && state.qnas[i].active) { active = state.qnas[i]; break; }
      }
      activeQnaId = active && active.id != null ? active.id : null;
      activeNumber = active && active.number != null ? Number(active.number) : null;
      ensureAttached();
    } catch (e) { /* 무시 */ }
  });

  window.addEventListener('resize', schedulePosition);
  document.addEventListener('scroll', schedulePosition, true);

  // 다른 탭 갔다 돌아왔을 때: 숨어 있는 동안 rAF가 멈춰 있었으므로 즉시 맞춘다.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { positionNow(); burstSync(); }
  });

  // 웹폰트가 늦게 로드되면 attach 때 베낀 폰트 metrics가 폴백 기준이라 줄바꿈이 어긋난다.
  try {
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(function () { remirror(); });
    }
  } catch (e) { /* 무시 */ }

  // 이벤트를 놓쳤을 때를 위한 안전망 폴링 (SPEC.md 관례와 동일한 결)
  setInterval(ensureAttached, REATTACH_POLL_MS);
});
