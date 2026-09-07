// 채팅방 → 그 회사 공고 모달.
//
// 오른쪽 채팅 패널(같은 출처 iframe `/chat-slide`)에서 회사 채팅방을 열면 헤더 아래에
// 버튼 줄을 하나 끼워 넣고, 누르면 그 회사의 공고 목록을 페이지 가운데 모달로 띄운다.
// 자소서를 쓰던 페이지를 벗어나지 않고 B사 공고를 보는 게 목적.
//
// 검증된 연결고리 (2026-07-27 실계정 확인, SPEC.md 참조):
//   채팅방 헤더의 회사명 앵커 href="/companies/:id"  → :id 가 company_group_id
//   GET /api/v1/company_groups/:id/employment_companies → 그 회사 공고 전체(+employments[])
//   GET /api/v1/resumes → 내 자소서 전체. resume.employment_id 를 공고의 employments[].id 와
//                          맞추면 "내가 이 공고에 쓴 자소서"가 나온다.
//   GET /api/v1/employment_companies/:id?skip_read_log=true → 공고 본문(JD 패널이 쓰는 그 API)
//
// 주의: 채팅 iframe은 React(Next.js)라 우리가 넣은 노드를 수시로 날린다.
//       MutationObserver로 다시 꽂는다. 사이트 CSS(Tailwind) 오염을 피하려고 버튼 줄도
//       모달도 전부 Shadow DOM 안에 그린다.
(function () {
  'use strict';

  // 사이트에는 채팅 UI가 **두 가지**나 있다(2026-07-27 실페이지 확인).
  //  A) React(Next.js) iframe `/chat-slide`  — 채팅 버튼으로 여는 쪽
  //  B) 페이지에 직접 그리는 AngularJS 채팅 `.chat-container.chat-window`
  //     — 자소서 페이지에서 사이트가 스스로 "이 기업 채팅방"을 띄울 때 쓰는 쪽
  // 둘은 `.chat-ctrl` 안에서 서로 교대로 보였다 숨었다 하며, 숨은 쪽도 DOM에 그대로 남는다.
  // A만 보고 있었더니 B로 열린 방에서는 버튼이 아예 안 떴다(실제로 보고됨).
  var CHAT_IFRAME = 'iframe[src*="chat-slide"]';
  var CHAT_INPAGE = '.chat-container.chat-window';
  var BAR_ID = 'jsl-chatjd-bar';
  var MODAL_ID = 'jsl-chatjd-modal';

  // 채팅 창은 여러 개일 수 있고, 닫아도 노드가 DOM에 0x0으로 남는다(회사 앵커까지 든 채로).
  // 그래서 "보이는 창"만 골라 각각 버튼 줄을 관리한다.
  // bars = [{root, host, shadow, label, cgid, name}] — root는 iframe document 또는 페이지 내 엘리먼트
  var bars = [];
  var watched = [];          // [{root, mo}] — 창마다 MutationObserver를 따로 건다
  var reinjectTimer = null;

  var modal = {};            // 모달 엘리먼트 모음
  var modalOpen = false;
  var modalCompanyId = null; // 모달이 지금 보여주고 있는 회사
  var modalSourceRoot = null; // 모달을 연 채팅 창 (그 창의 방이 바뀌면 모달도 따라간다)

  var resumesPromise = null;         // 내 자소서 목록 (한 번만 조회)
  var companyCache = {};             // company_group_id -> 공고 목록 Promise
  var detailCache = {};              // employment_company_id -> 공고 상세 Promise

  // ── 전형 단계 코드 (SPEC.md "카테고리 숫자 코드") ──────────────
  var CATEGORY = {
    0:  { label: '작성 중',   kind: 'neutral' },
    1:  { label: '제출 완료', kind: 'live' },
    10: { label: '미제출',    kind: 'neutral' },
    2:  { label: '서류 합격', kind: 'pass' },
    3:  { label: '서류 불합', kind: 'fail' },
    6:  { label: '1차 합격',  kind: 'pass' },
    7:  { label: '1차 불합',  kind: 'fail' },
    8:  { label: '2차 합격',  kind: 'pass' },
    9:  { label: '2차 불합',  kind: 'fail' },
    4:  { label: '최종 합격', kind: 'pass' },
    5:  { label: '최종 불합', kind: 'fail' },
    100:{ label: 'AI 마스터', kind: 'neutral' }
  };
  // 서류를 통과한 카드 = 서류 합격(2) + 그 뒤 단계로 넘어간 모든 카드 (SPEC의 통계 산정식과 동일)
  var AFTER_DOC = [2, 6, 7, 8, 9, 4, 5];
  // 실제로 지원까지 간 카드 (작성 중/미제출 제외)
  var APPLIED = [1, 2, 3, 6, 7, 8, 9, 4, 5];

  // ── 유틸 ──────────────────────────────────────────────────
  function api(url) {
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function el(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function daysLeft(endTime) {
    if (!endTime) return null;
    var t = new Date(endTime).getTime();
    if (isNaN(t)) return null;
    return Math.ceil((t - Date.now()) / 86400000);
  }

  function endLabel(endTime) {
    var d = daysLeft(endTime);
    if (d === null) return { text: '상시', kind: 'dead' };
    if (d < 0) return { text: '마감', kind: 'dead' };
    if (d === 0) return { text: '오늘 마감', kind: 'live' };
    return { text: 'D-' + d, kind: 'live' };
  }

  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2);
  }

  // 공고 content(원문 HTML) -> {text, imageUrl}. jd-panel과 같은 판별 규칙:
  // 태그를 걷어낸 순수 텍스트가 짧으면 "포스터 이미지형" 공고로 본다.
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

  // ── 데이터 조립 ───────────────────────────────────────────
  function getResumes() {
    if (!resumesPromise) {
      resumesPromise = api('/api/v1/resumes').then(function (list) {
        return Array.isArray(list) ? list : [];
      });
    }
    return resumesPromise;
  }

  // company_group_id -> { ecs: [공고], mine: {ecId: [내 자소서]}, stats }
  function loadCompany(cgid) {
    if (!companyCache[cgid]) {
      companyCache[cgid] = Promise.all([
        api('/api/v1/company_groups/' + cgid + '/employment_companies'),
        getResumes()
      ]).then(function (r) {
        var ecs = Array.isArray(r[0]) ? r[0] : [];
        var resumes = r[1] || [];

        // 모집부문 id -> 공고. 내 자소서는 공고가 아니라 모집부문(employment_id)에 매여 있다.
        var byEmploymentId = {};
        ecs.forEach(function (ec) {
          (ec.employments || []).forEach(function (e) { byEmploymentId[e.id] = ec.id; });
        });

        var mine = {};
        var applied = 0, passedDoc = 0, total = 0;
        resumes.forEach(function (rs) {
          var ecId = byEmploymentId[rs.employment_id];
          if (!ecId) return;
          if (rs.trashed_at || rs.removed_at) return;
          if (!mine[ecId]) mine[ecId] = [];
          mine[ecId].push(rs);
          total++;
          if (APPLIED.indexOf(rs.category) >= 0) applied++;
          if (AFTER_DOC.indexOf(rs.category) >= 0) passedDoc++;
        });

        ecs.sort(function (a, b) {
          return new Date(b.end_time || 0).getTime() - new Date(a.end_time || 0).getTime();
        });

        return {
          ecs: ecs,
          mine: mine,
          stats: {
            total: total,
            applied: applied,
            passedDoc: passedDoc,
            open: ecs.filter(function (e) { var d = daysLeft(e.end_time); return d === null || d >= 0; }).length
          }
        };
      });
    }
    return companyCache[cgid];
  }

  function loadDetail(ecId) {
    if (!detailCache[ecId]) {
      detailCache[ecId] = api('/api/v1/employment_companies/' + ecId + '?skip_read_log=true');
    }
    return detailCache[ecId];
  }

  // ── 모달 (최상위 문서에 그린다) ────────────────────────────
  // iframe 안이 아니라 top document에 그려야 채팅 패널 폭에 갇히지 않고 크게 볼 수 있다.
  var MODAL_CSS = [
    ':host{all:initial;}',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    '.back{position:fixed;inset:0;background:rgba(32,30,26,.45);display:flex;',
    '  align-items:center;justify-content:center;z-index:1;',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic",',
    '  "Apple SD Gothic Neo",sans-serif;}',
    // 높이를 고정하면 공고가 3개뿐인 회사에서 아래가 텅 빈 채로 뜬다 → 내용만큼만 차지하고
    // 길어질 때만 84vh에서 멈추게 한다(그때부터 .body가 스크롤).
    '.panel{width:min(880px,92vw);max-height:min(760px,84vh);background:#fff;border-radius:12px;',
    '  display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.28);}',
    '.hd{display:flex;align-items:center;gap:8px;padding:13px 14px;border-bottom:1px solid #e7e4dc;flex:none;}',
    '.hd .nm{font-size:15px;font-weight:800;color:#2b2a27;}',
    '.hd .cnt{font-size:12px;color:#98968e;}',
    '.iconbtn{width:28px;height:28px;flex:none;border:none;background:transparent;cursor:pointer;',
    '  color:#6b6a63;border-radius:6px;display:flex;align-items:center;justify-content:center;}',
    '.iconbtn:hover{background:#f2f0e9;}',
    '.iconbtn.x{margin-left:auto;}',
    '.sum{display:flex;align-items:baseline;gap:6px;padding:10px 14px;background:#fff1e6;',
    '  border-bottom:1px solid #ffd9bd;flex:none;}',
    '.sum .big{font-size:17px;font-weight:800;color:#c74f00;line-height:1;}',
    '.sum .lb{font-size:12px;color:#c74f00;}',
    '.sum .rt{margin-left:auto;font-size:11.5px;color:#6b6a63;}',
    '.body{flex:1;overflow-y:auto;}',
    '.grp{padding:12px 14px 5px;font-size:11px;font-weight:800;letter-spacing:.4px;color:#98968e;}',
    '.row{display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:transparent;',
    '  border-bottom:1px solid #f1efe9;cursor:pointer;font-family:inherit;}',
    '.row:hover{background:#faf8f3;}',
    '.row.mine{border-left:3px solid #f26200;padding-left:11px;}',
    '.row .t{font-size:13px;font-weight:700;color:#2b2a27;line-height:1.35;}',
    '.row .sub{margin-top:5px;font-size:11.5px;color:#6b6a63;display:flex;align-items:center;',
    '  gap:6px;flex-wrap:wrap;}',
    '.row .doc{color:#98968e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px;}',
    '.chip{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:20px;line-height:1.5;flex:none;}',
    '.chip.pass{background:#f26200;color:#fff;}',
    '.chip.fail{background:#f2f0e9;color:#6b6a63;}',
    '.chip.live{background:#fff1e6;color:#c74f00;border:1px solid #ffd9bd;}',
    '.chip.dead{background:transparent;color:#98968e;border:1px solid #e7e4dc;}',
    '.chip.neutral{background:#f2f0e9;color:#6b6a63;}',
    '.more{display:block;width:100%;padding:11px;border:none;background:#fbfaf7;cursor:pointer;',
    '  font-family:inherit;font-size:12px;color:#6b6a63;border-bottom:1px solid #f1efe9;}',
    '.more:hover{background:#f5f2eb;color:#c74f00;}',
    '.msg{padding:44px 20px;text-align:center;color:#98968e;font-size:12.5px;line-height:1.7;}',
    // 상세 보기
    '.dt{padding:16px 18px 26px;}',
    '.dt .title{font-size:16px;font-weight:800;color:#2b2a27;line-height:1.4;}',
    '.dt .meta{margin-top:7px;font-size:11.5px;color:#6b6a63;display:flex;gap:8px;',
    '  flex-wrap:wrap;align-items:center;}',
    '.dt .fields{margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;}',
    '.dt .field{font-size:11.5px;color:#4a4a4a;background:#f6f4ef;border:1px solid #e7e4dc;',
    '  border-radius:5px;padding:3px 8px;}',
    '.dt .jd{margin-top:16px;font-size:13px;color:#4a4a4a;white-space:pre-wrap;line-height:1.75;}',
    '.dt img{display:block;width:100%;height:auto;margin-top:16px;border-radius:6px;}',
    '.acts{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #e7e4dc;flex:none;',
    '  background:#fbfaf7;}',
    '.btn{flex:1;padding:9px 12px;border-radius:7px;font-size:12.5px;font-weight:700;',
    '  cursor:pointer;font-family:inherit;text-align:center;text-decoration:none;',
    '  border:1px solid #e7e4dc;background:#fff;color:#4a4a4a;}',
    '.btn:hover{border-color:#ffd9bd;color:#c74f00;}',
    '.btn.pri{background:#f26200;border-color:#f26200;color:#fff;}',
    '.btn.pri:hover{background:#e05a00;color:#fff;}'
  ].join('\n');

  function svg(paths, size) {
    return '<svg width="' + (size || 17) + '" height="' + (size || 17) + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  var ICON_X = svg('<path d="M18 6 6 18M6 6l12 12"/>');
  var ICON_BACK = svg('<polyline points="15 18 9 12 15 6"/>');
  var ICON_DOC = svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/>', 14);
  var ICON_CHEV = svg('<polyline points="9 18 15 12 9 6"/>', 14);

  function ensureModal() {
    if (modal.host && modal.host.isConnected) return;
    var host = document.createElement('div');
    host.id = MODAL_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;';
    var sh = host.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent = MODAL_CSS;
    sh.appendChild(st);

    var back = el(document, 'div', 'back');
    var panel = el(document, 'div', 'panel');

    var hd = el(document, 'div', 'hd');
    var backBtn = el(document, 'button', 'iconbtn b');
    backBtn.innerHTML = ICON_BACK;
    backBtn.title = '목록으로';
    backBtn.style.display = 'none';
    var nm = el(document, 'span', 'nm', '');
    var cnt = el(document, 'span', 'cnt', '');
    var xBtn = el(document, 'button', 'iconbtn x');
    xBtn.innerHTML = ICON_X;
    xBtn.title = '닫기 (Esc)';
    hd.appendChild(backBtn); hd.appendChild(nm); hd.appendChild(cnt); hd.appendChild(xBtn);

    var sum = el(document, 'div', 'sum');
    var body = el(document, 'div', 'body');
    var acts = el(document, 'div', 'acts');
    acts.style.display = 'none';

    panel.appendChild(hd); panel.appendChild(sum); panel.appendChild(body); panel.appendChild(acts);
    back.appendChild(panel);
    sh.appendChild(back);
    document.documentElement.appendChild(host);

    // 바깥(어두운 배경) 클릭으로 닫기. 패널 안 클릭은 통과시킨다.
    back.addEventListener('click', function (ev) { if (ev.target === back) closeModal(); });
    xBtn.addEventListener('click', closeModal);
    backBtn.addEventListener('click', function () {
      if (modalCompanyId) showList(modalCompanyId);
    });

    modal = { host: host, shadow: sh, panel: panel, nm: nm, cnt: cnt, sum: sum,
              body: body, acts: acts, backBtn: backBtn };
  }

  function openModal(cgid, name, sourceRoot) {
    ensureModal();
    modal.host.style.display = '';
    modalOpen = true;
    modalSourceRoot = sourceRoot || null;
    showList(cgid, name);
  }

  function closeModal() {
    if (modal.host) modal.host.style.display = 'none';
    modalOpen = false;
    modalSourceRoot = null;
  }

  function setMessage(text) {
    modal.body.innerHTML = '';
    modal.body.appendChild(el(document, 'div', 'msg', text));
  }

  // ── 목록 화면 ─────────────────────────────────────────────
  function showList(cgid, name) {
    modalCompanyId = cgid;
    modal.backBtn.style.display = 'none';
    modal.acts.style.display = 'none';
    modal.acts.innerHTML = '';
    modal.nm.textContent = name || modal.nm.textContent || '';
    modal.cnt.textContent = '';
    modal.sum.style.display = 'none';
    setMessage('공고를 불러오는 중…');

    loadCompany(cgid).then(function (data) {
      if (!modalOpen || modalCompanyId !== cgid) return;
      if (!data || !data.ecs.length) {
        modal.cnt.textContent = '';
        setMessage('이 회사의 공고를 찾지 못했어요.');
        return;
      }
      renderList(cgid, data);
    });
  }

  function renderList(cgid, data) {
    modal.cnt.textContent = '공고 ' + data.ecs.length;

    // 요약 줄
    modal.sum.style.display = '';
    modal.sum.innerHTML = '';
    if (data.stats.total > 0) {
      modal.sum.appendChild(el(document, 'span', 'big', data.stats.total));
      modal.sum.appendChild(el(document, 'span', 'lb', '개 썼고'));
      modal.sum.appendChild(el(document, 'span', 'big', data.stats.passedDoc));
      modal.sum.appendChild(el(document, 'span', 'lb', '번 서류 통과'));
    } else {
      modal.sum.appendChild(el(document, 'span', 'lb', '이 회사에 쓴 자소서는 아직 없어요'));
    }
    modal.sum.appendChild(el(document, 'span', 'rt', '진행 중 ' + data.stats.open));

    var mineEcs = data.ecs.filter(function (ec) { return data.mine[ec.id]; });
    var others = data.ecs.filter(function (ec) { return !data.mine[ec.id]; });
    // 안 쓴 공고는 진행 중인 것부터 (마감된 건 뒤로)
    others.sort(function (a, b) {
      var da = daysLeft(a.end_time), db = daysLeft(b.end_time);
      var oa = (da === null || da >= 0) ? 0 : 1, ob = (db === null || db >= 0) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return new Date(b.end_time || 0).getTime() - new Date(a.end_time || 0).getTime();
    });

    modal.body.innerHTML = '';
    modal.body.scrollTop = 0;

    if (mineEcs.length) {
      modal.body.appendChild(el(document, 'div', 'grp', '내가 쓴 공고 ' + mineEcs.length));
      mineEcs.forEach(function (ec) {
        modal.body.appendChild(buildRow(cgid, ec, data.mine[ec.id]));
      });
    }

    if (others.length) {
      modal.body.appendChild(el(document, 'div', 'grp', '그 외 공고 ' + others.length));
      var SHOWN = 5;
      var head = others.slice(0, SHOWN);
      var rest = others.slice(SHOWN);
      head.forEach(function (ec) { modal.body.appendChild(buildRow(cgid, ec, null)); });
      if (rest.length) {
        var more = el(document, 'button', 'more', '＋ ' + rest.length + '개 더 보기');
        more.addEventListener('click', function () {
          var frag = document.createDocumentFragment();
          rest.forEach(function (ec) { frag.appendChild(buildRow(cgid, ec, null)); });
          modal.body.replaceChild(frag, more);
        });
        modal.body.appendChild(more);
      }
    }
  }

  function buildRow(cgid, ec, myResumes) {
    var row = el(document, 'button', 'row' + (myResumes ? ' mine' : ''));
    row.appendChild(el(document, 'div', 't', ec.title || ec.name || '(제목 없음)'));

    var sub = el(document, 'div', 'sub');
    var end = endLabel(ec.end_time);
    sub.appendChild(el(document, 'span', 'chip ' + end.kind, end.text));

    if (myResumes && myResumes.length) {
      // 같은 공고에 여러 건 썼으면 가장 멀리 간 것(카테고리 우선순위) 하나를 대표로 보여준다.
      var rep = myResumes.slice().sort(function (a, b) {
        return (AFTER_DOC.indexOf(b.category) - AFTER_DOC.indexOf(a.category));
      })[0];
      var cat = CATEGORY[rep.category];
      if (cat) sub.appendChild(el(document, 'span', 'chip ' + cat.kind, cat.label));
      var doc = el(document, 'span', 'doc', rep.title || '내 자소서');
      sub.appendChild(doc);
      if (myResumes.length > 1) {
        sub.appendChild(el(document, 'span', 'doc', '외 ' + (myResumes.length - 1) + '건'));
      }
    } else if ((ec.employments || []).length) {
      var fields = ec.employments.map(function (e) { return e.field; })
        .filter(Boolean);
      var uniq = fields.filter(function (v, i) { return fields.indexOf(v) === i; });
      if (uniq.length) {
        sub.appendChild(el(document, 'span', 'doc',
          uniq.slice(0, 2).join(' · ') + (uniq.length > 2 ? ' 외 ' + (uniq.length - 2) : '')));
      }
    }

    row.appendChild(sub);
    row.addEventListener('click', function () { showDetail(cgid, ec, myResumes); });
    return row;
  }

  // ── 상세 화면 ─────────────────────────────────────────────
  function showDetail(cgid, ec, myResumes) {
    modal.backBtn.style.display = '';
    modal.sum.style.display = 'none';
    modal.cnt.textContent = '';
    setMessage('공고를 불러오는 중…');
    modal.acts.style.display = 'none';
    modal.acts.innerHTML = '';

    loadDetail(ec.id).then(function (job) {
      if (!modalOpen || modalCompanyId !== cgid) return;
      var j = job || ec;
      modal.body.innerHTML = '';
      modal.body.scrollTop = 0;

      var dt = el(document, 'div', 'dt');
      dt.appendChild(el(document, 'div', 'title', j.title || j.name || ''));

      var meta = el(document, 'div', 'meta');
      var end = endLabel(j.end_time);
      meta.appendChild(el(document, 'span', 'chip ' + end.kind, end.text));
      if (j.end_time) meta.appendChild(el(document, 'span', null, '마감 ' + fmtDate(j.end_time)));
      dt.appendChild(meta);

      var emps = j.employments || ec.employments || [];
      if (emps.length) {
        var fw = el(document, 'div', 'fields');
        var seen = {};
        emps.forEach(function (e) {
          if (!e.field || seen[e.field]) return;
          seen[e.field] = 1;
          fw.appendChild(el(document, 'span', 'field', e.field));
        });
        if (fw.children.length) dt.appendChild(fw);
      }

      // 공고 본문: 텍스트형이면 본문을, 포스터 이미지형이면 이미지를 크게.
      var parsed = parseContent(j.content);
      if (parsed.text && parsed.text.length >= 15) {
        dt.appendChild(el(document, 'div', 'jd', parsed.text));
      } else if (parsed.imageUrl) {
        var img = document.createElement('img');
        img.alt = j.title || '채용공고 이미지';
        img.src = parsed.imageUrl;
        dt.appendChild(img);
      } else {
        dt.appendChild(el(document, 'div', 'jd', '이 공고는 본문 미리보기를 제공하지 않아요.'));
      }
      modal.body.appendChild(dt);

      // 하단 버튼
      modal.acts.innerHTML = '';
      if (myResumes && myResumes.length) {
        var r = myResumes[0];
        var mineBtn = el(document, 'a', 'btn pri', '내 자소서 열기');
        mineBtn.href = '/resume/' + r.id;
        mineBtn.target = '_blank';
        mineBtn.rel = 'noopener noreferrer';
        modal.acts.appendChild(mineBtn);
      }
      var url = j.employment_page_url;
      if (url) {
        var siteBtn = el(document, 'a', 'btn', '채용 사이트에서 보기');
        siteBtn.href = url;
        siteBtn.target = '_blank';
        siteBtn.rel = 'noopener noreferrer';
        modal.acts.appendChild(siteBtn);
      }
      modal.acts.style.display = modal.acts.children.length ? '' : 'none';
    });
  }

  // ── 채팅 iframe 안 버튼 줄 ────────────────────────────────
  var BAR_CSS = [
    ':host{all:initial;display:block;}',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    '.b{display:flex;align-items:center;gap:7px;width:100%;padding:9px 14px;border:none;',
    '  border-top:1px solid #f2dfd0;border-bottom:1px solid #f2dfd0;background:#fff5ed;',
    '  color:#626262;cursor:pointer;font-size:12px;font-weight:500;text-align:left;min-height:44px;',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic",',
    '  "Apple SD Gothic Neo",sans-serif;line-height:1.4;}',
    '.b:hover{background:#ffebdc;}',
    '.b:focus-visible{outline:2px solid #b84300;outline-offset:-3px;}',
    '.b svg{flex:none;color:#b84300;}',
    '.b .lb{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
  ].join('\n');

  // root는 채팅 UI의 뿌리다. React쪽은 iframe의 document, Angular쪽은 페이지 안의 엘리먼트.
  function docOf(root) { return root.nodeType === 9 ? root : root.ownerDocument; }
  // MutationObserver를 걸 대상 (document는 body를 봐야 한다)
  function observeTargetOf(root) { return root.nodeType === 9 ? root.body : root; }

  function buildBar(root) {
    var doc = docOf(root);
    var host = doc.createElement('div');
    host.id = BAR_ID;
    var sh = host.attachShadow({ mode: 'open' });
    var st = doc.createElement('style');
    st.textContent = BAR_CSS;
    sh.appendChild(st);

    var rec = { root: root, host: host, shadow: sh, label: null, cgid: null, name: '' };

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'b';
    btn.innerHTML = ICON_DOC + '<span class="lb"></span>' + ICON_CHEV;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (rec.cgid) openModal(rec.cgid, rec.name, root);
    });
    sh.appendChild(btn);

    rec.label = sh.querySelector('.lb');
    bars.push(rec);
    return rec;
  }

  // 헤더 블록의 직계 자식 중 회사명 앵커를 품은 줄(= 헤더 한 줄)을 찾아 그 바로 아래에
  // 버튼 줄을 넣는다. 헤더 안쪽에 끼워 넣으면 아이콘 줄의 flex 배치가 깨지고 폭이 좁아
  // 라벨이 잘린다.
  // 헤더 블록 이름이 두 채팅 UI에서 다르다: React쪽은 `.sticky`, Angular쪽은
  // `.chat-window-head` (그 안의 헤더 줄은 각각 h-[52px] / .chat-info-wrapper).
  function insertPointFor(a) {
    var head = a.closest('.sticky') || a.closest('.chat-window-head');
    if (head) {
      var n = a;
      while (n && n.parentElement !== head) n = n.parentElement;
      if (n) return n;
    }
    // 폴백: 앵커에서 세 단계 위(헤더 줄 근처)
    var f = a.parentElement && a.parentElement.parentElement;
    return (f && f.parentElement) || f || a;
  }

  function dropBar(rec) {
    try { if (rec.host && rec.host.parentElement) rec.host.parentElement.removeChild(rec.host); } catch (e) { /* 무시 */ }
    var i = bars.indexOf(rec);
    if (i >= 0) bars.splice(i, 1);
  }

  function findBar(root) {
    for (var i = 0; i < bars.length; i++) if (bars[i].root === root) return bars[i];
    return null;
  }

  // 화면에서 실제로 보이고 있는지. 사이트가 채팅을 감추는 방식이 두 가지라 둘 다 봐야 한다:
  //  1) iframe 쪽은 `display:none` + 0x0 으로 만든다 → 크기/스타일로 걸러진다.
  //  2) 페이지 내 Angular 채팅은 **크기를 그대로 둔 채 패널을 화면 오른쪽 밖으로 밀어낸다**
  //     (실측: 열림 left=2200 / 닫힘 left=2560, innerWidth=2560). 크기만 보면 닫힌 창을
  //     열려 있다고 오판하므로 뷰포트와 겹치는지까지 확인한다.
  // offsetParent는 position:fixed에서 null이 될 수 있어 쓰지 않는다.
  var VIS_MARGIN = 40;   // 슬라이드 애니메이션 중 깜빡이지 않도록 둔 여유
  function isVisible(node) {
    var r = node.getBoundingClientRect();
    if (r.width < VIS_MARGIN || r.height < VIS_MARGIN) return false;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.right < VIS_MARGIN || r.left > vw - VIS_MARGIN) return false;
    if (r.bottom < VIS_MARGIN || r.top > vh - VIS_MARGIN) return false;
    var cs = null;
    try { cs = getComputedStyle(node); } catch (e) { return false; }
    if (!cs) return false;
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) >= 0.05;
  }

  // **실제로 보이는** 채팅 창만 고른다. 두 UI(A: iframe, B: 페이지 내 Angular)를 함께 본다.
  // 예전처럼 `querySelector`로 iframe 하나만 집으면, 숨은 창에 버튼을 꽂아놓고 정작 보이는
  // 창에는 아무것도 안 뜨는 상태가 된다(실제로 보고됨). 숨은 창도 마지막으로 보던 방의
  // 회사 앵커를 그대로 들고 있어서 "열려 있다"고 오판하기 딱 좋다.
  function visibleChatRoots() {
    var out = [];
    var frames = document.querySelectorAll(CHAT_IFRAME);
    for (var i = 0; i < frames.length; i++) {
      if (!isVisible(frames[i])) continue;
      var doc = null;
      try { doc = frames[i].contentDocument; } catch (e) { doc = null; }
      if (doc && doc.body) out.push(doc);
    }
    var panels = document.querySelectorAll(CHAT_INPAGE);
    for (var j = 0; j < panels.length; j++) {
      if (isVisible(panels[j])) out.push(panels[j]);
    }
    return out;
  }

  // 보이는 창 각각에 대해 버튼 줄을 맞춘다. 창이 여러 개여도 각자 자기 회사를 갖는다.
  function syncBars() {
    // 이미 떨어져 나간 노드에 걸린 옵저버 정리 (창을 닫았다 열면 통째로 교체된다)
    watched = watched.filter(function (w) {
      var alive = w.root.nodeType === 9 ? !!w.root.defaultView : w.root.isConnected;
      if (alive) return true;
      if (w.mo) w.mo.disconnect();
      return false;
    });

    var roots = visibleChatRoots();

    // 더 이상 보이지 않는 창의 버튼 줄은 걷어낸다
    bars.slice().forEach(function (rec) {
      if (roots.indexOf(rec.root) < 0) dropBar(rec);
    });

    roots.forEach(function (root) {
      watchRoot(root);
      var rec = findBar(root);
      var a = root.querySelector('a[href^="/companies/"]');
      // 회사 채팅방이 아니면(목록 화면·전체·직무별·인사담당자) 앵커 자체가 없다 → 버튼 숨김
      if (!a) { if (rec) dropBar(rec); return; }
      var m = a.getAttribute('href').match(/\/companies\/(\d+)/);
      if (!m) { if (rec) dropBar(rec); return; }

      var cgid = Number(m[1]);
      var name = (a.textContent || '').trim();
      if (!rec) rec = buildBar(root);

      // React가 헤더 줄 엘리먼트를 통째로 갈아끼우므로 삽입 기준점은 매번 새로 찾는다.
      var row = insertPointFor(a);
      if (!rec.host.isConnected || rec.host.previousElementSibling !== row) {
        row.insertAdjacentElement('afterend', rec.host);
      }

      if (rec.cgid !== cgid) {
        rec.cgid = cgid;
        rec.name = name;
        rec.label.textContent = name + ' 공고 보기';
        updateBarCount(rec);
        // 사이트가 스스로 방을 갈아끼우는 경우(새로고침하면 현재 자소서 기업 방이 열린다)가
        // 있어서, 그 창에서 연 모달이 떠 있으면 새 회사로 따라간다.
        if (modalOpen && modalSourceRoot === root) showList(cgid, name);
      }
    });
  }

  // 버튼 라벨에 공고 수와 내가 쓴 자소서 수를 채운다 (조회는 회사당 1회, 캐시).
  function updateBarCount(rec) {
    var cgid = rec.cgid;
    loadCompany(cgid).then(function (data) {
      if (!data || rec.cgid !== cgid || !rec.label) return;
      var t = rec.name + ' 공고 ' + data.ecs.length;
      if (data.stats.total) t += ' · 내가 쓴 자소서 ' + data.stats.total;
      rec.label.textContent = t;
    });
  }

  // 리렌더로 우리 노드가 날아가므로 각 채팅 창을 감시해 다시 꽂는다.
  function watchRoot(root) {
    for (var i = 0; i < watched.length; i++) if (watched[i].root === root) return;
    var rec = { root: root, mo: null };
    try {
      rec.mo = new MutationObserver(function () {
        if (reinjectTimer) return;
        reinjectTimer = setTimeout(function () {
          reinjectTimer = null;
          try { syncBars(); } catch (e) { /* 무시 */ }
          // 우리가 유발한 변경은 버린다 (자기 자신 재트리거 방지)
          watched.forEach(function (w) { if (w.mo) w.mo.takeRecords(); });
        }, 120);
      });
      rec.mo.observe(observeTargetOf(root), { childList: true, subtree: true });
    } catch (e) { /* 폴링이 보완 */ }

    // Esc: 포커스가 채팅 iframe 안에 있으면 top document로 keydown이 오지 않는다.
    // (페이지 내 Angular 채팅은 top document라 init에서 이미 걸어 뒀지만, 중복 등록해도
    //  모달이 이미 닫혀 있으면 아무 일도 안 하므로 해롭지 않다.)
    try {
      docOf(root).addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && modalOpen) closeModal();
      }, true);
    } catch (e) { /* 무시 */ }

    watched.push(rec);
  }

  function init() {
    try {
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && modalOpen) closeModal();
      }, true);

      syncBars();
      // 채팅 창은 열고 닫을 때마다 iframe이 새로 생기거나 숨겨지고, 새로고침하면 사이트가
      // 스스로 현재 자소서 기업의 방을 띄운다. MutationObserver는 iframe 문서 안쪽만 보므로
      // iframe 자체의 등장/교체/가시성 변화는 폴링으로 잡는다.
      setInterval(function () {
        try { syncBars(); } catch (e) { /* 조용히 무시 */ }
      }, 500);
      window.addEventListener('resize', function () {
        try { syncBars(); } catch (e) { /* 무시 */ }
      });
    } catch (e) {
      console.warn('[자비스] 채팅방 공고 기능 초기화 실패', e);
    }
  }

  JSL.register('chat-jd', init);
})();
