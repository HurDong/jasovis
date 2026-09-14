# 자비스 개발 재개 안내

최종 정리: 2026-09-14. 이 문서는 현재 구현으로 들어가는 안내이며, 작업 상태는 매번 Git과 코드로 확인한다.
확정된 다음 개발 과제는 없다. 아래 제약을 새 작업에 대한 자동 승인으로 해석하지 않는다.

## 서비스와 실행 환경

자비스는 자소설닷컴의 자소서 편집·전형 목록·채팅을 보조하는 비공식 Chrome MV3 확장이다.
ChatGPT 웹의 문항별 응답을 자소설 지원서에 입력하고, 현재 답변에서 고른 곳 하나에 관한 질문을 연결된 GPT 대화에 전송한다.
별도 백엔드·OpenAI API·빌드 과정은 없다. 소스와 `manifest.json`이 있는 저장소 루트를 Chrome에 로드한다.
영구 보관은 `chrome.storage.local`, GPT 질문 전송 기록·중복 방지는 `chrome.storage.session`을 사용한다.
사이트 기능은 기존 로그인 상태로 사이트와 통신할 수 있다.

| 실행 위치 | 역할 / 진입점 |
|---|---|
| 자소설 편집기 `/resume/:id` | Angular 편집기 상태·입력, 대시보드, 복사/붙여넣기, 검수, 답변 뱅크 |
| 자소설 목록 `/resume_list` | 반응형 전형 보드, 통계·진행률, 우클릭 메뉴, 정렬 보정, 준비 중 공고 |
| 자소설 일반 페이지의 Angular 채팅 | 공고 보기, 답글 원본 이동, 내 메시지, 방 빠른 이동 |
| `/chat-slide*`, `/desktop/chat-slide*` 프레임 | React 채팅 어댑터와 채팅 UI. `all_frames`와 MAIN/격리 월드를 함께 확인 |
| `chatgpt.com` 대화 | 완료 응답의 문항 추출, 지원서 연결·입력 UI |
| 확장 service worker | GPT 연결 정보, 대상 탭 탐색, 입력 준비·검증·동시 작업 방지 |
| 확장 팝업 | 로컬 답변 뱅크 검색·복사·관리 |

정확한 URL 매칭·실행 순서·권한은 [manifest.json](manifest.json)을 읽는다.

## 기능별 수정 위치

아래 경로는 저장소 루트 기준이다. 하나의 전역 앱이나 단일 프레임워크 프로젝트로 취급하지 않는다.

