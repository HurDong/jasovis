# 자비스 개발 재개 안내

최종 정리: 2026-09-11. 이 문서는 현재 구현으로 들어가는 안내이며, 작업 상태는 매번 Git과 코드로 확인한다.
확정된 다음 개발 과제는 없다. 아래 제약을 새 작업에 대한 자동 승인으로 해석하지 않는다.

## 서비스와 실행 환경

자비스는 자소설닷컴의 자소서 편집·전형 목록·채팅을 보조하는 비공식 Chrome MV3 확장이다.
ChatGPT 웹의 문항별 응답을 자소설 지원서에 입력하는 기능도 제공한다.
별도 백엔드·OpenAI API·빌드 과정은 없다. 소스와 `manifest.json`이 있는 저장소 루트를 Chrome에 로드한다.
확장 자체 보관 데이터는 `chrome.storage.local`을 사용한다. 사이트 기능은 기존 로그인 상태로 사이트와 통신할 수 있다.

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
| 외부 복사 패널 / 호출 버튼 | `src/features/relay-panel.js`, `relay-source.js`, `src/options/options.html`, `src/core/gpt-background.js`의 `relay:` 경로 |
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
6. 번호/질문 충돌·중복 후보는 수동 선택/제외로 해결한다. 질문 끝의 분량 표기와 연속 공백은 비교 시 정리하지만 답변 원문은 바꾸지 않는다.
7. 입력 직전에 응답 지문·연결 revision·대상 탭/문서·문항·기존 답변을 확인한다. 입력 후 모델을 다시 읽어 반영 여부를 표시한다.

연결 변경은 대상을 바꾸기만 하고 해제는 해당 대화의 연결만 지운다. 둘 다 기존 자소서를 수정/삭제하지 않는다.
연결은 다음 적용에서 대상 선택을 줄이는 편의 기능이며 자동 동기화가 아니다.
저장 버튼은 호출하지 않는다. 모델 입력 확인은 사이트 서버 저장 확인과 다르며, 사이트 입력 훅의 자동 저장 여부는 별도다.

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
node --test tests/relay/source.test.cjs tests/list-cards/menu.test.cjs
node tests/gpt/browser.cjs
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
