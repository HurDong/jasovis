// 목록 페이지: 마감 캘린더 (SPEC.md '마감 캘린더' 절 참조)
//
// 문제: 작성 중이 30건씩 쌓이면 카드가 세로로 흐르고 "이번 주에 뭐가 몰렸는지"가 안 보인다.
//   D-day는 카드마다 붙어 있지만 서로 비교가 안 되고, 스크롤해야 다 읽힌다.
// 해결: 툴바에서 여는 모달 하나. 앞으로 7일을 칸으로 나눠 그날 마감인 공고를 얹고,
//   왼쪽에 '오늘 손대야 할 것'을 역산해 세운다.
//
// 부담은 **그날 마감인 공고 건수**로 잰다 (2026-09-12 사용자 결정).
//   문항 수와 글자 수로도 재 봤으나 글자 수 제한이 없는 공고가 섞여 있어 기준이 서지 않는다.
//   건수는 어느 공고에나 있고 해석이 필요 없다.
//
// 데이터: JSL.onState의 resumes에서 endTime·qnaTotal·qnaFilled를 쓴다. 회사명만 state에 없어서
//   목록 DOM(li.resume-node[resume_node_id] .name)에서 긁는다. 카드가 아직 안 그려졌으면
//   '(제목 없음)'으로 두고 다음 state에서 채운다 — 사이트 렌더와 경쟁하지 않는다.
JSL.register('list-calendar', function () {
  'use strict';

  var HOST_ID = 'jsl-cal-host';
  var BTN_ID = 'jsl-cal-btn';
  var DAYS = 7;                 // 보드에 세우는 날 수
  var host = null, shadow = null, root = null, open = false;
  var lastState = null, names = {};

  // ── 계산 ────────────────────────────────────────────────
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }

  // 마감까지 남은 일수. 오늘 마감이면 1로 둔다 — 0으로 나누지 않기 위해서이기도 하고,
  // 실제로 '오늘 안에' 끝내야 하는 하루치 부담이 맞다.
  function daysLeft(endTime, now) {
    var d = dayDiff(new Date(endTime), now);
    return d < 1 ? 1 : d;
  }

  function collect(state) {
    var now = new Date(), byDay = {};
    (state.resumes || []).forEach(function (r) {
      if (!r.endTime || r.sample) return;
      var end = new Date(r.endTime);
      if (isNaN(end.getTime())) return;
      var off = dayDiff(end, now);
      if (off < 0 || off >= DAYS) return;         // 지난 마감과 이번 주 밖은 뺀다
      var total = Number(r.qnaTotal) || 0;
      var filled = Number(r.qnaFilled) || 0;
      var left = Math.max(0, total - filled);
      (byDay[off] = byDay[off] || []).push({
        id: r.id, title: names[r.id] || '(제목 없음)',
        total: total, filled: filled, left: left, dd: daysLeft(r.endTime, now),
      });
    });
    return byDay;
  }

  // 부담 티어 — 그날 마감인 공고가 몇 건인가. 4단계.
  function tierOf(count) {
    if (count <= 0) return 0;
    if (count === 1) return 1;     // 여유
    if (count === 2) return 2;     // 보통
    if (count === 3) return 3;     // 바쁨
    return 4;                      // 몰림 (4건 이상)
  }
  var TIER_NAME = ['쉬는 날', '여유', '보통', '바쁨', '몰림'];

  // 오늘 손대야 할 것 — 이틀 안(오늘·내일·모레) 마감이면서 아직 안 끝난 공고.
  // 마감 가까운 순 → 남은 문항 많은 순. 최대 3건만 세운다.
  function urgent(byDay) {
    var out = [];
    [0, 1, 2].forEach(function (off) {
      (byDay[off] || []).forEach(function (it) { if (it.left > 0) out.push(it); });
    });
    out.sort(function (a, b) { return (a.dd - b.dd) || (b.left - a.left); });
    return out.slice(0, 3);
  }

  // ── 불꽃 (표정) ─────────────────────────────────────────
  // 눈·입 위치와 크기를 불꽃 폭에 비례시킨다. 고정값으로 두면 작은 티어에서 얼굴이
  // 몸 밖으로 삐져나온다 (2026-09-12 실측 후 수정).
  var OUT = ['#ddd7d0', '#ffb877', '#ff9440', '#ff6813', '#e94a00'];
  var MID = ['#e6e0d9', '#ffd9a8', '#ffc078', '#ffab52', '#ff8a2b'];
  var SIZE = [null, [10, 5.0], [12.5, 5.5], [15, 6.0], [18, 6.4]];   // [높이, 폭]
  var SPD = [0, 2.6, 2.0, 1.45, 1.0];

  function blob(yb, h, w, lean, cx) {
    var t = cx + lean, f = function (n) { return n.toFixed(1); };
    return 'M' + cx + ' ' + yb
      + 'C' + f(cx - w) + ' ' + f(yb - h * 0.12) + ' ' + f(cx - w) + ' ' + f(yb - h * 0.56) + ' ' + f(t - w * 0.44) + ' ' + f(yb - h * 0.8)
      + 'C' + f(t - w * 0.16) + ' ' + f(yb - h * 0.94) + ' ' + f(t) + ' ' + f(yb - h * 0.95) + ' ' + f(t) + ' ' + f(yb - h)
      + 'C' + f(t) + ' ' + f(yb - h * 0.95) + ' ' + f(t + w * 0.16) + ' ' + f(yb - h * 0.94) + ' ' + f(t + w * 0.44) + ' ' + f(yb - h * 0.8)
      + 'C' + f(cx + w) + ' ' + f(yb - h * 0.56) + ' ' + f(cx + w) + ' ' + f(yb - h * 0.12) + ' ' + cx + ' ' + yb + 'Z';
  }
  function morph(yb, h, w, lean, dur, fill, delay) {
    var a = blob(yb, h, w, lean, 12), b = blob(yb, h * 1.11, w * 0.9, lean - 1.3, 12),
      c = blob(yb, h * 0.92, w * 1.08, lean + 1.4, 12);
    return '<path d="' + a + '" fill="' + fill + '"><animate attributeName="d" dur="' + dur
      + 's" begin="' + delay + 's" repeatCount="indefinite" values="' + a + ';' + b + ';' + c + ';' + a
      + '" keyTimes="0;.33;.66;1" calcMode="spline"'
      + ' keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/></path>';
  }
  // 얼굴 — 전부 폭(w) 기준이라 티어가 작아도 눈이 몸 안에 남는다
  function face(t, yb, h, w) {
    var ink = '#6b3a12', f = function (n) { return n.toFixed(2); };
    var ey = yb - h * 0.36;                 // 넓은 구간에 눈을 둔다
    var dx = w * 0.30, r = Math.max(0.62, w * 0.165);
    var my = ey + h * 0.22, mw = w * 0.26, mh = w * 0.20;
    if (t === 1) {
      return '<circle cx="' + f(12 - dx) + '" cy="' + f(ey) + '" r="' + f(r) + '" fill="' + ink + '"/>'
        + '<circle cx="' + f(12 + dx) + '" cy="' + f(ey) + '" r="' + f(r) + '" fill="' + ink + '"/>'
        + '<path d="M' + f(12 - mw) + ' ' + f(my) + 'q' + f(mw) + ' ' + f(mh) + ' ' + f(mw * 2) + ' 0"'
        + ' stroke="' + ink + '" stroke-width="' + f(r * 0.75) + '" fill="none" stroke-linecap="round"/>';
    }
    if (t === 2) {
      return '<circle cx="' + f(12 - dx) + '" cy="' + f(ey) + '" r="' + f(r * 1.08) + '" fill="' + ink + '"/>'
        + '<circle cx="' + f(12 + dx) + '" cy="' + f(ey) + '" r="' + f(r * 1.08) + '" fill="' + ink + '"/>'
        + '<ellipse cx="12" cy="' + f(my) + '" rx="' + f(mw * 0.7) + '" ry="' + f(mh * 0.75) + '" fill="' + ink + '"/>';
    }
    if (t === 3) {
      return '<path d="M' + f(12 - dx - r) + ' ' + f(ey - r * 1.5) + 'l' + f(r * 1.9) + ' ' + f(r)
        + 'M' + f(12 + dx + r) + ' ' + f(ey - r * 1.5) + 'l' + f(-r * 1.9) + ' ' + f(r) + '"'
        + ' stroke="' + ink + '" stroke-width="' + f(r * 0.7) + '" stroke-linecap="round"/>'
        + '<circle cx="' + f(12 - dx) + '" cy="' + f(ey + r * 0.4) + '" r="' + f(r * 1.12) + '" fill="' + ink + '"/>'
        + '<circle cx="' + f(12 + dx) + '" cy="' + f(ey + r * 0.4) + '" r="' + f(r * 1.12) + '" fill="' + ink + '"/>'
        + '<ellipse cx="12" cy="' + f(my + r * 0.6) + '" rx="' + f(mw * 0.85) + '" ry="' + f(mh) + '" fill="' + ink + '"/>';
    }
    return '<path d="M' + f(12 - dx - r * 1.2) + ' ' + f(ey - r * 1.7) + 'l' + f(r * 2.1) + ' ' + f(r * 1.2)
      + 'M' + f(12 + dx + r * 1.2) + ' ' + f(ey - r * 1.7) + 'l' + f(-r * 2.1) + ' ' + f(r * 1.2) + '"'
      + ' stroke="' + ink + '" stroke-width="' + f(r * 0.75) + '" stroke-linecap="round"/>'
      + '<path d="M' + f(12 - dx - r * 0.8) + ' ' + f(ey + r * 0.9) + 'l' + f(r * 1.6) + ' ' + f(-r * 1.6)
      + 'M' + f(12 - dx + r * 0.8) + ' ' + f(ey + r * 0.9) + 'l' + f(-r * 1.6) + ' ' + f(-r * 1.6)
      + 'M' + f(12 + dx - r * 0.8) + ' ' + f(ey + r * 0.9) + 'l' + f(r * 1.6) + ' ' + f(-r * 1.6)
      + 'M' + f(12 + dx + r * 0.8) + ' ' + f(ey + r * 0.9) + 'l' + f(-r * 1.6) + ' ' + f(-r * 1.6) + '"'
      + ' stroke="' + ink + '" stroke-width="' + f(r * 0.65) + '" stroke-linecap="round"/>'
      + '<ellipse cx="12" cy="' + f(my + r * 1.1) + '" rx="' + f(mw * 1.05) + '" ry="' + f(mh * 1.25) + '" fill="' + ink + '"/>';
  }
  function flame(t, px) {
    // 마감이 없는 날은 같은 몸에 눈을 감겨 둔다. 점선 링을 쓰던 때는 혼자 다른 물건처럼 보였다.
    if (!t) {
      var zh = 8.6, zw = 4.6, zb = 22, zink = '#c0b9b1';
      var ey0 = zb - zh * 0.36, dx0 = zw * 0.30, r0 = Math.max(0.62, zw * 0.165);
      return '<svg class="fl t0" width="' + px + '" height="' + px + '" viewBox="0 0 24 26" aria-hidden="true">'
        + '<path d="' + blob(zb, zh, zw, 0, 12) + '" fill="' + OUT[0] + '"/>'
        + '<path d="' + blob(zb, zh * 0.7, zw * 0.66, 0.3, 12) + '" fill="#efebe6"/>'
        // 감은 눈 — 위로 휘어진 두 획
        + '<path d="M' + (12 - dx0 - r0).toFixed(2) + ' ' + ey0.toFixed(2)
        + 'q' + r0.toFixed(2) + ' ' + (-r0 * 0.95).toFixed(2) + ' ' + (r0 * 2).toFixed(2) + ' 0'
        + 'M' + (12 + dx0 - r0).toFixed(2) + ' ' + ey0.toFixed(2)
        + 'q' + r0.toFixed(2) + ' ' + (-r0 * 0.95).toFixed(2) + ' ' + (r0 * 2).toFixed(2) + ' 0"'
        + ' stroke="' + zink + '" stroke-width="' + (r0 * 0.72).toFixed(2) + '" fill="none" stroke-linecap="round"/>'
        + '<ellipse cx="12" cy="' + (ey0 + zh * 0.24).toFixed(2) + '" rx="' + (zw * 0.16).toFixed(2)
        + '" ry="' + (zw * 0.11).toFixed(2) + '" fill="' + zink + '"/></svg>';
    }
    var h = SIZE[t][0], w = SIZE[t][1], yb = 22;
    return '<svg class="fl t' + t + '" width="' + px + '" height="' + px + '" viewBox="0 0 24 26" aria-hidden="true">'
      + morph(yb, h, w, 0, SPD[t], OUT[t], 0)
      + morph(yb, h * 0.7, w * 0.66, 0.3, SPD[t] * 0.88, MID[t], 0.12)
      + face(t, yb, h, w) + '</svg>';
  }

  // ── 렌더 ────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  // 문항 칸 분할 — 13문항이면 13칸. 12칸을 넘으면 비율로 접는다.
  function bar(filled, total) {
    if (!total) return '<span class="blab none">문항 없음</span>';
    var unit = Math.min(total, 12), on = Math.round(filled / total * unit), cells = '';
    for (var i = 0; i < unit; i++) cells += '<i' + (i < on ? ' class="on"' : '') + '></i>';
    return '<span class="bseg">' + cells + '</span>'
      + '<span class="blab">' + filled + '<em>/' + total + '</em></span>';
  }

  function build(byDay) {
    var now = new Date(), html = '';
    var hot = urgent(byDay);
    var weekCount = 0;
    for (var o = 0; o < DAYS; o++) weekCount += (byDay[o] || []).length;

    // 좌측 — 오늘 할 일
    var aside = '<aside class="today"><div class="th"><span class="orb"></span>오늘 할 일'
      + '<em>' + (now.getMonth() + 1) + '.' + now.getDate() + ' ' + WD[now.getDay()] + '</em></div>';
    if (hot.length) {
      var top = hot[0];
      aside += '<div class="say">' + esc(top.title) + '이(가) ' + (top.dd === 1 ? '오늘' : 'D-' + top.dd)
        + '입니다. ' + (hot.length > 1 ? '이틀 안에 <b>' + hot.length + '건</b>이 몰려 있어요. ' : '')
        + '여기부터 손대시죠.</div>';
      aside += '<div class="crit">이틀 안 마감 · 아직 안 끝난 것</div>';
      hot.forEach(function (it) {
        aside += '<div class="ti"><b>' + esc(it.title) + '</b>'
          + '<span class="dd">' + (it.dd === 1 ? 'D-DAY' : 'D-' + it.dd) + '</span>'
          + '<span class="brow">' + bar(it.filled, it.total) + '</span></div>';
      });
    } else {
      aside += '<div class="say">이틀 안에 마감인 공고가 없습니다. 여유 있을 때 미리 써 두세요.</div>';
    }
    aside += '<div class="tsum">이번 주 마감 <b>' + weekCount + '</b>건</div></aside>';

    // 우측 — 7일 칸
    var cols = '<div class="cols">';
    for (var off = 0; off < DAYS; off++) {
      var d = new Date(now); d.setDate(d.getDate() + off);
      var items = byDay[off] || [], t = tierOf(items.length);
      cols += '<div class="col t' + t + (off === 0 ? ' today' : '') + '">'
        + '<div class="ch"><span class="meta"><em>' + WD[d.getDay()] + '</em><b>' + d.getDate() + '</b>'
        + '<span class="ic">' + flame(t, 48) + '</span></span>'
        + '<span class="cnt"><b>' + items.length + '</b>건'
        + '<span class="tname">' + TIER_NAME[t] + '</span></span></div><div class="cb">';
      if (!items.length) cols += '<div class="free">비어 있어요<em>미리 써 두기 좋은 날</em></div>';
      items.forEach(function (it) {
        cols += '<div class="cd' + (it.left === 0 ? ' done' : '') + '" data-id="' + it.id + '">'
          + '<span class="cdt">' + esc(it.title) + '</span>'
          + '<span class="brow">' + bar(it.filled, it.total) + '</span></div>';
      });
      cols += '</div></div>';
    }
    cols += '</div>';

    return '<div class="bd">' + aside + cols + '</div>';
  }

  // ── 껍데기 ──────────────────────────────────────────────
  function css() {
    return [
      ':host{all:initial;}',
      '*{box-sizing:border-box;margin:0;padding:0;}',
      '.dim{position:fixed;inset:0;z-index:2147483000;background:rgba(28,22,16,.34);',
      '  display:flex;align-items:center;justify-content:center;padding:24px;}',
      '.sheet{width:min(1560px,94vw);min-height:min(680px,86vh);max-height:92vh;overflow:auto;',
      '  background:#fff;border-radius:10px;',
      '  box-shadow:0 18px 54px rgba(0,0,0,.26);position:relative;',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic",sans-serif;',
      '  color:#1e1e1e;font-size:14px;line-height:1.55;}',
      '.close{position:absolute;right:14px;top:14px;width:34px;height:34px;border:0;background:transparent;',
      '  color:#999;font-size:21px;cursor:pointer;border-radius:5px;z-index:2;}',
      '.close:hover{background:#f3f3f3;color:#333;}',
      // stretch라야 왼쪽 세로선이 오른쪽 보드와 같은 길이가 된다 (flex-start면 내용만큼만 그어진다)
      '.bd{display:flex;gap:20px;align-items:stretch;flex-wrap:wrap;padding:28px 26px 24px;}',
      // 좌측
      '.today{flex:0 0 282px;border-right:2px solid #3f4b5e;padding-right:20px;',
      '  display:flex;flex-direction:column;}',
      '.tsum{margin-top:auto;}',
      '.th{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;color:#3f4b5e;',
      '  padding-bottom:15px;display:flex;align-items:center;gap:9px;}',
      '.orb{width:15px;height:15px;border-radius:50%;border:1.5px solid #ff6813;flex:none;',
      '  background:radial-gradient(circle,#ff6813 0 3px,transparent 3px);}',
      '.th em{font-style:normal;letter-spacing:.06em;font-size:12px;color:#777;font-weight:400;',
      '  margin-left:auto;text-transform:none;}',
      // 자비스가 말하는 자리. 지원서 페이지의 '자비스 호출' 버튼과 같은 차콜·구리 언어를 쓴다.
      '.say{position:relative;font-size:12.5px;line-height:1.7;color:#e2dcd5;background:#1c1917;',
      '  border:1px solid #3c3733;border-radius:9px;padding:13px 14px 13px 40px;margin-bottom:15px;',
      '  word-break:keep-all;box-shadow:0 3px 10px rgba(28,25,23,.2);',
      '  background-image:radial-gradient(ellipse 44% 150% at 16% 50%,#3a2a20a6,transparent);}',
      '.say:before{content:"";position:absolute;left:13px;top:14px;width:16px;height:16px;border-radius:50%;',
      '  border:1.3px solid #de9270;background:radial-gradient(circle,#de9270 0 3.2px,transparent 3.2px);}',
      '.say b{color:#de9270;font-weight:700;}',
      '.crit{font-size:10.5px;letter-spacing:.06em;color:#9b938b;padding-bottom:2px;}',
      '.ti{padding:13px 0;border-bottom:1px solid #dbe0e8;}',
      '.ti > b{font-size:14px;font-weight:700;display:inline;}',
      '.ti .dd{font-size:10.5px;letter-spacing:.1em;background:#ff6813;color:#fff;padding:3px 8px;margin-left:7px;border-radius:3px;}',
      '.tsum{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#3f4b5e;padding-top:18px;}',
      '.tsum b{font-size:26px;color:#3f4b5e;letter-spacing:-.02em;}',
      // 칸
      '.cols{flex:1;min-width:0;display:grid;grid-template-columns:repeat(7,1fr);gap:8px;}',
      '.col{padding:0 12px;border-left:1px solid #eee;min-width:0;}',
      '.col:first-child{border-left:0;}',
      // 오늘은 칸 자체가 하나의 덩어리로 읽혀야 한다. 오른쪽 칸의 세로선이 오늘을 갈라놓아서 걷는다.
      '.col.today + .col{border-left:0;}',
      // 오늘 칸은 왼쪽 세로선에 붙인다. .bd의 gap(20px)만큼 왼쪽으로 끌어내고 그만큼 안쪽
      // 여백으로 되돌려, 글자 위치는 그대로 두면서 상자만 선까지 닿게 한다.
      // 붙는 변은 라운드를 죽여야 선과 상자가 한 덩어리로 읽힌다.
      '.col.today{position:relative;z-index:1;background:linear-gradient(#fffaf6,#fff);',
      '  border-radius:0 7px 7px 0;box-shadow:inset 0 0 0 1px #ffe3d0;',
      '  margin:-6px -6px -6px -20px;padding:6px 12px 6px 20px;}',
      '.ch{padding-bottom:13px;margin-bottom:13px;border-bottom:2px solid #3f4b5e;}',
      '.col.t3 .ch,.col.t4 .ch{border-bottom-color:#ff6813;}',
      '.meta{display:flex;align-items:center;gap:5px;}',
      '.meta em{font-style:normal;font-size:11px;letter-spacing:.12em;color:#777;text-transform:uppercase;}',
      '.meta > b{font-size:32px;font-weight:700;letter-spacing:-.045em;line-height:1;}',
      '.col.today .meta > b{color:#ff6813;}',
      '.ic{margin-left:auto;display:flex;flex:none;}',
      '.cnt{display:flex;align-items:baseline;gap:4px;font-size:12.5px;color:#777;margin-top:10px;}',
      '.cnt b{font-size:30px;color:#3f4b5e;font-weight:700;letter-spacing:-.03em;line-height:1;}',
      '.col.t3 .cnt b,.col.t4 .cnt b{color:#ff6813;}',
      // 상태는 건수 오른쪽 빈자리에 둔다. 모든 칸이 같은 높이가 되어 아래 구분선이 한 줄로 선다.
      '.tname{margin-left:auto;align-self:center;font-size:11.5px;font-weight:700;color:#b0561f;',
      '  background:#fff6f0;border-radius:3px;padding:3px 8px;white-space:nowrap;}',
      '.col.t1 .tname,.col.t2 .tname{color:#3f4b5e;background:#eef0f4;}',
      // 마감이 없는 날 — 숫자를 죽이고 재만 남긴다
      '.col.t0 .cnt{color:#bdb6ae;}',
      '.col.t0 .cnt b{color:#c8c2ba;}',
      '.col.t0 .tname{color:#a9a29a;background:#f4f3f1;font-weight:600;}',
      '.col.t0 .ch{border-bottom-color:#dcdcdc;}',
      '.col.t0 .meta > b,.col.t0 .meta em{color:#b5aea6;}',
      '.col.t0 .cb{min-height:34px;}',
      '.free{padding:14px 0 4px;font-size:11.5px;color:#b5aea6;line-height:1.6;}',
      '.free em{display:block;font-style:normal;font-size:10.5px;color:#c8c2ba;margin-top:2px;}',
      '.cd{padding:11px 0;border-bottom:1px solid #f4f4f4;cursor:pointer;}',
      '.cd:hover{background:#fffaf6;}',
      '.cdt{font-size:12.5px;line-height:1.4;display:block;word-break:keep-all;}',
      '.cd.done{opacity:.4;}',
      // 진행 바
      '.brow{display:flex;align-items:center;gap:7px;margin-top:8px;}',
      '.bseg{flex:1;display:flex;gap:1.5px;min-width:0;}',
      '.bseg i{flex:1;height:9px;background:#eef0f4;border-radius:2px;}',
      '.bseg i.on{background:#ff6813;}',
      '.cd.done .bseg i.on{background:#3f4b5e;}',
      '.blab{font-size:11.5px;font-weight:700;color:#ff6813;font-variant-numeric:tabular-nums;flex:none;}',
      '.blab em{font-style:normal;font-weight:400;color:#777;margin-left:1px;}',
      '.blab.none{color:#bbb;font-weight:400;}',
      '.cd.done .blab{color:#3f4b5e;}',
      // 다음 주
      // 불꽃 — 바쁠수록 빨리 탄다
      '@keyframes bob{0%,100%{transform:translateY(0) scale(1,1)}',
      '  32%{transform:translateY(-1.1px) scale(.94,1.08)}',
      '  64%{transform:translateY(.5px) scale(1.06,.94)}}',
      '.fl{transform-box:fill-box;transform-origin:50% 100%;display:block;}',
      '.fl.t0{animation:bob 4.4s ease-in-out infinite;}',
      '.fl.t1{animation:bob 2.6s ease-in-out infinite;}',
      '.fl.t2{animation:bob 2.0s ease-in-out infinite;}',
      '.fl.t3{animation:bob 1.45s ease-in-out infinite;}',
      '.fl.t4{animation:bob 1.0s ease-in-out infinite;}',
      '@media(prefers-reduced-motion:reduce){.fl{animation:none!important;}.fl animate{display:none;}}',
      '.empty{padding:140px 20px;text-align:center;color:#999;font-size:15px;}',
    ].join('\n');
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;';
    shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = css();
    shadow.appendChild(style);
    root = document.createElement('div');
    root.className = 'dim';
    // 바깥을 누르면 닫는다. 시트 안쪽 클릭은 통과시키지 않는다.
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    shadow.appendChild(root);
    document.documentElement.appendChild(host);
  }

  function render() {
    if (!open) return;
    ensureHost();
    var byDay = lastState ? collect(lastState) : {};
    var has = Object.keys(byDay).length > 0;
    root.innerHTML = '<div class="sheet"><button class="close" title="닫기">×</button>'
      + (has ? build(byDay)
        : '<div class="empty">앞으로 ' + DAYS + '일 안에 마감인 자소서가 없습니다.</div>')
      + '</div>';
    root.querySelector('.close').addEventListener('click', close);
    // 카드를 누르면 그 자소서로 이동한다
    Array.prototype.forEach.call(root.querySelectorAll('.cd[data-id]'), function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-id');
        if (id) location.href = '/resume/' + id;
      });
    });
  }

  function onKey(e) { if (e.key === 'Escape' && open) { e.preventDefault(); close(); } }

  function show() {
    open = true;
    ensureHost();
    host.style.display = 'block';
    document.addEventListener('keydown', onKey, true);
    render();
  }
  function close() {
    open = false;
    if (host) host.style.display = 'none';
    document.removeEventListener('keydown', onKey, true);
  }

  // ── 여는 버튼 ───────────────────────────────────────────
  // 정렬 줄(공고 마감일순 · 생성일순 · 제목순) 오른쪽 빈자리에 같은 줄로 둔다.
  // 그 칸은 원래 블록이라 그냥 붙이면 줄바꿈이 나서 아래 전체가 한 칸 내려갔고,
  // 우상단(스케쥴러 보기 옆)으로 옮겼더니 시선에서 너무 멀어졌다 (2026-09-12 실화면).
  // 그래서 그 칸만 우리 클래스로 한 줄(flex)로 잡고 끝에 붙인다 — 사이트 노드는 그대로 둔다.
  function ensureSlotStyle() {
    if (document.getElementById('jsl-cal-style')) return;
    var st = document.createElement('style');
    st.id = 'jsl-cal-style';
    st.textContent = '.sort-resume-list.jsl-cal-slot{display:flex;align-items:center;'
      + 'gap:10px;flex-wrap:wrap;min-width:0;}'
      + '.sort-resume-list.jsl-cal-slot > .resume-order-by{margin:0 !important;}';
    document.head.appendChild(st);
  }
  function ensureButton() {
    if (document.getElementById(BTN_ID)) return true;
    var slot = document.querySelector('.resume-search-body .sort-resume-list');
    if (slot) { ensureSlotStyle(); slot.classList.add('jsl-cal-slot'); }
    else slot = document.querySelector('.resume-search-header');
    if (!slot) return false;
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = '이번 주 마감을 한눈에 보기';
    // 정렬 세그먼트와 같은 높이·라운드로 맞춰 한 줄에서 튀지 않게 한다
    btn.style.cssText = 'flex:none;height:32px;padding:0 13px;border:1px solid #fed2ba;'
      + 'border-radius:4px;background:#fff6f0;color:#b0561f;font-size:12.5px;font-weight:600;'
      + 'cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;'
      + 'white-space:nowrap;vertical-align:middle;';
    btn.innerHTML = '<span style="width:12px;height:12px;border-radius:50%;flex:none;'
      + 'border:1.2px solid #ff6813;background:radial-gradient(circle,#ff6813 0 2.4px,transparent 2.4px)">'
      + '</span>마감 캘린더';
    btn.addEventListener('mouseenter', function () { btn.style.background = '#ffeee2'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#fff6f0'; });
    btn.addEventListener('click', function (e) { e.preventDefault(); show(); });
    slot.appendChild(btn);
    return true;
  }

  // 버튼은 상태가 필요 없다. 툴바가 생기는 즉시 단다 — 첫 상태(최대 2초)를 기다리면
  // 다른 기능들 뒤에 혼자 늦게 나타난다.
  function mountButtonASAP() {
    if (ensureButton()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (ensureButton() || ++tries > 60) clearInterval(timer);   // 최대 9초
    }, 150);
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { if (ensureButton()) mo.disconnect(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(function () { mo.disconnect(); }, 12000);
    }
  }
  mountButtonASAP();

  // 회사명은 state에 없다 — 목록 카드에서 긁어 둔다
  function harvestNames() {
    var nodes = document.querySelectorAll('li.resume-node[resume_node_id]');
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute('resume_node_id');
      var name = nodes[i].querySelector('.name');
      if (id && name) {
        var t = (name.textContent || '').trim();
        if (t) names[id] = t;
      }
    }
  }

  JSL.onState(function (state) {
    try {
      if (!state || state.page !== 'list') { close(); return; }
      lastState = state;
      harvestNames();
      ensureButton();
      if (open) render();
    } catch (e) { /* 예외 전파 금지 */ }
  });

  // 사이트가 툴바를 다시 그리면 버튼이 사라진다 — state 주기 사이의 공백을 메운다
  setInterval(function () {
    try { if (lastState && lastState.page === 'list') ensureButton(); } catch (e) { /* 무시 */ }
  }, 1500);
});