| 변경하려는 부분 | 먼저 읽을 파일 |
|---|---|
| 편집기 상태 / 답변 입력 | `src/core/bridge-main.js`, `src/core/bridge.js` |
| 편집기 대시보드 / 표시 슬롯 | `src/features/dashboard.js` |
| 복사·붙여넣기·맞춤법·단축키 | `src/features/copy.js`, `paste.js`, `spellcheck.js`, `hotkeys.js` |
| 문장 검수 위치 | `src/features/checkpoint.js` |
| 답변 뱅크 | `src/features/bank.js`, `src/popup/popup.js`, `popup.html` |
| 목록 상태·사이트 액션 | `src/core/list-main.js` |
| 목록 배치 / 디자인 | `src/features/list-layout.js`, `list-design.css` |
| 목록 통계·진행률 | `src/features/list-stats.js`, `list-progress.js` |
| 목록 우클릭 / 정렬 / 준비 공고 | `src/features/list-menu.js`, `list-sort.js`, `watch.js` |
| 편집기 공고 / 채팅방 공고 | `src/features/jd-panel.js`, `chat-jd.js` |
| 답글 원본 조회·이동 | `src/core/chat-main.js`, `chat-react-main.js`, `src/features/chat-reply.js` |
| 내 메시지·빠른 이동 | `src/core/chat-tools-main.js`, `src/features/chat-tools.js` |
| 채팅 색·레이아웃 | `src/features/chat-design.css` |
| GPT 추출·문항 대응 | `src/core/gpt-protocol.js`, `src/features/gpt-response.js` |
| GPT 연결·라우팅 | `src/core/gpt-background.js`, `src/features/gpt-connect.js` |
| GPT 질문 바 UI | `src/core/gpt-feedback.js`(순수 계약·요청 형식·판독·위치), `src/features/gpt-feedback.js`(고르기 감지·질문 바·수정안 카드·자리 찾기·바꾸기), `gpt-feedback-marks.js`(답변란 표시·줄 위치 측정) |
| 자소설 → GPT → 자소설 | `src/core/gpt-feedback-background.js`(세션·검증·뒤 탭 전달·질문 칸·답 보관), `src/features/gpt-feedback-client.js`(웹 입력·전송 확인·답 감시), `src/core/gpt-render-main.js`(뒤 탭 화면 갱신 보조) |
| 외부 복사 패널 / 호출 버튼 | `src/features/relay-panel.js`, `relay-source.js`, `src/options/options.html`, `src/core/gpt-background.js`의 `relay:` 경로 |
| 내 이력 직접 입력 / 저장 / 편집 | `src/core/relay-profile.js`(검증·병합·틀), `src/features/relay-panel.js`(패널 안 ✎ 수정·추가·삭제·JSON). 옵션 화면에는 편집 UI 없음. 사용자 정보는 로컬 storage에만 보관 |
| GPT UI 스타일 | `src/features/gpt-response.css` |

`src/features/qna-nav.js`는 남아 있는 미사용 파일이며 manifest에 등록되지 않는다.

## 통신 경계

- 편집기의 MAIN `bridge-main.js`가 Angular 모델을 읽고 액션을 실행한다.
  격리 월드 `bridge.js`는 `JSL.getState`, `JSL.action`, `JSL.onState`, 기능 등록·이벤트 API를 제공한다.
  편집기 채널은 `JSL_REQ / JSL_RES / JSL_STATE`다.
- 목록·채팅은 각 MAIN 브리지가 담당한다. 답글 이동은 `JSL_CHAT_REQ / RES`,
  내 메시지·빠른 이동은 `JSL_CHAT_TOOLS_REQ / RES`를 쓴다. 편집기 JSL API로 모든 기능을 억지로 합치지 않는다.
- GPT의 두 출처 간 통신은 확장 runtime 메시지와 service worker를 거친다.
  채팅/목록 브리지와 별개다. 확장 service worker에는 DOM이 없다.
- 독립 위젯/모달은 Shadow DOM을 사용하고, 사이트 DOM을 꾸미는 목록·채팅·GPT UI는 범위를 제한한 CSS를 사용한다.

상태 스키마·메시지 계약·사이트 셀렉터는 [SPEC.md](SPEC.md)의 해당 절과 실제 구현을 함께 확인한다.

## GPT 일괄 입력: 오해하기 쉬운 동작

1. 사용자가 평소처럼 GPT 응답을 받는다. 앞뒤 전략·표가 있어도 문항 제목/질문과 이어진 코드 블록을 후보로 읽는다.
2. `자소설에 적용`을 누르면 처음에는 **현재 열린 Chrome 지원서 편집 탭** 중 대상을 선택한다.
   공고 링크를 파싱해 지원서를 찾거나 계정 전체 지원서 목록을 가져오는 기능은 없다.
3. 연결은 ChatGPT 대화 ID 기준이다. 같은 프로젝트의 다른 대화에 공유하지 않는다.
4. 문항 번호와 질문을 실제 지원서 문항에 대조한다. 출력 순서나 코드 블록 수만으로 순서 매핑하지 않는다.
5. `문항 2 수정안`이면 2번만 입력할 수 있다. 이전 사용자 메시지의 “2번 수정해줘”를 추적해 추론하지 않는다.
   선택한 assistant 응답에 번호나 대응 가능한 질문이 없으면 자동 인식하지 않는다.
