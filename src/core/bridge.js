// 격리 월드: 전역 네임스페이스 JSL 정의. 기능 모듈은 이 API만 사용한다. (SPEC.md 참조)
(function () {
  'use strict';

  let reqSeq = 0;
  const pending = new Map();
  const stateSubs = [];
  const bus = new Map(); // pub/sub
  const features = [];

  window.addEventListener('JSL_RES', function (ev) {
    const d = ev.detail || {};
    const p = pending.get(d.id);
    if (p) {
      pending.delete(d.id);
      clearTimeout(p.timer);
      p.resolve({ ok: d.ok, data: d.data });
    }
  });

  window.addEventListener('JSL_STATE', function (ev) {
    const state = ev.detail || null;
    stateSubs.forEach(function (cb) {
      try { cb(state); } catch (e) { console.warn('[자비스] onState 콜백 오류', e); }
    });
  });

  function request(action, payload) {
    return new Promise(function (resolve) {
      const id = ++reqSeq;
      const timer = setTimeout(function () {
        pending.delete(id);
        resolve({ ok: false, data: null });
      }, 3000);
      pending.set(id, { resolve: resolve, timer: timer });
      window.dispatchEvent(new CustomEvent('JSL_REQ', { detail: { id: id, action: action, payload: payload || {} } }));
    });
  }

  const JSL = {
    register: function (name, initFn) {
      features.push({ name: name, init: initFn });
    },
    getState: function () {
      return request('getState').then(function (r) { return r.ok ? r.data : null; });
    },
    onState: function (cb) {
      stateSubs.push(cb);
    },
    action: function (name, payload) {
      return request(name, payload);
    },
    on: function (event, cb) {
      if (!bus.has(event)) bus.set(event, []);
      bus.get(event).push(cb);
    },
    emit: function (event, payload) {
      (bus.get(event) || []).forEach(function (cb) {
        try { cb(payload); } catch (e) { console.warn('[자비스] emit 콜백 오류', event, e); }
      });
    },
    ui: null // dashboard 기능이 채운다 (SPEC.md의 JSL.ui 계약)
  };

  window.JSL = JSL;

  // 모든 content_scripts 파일 로드 완료 후(동기 실행 순서 보장) 기능 초기화
  setTimeout(function () {
    features.forEach(function (f) {
      try { f.init(); } catch (e) { console.warn('[자비스] 기능 초기화 실패:', f.name, e); }
    });
  }, 0);
})();
