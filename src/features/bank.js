// 답변 뱅크 수집기 — 편집 중인 자소서 문항을 chrome.storage.local에 자동 아카이브 (SPEC.md 참조)
// 저장 키: 'jslAnswerBank'
// 구조: { [qnaId]: {resumeId, resumeTitle, number, question, answer, tags, updatedAt} }
(function () {
  'use strict';

  var STORAGE_KEY = 'jslAnswerBank';
  var CATEGORY_VERSION_KEY = 'jslAnswerBankCategoryVersion';
  var BANK_PANEL_POS_KEY = 'jslBankPanelPos';
  var BANK_PANEL_SIZE_KEY = 'jslBankPanelSize';
  var BANK_META_KEY = 'jslAnswerBankMeta';
  var RESUME_STAGE_KEY = 'jslResumeStage'; // { [resumeId]: category } — 목록 페이지 방문 시 갱신
  var CATEGORY_VERSION = 2;
  var DEBOUNCE_MS = 30000; // 30초 디바운스

  // 전형 단계 가중치 — "이 답변으로 어디까지 통과했는가"를 0~4 점수로 환산.
  // 자유양식만 내고 서류만 붙은 경우와, 실제로 1차·2차 면접까지 부른 경우를
  // 같은 무게로 취급하지 않기 위함(사용자 요청). 카테고리 코드는 SPEC.md 참조.
  // 뒤 단계에 결과가 있다는 것 자체가 앞 단계를 통과했다는 뜻이라, 각 단계를
  // "그 단계까지 확실히 통과했는가"로 따로 판정해 합산한다.
  var STAGE_LABELS = ['', '서류 합격', '1차 합격', '2차 합격', '최종 합격'];
  function stageTier(category) {
    var c = Number(category);
    var passedDoc = c === 2 || c === 6 || c === 7 || c === 8 || c === 9 || c === 4 || c === 5;
    var passed1st = c === 6 || c === 8 || c === 9 || c === 4 || c === 5;
    var passed2nd = c === 8 || c === 4 || c === 5;
    var passedFinal = c === 4;
    if (passedFinal) return 4;
    if (passed2nd) return 3;
    if (passed1st) return 2;
    if (passedDoc) return 1;
    return 0;
  }

  // 문항 질문만으로 분류한다. 답변 본문은 분류 근거로 사용하지 않는다.
  // 여러 의도가 한 문항에 함께 있으면 태그도 함께 붙인다.
  var CATEGORY_RULES = [
    { tag: '자유양식', re: /자유\s*양식|자유롭게\s*(?:작성|기술|서술)/ },
    { tag: '입사 후 포부', re: /입사\s*후|직무\s*수행\s*계획|수행하고\s*싶은\s*직무/ },
    { tag: '지원동기·기업적합', re: /지원(?:하게 된|하는)?\s*동기|지원한\s*(?:동기|이유)|회사(?:를)?\s*선택(?:하는)?\s*기준|기업.*?(?:적합|선택)|해당\s*직무에\s*지원/ },
    { tag: '직무역량·전문성', re: /직무.*?(?:역량|전문성|경쟁력|수행|노력|경험|성과)|(?:역량|전문성|경쟁력).*?직무|차별화.*?(?:역량|경쟁력)|분야의\s*전문성|전문성을\s*향상/ },
    { tag: '가치관·조직적합', re: /핵심\s*가치|가치관|조직.*?(?:가치|적합)|회사의\s*가치/ },
    { tag: '협업·조직문화', re: /협업|갈등|조직\s*문화|조직문화|팀.*?(?:기여|협업|갈등)|의견.*?(?:조율|합의)|소통/ },
    { tag: '성장과정·자기이해', re: /성장\s*과정|성장배경|성격.*?(?:가치관|특성)|본인을?\s*(?:소개|설명)/ },
    { tag: '강점·보완점', re: /강점|약점|보완(?:해야 할)?\s*점|장단점|장점.*단점/ },
    { tag: '문제해결·도전', re: /문제(?:나)?\s*(?:해결|상황)|어려움.*?(?:해결|극복)|극복|도전.*?(?:경험|과정)|해결한\s*(?:경험|것)/ },
    { tag: '성취·실패', re: /(?:가장 큰|최대의)?\s*(?:성취|성공|실패)\s*(?:경험|사례)|성과를?\s*(?:낸|만든|이룬)\s*(?:경험|사례)/ }
  ];
  var BANK_CATEGORIES = [
    '전체', '지원동기·기업적합', '직무역량·전문성', '입사 후 포부',
    '가치관·조직적합', '협업·조직문화', '성장과정·자기이해', '강점·보완점',
    '문제해결·도전', '성취·실패', '자유양식', '기타'
  ];

  function categorize(question) {
    var tags = [];
    var q = String(question || '');
    CATEGORY_RULES.forEach(function (rule) {
      if (rule.re.test(q)) tags.push(rule.tag);
    });
    return tags.length ? tags : ['기타'];
  }

  // 질문 텍스트 분류를 다른 기능(대시보드의 작성중 문항 카테고리 칩 등)이 재사용할 수
  // 있게 JSL에 노출한다. 분류 근거·태그 목록의 단일 소유는 계속 이 파일(bank)이며,
  // 소비하는 쪽은 없을 수도 있음을 전제로 방어적으로 쓴다(로드 순서/미로딩 견딤).
  try { JSL.categorizeQuestion = categorize; } catch (e) { /* 무시 */ }

  function init() {
    var bank = null;       // 저장소의 최신 사본 (직전 저장본 비교용)
    var pending = {};      // 디바운스 대기 중인 변경분 { qnaId: entry }
    var timer = null;
    var importedList = false; // 목록 페이지 일괄 수집은 세션당 1회
    var panelHost = null;
    var panelEls = {};
    var panelOpen = false;
    var panelCategory = '전체';
    var panelQuery = '';
    var panelMode = 'all';
    var filtersOpen = false;
    var panelSearchTimer = null;
    var bankMeta = {};
    var expandedItems = {};
    var currentQnaId = null;
    var currentQnaTags = [];
    var resumeStages = {}; // { resumeId: category } — 목록 페이지에서 갱신
    var lastResumeStagesJSON = '';

    function visibleBank() {
      var merged = {};
      Object.keys(bank || {}).forEach(function (id) { merged[id] = bank[id]; });
      // 아직 저장 디바운스 중인 답변도 패널에서는 즉시 확인할 수 있게 한다.
      Object.keys(pending).forEach(function (id) { merged[id] = pending[id]; });
      return merged;
    }

    function metaFor(id) {
      return bankMeta[id] || {};
    }

    function tierFor(entry) {
      if (!entry || entry.resumeId == null) return 0;
      var category = resumeStages[entry.resumeId];
      return category == null ? 0 : stageTier(category);
    }

    function saveResumeStages() {
      try {
        var payload = {};
        payload[RESUME_STAGE_KEY] = resumeStages;
        chrome.storage.local.set(payload);
      } catch (e) { /* 저장 실패는 무시 — 다음 목록 방문 때 다시 시도 */ }
    }

    function saveBankMeta() {
      try {
        var payload = {};
        payload[BANK_META_KEY] = bankMeta;
        chrome.storage.local.set(payload);
      } catch (e) { /* 메타데이터 저장 실패는 무시 */ }
    }

    function hasSharedTag(entry) {
      if (!currentQnaTags.length || !entry || !Array.isArray(entry.tags)) return false;
      return entry.tags.some(function (tag) {
        return tag !== '기타' && currentQnaTags.indexOf(tag) !== -1;
      });
    }

    function usefulCurrentTags() {
      return currentQnaTags.filter(function (tag) { return tag !== '기타'; });
    }

    function filteredEntries() {
      var q = panelQuery.trim().toLowerCase();
      var merged = visibleBank();
      return Object.keys(merged).map(function (id) {
        return { id: id, entry: merged[id], meta: metaFor(id) };
      }).filter(function (item) {
        var entry = item.entry || {};
        if (panelMode === 'similar' && (String(item.id) === String(currentQnaId) || !hasSharedTag(entry))) return false;
        if (panelMode === 'favorites' && !item.meta.favorite) return false;
        if (panelMode === 'recent' && !item.meta.lastCopiedAt) return false;
        if (panelMode === 'top' && tierFor(entry) < 1) return false;
        if (panelCategory !== '전체' && (!Array.isArray(entry.tags) || entry.tags.indexOf(panelCategory) === -1)) return false;
        if (!q) return true;
        return (String(entry.resumeTitle || '') + '\n' + String(entry.question || '') + '\n' + String(entry.answer || ''))
          .toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) {
        if (panelMode === 'recent') return String(b.meta.lastCopiedAt || '').localeCompare(String(a.meta.lastCopiedAt || ''));
        if (panelMode === 'top') {
          // 우수 답변 중에서도 지금 보고 있는 문항과 같은 유형을 먼저 보여준다.
          // (같은 유형 우선 → 그 안에서 전형을 멀리 간 순 → 나머지 우수 답변)
          var aShared = hasSharedTag(a.entry) ? 1 : 0, bShared = hasSharedTag(b.entry) ? 1 : 0;
          if (aShared !== bShared) return bShared - aShared;
          var aTier = tierFor(a.entry), bTier = tierFor(b.entry);
          if (aTier !== bTier) return bTier - aTier;
        }
        if (panelMode === 'similar') {
          var aScore = (a.entry.tags || []).filter(function (tag) { return currentQnaTags.indexOf(tag) !== -1; }).length;
          var bScore = (b.entry.tags || []).filter(function (tag) { return currentQnaTags.indexOf(tag) !== -1; }).length;
          if (aScore !== bScore) return bScore - aScore;
        }
        return String(b.entry.updatedAt || '').localeCompare(String(a.entry.updatedAt || ''));
      });
    }

    function modeCounts() {
      var merged = visibleBank();
      var counts = { all: 0, similar: 0, favorites: 0, recent: 0, top: 0 };
      Object.keys(merged).forEach(function (id) {
        var entry = merged[id];
        var meta = metaFor(id);
        counts.all += 1;
        if (String(id) !== String(currentQnaId) && hasSharedTag(entry)) counts.similar += 1;
        if (meta.favorite) counts.favorites += 1;
        if (meta.lastCopiedAt) counts.recent += 1;
        if (tierFor(entry) >= 1) counts.top += 1;
      });
      return counts;
    }

    function setPanelMode(mode) {
      if (mode === 'similar' && !usefulCurrentTags().length) return;
      panelMode = mode;
      renderBankPanel(true);
    }

    function renderBankPanel(resetScroll) {
      if (!panelHost || !panelOpen) return;
      var previousScrollTop = resetScroll ? 0 : panelEls.list.scrollTop;
      var entries = filteredEntries();
      var total = Object.keys(visibleBank()).length;
      var counts = modeCounts();
      panelEls.count.textContent = total ? total + '개 중 ' + entries.length + '개' : '0개';
      panelEls.filterToggle.textContent = panelCategory === '전체' ? '필터' : panelCategory + ' ×';
      panelEls.filterToggle.classList.toggle('active', panelCategory !== '전체' || filtersOpen);
      panelEls.chips.className = 'chips' + (filtersOpen ? ' show' : '');
      var activeTags = usefulCurrentTags();
      panelEls.context.innerHTML = '';
      panelEls.context.className = 'current-context' + (activeTags.length ? ' show' : '');
      if (activeTags.length) {
        var contextLabel = document.createElement('span');
        contextLabel.className = 'context-label';
        contextLabel.textContent = '현재 문항 분류';
        panelEls.context.appendChild(contextLabel);
        activeTags.forEach(function (tag) {
          var contextTag = document.createElement('span');
          contextTag.className = 'context-tag';
          contextTag.textContent = tag;
          panelEls.context.appendChild(contextTag);
        });
      }
      Object.keys(panelEls.modes).forEach(function (mode) {
        var button = panelEls.modes[mode];
        var labels = { all: '전체', top: '우수 답변', similar: '현재 문항', favorites: '즐겨찾기', recent: '최근 복사' };
        button.textContent = labels[mode] + (counts[mode] ? ' ' + counts[mode] : '');
        button.classList.toggle('active', panelMode === mode);
        button.disabled = mode === 'similar' && !activeTags.length;
        if (mode === 'similar') {
          button.title = button.disabled
            ? '현재 문항을 분류한 뒤 사용할 수 있어요'
            : '현재 문항과 같은 유형: ' + currentQnaTags.join(', ');
        } else if (mode === 'top') {
          button.title = activeTags.length
            ? '서류 전형 이상 통과한 답변 중, 현재 문항과 같은 유형을 먼저 · 그 안에서 1차·2차 멀리 간 순으로'
            : '서류 전형 이상 통과한 자소서의 답변만, 1차·2차처럼 더 멀리 간 순서로 정렬';
        }
      });
      panelEls.chips.innerHTML = '';
      BANK_CATEGORIES.forEach(function (category) {
        var chip = document.createElement('button');
        chip.className = 'chip' + (category === panelCategory ? ' active' : '');
        chip.textContent = category;
        chip.addEventListener('click', function () {
          panelCategory = category;
          filtersOpen = false;
          renderBankPanel(true);
        });
        panelEls.chips.appendChild(chip);
      });

      panelEls.list.innerHTML = '';
      if (bank === null) {
        var loading = document.createElement('div');
        loading.className = 'empty';
        loading.textContent = '답변 뱅크를 불러오는 중입니다.';
        panelEls.list.appendChild(loading);
        return;
      }
      if (total === 0 || entries.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        if (total === 0) {
          empty.textContent = '저장된 답변이 없습니다.\n작성한 답변은 자동으로 여기 모입니다.';
        } else if (panelMode === 'similar') {
          empty.textContent = '현재 문항과 같은 분류의 답변이 없습니다.\n전체 탭에서 다른 답변을 확인해 보세요.';
        } else if (panelMode === 'favorites') {
          empty.textContent = '즐겨찾기한 답변이 없습니다.';
        } else if (panelMode === 'recent') {
          empty.textContent = '최근에 복사한 답변이 없습니다.';
        } else if (panelMode === 'top') {
          empty.textContent = '서류 전형 이상 통과한 답변이 없습니다.\n목록 페이지를 한 번 열어야 전형 결과가 반영돼요.';
        } else {
          empty.textContent = '검색 결과가 없습니다.';
        }
        panelEls.list.appendChild(empty);
        return;
      }

      entries.forEach(function (item) {
        var entry = item.entry || {};
        var answer = String(entry.answer || '');
        var card = document.createElement('article');
        var expanded = !!expandedItems[item.id];
        card.className = 'item' + (expanded ? ' expanded' : '');

        var top = document.createElement('div');
        top.className = 'item-top';

        var title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = String(entry.resumeTitle || '(제목 없음)') + (entry.number != null ? ' · ' + entry.number + '번' : '');
        top.appendChild(title);
        var tier = tierFor(entry);
        if (tier >= 1) {
          var stage = document.createElement('span');
          stage.className = 'stage stage-' + tier;
          stage.textContent = STAGE_LABELS[tier];
          top.appendChild(stage);
        }
        var favorite = document.createElement('button');
        favorite.className = 'favorite' + (item.meta.favorite ? ' active' : '');
        favorite.textContent = item.meta.favorite ? '★' : '☆';
        favorite.title = item.meta.favorite ? '즐겨찾기 해제' : '즐겨찾기';
        favorite.addEventListener('click', function () {
          bankMeta[item.id] = bankMeta[item.id] || {};
          bankMeta[item.id].favorite = !bankMeta[item.id].favorite;
          if (!bankMeta[item.id].favorite && !bankMeta[item.id].lastCopiedAt) delete bankMeta[item.id];
          saveBankMeta();
          renderBankPanel();
        });
        top.appendChild(favorite);
        card.appendChild(top);

        var questionLabel = document.createElement('div');
        questionLabel.className = 'section-label';
        questionLabel.textContent = '질문';
        card.appendChild(questionLabel);

        var question = document.createElement('div');
        question.className = 'item-question';
        question.textContent = String(entry.question || '(질문 없음)');
        card.appendChild(question);

        var answerLabel = document.createElement('div');
        answerLabel.className = 'section-label answer-label';
        answerLabel.textContent = '답변';
        card.appendChild(answerLabel);

        var preview = document.createElement('div');
        preview.className = 'item-answer';
        preview.textContent = answer;
        card.appendChild(preview);

        var bottom = document.createElement('div');
        bottom.className = 'item-bottom';
        var copy = document.createElement('button');
        copy.className = 'copy';
        copy.textContent = '답변 복사';
        copy.addEventListener('click', function () {
          navigator.clipboard.writeText(answer).then(function () {
            copy.textContent = '✓ 복사됨';
            copy.classList.add('done');
            bankMeta[item.id] = bankMeta[item.id] || {};
            bankMeta[item.id].lastCopiedAt = new Date().toISOString();
            saveBankMeta();
            setTimeout(function () { copy.textContent = '답변 복사'; copy.classList.remove('done'); }, 1200);
          }).catch(function () {
            copy.textContent = '복사 실패';
            setTimeout(function () { copy.textContent = '답변 복사'; }, 1200);
          });
        });
        bottom.appendChild(copy);
        (Array.isArray(entry.tags) ? entry.tags : ['기타']).forEach(function (tag) {
          var tagEl = document.createElement('span');
          tagEl.className = 'tag';
          tagEl.textContent = tag;
          bottom.appendChild(tagEl);
        });
        var meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = answer.length + '자';
        bottom.appendChild(meta);
        var expand = document.createElement('button');
        expand.className = 'expand';
        expand.textContent = expanded ? '접기' : '더보기';
        expand.addEventListener('click', function () {
          expandedItems[item.id] = !expandedItems[item.id];
          renderBankPanel();
        });
        bottom.appendChild(expand);
        card.appendChild(bottom);
        card.addEventListener('click', function (event) {
          if (event.target.closest('button')) return;
          expandedItems[item.id] = !expandedItems[item.id];
          renderBankPanel();
        });
        panelEls.list.appendChild(card);
      });
      panelEls.list.scrollTop = previousScrollTop;
    }

    function clampBankPanelPosition(left, top) {
      var rect = panelHost.getBoundingClientRect();
      var width = rect.width || 380;
      var height = rect.height || Math.min(680, window.innerHeight - 98);
      return {
        left: Math.max(8, Math.min(left, window.innerWidth - Math.min(width, window.innerWidth - 8))),
        top: Math.max(8, Math.min(top, window.innerHeight - Math.min(height, window.innerHeight - 8)))
      };
    }

    function applyBankPanelPosition(pos) {
      var clamped = clampBankPanelPosition(pos.left, pos.top);
      panelHost.style.left = clamped.left + 'px';
      panelHost.style.top = clamped.top + 'px';
      panelHost.style.right = 'auto';
    }

    function setupBankPanelDrag(dragHandle) {
      var dragging = false;
      var startX = 0, startY = 0, startLeft = 0, startTop = 0;
      dragHandle.addEventListener('mousedown', function (event) {
        if (event.target.closest('button')) return;
        var rect = panelHost.getBoundingClientRect();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        dragHandle.classList.add('dragging');
        event.preventDefault();
      });
      document.addEventListener('mousemove', function (event) {
        if (!dragging) return;
        applyBankPanelPosition(clampBankPanelPosition(startLeft + event.clientX - startX, startTop + event.clientY - startY));
      });
      document.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        dragHandle.classList.remove('dragging');
        var rect = panelHost.getBoundingClientRect();
        try { chrome.storage.local.set((function () { var data = {}; data[BANK_PANEL_POS_KEY] = { left: rect.left, top: rect.top }; return data; })()); } catch (e) { /* 위치 저장 실패는 무시 */ }
      });
    }

    function setupBankPanelResize() {
      if (typeof ResizeObserver !== 'function') return;
      var resizeTimer = null;
      var observer = new ResizeObserver(function () {
        if (!panelOpen) return;
        var rect = panelHost.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 300) return;
        var clamped = clampBankPanelPosition(rect.left, rect.top);
        if (clamped.left !== rect.left || clamped.top !== rect.top) applyBankPanelPosition(clamped);
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          try {
            var data = {};
            data[BANK_PANEL_SIZE_KEY] = { width: rect.width, height: rect.height };
            chrome.storage.local.set(data);
          } catch (e) { /* 크기 저장 실패는 무시 */ }
        }, 250);
      });
      observer.observe(panelHost);
    }

    function ensureBankPanel() {
      if (panelHost) return;
      panelHost = document.createElement('div');
      panelHost.id = 'jsl-bank-panel';
      panelHost.style.cssText = 'position:fixed;right:22px;top:74px;width:380px;height:min(680px,calc(100vh - 98px));min-width:320px;min-height:360px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);resize:both;overflow:hidden;z-index:2147483647;display:none;';
      var root = panelHost.attachShadow({ mode: 'open' });
      var style = document.createElement('style');
      // 자비스 공용 테마 — 크림 외피 + 흰 본문, 주황 액센트, 숫자는 모노스페이스 (dashboard와 동일 문법)
      style.textContent = [
        ':host{all:initial}', '*{box-sizing:border-box}',
        '.panel{height:100%;display:flex;flex-direction:column;overflow:hidden;background:#fdf8f3;border:1px solid #f0e2d5;border-radius:18px;box-shadow:0 12px 34px rgba(30,20,10,.18);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#332b24;font-size:13px;line-height:1.45}',
        '.header{padding:13px 15px 11px;flex:none}',
        '.title-row{display:flex;align-items:center;margin-bottom:9px;cursor:grab;user-select:none}.title-row.dragging{cursor:grabbing}.title{flex:1;color:#1f1a15;font-size:14px;font-weight:700}.title .brand{color:#ff6a00}.count{margin-left:7px;color:#93826f;font-size:11px;font-weight:400;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.close{border:0;background:transparent;color:#b8a794;font-size:22px;line-height:1;padding:0 3px;cursor:pointer;border-radius:8px}.close:hover{background:#fff1e8;color:#ff6a00}',
        '.search-row{display:flex;gap:6px}.search{min-width:0;flex:1;border:1px solid #eadbc9;background:#fff;border-radius:10px;padding:8px 11px;outline:0;font:inherit;color:#332b24}.search:focus{border-color:#ff9b58;box-shadow:0 0 0 3px #fff1e8}.filter-toggle{flex:none;border:1px solid #eadbc9;background:#fff;color:#796b5f;border-radius:10px;padding:0 11px;font-size:11px;font-weight:700;cursor:pointer;max-width:145px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit}.filter-toggle:hover,.filter-toggle.active{border-color:#ffb377;color:#ef6500;background:#fff8f2}',
        '.current-context{display:none;align-items:center;gap:5px;flex-wrap:wrap;margin-top:8px;padding:7px 10px;border:1px solid #ffd9bd;border-radius:10px;background:#fff8f2}.current-context.show{display:flex}.context-label{color:#8c7969;font-size:10.5px;font-weight:700;margin-right:2px}.context-tag{background:#ff6a00;color:#fff;border-radius:999px;padding:3px 8px;font-size:10.5px;font-weight:700}',
        '.modes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin-top:8px}.mode{border:1px solid transparent;background:#f6ede3;color:#76695e;border-radius:9px;padding:6px 2px;font-size:10px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit}.mode:hover{border-color:#ffc399;color:#ff6a00}.mode.active{background:#ff6a00;border-color:#ff6a00;color:#fff;font-weight:700}.mode:disabled{opacity:.42;cursor:not-allowed}',
        '.chips{display:none;flex-wrap:wrap;gap:5px;margin-top:8px;padding-top:8px;border-top:1px dashed #eadbc9}.chips.show{display:flex}.chip{flex:none;border:1px solid #eadbc9;background:#fff;color:#796b5f;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer;white-space:nowrap;font-family:inherit}.chip:hover{border-color:#ffc399;color:#ff6a00}.chip.active{background:#ff6a00;border-color:#ff6a00;color:#fff;font-weight:700}',
        '.list{overflow-y:auto;flex:1;background:#fff;border-radius:14px 14px 0 0;border-top:1px solid #f0e2d5}.list::-webkit-scrollbar{width:4px}.list::-webkit-scrollbar-thumb{background:#eddfd2;border-radius:2px}.empty{padding:44px 22px;color:#a89a8b;text-align:center;line-height:1.6;white-space:pre-line}',
        '.item{padding:12px 15px;border-bottom:1px solid #f8f1ea;cursor:pointer}.item:hover{background:#fffdfb}.item-top{display:flex;align-items:center;gap:8px}.item-title{flex:1;color:#ff6a00;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.favorite{border:0;background:transparent;color:#c9bdb2;font-size:18px;line-height:1;padding:2px;cursor:pointer}.favorite:hover,.favorite.active{color:#ff8a00}.section-label{margin-top:7px;color:#b3a08c;font-size:10px;font-weight:700;letter-spacing:.05em}.answer-label{margin-top:8px}.item-question{margin-top:2px;font-weight:700;color:#1f1a15;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.item-answer{margin-top:2px;color:#6f6256;line-height:1.5;white-space:pre-line;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.item.expanded .item-question,.item.expanded .item-answer{display:block;overflow:visible}.item-bottom{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:9px}.copy{border:1.5px solid #ffb377;background:#fff;color:#ff6a00;border-radius:8px;padding:4px 12px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}.copy:hover,.copy.done{background:#ff6a00;border-color:#ff6a00;color:#fff}.tag{padding:3px 8px;border-radius:999px;background:#fff1e8;color:#de5e00;font-size:10.5px}.meta{color:#b3a493;font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.expand{margin-left:auto;border:0;background:transparent;color:#9b8d80;font-size:11px;cursor:pointer;padding:3px;font-family:inherit}.expand:hover{color:#ff6a00;text-decoration:underline}',
        '.stage{flex:none;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap}.stage-1{background:#f3ece2;color:#8a7358}.stage-2{background:#ffe6cf;color:#c56a00}.stage-3{background:#ffd6a8;color:#a84f00}.stage-4{background:linear-gradient(135deg,#ffe27a,#ff9d3d);color:#5a3800;box-shadow:0 0 0 1px rgba(255,180,0,.45)}'
      ].join('\n');
      root.appendChild(style);

      var panel = document.createElement('section');
      panel.className = 'panel';
      var header = document.createElement('header');
      header.className = 'header';
      var titleRow = document.createElement('div');
      titleRow.className = 'title-row';
      var title = document.createElement('div');
      title.className = 'title';
      title.innerHTML = '<span class="brand">자비스</span> 답변 뱅크';
      var count = document.createElement('span');
      count.className = 'count';
      title.appendChild(count);
      var close = document.createElement('button');
      close.className = 'close';
      close.textContent = '×';
      close.title = '답변 뱅크 닫기';
      close.addEventListener('click', function () { panelOpen = false; panelHost.style.display = 'none'; });
      titleRow.appendChild(title);
      titleRow.appendChild(close);
      var search = document.createElement('input');
      search.className = 'search';
      search.type = 'search';
      search.placeholder = '질문 · 답변 · 회사명 검색';
      search.addEventListener('input', function () {
        if (panelSearchTimer) clearTimeout(panelSearchTimer);
        panelSearchTimer = setTimeout(function () {
          panelQuery = search.value;
          renderBankPanel(true);
        }, 150);
      });
      var filterToggle = document.createElement('button');
      filterToggle.className = 'filter-toggle';
      filterToggle.textContent = '필터';
      filterToggle.addEventListener('click', function () {
        if (panelCategory !== '전체') {
          panelCategory = '전체';
          filtersOpen = false;
        } else {
          filtersOpen = !filtersOpen;
        }
        renderBankPanel(true);
      });
      var searchRow = document.createElement('div');
      searchRow.className = 'search-row';
      searchRow.appendChild(search);
      searchRow.appendChild(filterToggle);

      var currentContext = document.createElement('div');
      currentContext.className = 'current-context';

      var modes = document.createElement('div');
      modes.className = 'modes';
      var modeButtons = {};
      ['all', 'top', 'similar', 'favorites', 'recent'].forEach(function (mode) {
        var button = document.createElement('button');
        button.className = 'mode';
        button.addEventListener('click', function () { setPanelMode(mode); });
        modes.appendChild(button);
        modeButtons[mode] = button;
      });
      var chips = document.createElement('div');
      chips.className = 'chips';
      header.appendChild(titleRow);
      header.appendChild(searchRow);
      header.appendChild(currentContext);
      header.appendChild(modes);
      header.appendChild(chips);
      var list = document.createElement('div');
      list.className = 'list';
      panel.appendChild(header);
      panel.appendChild(list);
      root.appendChild(panel);
      (document.body || document.documentElement).appendChild(panelHost);
      panelEls = {
        count: count, chips: chips, list: list, search: search,
        filterToggle: filterToggle, modes: modeButtons, context: currentContext
      };
      setupBankPanelDrag(titleRow);
      setupBankPanelResize();
      try {
        chrome.storage.local.get([BANK_PANEL_POS_KEY, BANK_PANEL_SIZE_KEY], function (res) {
          var size = res && res[BANK_PANEL_SIZE_KEY];
          if (size && typeof size.width === 'number' && typeof size.height === 'number') {
            panelHost.style.width = Math.max(320, Math.min(size.width, window.innerWidth - 16)) + 'px';
            panelHost.style.height = Math.max(360, Math.min(size.height, window.innerHeight - 16)) + 'px';
          }
          var pos = res && res[BANK_PANEL_POS_KEY];
          if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') applyBankPanelPosition(pos);
        });
      } catch (e) { /* 저장한 위치가 없거나 storage 접근 실패 */ }

      document.addEventListener('keydown', function (event) {
        if (!panelOpen) return;
        if (event.key === 'Escape') {
          panelOpen = false;
          panelHost.style.display = 'none';
          event.preventDefault();
          return;
        }
        var path = event.composedPath ? event.composedPath() : [];
        var keyTarget = path.length ? path[0] : event.target;
        var tagName = keyTarget && keyTarget.tagName;
        if (event.key === '/' && tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
          panelEls.search.focus();
          event.preventDefault();
        }
      }, true);
    }

    function openBankPanel() {
      ensureBankPanel();
      // 패널 진입 시 현재 활성 문항의 분류를 기본 맥락으로 사용한다.
      panelMode = usefulCurrentTags().length ? 'similar' : 'all';
      panelCategory = '전체';
      filtersOpen = false;
      panelOpen = true;
      panelHost.style.display = '';
      renderBankPanel(true);
      panelEls.search.focus();
    }

    // 초기 1회 로드
    try {
      chrome.storage.local.get([STORAGE_KEY, CATEGORY_VERSION_KEY, BANK_META_KEY, RESUME_STAGE_KEY], function (res) {
        try {
          bank = (res && res[STORAGE_KEY]) || {};
          bankMeta = (res && res[BANK_META_KEY]) || {};
          resumeStages = (res && res[RESUME_STAGE_KEY]) || {};
          lastResumeStagesJSON = JSON.stringify(resumeStages);
          // 기존에 모인 답변도 새 기준을 적용한다. 질문만 읽고 답변은 건드리지 않는다.
          if (res && res[CATEGORY_VERSION_KEY] !== CATEGORY_VERSION) {
            Object.keys(bank).forEach(function (id) {
              var entry = bank[id];
              if (entry) entry.tags = categorize(entry.question);
            });
            var migration = {};
            migration[STORAGE_KEY] = bank;
            migration[CATEGORY_VERSION_KEY] = CATEGORY_VERSION;
            chrome.storage.local.set(migration);
          }
          renderBankPanel();
          // 편집기가 이미 떠 있는데 초기화 레이스로 첫 상태 브로드캐스트를 놓쳤을 수 있다.
          // (bank가 늦게 구독하면 bridge-main은 동일 상태를 재전송하지 않아 현재 문항 분류가
          //  영영 비어버린다.) 현재 상태를 능동적으로 한 번 받아 현재 문항 분류를 채운다.
          try {
            JSL.getState().then(function (s) { if (s) handleState(s); }).catch(function () {});
          } catch (e2) { /* getState 실패는 무시 — 이후 onState가 보완 */ }
        } catch (e) { bank = {}; }
      });
    } catch (e) {
      console.warn('[자비스] 답변 뱅크: storage 접근 실패, 수집 비활성', e);
      return;
    }

    function flush() {
      timer = null;
      var changes = pending;
      pending = {};
      if (!bank) { bank = {}; }
      var hasChange = false;
      Object.keys(changes).forEach(function (id) {
        bank[id] = changes[id];
        hasChange = true;
      });
      if (!hasChange) return;
      try {
        var payload = {};
        payload[STORAGE_KEY] = bank;
        chrome.storage.local.set(payload);
        renderBankPanel();
      } catch (e) {
        console.warn('[자비스] 답변 뱅크 저장 실패', e);
      }
    }

    // 목록 페이지 일괄 수집: 현재 시즌 모든 자소서의 문항을 한 번에 가져와 저장.
    // (편집 페이지를 일일이 열지 않아도 뱅크가 채워지도록)
    function importFromList() {
      if (importedList || bank === null) return;
      importedList = true;
      JSL.action('getFullResumes').then(function (r) {
        try {
          if (!r || !r.ok || !r.data || !Array.isArray(r.data.resumes)) {
            importedList = false; // 실패 시 다음 state 주기에 재시도
            return;
          }
          var dirty = false;
          r.data.resumes.forEach(function (res) {
            (res.qnas || []).forEach(function (q) {
              if (q == null || q.id == null) return;
              var answer = String(q.answer == null ? '' : q.answer);
              if (!answer.trim()) return;
              var question = String(q.question == null ? '' : q.question);
              var id = String(q.id);
              var prev = pending[id] || bank[id];
              if (prev && prev.answer === answer && prev.question === question) return;
              pending[id] = {
                resumeId: res.id,
                resumeTitle: String(res.title == null ? '' : res.title),
                number: q.number,
                question: question,
                answer: answer,
                tags: categorize(question),
                updatedAt: new Date().toISOString()
              };
              dirty = true;
            });
          });
          if (dirty) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
              try { flush(); } catch (e) { console.warn('[자비스] 답변 뱅크 flush 오류', e); }
            }, 1000); // 일괄 수집은 1초 뒤 바로 저장
          }
        } catch (e) { console.warn('[자비스] 답변 뱅크 일괄 수집 오류', e); }
      }).catch(function () { importedList = false; });
    }

    function handleState(state) {
      try {
        if (state && state.page === 'list') {
          if (panelOpen && panelHost) {
            panelOpen = false;
            panelHost.style.display = 'none';
          }
          if (Array.isArray(state.resumes)) {
            var stages = {};
            state.resumes.forEach(function (r) { if (r && r.id != null) stages[r.id] = r.category; });
            var stagesJSON = JSON.stringify(stages);
            if (stagesJSON !== lastResumeStagesJSON) {
              resumeStages = stages;
              lastResumeStagesJSON = stagesJSON;
              saveResumeStages();
              if (panelOpen) renderBankPanel();
            }
          }
          importFromList();
          return;
        }
        if (!state || !state.resume || !Array.isArray(state.qnas)) return;
        if (bank === null) return; // 초기 로드 전이면 다음 주기에 처리
        var resume = state.resume;
        var dirty = false;

        var activeQna = null;
        for (var activeIndex = 0; activeIndex < state.qnas.length; activeIndex++) {
          if (state.qnas[activeIndex] && state.qnas[activeIndex].active) {
            activeQna = state.qnas[activeIndex];
            break;
          }
        }
        if (!activeQna && state.qnas.length) activeQna = state.qnas[0];
        var nextQnaId = activeQna && activeQna.id != null ? String(activeQna.id) : null;
        var nextQnaTags = activeQna ? categorize(activeQna.question) : [];
        var currentChanged = nextQnaId !== currentQnaId || nextQnaTags.join('|') !== currentQnaTags.join('|');
        currentQnaId = nextQnaId;
        currentQnaTags = nextQnaTags;

        state.qnas.forEach(function (qna) {
          if (!qna || qna.id == null) return;
          var answer = String(qna.answer == null ? '' : qna.answer);
          if (!answer.trim()) return; // 빈 답변(공백뿐)은 저장하지 않음
          var question = String(qna.question == null ? '' : qna.question);
          var id = String(qna.id);

          // 직전 저장본(또는 이미 대기 중인 변경분)과 달라진 문항만
          var prev = pending[id] || bank[id];
          if (prev && prev.answer === answer && prev.question === question) return;

          pending[id] = {
            resumeId: resume.id,
            resumeTitle: String(resume.title == null ? '' : resume.title),
            number: qna.number,
            question: question,
            answer: answer,
            tags: categorize(question),
            updatedAt: new Date().toISOString()
          };
          dirty = true;
        });

        if (dirty && !timer) {
          timer = setTimeout(function () {
            try { flush(); } catch (e) { console.warn('[자비스] 답변 뱅크 flush 오류', e); }
          }, DEBOUNCE_MS);
        }
        if (dirty || currentChanged) renderBankPanel();
      } catch (e) {
        // 예외 전파 금지
        console.warn('[자비스] 답변 뱅크 수집 오류', e);
      }
    }
    JSL.onState(handleState);

    // 페이지 이탈 직전 대기분 저장 시도 (best-effort)
    window.addEventListener('pagehide', function () {
      try {
        if (timer) { clearTimeout(timer); flush(); }
      } catch (e) { /* 무시 */ }
    });

    // 팝업에서 삭제하거나 다른 탭에서 갱신해도 열린 패널은 최신 상태를 유지한다.
    try {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'local') return;
        if (changes[STORAGE_KEY]) bank = changes[STORAGE_KEY].newValue || {};
        if (changes[BANK_META_KEY]) bankMeta = changes[BANK_META_KEY].newValue || {};
        if (changes[RESUME_STAGE_KEY]) {
          resumeStages = changes[RESUME_STAGE_KEY].newValue || {};
          lastResumeStagesJSON = JSON.stringify(resumeStages);
        }
        renderBankPanel();
      });
    } catch (e) { /* storage 변경 감지 실패는 무시 */ }

    // 대시보드 위젯에서 답변 뱅크를 같은 페이지의 패널로 연다.
    (function attachOpenButton() {
      var start = Date.now();
      (function wait() {
        try {
          if (JSL.ui && JSL.ui.ready) {
            JSL.ui.ready.then(function () {
              try {
                JSL.ui.addAction('답변 뱅크', function () {
                  openBankPanel();
                });
              } catch (e) { /* UI 실패는 무시 — 툴바 아이콘으로 접근 가능 */ }
            }).catch(function () {});
            return;
          }
        } catch (e) { /* 무시 */ }
        if (Date.now() - start < 5000) setTimeout(wait, 200);
      })();
    })();
  }

  JSL.register('bank', init);
})();
