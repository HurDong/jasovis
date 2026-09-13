// 개인 정보는 확장의 로컬 저장소에만 보관한다. 초기 데이터는 비어 있다.
(function () {
  'use strict';
  var P = JSLRelayProfile;
  var draft = P.empty(), base, category = P.categories[0], ready = false, dirty = false, saving = false;
  var records = document.getElementById('profile-records');
  var status = document.getElementById('profile-status');
  var tabs = document.getElementById('profile-tabs');
  var save = document.getElementById('profile-save');
  var add = document.getElementById('profile-add');
  var language = document.getElementById('profile-language');
  function report(text, error) { status.textContent = text; status.className = error ? 'error' : ''; }
  function changed() { dirty = true; report('저장하지 않은 변경이 있습니다.'); }
  function controls() {
    document.querySelectorAll('.profile button,.profile input,.profile textarea').forEach(function (el) { el.disabled = !ready || saving; });
    document.getElementById('profile-reload').disabled = saving;
  }
  function read() {
    ready = false; controls();
    chrome.storage.local.get(P.key, function (items) {
      if (chrome.runtime.lastError) { report('내 이력을 읽지 못했습니다. 다시 읽기를 눌러 주세요.', true); return; }
      base = JSON.stringify(items[P.key]);
      try { draft = items[P.key] == null ? P.empty() : P.validate(items[P.key]); }
      catch (e) { report('저장된 이력 형식을 확인할 수 없습니다: ' + e.message, true); return; }
      dirty = false; ready = true; render(); controls(); report('저장된 내 이력을 불러왔습니다.');
    });
  }
  function field(label, value, setter, multiline) {
    var wrap = document.createElement('label'); wrap.textContent = label;
    var input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.value = value; input.maxLength = 10000;
    input.addEventListener('input', function () { setter(input.value); changed(); });
    wrap.appendChild(input); return wrap;
  }
  function render() {
    tabs.replaceChildren(); records.replaceChildren();
    P.categories.forEach(function (name) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = name;
      b.setAttribute('aria-pressed', String(name === category));
      b.onclick = function () { category = name; render(); }; tabs.appendChild(b);
    });
    language.hidden = category !== '어학';
    add.textContent = category + ' 추가';
    if (!draft.categories[category].length) {
      var empty = document.createElement('p'); empty.textContent = '등록된 ' + category + ' 정보가 없습니다.'; records.appendChild(empty);
    }
    draft.categories[category].forEach(function (record, index) {
      var box = document.createElement('section'); box.className = 'profile-record';
      var head = document.createElement('div'); head.className = 'profile-record-head';
      var title = document.createElement('strong'); title.textContent = record.title || '새 ' + category;
      head.appendChild(title);
      var del = document.createElement('button'); del.type = 'button'; del.className = 'ghost'; del.textContent = '삭제';
      del.onclick = function () { draft.categories[category].splice(index, 1); changed(); render(); }; head.appendChild(del); box.appendChild(head);
      var fields = document.createElement('div'); fields.className = 'profile-fields';
      record.fields.forEach(function (pair, fieldIndex) {
        var multiline = /내용|내역/.test(pair[0]) || /[\r\n]/.test(pair[1]) || pair[1].length > 200;
        var wrap = field(pair[0], pair[1], function (value) {
          pair[1] = value;
          if (fieldIndex === 0) { record.title = value.slice(0, 200); title.textContent = record.title || '새 ' + category; }
        }, multiline);
        if (fieldIndex === 0) wrap.querySelector('input,textarea').maxLength = 200;
        if (pair[1].length > 50 || /내용|내역/.test(pair[0])) wrap.className = 'wide';
        fields.appendChild(wrap);
      });
      box.appendChild(fields); records.appendChild(box);
    });
  }
  function addRecord(labels) {
    if (draft.categories[category].length >= 50) { report('분류별 최대 50개까지 등록할 수 있습니다.', true); return; }
    draft.categories[category].push({ title: '', fields: labels.map(function (label) { return [label, '']; }) });
    changed(); render(); records.lastElementChild.querySelector('input').focus();
  }
  add.onclick = function () { addRecord(P.templates[category]); };
  language.onclick = function () { addRecord(['외국어', '회화수준', '작문수준', '독해수준']); };
  document.getElementById('profile-import').onclick = function () {
    if (!ready || saving) return;
    var text = document.getElementById('profile-import-text'), result;
    try { result = P.merge(draft, text.value); } catch (e) { report('추가하지 못했습니다: ' + e.message, true); return; }
    var names = P.categories.filter(function (name) { return result.added[name]; });
    var notes = [];
    if (result.duplicates) notes.push('이미 있는 같은 항목 ' + result.duplicates + '개는 건너뛰었습니다.');
    if (result.conflicts.length) notes.push('이름이 같지만 내용이 다른 항목은 추가하지 않았습니다: ' + result.conflicts.join(', '));
    if (!names.length) { report(['추가할 새 항목이 없습니다.'].concat(notes).join(' '), result.conflicts.length > 0); return; }
    draft = result.value; text.value = ''; category = names[0]; dirty = true; render();
    report([names.map(function (name) { return name + ' ' + result.added[name] + '개'; }).join(', ') +
      '를 편집 화면에 추가했습니다. 확인 후 내 이력 저장을 누르세요.'].concat(notes).join(' '), result.conflicts.length > 0);
  };
  save.onclick = async function () {
    if (!ready || saving) return;
    var value;
    try { value = P.validate(draft); } catch (e) { report(e.message, true); return; }
    saving = true; controls();
    try {
      var latest = await chrome.storage.local.get(P.key);
      if (JSON.stringify(latest[P.key]) !== base) throw new Error('다른 설정 화면에서 변경되었습니다. 작성 중인 내용은 이 화면에 유지했습니다. 필요한 값을 복사해 둔 뒤 저장본을 다시 읽어 주세요.');
      await chrome.storage.local.set({ [P.key]: value });
      var check = await chrome.storage.local.get(P.key);
      if (JSON.stringify(P.validate(check[P.key])) !== JSON.stringify(value)) throw new Error('저장한 내용을 확인하지 못했습니다. 저장본을 다시 읽어 주세요.');
      base = JSON.stringify(check[P.key]); dirty = false; report('이 브라우저에 저장했습니다. 열린 자비스에도 반영됩니다.');
    } catch (e) { report('저장 실패: ' + e.message, true); }
    saving = false; controls();
  };
  document.getElementById('profile-reload').onclick = function () {
    if (dirty && !confirm('저장하지 않은 변경을 버리고 저장본을 다시 읽을까요?')) return;
    read();
  };
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  read();
})();
