// paste 기능: 클립보드 본문을 문항 답변란에 넣는다 — SPEC.md '붙여넣기' 절 참조
//
// 쓰임새: ChatGPT 등에서 초안 **본문만** 복사해 온 뒤, 대시보드의 그 문항 카드에서
// 붙여넣기 아이콘 하나를 누르면 끝. 문항 탭을 옮길 필요가 없다 — bridge-main의
// setAnswer가 Angular 스코프에 직접 쓰기 때문에 비활성 문항에도 그대로 들어간다.
//
// 안전장치: 이미 쓴 답변을 덮어쓸 때는 일단 넣어서 눈으로 보게 하되, 원문을 들고 있다가
// 되묻는 토스트에서 '적용'을 누르면 잊고(+저장), '되돌리기'를 누르면 원문을 되돌린다.
// 빈 문항이면 되돌릴 게 없으므로 확인 절차 없이 바로 들어간다.
JSL.register('paste', function () {
  'use strict';

  var TOAST_ID = 'paste-undo';

  // 붙여넣기 아이콘 (클립보드 + 들어가는 문서). 복사 아이콘과 같은 규격: 15px / stroke 2
  var PASTE_ICON_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="8" y="4" width="12" height="16" rx="2"/>' +
    '<path d="M12 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/>' +
    '<path d="M4 10v9a1 1 0 0 0 1 1h3"/></svg>';

  function toast(payload) { JSL.emit('toast', payload); }
  function closeUndoToast() { JSL.emit('toast:close', { id: TOAST_ID }); }

  // ---------- 글자수 (SPEC 공용 규칙) ----------
  function effectiveCount(text, qna) {
    var t = String(text || '');
    return qna && qna.include_space === false ? t.replace(/\s/g, '').length : t.length;
  }

  function isBlank(text) { return String(text || '').replace(/\s/g, '') === ''; }

  // 미리보기 한 줄 — 줄바꿈은 공백으로 접고 너무 길면 자른다
  function preview(text, max) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  // ---------- 클립보드 읽기 ----------
  // manifest의 clipboardRead 권한이 있어야 하고, 유저 제스처(클릭) 안에서만 성공한다.
  // 실패는 예외로 던지지 않고 null을 돌려준다 (호출측이 안내 토스트를 띄운다).
  function readClipboard() {
    return new Promise(function (resolve) {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) { resolve(null); return; }
        navigator.clipboard.readText().then(
          function (text) { resolve(text == null ? null : String(text)); },
          function () { resolve(null); }
        );
      } catch (e) { resolve(null); }
    });
  }

  // 붙여넣을 본문 다듬기 — 줄바꿈 표기만 통일하고 앞뒤 빈 줄을 턴다.
  // 문단 사이 빈 줄은 글쓴이의 의도이므로 건드리지 않는다.
  function normalize(text) {
    return String(text).replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  }

  // ---------- 되돌리기 대기 목록 ----------
  // number -> {before, after}
  //  · before: 덮어쓰기 전 원문. 같은 문항에 연속으로 붙여넣어도 '원래 내 글'을 계속
  //    들고 있어야 하므로, 이미 대기 중이면 갱신하지 않는다.
  //  · after: 우리가 마지막으로 써넣은 값. 되돌리기 직전에 현재 답변과 비교해서
  //    "결정 안 한 사이에 직접 고쳤는지"를 판정한다.
  var pending = new Map();

  function findQna(state, number) {
    if (!state || !Array.isArray(state.qnas)) return null;
    for (var i = 0; i < state.qnas.length; i++) {
      if (Number(state.qnas[i].number) === Number(number)) return state.qnas[i];
    }
    return null;
  }

  function activeNumber(state) {
    if (!state || !Array.isArray(state.qnas)) return null;
    for (var i = 0; i < state.qnas.length; i++) {
      if (state.qnas[i].active) return Number(state.qnas[i].number);
    }
    return state.qnas.length ? Number(state.qnas[0].number) : null;
  }

  // 글자수 보조 줄 — 제한이 있으면 초과 여부까지
  function countSub(text, qna) {
    var n = effectiveCount(text, qna);
    var basis = qna.include_space === false ? '공백 제외' : '공백 포함';
    var limit = Number(qna.total_count) || 0;
    if (!limit) return n + '자 (' + basis + ')';
    if (n > limit) return n + ' / ' + limit + '자 · ' + (n - limit) + '자 초과';
    return n + ' / ' + limit + '자 (' + basis + ')';
  }

  // ---------- 되돌리기 ----------
  function undo(number) {
    var num = Number(number);
    var slot = pending.get(num);
    if (!slot) return;
    JSL.getState().then(function (state) {
      var qna = findQna(state, num);
      // 결정을 미루는 사이에 직접 고쳤다면, 되돌리기가 그 수정까지 날린다 → 하지 않고 알린다.
      if (qna && qna.answer !== slot.after) {
        pending.delete(num);
        toast({
          message: '되돌리지 않았어요',
          sub: '그 사이 문항 ' + num + '을(를) 직접 고쳐서, 되돌리면 그 수정까지 사라집니다',
          kind: 'fail', duration: 5200
        });
        return;
      }
      JSL.action('setAnswer', { number: num, text: slot.before }).then(function (r) {
        pending.delete(num);
        if (r && r.ok) {
          toast({ message: '문항 ' + num + ' 되돌렸어요', sub: '붙여넣기 전 원문으로 복구했습니다', kind: 'ok' });
        } else {
          toast({ message: '되돌리기 실패', sub: '문항 정보를 읽지 못했습니다', kind: 'fail' });
        }
      });
    });
  }

  // ---------- 적용 확정 ----------
  // 원문을 잊고 사이트 저장까지 대신 눌러 서버에 반영한다.
  // (이 편집기는 문항별 자동저장이 꺼져 있을 수 있어, 안 누르면 새로고침 때 날아간다)
  function commit(number) {
    pending.delete(Number(number));
    JSL.action('save').then(function (r) {
      if (r && r.ok) {
        toast({ message: '문항 ' + number + ' 적용했어요', sub: '저장하기까지 눌렀습니다', kind: 'ok' });
      } else {
        toast({
          message: '문항 ' + number + ' 적용했어요',
          sub: '저장 버튼을 찾지 못했습니다 — Ctrl+S로 저장해 주세요',
          kind: 'info', duration: 5000
        });
      }
    });
  }

  // ---------- 붙여넣기 본체 ----------
  // Promise<boolean> — 대시보드 버튼이 이 값으로 성공/실패 펄스를 준다.
  function pasteInto(number) {
    // 클립보드 읽기는 유저 제스처 안에서 시작해야 하므로 state 조회보다 먼저 건다.
    return Promise.all([readClipboard(), JSL.getState()]).then(function (both) {
      var raw = both[0];
      var state = both[1];

      if (raw === null) {
        toast({
          message: '클립보드를 읽지 못했어요',
          sub: '확장 프로그램을 새로고침했는지, 브라우저가 붙여넣기를 막고 있지 않은지 확인해 주세요',
          kind: 'fail', duration: 5200
        });
        return false;
      }
      var text = normalize(raw);
      if (!text) {
        toast({ message: '클립보드가 비어 있어요', sub: '초안 본문을 먼저 복사해 주세요', kind: 'fail' });
        return false;
      }

      var num = number != null ? Number(number) : activeNumber(state);
      var qna = findQna(state, num);
      if (!qna) {
        toast({ message: '붙여넣기 실패 — 문항 정보를 읽지 못했습니다', kind: 'fail' });
        return false;
      }

      var before = qna.answer || '';
      var hadContent = !isBlank(before);

      return JSL.action('setAnswer', { number: num, text: text }).then(function (r) {
        if (!r || !r.ok) {
          toast({ message: '붙여넣기 실패 — 문항 ' + num + '에 쓰지 못했습니다', kind: 'fail' });
          return false;
        }
        var sub = countSub(text, qna);

        if (!hadContent) {
          // 빈 문항 — 되돌릴 게 없으니 확인 절차 없이 끝낸다
          toast({ message: '문항 ' + num + '에 붙여넣었어요', sub: sub, kind: 'ok' });
          return true;
        }

        // 덮어쓴 경우 — 원문을 들고 있다가 결정을 받는다.
        // 이미 대기 중이면 최초 원문을 유지한다 (연속 붙여넣기 후에도 내 글로 돌아가게).
        var slot = pending.get(num);
        if (slot) slot.after = text;
        else { slot = { before: before, after: text }; pending.set(num, slot); }

        toast({
          id: TOAST_ID,
          kind: 'info',
          message: '문항 ' + num + '에 붙여넣었어요 · 원래 글은 아직 되돌릴 수 있어요',
          sub: sub + ' · 이전 ' + effectiveCount(slot.before, qna) + '자',
          prev: '덮어쓴 원래 글: ' + preview(slot.before, 90),
          actions: [
            { label: '되돌리기', onClick: function () { undo(num); } },
            { label: '적용', primary: true, onClick: function () { commit(num); } }
          ]
        });
        return true;
      });
    }).catch(function (e) {
      console.warn('[자비스] paste 오류', e);
      toast({ message: '붙여넣기 실패', kind: 'fail' });
      return false;
    });
  }

  // ---------- 이벤트 구독 ----------
  JSL.on('paste:qna', function (payload) {
    pasteInto(payload && payload.number != null ? payload.number : null);
  });

  // 다른 자소서로 넘어가면 되돌리기 대상이 의미를 잃는다 — 대기 상태를 비운다.
  var lastResumeId = null;
  JSL.onState(function (state) {
    var id = state && state.resume ? state.resume.id : null;
    if (id === lastResumeId) return;
    if (lastResumeId !== null && pending.size) {
      pending.clear();
      closeUndoToast();
    }
    lastResumeId = id;
  });

  // ---------- UI 버튼 (dashboard의 JSL.ui 계약, 5초 타임아웃) ----------
  // copy.js와 같은 패턴. 대시보드가 없거나 늦으면 버튼 없이 이벤트 구독만으로 동작한다.
  function waitForUi(timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (ok) {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(deadline);
        resolve(ok);
      };
      var deadline = setTimeout(function () { finish(false); }, timeoutMs);
      var attach = function () {
        if (JSL.ui && JSL.ui.ready && typeof JSL.ui.ready.then === 'function') {
          clearInterval(poll);
          JSL.ui.ready.then(function () { finish(true); }, function () { finish(false); });
          return true;
        }
        return false;
      };
      var poll = setInterval(attach, 100);
      attach();
    });
  }

  var addedButtons = {}; // 이미 버튼을 단 문항 번호

  function addPasteButtons(state) {
    if (!state || !state.qnas) return;
    state.qnas.forEach(function (qna) {
      if (addedButtons[qna.number]) return;
      try {
        // 모든 상태(미작성/작성중/완료)에 단다 — 붙여넣기가 가장 필요한 건 빈 문항이다.
        JSL.ui.addQnaAction(qna.number, '붙여넣기', function () {
          return pasteInto(qna.number);
        }, { icon: PASTE_ICON_SVG, title: '클립보드를 이 문항 답변에 붙여넣기' });
        addedButtons[qna.number] = true;
      } catch (e) {
        console.warn('[자비스] paste: 문항 버튼 추가 실패', qna.number, e);
      }
    });
  }

  waitForUi(5000).then(function (ready) {
    if (!ready) {
      console.warn('[자비스] paste: 대시보드 UI 미준비 — 버튼 없이 이벤트로만 동작');
      return;
    }
    JSL.getState().then(addPasteButtons).catch(function () {});
    JSL.onState(function (state) {
      try { addPasteButtons(state); } catch (e) { /* 무시 */ }
    });
  });
});
