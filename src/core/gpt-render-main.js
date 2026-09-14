// ChatGPT 페이지(MAIN) — 자비스 질문을 전달하거나 답을 기다리는 동안에만, 뒤로 간 탭에서도 화면 갱신을 이어 준다.
// 브라우저는 보이지 않는 탭의 requestAnimationFrame을 멈춘다. 뒤로 간 ChatGPT 탭이 답을 끝까지 그리지 않은 사례(2026-09-15 실사이트)의
// 원인으로 보고 보조한다. 격리 스크립트가 <html data-jsl-keep-rendering>을 켠 동안 숨은 탭의 프레임 요청만 타이머로 돌린다.
(function () {
  'use strict';
  if (window.__jslKeepRendering) return;
  window.__jslKeepRendering = true;
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const timers = new Map();
  let next = 0;
  const wanted = () => document.hidden && document.documentElement.hasAttribute('data-jsl-keep-rendering');
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (!wanted() || typeof callback !== 'function') return raf(callback);
    // 브라우저가 주는 번호와 겹치지 않게 음수를 쓴다.
    const id = --next;
    timers.set(id, setTimeout(() => { timers.delete(id); callback(performance.now()); }, 16));
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); return; }
    caf(id);
  };
})();
