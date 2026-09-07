// copy 기능 (Agent B): 문항 평문 복사 + 전체 복사(기업/문항/본문) — SPEC.md 참조
JSL.register('copy', function () {
  'use strict';

  // ---------- 글자수 규칙 (SPEC 공용 규칙) ----------
  // include_space가 false면 공백 제외 기준으로 센다.
  function charCount(qna) {
    var answer = (qna && qna.answer) || '';
    if (qna && qna.include_space === false) {
      return answer.replace(/\s/g, '').length;
    }
    return answer.length;
  }

  // kind는 토스트의 아이콘+액센트를 바꾼다 ('ok' 체크·주황 / 'fail' 엑스·빨강 / 기본 info)
  // sub는 본문 아래 작은 보조 줄 (글자수처럼 확인용이지만 본문만큼 크지 않아도 되는 값)
  function toast(message, kind, sub) {
    JSL.emit('toast', { message: message, kind: kind, sub: sub });
  }

  // 토스트 보조 줄용 — 제한 기준(공백 포함/제외)과 반대쪽 값을 같이 보여준다
  function countSub(qna) {
    var answer = (qna && qna.answer) || '';
    var noSpace = answer.replace(/\s/g, '').length;
    return qna && qna.include_space === false
      ? answer.length + '자 (공백 포함)'
      : noSpace + '자 (공백 제외)';
  }

  // ---------- 클립보드 ----------
  // 반드시 유저 제스처(클릭/keydown) 핸들러에서 호출되는 흐름을 전제로 한다.
  // navigator.clipboard 실패 시 textarea + execCommand('copy') 폴백.
  function copyByExecCommand(text) {
    var ok = false;
    var ta = document.createElement('textarea');
    ta.value = text;
    // 화면 밖으로 밀어 시각적 영향 제거
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    try {
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  // Promise<boolean> — 성공 여부만 반환, 예외 전파 없음
  function copyText(text) {
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { resolve(true); },
            function () { resolve(copyByExecCommand(text)); }
          );
          return;
        }
      } catch (e) { /* 아래 폴백으로 */ }
      resolve(copyByExecCommand(text));
    });
  }

  // ---------- 모드 1: 문항 평문 복사 (채용플랫폼 제출용) ----------
  // number가 없으면 활성 문항. 데이터는 매번 getState()로 신선하게 조회.
  // Promise<boolean> 반환 — 대시보드 버튼이 이 값으로 성공/실패 피드백(펄스)을 준다.
  function copyQna(number) {
    return JSL.getState().then(function (state) {
      if (!state || !state.qnas || state.qnas.length === 0) {
        toast('복사 실패 — 문항 정보를 읽지 못했습니다', 'fail');
        return false;
      }
      var qna = null;
      if (number != null) {
        for (var i = 0; i < state.qnas.length; i++) {
          if (Number(state.qnas[i].number) === Number(number)) { qna = state.qnas[i]; break; }
        }
      } else {
        for (var j = 0; j < state.qnas.length; j++) {
          if (state.qnas[j].active) { qna = state.qnas[j]; break; }
        }
        if (!qna) qna = state.qnas[0]; // 활성 문항을 못 찾으면 첫 문항
      }
      if (!qna) {
        toast('복사 실패 — 문항 ' + number + '을(를) 찾지 못했습니다', 'fail');
        return false;
      }
      var text = qna.answer || '';
      return copyText(text).then(function (ok) {
        if (ok) {
          toast('문항 ' + qna.number + ' 복사됨 · ' + charCount(qna) + '자', 'ok', countSub(qna));
        } else {
          toast('복사 실패', 'fail');
        }
        return ok;
      });
    }).catch(function () {
      toast('복사 실패', 'fail');
      return false;
    });
  }

  // ---------- 모드 2: 전체 복사 (기업 + 문항(글자수 포함) + 본문) ----------
  function buildFullText(state) {
    var resume = state.resume || {};
    var title = resume.title || '(제목 없음)';

    var lines = [];
    lines.push('# ' + title);

    state.qnas.forEach(function (qna) {
      lines.push('');
      lines.push('## 문항 ' + qna.number + '. ' + (qna.question || '(질문 없음)'));
      var limit = qna.total_count;
      if (limit) {
        lines.push('(제한: ' + limit + '자, 현재 ' + charCount(qna) + '자)');
      } else {
        lines.push('(제한 없음, 현재 ' + charCount(qna) + '자)');
      }
      lines.push('');
      lines.push(qna.answer || '(작성 전)');
    });

    return lines.join('\n');
  }

  function copyFull() {
    return JSL.getState().then(function (state) {
      if (!state || !state.qnas || state.qnas.length === 0) {
        toast('복사 실패 — 자소서 정보를 읽지 못했습니다', 'fail');
        return false;
      }
      var text = buildFullText(state);
      return copyText(text).then(function (ok) {
        if (ok) {
          toast('자소서 전체가 복사됐어요', 'ok');
        } else {
          toast('복사 실패', 'fail');
        }
        return ok;
      });
    }).catch(function () {
      toast('복사 실패', 'fail');
      return false;
    });
  }

  // ---------- 이벤트 구독 (단축키 연동) ----------
  JSL.on('copy:qna', function (payload) {
    copyQna(payload && payload.number != null ? payload.number : null);
  });
  JSL.on('copy:full', function () {
    copyFull();
  });

  // ---------- UI 버튼 (dashboard의 JSL.ui 계약, 5초 타임아웃) ----------
  // JSL.ui는 dashboard가 나중에 채우므로 존재 자체도 폴링으로 기다린다.
  // 5초 내 ready가 안 되면 버튼 없이 이벤트 구독만으로 동작(에러 없이 포기).
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

  var addedQnaButtons = {}; // 이미 버튼을 단 문항 번호 기록

  function addQnaButtons(state) {
    if (!state || !state.qnas) return;
    state.qnas.forEach(function (qna) {
      if (addedQnaButtons[qna.number]) return;
      try {
        // 빈 문항에는 달지 않는다 — 복사할 답변이 없다. (붙여넣기 버튼이 대신 그 자리에 온다)
        JSL.ui.addQnaAction(qna.number, '복사', function () {
          return copyQna(qna.number);
        }, { title: '이 문항 답변 복사', stages: ['active', 'done'], emphasis: 'primary' });
        addedQnaButtons[qna.number] = true;
      } catch (e) {
        console.warn('[자비스] copy: 문항 버튼 추가 실패', qna.number, e);
      }
    });
  }

  waitForUi(5000).then(function (ready) {
    if (!ready) {
      console.warn('[자비스] copy: 대시보드 UI 미준비 — 버튼 없이 단축키 이벤트로만 동작');
      return;
    }
    try {
      // 전체 복사 공용 버튼 — 기업/문항/본문 전체를 평문으로 복사 (액션줄 primary)
      var fullBtn = JSL.ui.addAction('질문+답변 전체 복사', function () {
        return copyFull();
      }, { variant: 'primary' });
      if (fullBtn) {
        fullBtn.title = '모든 문항의 질문(글자수 포함)과 답변을 한 번에 복사해요';
      }
    } catch (e) {
      console.warn('[자비스] copy: 전체 복사 버튼 추가 실패', e);
    }
    // 문항별 복사 버튼 — 현재 state 기준으로 추가하고, 이후 늘어나는 문항도 반영
    JSL.getState().then(addQnaButtons).catch(function () {});
    JSL.onState(function (state) {
      try { addQnaButtons(state); } catch (e) { /* 무시 */ }
    });
  });
});