6. 번호/질문 충돌·중복 후보는 수동 선택/제외로 해결한다. 질문 끝의 분량 표기·연속 공백·문장부호와 해당 문항 번호에 일치하는 질문 앞 번호 표기는 비교 시 정리하지만 답변 원문은 바꾸지 않는다.
7. 입력 직전에 응답 지문·연결 revision·대상 탭/문서·문항·기존 답변을 확인한다. 입력 후 모델을 다시 읽어 반영 여부를 표시한다.

`gpt-protocol.js`의 `analyzeQuestion`을 GPT와 지원서 양쪽에 적용한다. 원문과 UTF-16 구간, 실제 ID·편집기 순번·명시적 접두사, 분량·선택 예시·조건·미분류 구간을 반환한다. `compareQuestion`은 모든 대상에 대해 근거·충돌·불확실성·추천 점수를 반환하며 `map`은 유일성과 응답 중복을 검사한다.
기존 `normalizeQuestion`은 연결 비교와 분량 문법 검증에 유지한다. `detailedQuestion`은 기존 긴 지침의 한쪽 예시 생략 호환 경로다. `questionKey`는 제한된 구두점만 정리하고 의미 기호를 보존한다. 분석기는 같은 프로토콜 파일에 두므로 manifest와 worker의 기존 주입 순서를 유지한다.

`gpt-background.js`는 `gpt-confirmed-mappings`를 직렬 갱신한다. 수동 선택 후 검증된 문항만 저장하며 대화·지원서·revision·문항 원문 구성의 SHA-256·분석기 버전을 범위로 사용한다. 최근 확인 순 256개/30일 제한이며 준비·연결 변경·삭제 때 정리한다. 준비 뒤 전체 문항 구성도 원문 지문으로 재검증한다. `gpt:forget-mappings`는 현재 대화 기억과 아직 적용되지 않은 준비 기록의 학습 항목을 비운다.

연결 변경은 대상을 바꾸기만 하고 해제는 해당 대화의 연결만 지운다. 둘 다 기존 자소서를 수정/삭제하지 않는다.
연결은 다음 적용에서 대상 선택을 줄이는 편의 기능이며 자동 동기화가 아니다.
저장 버튼은 호출하지 않는다. 모델 입력 확인은 사이트 서버 저장 확인과 다르며, 사이트 입력 훅의 자동 저장 여부는 별도다.

## 현재 문항 GPT 질문 바

- 질문 하나는 한 문항의 고른 곳 하나(`textarea.answer`의 UTF-16 시작/끝과 보낼 때 원문)에만 속한다. 질문 칸은 자소설 탭마다 하나다.
- `feedback:` 메시지는 기존 `gpt:` 답변 적용과 분리한다. `gpt:state`로 현재 문항·문서와 원문을 재확인한다.
- 기존 `gpt-conversation:*` 연결을 역으로 찾는다. 미연결 대화를 사용자가 선택하면 같은 연결 계약을 만든다.
  자동으로 회사 이름을 추측하거나 새로운 GPT 대화/프로젝트를 만들지 않는다.
- 탭을 옮기지 않는 것이 기본이다. 뒤 탭 입력이 반영되지 않을 때만 GPT 탭을 잠깐 활성화했다가 곧바로 자소설 탭으로 돌아온다.
  재시도 조건(클릭 승인 요청 전·사용자 편집 없음·넣은 글 삭제 확인)을 넓히지 않는다. 넓히면 같은 질문이 두 번 보내질 수 있다.
- `feedback:authorize`는 실제 전송 클릭 직전에 출처·연결 revision·현재 원문을 재검증한다.
  세션에 클릭 가능 상태를 기록한 뒤 승인하며, 워커가 재시작돼도 같은 요청을 다시 클릭하지 않는다.
