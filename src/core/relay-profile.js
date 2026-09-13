// 직접 입력한 개인 이력의 공통 저장 계약. 기본값에는 실제 사용자 데이터가 없다.
(function (scope) {
  'use strict';
  var KEY = 'jslRelayProfile';
  var LIMIT = 256 * 1024;
  var categories = ['어학', '자격증', '수상', '교육'];
  var templates = {
    '어학': ['시험명', '등록번호', '응시일', '등급'],
    '자격증': ['자격증명', '발급기관', '등록번호', '취득일'],
    '수상': ['상훈명', '수여기관', '수상일자', '수상내역'],
    '교육': ['과정명', '교육기관', '시작일', '종료일', '교육시간', '주요내용']
  };
  function empty() {
    return { version: 1, categories: { '어학': [], '자격증': [], '수상': [], '교육': [] } };
  }
  function validate(input) {
    if (!input || input.version !== 1 || !input.categories || typeof input.categories !== 'object' || Array.isArray(input.categories)) {
      throw new Error('지원하는 개인 이력 저장 형식(version: 1)이 아닙니다.');
    }
    if (new TextEncoder().encode(JSON.stringify(input)).length > LIMIT) throw new Error('이력 정보는 256KB 이하로 저장해 주세요.');
    if (Object.keys(input.categories).some(function (name) { return categories.indexOf(name) === -1; })) {
      throw new Error('어학·자격증·수상·교육 이외의 분류가 포함되어 있습니다.');
    }
    var result = empty();
    categories.forEach(function (name) {
      var records = input.categories[name];
      if (!Array.isArray(records) || records.length > 50) throw new Error(name + ': 항목 배열이 필요하며 최대 50개까지 지원합니다.');
      result.categories[name] = records.map(function (record) {
        if (!record || typeof record.title !== 'string' || !record.title.trim() || record.title.length > 200) {
          throw new Error(name + ': 항목 이름을 1~200자로 입력해 주세요.');
        }
        if (!Array.isArray(record.fields) || !record.fields.length || record.fields.length > 20) throw new Error(name + ': 필드는 1~20개여야 합니다.');
        return { title: record.title, fields: record.fields.map(function (pair) {
          if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0].trim() || pair[0].length > 40 || typeof pair[1] !== 'string' || pair[1].length > 10000) {
            throw new Error(name + ': 필드 이름(1~40자)과 값(최대 10,000자)은 문자열이어야 합니다.');
          }
          return [pair[0], pair[1]]; // 번호의 0, 날짜 표기, 공백과 줄바꿈을 그대로 보관
        }) };
      });
    });
    return result;
  }
  // 붙여넣은 JSON을 편집본 뒤에 붙인다. 제목은 첫 필드에서 만들고, 같은 항목·같은 이름의 다른 항목은 추가하지 않는다.
  function merge(current, text) {
    var input;
    try { input = JSON.parse(text); } catch (e) { throw new Error('JSON 형식이 아닙니다. (' + e.message + ')'); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || !input.categories || typeof input.categories !== 'object' || Array.isArray(input.categories)) {
      throw new Error('{"version":1,"categories":{...}} 형식이 필요합니다.');
    }
    var candidate = { version: input.version, categories: {} };
    Object.keys(input.categories).forEach(function (name) { candidate.categories[name] = input.categories[name]; });
    categories.forEach(function (name) {
      var records = candidate.categories[name];
      if (records == null) { candidate.categories[name] = []; return; }
      if (!Array.isArray(records)) return;
      candidate.categories[name] = records.map(function (record) {
        var first = record && Array.isArray(record.fields) && Array.isArray(record.fields[0]) ? record.fields[0][1] : null;
        return record && typeof first === 'string' ? { title: first.slice(0, 200), fields: record.fields } : record;
      });
    });
    var incoming = validate(candidate);
    var result = JSON.parse(JSON.stringify(current)), added = {}, duplicates = 0, conflicts = [];
    categories.forEach(function (name) {
      var list = result.categories[name];
      added[name] = 0;
      incoming.categories[name].forEach(function (record) {
        var key = JSON.stringify(record);
        if (list.some(function (item) { return JSON.stringify(item) === key; })) { duplicates++; return; }
        if (list.some(function (item) { return item.title === record.title; })) { conflicts.push(name + ' · ' + record.title); return; }
        list.push(record); added[name]++;
      });
      if (list.length > 50) throw new Error(name + ': 분류별 최대 50개까지 등록할 수 있습니다.');
    });
    return { value: result, added: added, duplicates: duplicates, conflicts: conflicts };
  }
  var api = { key: KEY, limit: LIMIT, categories: categories, templates: templates, empty: empty, validate: validate, merge: merge };
  scope.JSLRelayProfile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
