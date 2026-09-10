// 답변 뱅크 팝업 — chrome.storage.local 'jslAnswerBank' 검색/복사/삭제 UI (SPEC.md 참조)
(function () {
  'use strict';

  var STORAGE_KEY = 'jslAnswerBank';
  var CATEGORIES = [
    '전체', '지원동기·기업적합', '직무역량·전문성', '입사 후 포부',
    '가치관·조직적합', '협업·조직문화', '성장과정·자기이해', '강점·보완점',
    '문제해결·도전', '성취·실패', '자유양식', '기타'
  ];

  var bank = {};            // { qnaId: entry }
  var activeCategory = '전체';
  var query = '';
  var searchTimer = null;
  var deleted = null;       // 실행취소용 { id, entry }
  var undoTimer = null;

  var $search = document.getElementById('search');
  var $chips = document.getElementById('chips');
  var $list = document.getElementById('list');
  var $count = document.getElementById('count');
  var $undoBar = document.getElementById('undo-bar');
  var $undoBtn = document.getElementById('undo-btn');

  // ---------- 유틸 ----------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 이스케이프 후 검색어 하이라이트
  function highlight(text, q) {
    var esc = escapeHtml(text);
    if (!q) return esc;
    var escQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return esc.replace(new RegExp('(' + escQ + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) {
      return esc;
    }
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '.' + mm + '.' + dd;
  }

  function save(cb) {
    var payload = {};
    payload[STORAGE_KEY] = bank;
    chrome.storage.local.set(payload, cb);
  }

  // ---------- 필터/렌더 ----------

  function filtered() {
    var q = query.trim().toLowerCase();
    return Object.keys(bank)
      .map(function (id) { return { id: id, entry: bank[id] }; })
      .filter(function (w) {
        var e = w.entry;
        if (activeCategory !== '전체') {
          if (!Array.isArray(e.tags) || e.tags.indexOf(activeCategory) === -1) return false;
        }
        if (q) {
          var hay = (String(e.question || '') + '\n' + String(e.answer || '') + '\n' + String(e.resumeTitle || '')).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      })
      .sort(function (a, b) {
        return String(b.entry.updatedAt || '').localeCompare(String(a.entry.updatedAt || ''));
      });
  }

  function renderChips() {
    $chips.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className = 'chip' + (cat === activeCategory ? ' active' : '');
      btn.textContent = cat;
      btn.addEventListener('click', function () {
        activeCategory = cat;
        renderChips();
        renderList();
      });
      $chips.appendChild(btn);
    });
  }

  function renderList() {
    var items = filtered();
    var total = Object.keys(bank).length;
    $count.textContent = total ? '(' + items.length + '/' + total + ')' : '';
    $list.innerHTML = '';

    if (total === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '저장된 답변이 없습니다.\n자소설닷컴 자소서 편집 페이지를 열면 자동으로 수집됩니다.';
      empty.style.whiteSpace = 'pre-line';
      $list.appendChild(empty);
      return;
    }
    if (items.length === 0) {
      var none = document.createElement('div');
      none.className = 'empty';
      none.textContent = '검색 결과가 없습니다.';
      $list.appendChild(none);
      return;
    }

    var q = query.trim();
    items.forEach(function (w) {
      var e = w.entry;
      var answer = String(e.answer || '');
      var item = document.createElement('div');
      item.className = 'item';

      var tagsHtml = (Array.isArray(e.tags) ? e.tags : ['기타'])
        .map(function (t) { return '<span class="tag">' + escapeHtml(t) + '</span>'; })
        .join('');

      item.innerHTML =
        '<div class="item-top">' +
          '<span class="item-title">' + highlight(String(e.resumeTitle || '(제목 없음)'), q) +
            (e.number != null ? ' · ' + escapeHtml(String(e.number)) + '번' : '') + '</span>' +
          '<button class="del-btn" title="삭제">&times;</button>' +
        '</div>' +
        '<div class="item-q">' + highlight(String(e.question || '(질문 없음)'), q) + '</div>' +
        '<div class="item-a">' + highlight(answer, q) + '</div>' +
        '<div class="item-bottom">' +
          '<button class="copy-btn">복사</button>' +
          tagsHtml +
          '<span class="meta">' + answer.length + '자 · ' + formatDate(e.updatedAt) + '</span>' +
        '</div>';

      // 복사
      var copyBtn = item.querySelector('.copy-btn');
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(answer).then(function () {
          copyBtn.textContent = '✓ 복사됨';
          copyBtn.classList.add('done');
          setTimeout(function () {
            copyBtn.textContent = '복사';
            copyBtn.classList.remove('done');
          }, 1500);
        }).catch(function () {
          copyBtn.textContent = '복사 실패';
          setTimeout(function () { copyBtn.textContent = '복사'; }, 1500);
        });
      });

      // 삭제 (confirm 없이 즉시 + 실행취소 5초)
      item.querySelector('.del-btn').addEventListener('click', function () {
        var id = w.id;
        deleted = { id: id, entry: bank[id] };
        delete bank[id];
        save();
        renderList();
        showUndoBar();
      });

      $list.appendChild(item);
    });
  }

  // ---------- 실행취소 ----------

  function showUndoBar() {
    $undoBar.classList.add('show');
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndoBar, 5000);
  }

  function hideUndoBar() {
    $undoBar.classList.remove('show');
    deleted = null;
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
  }

  $undoBtn.addEventListener('click', function () {
    if (deleted) {
      bank[deleted.id] = deleted.entry;
      save();
      renderList();
    }
    hideUndoBar();
  });

  // ---------- 검색 (300ms 디바운스) ----------

  $search.addEventListener('input', function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      query = $search.value;
      renderList();
    }, 300);
  });

  // ---------- 초기화 ----------

  chrome.storage.local.get(STORAGE_KEY, function (res) {
    bank = (res && res[STORAGE_KEY]) || {};
    renderChips();
    renderList();
  });
})();

// ── 채용 사이트 위에 세로 복사 바 띄우기 ──────────────────────────────
// 팝업을 연 것 자체가 사용자 조작이라 activeTab 권한이 그 탭에만 잠깐 열린다.
// 그때 relay-panel.js를 한 번 주입한다. 사이트 DOM은 읽지도 쓰지도 않고 우리 막대만 얹는다.
// 이미 떠 있으면 relay-panel이 스스로 닫는다(토글).
(function () {
  var btn = document.getElementById('relay-btn');
  var sub = document.getElementById('relay-sub');
  if (!btn || !sub) return;

  // chrome:// 같은 곳엔 어떤 확장도 주입할 수 없다. 미리 알려주고 버튼을 잠근다.
  function injectable(url) {
    return /^https?:\/\//.test(url || '');
  }

  chrome.storage.local.get('jslRelay', function (res) {
    var snap = res && res.jslRelay;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !injectable(tab.url)) {
        sub.textContent = '이 페이지에는 띄울 수 없습니다';
        return;
      }
      if (!snap || !snap.qnas || !snap.qnas.length) {
        sub.textContent = '자소설에서 자소서를 먼저 열어 주세요';
        return;
      }
      sub.textContent = (snap.title || '자소서') + ' · ' + snap.qnas.length + '문항';
      btn.disabled = false;
      btn.addEventListener('click', function () {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: ['src/features/relay-panel.js'] },
          function () {
            if (chrome.runtime.lastError) {
              sub.textContent = '띄우지 못했습니다 — 페이지를 새로고침해 주세요';
              return;
            }
            window.close();
          }
        );
      });
    });
  });
})();