- 기존 GPT 입력·생성 상태를 보존한다. 사용자 메시지 ID와 본문(또는 첫 줄)을 확인한 경우만 성공이다.
  확인 불가 요청은 자동 재시도하지 않으며, 실제 사이트 전송 시험은 별도 구체적인 허용 범위를 확인한다.
- 요청 형식과 판독 규칙은 `JSLFeedback.prompt/parseAnswer` 한 곳에서 바꾼다. 형식을 바꾸면 가상 GPT 응답(`feedback.browser.cjs`)과 단위 테스트를 함께 갱신한다.
- 답은 보낸 메시지 ID 다음 assistant 메시지만 읽는다. 바꾸기는 `locate`로 위치가 확정될 때만 `setAnswer`로 쓰고, 추측으로 덮어쓰지 않는다.
- 떠 있는 UI 자리는 `gpt-feedback.js`의 `place()` 한 곳에서 정한다. 고른 줄·대시보드를 가리지 않는 조건을 유지하고, 바꾸면 `feedback.browser.cjs`의 미가림 검사를 함께 본다.
- `gpt-render-main.js`는 ChatGPT 페이지 전역 `requestAnimationFrame`을 감싸므로 표시(`data-jsl-keep-rendering`)가 켜진 숨은 탭에서만 동작해야 한다.
- 실제 ChatGPT 뒤 탭의 입력·답 판독은 가상 페이지로 대신할 수 없다. 실계정 전송 시험은 사용자 허락 범위에서만 한다.

## 디자인·행동 결정

- 목록에서 작성 중을 우선한다. 제출 완료는 내용에 맞춰 높이를 쓰고 상한을 두어 작성 중 공간을 확보한다.
  제출 완료 카드의 마감일은 숨기고 긴 제목을 말줄임한다.
- 넓은 창의 보드와 좁은 창의 재배치를 함께 고려한다. 현재 기준은 `list-layout.js`와 `list-design.css`다.
  과거 시안의 고정 열 배치·색상·점선 스타일을 최신 구현 위에 다시 덮지 않는다.
- 주황 브랜드와 중립색을 사용하고 상태 구분에는 경계·간격·표시를 함께 쓴다. 현재 토큰과 최근 결정은 SPEC의 날짜가 최신인 절을 확인한다.
- 채팅의 내 메시지는 브랜드 주황, 상대 메시지는 회색 계열로 구분한다. 인용문과 원본 이동 강조는 본문과 구분되어야 한다.
- 내 메시지 항목에서 원래 대화로 이동하면 모아보기는 닫힌다. 창 비활성화만으로 검색 화면을 닫지 않으며 탐색 중이면 탐색만 중단한다.
- 과거 메시지 탐색의 시간/회수 한도나 로딩 정체는 전체 기록의 끝을 뜻하지 않는다. 날짜를 읽을 수 없으면 추정하지 않는다.

## 실행과 검증

Chrome `chrome://extensions`에서 개발자 모드를 켜고 저장소 루트를 압축해제된 확장으로 로드한다.
수정 후 확장을 다시 로드하고 해당 사이트 탭을 새로고침한다. GPT 연동 변경이면 ChatGPT와 자소설 양쪽에 필요하다.
실제 편집 중인 초안이 있는 탭은 새로고침으로 내용을 잃지 않도록 현재 상태를 먼저 확인한다.

저장소 루트에서 실행:

```sh
node --test tests/gpt/protocol.test.cjs tests/gpt/background.test.cjs tests/chat-tools/main.test.cjs
node --test tests/gpt/matching.test.cjs tests/gpt/engine.test.cjs
node --test tests/gpt/feedback.test.cjs tests/gpt/feedback-background.test.cjs
node --test tests/relay/source.test.cjs tests/list-cards/menu.test.cjs
node --test tests/relay/profile.test.cjs
node tests/relay/browser.cjs
node tests/gpt/browser.cjs
node tests/gpt/matching.browser.cjs
node tests/gpt/feedback.browser.cjs
node tests/chat-tools/serve.cjs
git diff --check
```

