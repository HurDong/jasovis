// 문항 퀵 내비게이터 — 답변 textarea 옆에 크게 붙는 위/아래 버튼 두 개.
// 대시보드나 Alt+숫자 단축키까지 손을 옮기지 않아도 마우스로 이전/다음 문항을
// 오갈 수 있게 한다. 버튼 DOM은 최초 1회만 만들고 이후엔 텍스트/disabled만 갱신한다.
//
// 연타 시 끊김 방지: 사이트 쪽 문항 전환은 Angular 다이제스트를 동반해 가볍지 않다.
// 버튼을 빠르게 여러 번 누르면 요청을 그때그때 다 쏘지 않고, 응답이 올 때까지는
// "가고 싶은 목적지"만 갱신해두었다가 응답이 오면 그 시점의 최종 목적지로 한 번에
// 점프한다 — 중간 문항을 다 거치지 않고 최종 목적지로만 이동해서 체감 지연을 줄인다.
JSL.register('qna-nav', function () {
  'use strict';

  var POLL_MS = 400;
  var GAP = 14; // textarea와의 간격

  var host = null;
  var railEl = null;
  var prevBtn = null;
  var nextBtn = null;
  var rafPending = false;
  var visible = false;
  var qnas = null;          // 최신 qnas 배열 (number 오름차순)
  var desiredIndex = null;  // 낙관적 목적지 인덱스 (요청 진행 중에도 버튼 반응은 즉시)
  var busy = false;         // switchQna 요청 진행 중

  var UP_SVG = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
  var DOWN_SVG = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'jsl-qna-nav';
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;display:none;';
    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;}',
      '*{box-sizing:border-box;margin:0;padding:0;}',
      '.rail{display:flex;flex-direction:column;align-items:center;gap:5px;',
      '  background:#fdf8f3;border:2px solid #f0e2d5;border-radius:28px;padding:11px;',
      '  box-shadow:0 12px 30px rgba(30,20,10,.22);',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;}',
      '.nav{flex:none;width:66px;height:60px;border:0;border-radius:18px;background:#fff;',
      '  border:2px solid #eadbc9;color:#c8ab8d;cursor:pointer;padding:0;',
      '  display:flex;align-items:center;justify-content:center;',
      '  transition:background .1s,color .1s,transform .06s,border-color .1s;}',
      '.nav:hover:not(:disabled){background:#fff1e8;border-color:#ffb377;color:#ff6a00;}',
      '.nav:active:not(:disabled){transform:scale(.9);background:#ff6a00;border-color:#ff6a00;color:#fff;}',
      '.nav:disabled{opacity:.28;cursor:default;}',
      '.nav svg{display:block;}'
    ].join('\n');
    shadow.appendChild(style);

    railEl = document.createElement('div');
    railEl.className = 'rail';

    prevBtn = document.createElement('button');
    prevBtn.className = 'nav';
    prevBtn.innerHTML = UP_SVG;
    prevBtn.title = '이전 문항';
    prevBtn.addEventListener('click', function () { go(-1); });

    nextBtn = document.createElement('button');
    nextBtn.className = 'nav';
    nextBtn.innerHTML = DOWN_SVG;
    nextBtn.title = '다음 문항';
    nextBtn.addEventListener('click', function () { go(1); });

    railEl.appendChild(prevBtn);
    railEl.appendChild(nextBtn);
    shadow.appendChild(railEl);
    (document.body || document.documentElement).appendChild(host);
  }

  // 비활성 문항의 textarea가 DOM에 숨겨진 채 남을 수 있어 보이는 것만 고른다.
  // 문항 전환 중 아주 짧은 순간엔 전부 안 보일 수도 있는데, 그때 첫 번째로
  // 폴백하면 그 요소의 rect가 (0,0)이라 버튼이 화면 좌상단으로 순간이동해버린다
  // (실제로 보고된 버그). 그래서 다 안 보이면 null을 반환해 위치를 그대로 둔다.
  function findVisibleAnswerTa() {
    var list = document.querySelectorAll('textarea.answer');
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) return list[i];
    }
    return null;
  }

  function schedulePosition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      positionNow();
    });
  }

  function positionNow() {
    if (!host || !visible) return;
    var ta = findVisibleAnswerTa();
    if (!ta) return; // 전환 중 잠깐 아무 textarea도 안 보이는 순간 — 마지막 위치를 그대로 유지
    try {
      var rect = ta.getBoundingClientRect();
      var railRect = railEl.getBoundingClientRect();
      // 세로 위치는 항상 "화면 정중앙"으로 고정한다. 문항마다 질문 텍스트 길이가
      // 달라 답변 상자가 시작하는 위치도 미세하게 달라지는데, 그걸 그대로 따라가면
      // 문항을 넘길 때마다 버튼이 조금씩 흔들리는 것처럼 보인다(실제로 보고된 문제).
      // 가로만 답변 상자 왼쪽에 붙이고, 세로는 콘텐츠와 무관하게 고정한다.
      var top = window.innerHeight / 2 - railRect.height / 2;
      top = Math.max(8, Math.min(top, window.innerHeight - railRect.height - 8));
      // textarea 왼쪽에 붙이되, 공간이 없으면(작은 창) textarea 안쪽 왼편으로 겹쳐서라도 보이게
      var left = rect.left - railRect.width - GAP;
      if (left < 8) left = Math.min(rect.left + 8, window.innerWidth - railRect.width - 8);
      host.style.top = top + 'px';
      host.style.left = left + 'px';
      host.style.display = '';
    } catch (e) { /* 무시 */ }
  }

  function activeIndex() {
    if (!qnas) return -1;
    for (var i = 0; i < qnas.length; i++) {
      if (qnas[i].active) return i;
    }
    return -1;
  }

  // 지금 "가려는" 인덱스 — 요청이 진행 중이면 아직 확정 안 된 낙관적 목적지를 우선한다
  function effectiveIndex() {
    return desiredIndex != null ? desiredIndex : activeIndex();
  }

  function go(delta) {
    if (!qnas) return;
    var base = effectiveIndex();
    if (base < 0) return;
    var target = base + delta;
    if (target < 0 || target >= qnas.length) return;
    desiredIndex = target;
    render(); // 응답을 기다리지 않고 버튼/숫자를 즉시 반응시킨다
    if (!busy) sendSwitch();
  }

  function sendSwitch() {
    if (desiredIndex == null || !qnas || !qnas[desiredIndex]) { busy = false; return; }
    var target = desiredIndex;
    busy = true;
    JSL.action('switchQna', { number: Number(qnas[target].number) }).then(function () {
      busy = false;
      if (desiredIndex === target) {
        desiredIndex = null; // 목적지 도착 — 낙관 상태 해제, 이후엔 실제 state 기준으로 표시
      } else {
        sendSwitch(); // 응답 오는 사이 더 눌렀으면, 그 사이 단계는 건너뛰고 최종 목적지로 바로 이동
      }
    }).catch(function () {
      busy = false;
      desiredIndex = null;
    });
  }

  // 값만 갱신 — 버튼 자체는 ensureHost에서 한 번만 만든다
  function render() {
    var i = effectiveIndex();
    var total = qnas ? qnas.length : 0;
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i < 0 || i >= total - 1;
    schedulePosition();
  }

  ensureHost();

  JSL.onState(function (state) {
    try {
      // 문항이 1개뿐이면 오갈 곳이 없으니 표시하지 않는다. 목록 페이지도 대상 아님.
      if (!state || state.page === 'list' || !Array.isArray(state.qnas) || state.qnas.length < 2) {
        visible = false;
        qnas = null;
        desiredIndex = null;
        host.style.display = 'none';
        return;
      }
      visible = true;
      qnas = state.qnas;
      render();
    } catch (e) {
      // 예외 전파 금지
      console.warn('[자비스] 문항 내비게이터 렌더 오류', e);
    }
  });

  window.addEventListener('resize', schedulePosition);
  document.addEventListener('scroll', schedulePosition, true);
  setInterval(schedulePosition, POLL_MS);
});
