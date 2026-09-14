// 답변란 위 표시 층 — 담은 인용(밑줄+번호)과 받은 수정안(연주황 배경)을 칠한다.
// 글자는 투명하고 클릭은 통과한다. 답변란 글자 위치와 맞추려고 폰트·여백을 그대로 복제한다.
(function () {
  'use strict';
  if (window.JSLFeedbackMarks) return;
  const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform',
    'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'boxSizing', 'direction', 'tabSize', 'wordBreak'];
  let host, layer, ta = null, ranges = [], painted = '', frame = 0;
  function ensure() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'jsl-gpt-feedback-marks';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483000;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box;margin:0;padding:0}
      .layer{position:absolute;left:0;top:0;overflow:hidden;color:transparent;background:transparent;border-color:transparent;
        white-space:pre-wrap;overflow-wrap:break-word;word-wrap:break-word}
      .q{position:relative;box-shadow:inset 0 -2px 0 #ffb377;border-radius:1px}
      .q::after{content:attr(data-n);position:absolute;right:-3px;top:-.72em;min-width:13px;padding:0 3px;border-radius:7px;
        background:#ff6a00;color:#fff;font:700 9px/13px -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;text-align:center}
      .a{background:rgba(255,106,0,.12);box-shadow:inset 0 -2px 0 #ffc79c;border-radius:3px;
        box-decoration-break:clone;-webkit-box-decoration-break:clone}
    </style><div class="layer"></div>`;
    layer = root.querySelector('.layer');
    (document.body || document.documentElement).appendChild(host);
  }
  function mirror() {
    const cs = getComputedStyle(ta);
    for (const p of COPY) { try { layer.style[p] = cs[p]; } catch { /* 무시 */ } }
    layer.style.boxSizing = 'border-box';
  }
  // 답변란이 다른 요소(맞춤법 패널·모달)에 가려졌으면 표시도 숨긴다.
  function covered(rect) {
    const points = [[rect.left + 12, rect.top + 12], [rect.left + rect.width / 2, rect.top + rect.height / 2], [rect.right - 12, rect.bottom - 12]];
    return points.every(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el && el !== ta && !ta.contains(el) && !el.closest?.('#jsl-checkpoint');
    });
  }
  function paint() {
    frame = 0;
    const current = (() => { const all = [...document.querySelectorAll('textarea.answer')]; return all.find(t => t.getClientRects().length) || all[0] || null; })();
    if (!ranges.length || !current || !current.isConnected) { if (host) host.style.display = 'none'; ta = current; return; }
    ensure();
    if (current !== ta) { ta = current; painted = ''; }
    const rect = ta.getBoundingClientRect();
    if (!rect.width || !rect.height || covered(rect)) { host.style.display = 'none'; return; }
    host.style.display = '';
    host.style.left = rect.left + 'px'; host.style.top = rect.top + 'px';
    layer.style.width = rect.width + 'px'; layer.style.height = rect.height + 'px';
    const text = ta.value || '';
    const valid = ranges.filter(r => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= text.length)
      .sort((a, b) => a.start - b.start);
    const key = text + '\u0000' + JSON.stringify(valid);
    if (key !== painted) {
      mirror();
      const nodes = [];
      let at = 0;
      for (const r of valid) {
        if (r.start < at) continue; // 겹치는 표시는 앞의 것만 칠한다.
        if (r.start > at) nodes.push(document.createTextNode(text.slice(at, r.start)));
        const span = document.createElement('span');
        span.className = r.kind === 'applied' ? 'a' : 'q';
        if (r.label != null) span.dataset.n = String(r.label);
        span.textContent = text.slice(r.start, r.end);
        nodes.push(span); at = r.end;
      }
      nodes.push(document.createTextNode(text.slice(at) + ' '));
      layer.replaceChildren(...nodes);
      painted = key;
    }
    layer.scrollTop = ta.scrollTop; layer.scrollLeft = ta.scrollLeft;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('input', e => { if (e.target?.matches?.('textarea.answer')) schedule(); }, true);
  window.addEventListener('resize', schedule);
  // 레이아웃 변화(패널 열림·문항 전환)는 이벤트가 없어 가볍게 따라간다. rAF가 멈춘 뒤 탭에서도 맞춘다.
  setInterval(() => { if (ranges.length || (host && host.style.display !== 'none')) paint(); }, 400);
  window.JSLFeedbackMarks = {
    set(next) { ranges = Array.isArray(next) ? next : []; schedule(); },
    clear() { ranges = []; schedule(); }
  };
})();