- 첫 명령은 Node 내장 테스트 러너를 사용한다. GPT 브라우저 테스트에는 `playwright`와 해당 Chromium이 필요하다.
  공용 설치를 사용할 때는 그 환경의 `NODE_PATH`를 설정한다. 개발자 개인 PC 경로를 소스에 고정하지 않는다.
- GPT 브라우저 테스트는 임시 프로필에 실제 확장을 로드하고 두 사이트 HTTPS 요청을 로컬 가상 데이터로 대체한다.
- 채팅 fixture 서버는 출력된 localhost 주소의 `/`가 React, `/angular`가 Angular 재현 화면이다. 고정 포트를 가정하지 않는다.
- 테스트 종료 후 자신이 띄운 서버만 종료한다. 사용자의 기존 Chrome 프로필·탭이나 다른 개발 서버를 정리하지 않는다.
- 자세한 시나리오: [GPT 검증](tests/gpt/README.md), [채팅 도구 검증](tests/chat-tools/README.md),
  [호출 패널 검증](tests/relay/README.md), [목록 카드·공고 링크 검증](tests/list-cards/README.md).

## 검증 기록과 남은 제약

- 2026-09-11 GPT 관련 자동 검사 25개(채팅 회귀 포함)와 로컬 MV3 브라우저 흐름을 통과했다.
  사용자가 적용 후 `자소설에서 확인 ↗`의 실사이트 동작을 확인했다. 다른 창 포커스·예외 경로는
  로컬 검사 결과이며, 서버 저장이나 모든 지원서 조합까지 검증된 것은 아니다.
- 오늘 반영한 UX: 호출/닫기 명칭, 두 줄 문항 미리보기, 구릿빛 워프 호출 버튼, 차콜 복사 패널,
  작성 중 카드의 회색 경계 띠, 기업 채용사이트 링크 복사, GPT 적용 후 대상 탭 이동.
  상세 계약은 SPEC의 각 기능 절, 검증 범위는 각 테스트 README를 기준으로 한다.
- 세션 초 사용자는 문항 전환 후 커서와 당시 복사 바의 정상 동작을 확인했다.
  이후 시각 변경·기업 링크 복사의 모든 경로에 대한 확인으로 확대하지 않는다.
- 사이트 셀렉터, Angular 모델, React 채팅 모듈 식별은 외부 사이트 변경에 영향을 받는다.
- 채팅의 OS Alt+Tab 동작과 fixture의 모의 visibility 이벤트는 서로 다른 검증이다.
- 목록 전체·서버 저장·모든 채팅 경로를 포괄하는 통합 자동 테스트는 없다. 변경한 흐름에 맞는 재현과 검증을 추가한다.
- 다음 작업을 시작할 때에는 위 기록을 재실행 결과처럼 보고하지 않는다. 최신 Git 상태·현재 요청·사용 가능한 브라우저 도구부터 확인한다.

## 문서 갱신 기준

| 문서 | 관리할 내용 |
|---|---|
| [AGENTS.md](AGENTS.md) | 공통 개발 지침과 시작 순서 |
| [CLAUDE.md](CLAUDE.md) | AGENTS.md import만 유지 |
| [README.md](README.md) | 사용자 기능·설치·사용법 |
| [SPEC.md](SPEC.md) | 기능 계약·구체적인 설계와 날짜가 있는 검증 증거 |
| 이 문서 | 현재 개발 진입점·중요한 UX 결정·제약 |
| [PRIVACY.md](PRIVACY.md) | 데이터 처리·권한·보관 범위 |

브랜치 상태·미커밋 목록·로컬 포트·탭 ID·개인 계정 데이터는 이 문서의 고정 컨텍스트로 남기지 않는다.
