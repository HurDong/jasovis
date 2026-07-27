# 자비스 (JASOVIS — 자소설닷컴 비서) — 공유 명세

서비스명: **자비스** ("자소설 비서"의 줄임말). 콘솔 로그 태그는 `[자비스]`.
스토어/공개 표기: **"자비스 for 자소설닷컴"** + 비공식(운영사와 무관) 고지 필수 — 상표 오인 방지.

Chrome MV3 익스텐션. 자소설닷컴 자소서 편집 페이지(`https://jasoseol.com/resume/*`)에
작성 보조 기능을 얹는다. **이 문서가 모든 모듈 간 인터페이스의 단일 기준이다.**

## 검증된 사실 (2026-07-19, 실페이지에서 확인됨)

- 에디터는 **AngularJS 1.4.8**. React/Vue 아님.
- 문항 = `textarea.qna-question`(질문) + `textarea.answer`(답변) 쌍. 문항 수는 가변(1~N).
- Angular 스코프 체인을 올라가면 컨트롤러 스코프에 다음이 있음:
  - `resume`: `{id, user_id, title, created_at, updated_at, employment_id, end_time, submit_page,
    removed_at, category, category_updated_at, trashed_at, employment_company_id,
    employment_duty_group_ids, d_day, recruit_type}` (2026-07-22 실페이지 전체 키 확인됨).
    `employment_company_id`가 그 이력서와 연결된 채용공고(회사 단위) id — 아래 JD 패널 참조.
  - `qnas`: **배열이 아니라 객체** `{"1": qna, "2": qna, ...}`. 각 qna:
    `{id, number, question, answer, total_count, is_character, include_space, count_mode, active, is_autosave, ...}`
  - 컨트롤러 함수: `save`, `switch_qna`, `speller`, `restore_version` 등.
    `switch_qna`는 프로그래매틱 호출이 에러 없이 되지만 **화면 전환이 안 될 수 있음** → DOM 클릭 폴백 필수.
- 주요 DOM 셀렉터:
  - 문항 탭(왼쪽 1/2/3 버튼): `span.qna-number` (텍스트가 문항 번호). 클릭은 이 span 또는 부모에.
  - 맞춤법검사 버튼: `div.function_button.spell` — **`.click()` 호출로 검사 패널이 열리는 것 검증됨.**
    단, 이 버튼은 **토글**이라 패널이 열린 상태에서 누르면 닫힌다. 패널 열림 판정은
    재검사하기 버튼 `span.check-spell-button`의 존재+표시 여부(열려 있을 때만 보임).
    열려 있으면 재검사하기를 클릭할 것. (패널 헤더: `.side-tool-header.spell-header`)
  - 저장 버튼: 텍스트 `저장하기`.
  - 활성 문항의 답변란만 보임. 전체 문항 데이터는 DOM이 아닌 스코프에서 읽을 것.
- `navigator.clipboard.writeText`는 **유저 제스처(클릭/keydown 핸들러) 안에서만 성공.**
- 사이트에 자동저장/저장기록/맞춤법검사/메모 기능이 이미 내장돼 있음. 우리는 그 위의 보조 UI만.
- 사이트 전역 CSS 오염이 심하므로 **모든 주입 UI는 Shadow DOM 안에 렌더**할 것.

## 아키텍처: 두 개의 월드

콘텐츠 스크립트 격리 월드에서는 페이지의 `angular`에 접근 불가. 그래서:

- `src/core/bridge-main.js` — `world: "MAIN"`으로 주입. Angular 스코프를 읽고 액션을 실행.
  격리 월드와 `CustomEvent`로만 통신. **이 파일만 페이지 내부에 접근할 수 있다.**
- `src/core/bridge.js` — 격리 월드. 전역 네임스페이스 `window.JSL`을 정의.
  모든 기능 모듈은 이것만 사용한다. **기능 모듈은 절대 `angular`를 직접 만지지 않는다.**

manifest의 `content_scripts.js` 배열 순서 = 실행 순서: `bridge.js` → 각 feature 파일.
기능 모듈은 로드 즉시 `JSL.register(name, initFn)`을 호출한다.

## JSL API (bridge.js가 제공, 기능 모듈이 소비)

```js
JSL.register(name, initFn)      // initFn()은 브릿지가 페이지와 연결된 후 호출됨
JSL.getState() -> Promise<State | null>   // 스코프 스냅샷 요청 (단발)
JSL.onState(cb)                 // 클릭·입력 직후 State 브로드캐스트 구독. 2초 폴링은 안전망
JSL.action(name, payload) -> Promise<{ok, data?}>
   // 지원 액션: 'switchQna' {number}, 'spellCheck' {}, 'save' {}
JSL.on(event, cb) / JSL.emit(event, payload)   // 격리 월드 내 기능 간 pub/sub
JSL.ui                          // dashboard 기능이 채워 넣는 UI 슬롯 API (아래 참조)
```

### State 스키마

```js
{
  resume: { id, title, end_time, d_day, updated_at },
  qnas: [   // 배열로 변환되어 옴, number 오름차순
    { id, number, question, answer, total_count,
      is_character, include_space, count_mode, active }
  ]
}
```

State가 `null`이면 스코프를 못 찾은 것(페이지 로딩 중이거나 사이트 구조 변경).
**모든 기능은 state null을 조용히 견뎌야 한다** (에러 던지지 말 것).

편집 페이지 상태는 문항 탭 `click`과 답변란 `input` 직후 다음 렌더 프레임에 전송한다.
80ms 뒤 비동기 후처리를 한 번 더 확인하며, 2초 폴링은 이벤트 누락 안전망으로만 둔다.
직전 상태와 `JSON.stringify` 결과가 같으면 전송하지 않아 불필요한 패널 재렌더를 막는다.

### 기능 간 pub/sub 이벤트 (JSL.on / JSL.emit)

- `'copy:qna'` payload `{number}` — 해당 문항 평문 복사 실행 (copy 기능이 구독)
- `'copy:full'` — 전체 프롬프트 모드 복사 실행 (copy 기능이 구독)
- `'toast'` payload `{message, sub, kind, items, title, duration}` — 알림 표시 (dashboard가 구독/렌더)
  - **위치: 화면 우하단 고정**(`right:20px / bottom:20px`, 위로 쌓임). 위젯 shadow가 아니라
    body에 붙는 별도 호스트(`#jsl-toasts`)에 그린다 — 위젯 호스트에 `transform`이 걸려 있어서
    그 안의 `position:fixed`는 뷰포트가 아니라 위젯 박스 기준으로 잡히기 때문. URL이 자소서
    상세를 벗어나면 위젯과 함께 숨긴다.
  - `kind`: `'info'`(크림+주황 테두리) / `'ok'`(주황 채움+흰 글자) / `'fail'`(흰 바탕+빨강) / `'help'`
    — 색만으로 구분하지 않고 아이콘(i / 체크 / 엑스)이 함께 바뀐다.
    **초록은 쓰지 않는다** — 강조는 색을 추가하는 게 아니라 주황의 농도/반전으로만 만든다.
  - `sub`: 본문 아래 한 단계 작은 보조 줄 (예: `'616자 (공백 제외)'`).
  - `kind:'help'`: `items`를 키캡 목록으로 렌더. `{keys, desc}`는 한 행, `{group}`은 구분 헤더 한 줄.
    자동소멸 없이 클릭·Esc·재호출로 닫힌다 (Esc는 capture에서 전파를 끊어 checkpoint의 Esc와 겹치지 않게).
    `keys` 표기에서 `+`는 동시 누르기, **공백을 두른 ` / `** 는 대안 키로 갈라져 각각 키캡이 된다
    (`'Tab / Shift+Tab'`). 공백 없는 슬래시는 키 이름 그대로다 — `'Alt+/'`는 `[Alt]+[/]`.
  - 같은 `kind|message|sub`가 연달아 오면 새로 쌓지 않고 기존 토스트를 bump + 타이머 리셋. 최대 3개.
  - `duration`(ms, 기본 3200) 동안 바닥의 얇은 바가 줄어들며 남은 시간을 보여준다.

### JSL.ui (dashboard가 구현하는 계약)

```js
JSL.ui.ready -> Promise<void>        // 대시보드 렌더 완료 시 resolve
JSL.ui.addAction(labelHTML, onClick, opts?) // 공용 버튼 추가, 버튼 엘리먼트 반환
//   opts {slot:'footer'|'header', variant:'primary'|'toggle'} — 생략 시 하단 기본 버튼.
//   'header'는 헤더 우측 소형 아이콘 버튼. 'toggle'은 on/off 표시를 호출측이 버튼에
//   .on 클래스를 토글해서 제어한다 (액션줄=라벨+스위치형, header 슬롯과 함께 쓰면
//   아이콘 색상만 바뀌는 소형 토글 — 둘 다 스타일은 dashboard 소유).
JSL.ui.addQnaAction(number, labelHTML, onClick) // 문항 카드 우측 풀하이트 복사 버튼
JSL.ui.setWarning(number, text|null) // 문항 행에 경고 문구 표시/해제 (예: "48자 초과")
```

dashboard가 없거나 5초 내 ready 안 되면, 다른 기능은 UI 추가를 포기하고
기능 자체(단축키/자동검사)는 계속 동작해야 한다.

### 답변 뱅크 문항 분류

분류 근거는 **문항 질문 텍스트만**이며, 답변 본문은 사용하지 않는다. 하나의 문항에
여러 의도가 있으면 복수 태그를 허용한다. 태그는 `지원동기·기업적합`,
`직무역량·전문성`, `입사 후 포부`, `가치관·조직적합`, `협업·조직문화`,
`성장과정·자기이해`, `강점·보완점`, `문제해결·도전`, `성취·실패`, `자유양식`,
`기타`다. 예를 들어 `입사 후 직무수행계획`은 지원동기가 아니라 `입사 후 포부`다.

편집 페이지의 답변 뱅크는 페이지 내부 플로팅 패널로 연다. 카테고리는 접이식 필터로
제공하고, `전체/현재 문항/즐겨찾기/최근 복사` 보기와 카드 펼치기를 지원한다. 현재 문항
보기는 활성 문항과 태그가 겹치는 다른 답변을 우선 노출한다. 패널을 열 때 활성 문항에
유효한 태그가 있으면 해당 태그를 상단에 표시하고 `현재 문항` 보기로 자동 진입한다.
즐겨찾기·최근 복사 시각은
답변 본문과 분리된 `jslAnswerBankMeta`에 저장한다. 패널 위치와 크기는 기억하며,
`Esc`로 닫고 `/`로 검색창에 포커스한다.

## 파일 소유권 (병렬 작업 충돌 방지 — 자기 파일만 수정할 것)

| 파일 | 소유 |
|---|---|
| `manifest.json`, `SPEC.md`, `src/core/bridge-main.js`, `src/core/bridge.js` | 코어(작성 완료, 수정 금지) |
| `src/features/dashboard.js` | Agent A |
| `src/features/copy.js` | Agent B |
| `src/features/spellcheck.js` | Agent C |
| `src/features/hotkeys.js` | Agent D |
| `src/features/bank.js`, `src/popup/popup.html`, `src/popup/popup.js` | Agent E |
| `src/features/jd-panel.js` | (완료) |
| `src/features/chat-jd.js` | (완료) |
| `src/features/checkpoint.js` | (완료) |
| `src/features/qna-nav.js` | **제거됨** — manifest에서 내렸다. 파일만 남아 있고 로드되지 않는다.
  문항 이동은 대시보드 카드 클릭과 `Alt+숫자` 단축키로 대체. |

manifest.json에 위 파일이 모두 이미 등록돼 있다. 파일이 비어 있으면 안 되므로
각 파일에는 최소 스텁이 들어 있다 — 스텁을 자기 구현으로 교체하면 된다.

## 확정 키맵 (hotkeys 기능)

| 키 | 동작 | 비고 |
|---|---|---|
| `Alt+1`..`Alt+9` | 문항 전환 | Ctrl+숫자는 크롬 탭 전환이라 가로채기 불가 |
| `Alt+C` | 현재 활성 문항 평문 복사 | `JSL.emit('copy:qna', {number: 활성번호})` |
| `Alt+Shift+C` | 전체 프롬프트 복사 | `JSL.emit('copy:full')` |
| `F7` | 맞춤법검사 | `JSL.action('spellCheck')` |
| `Ctrl+S` | 저장 | `preventDefault()` 필수 (크롬 페이지저장 차단) |
| `Tab` / `Shift+Tab` | 검수 하이라이트를 다음/이전 문장으로 | **답변 textarea 안에서만** — checkpoint가 처리 |
| `Alt+↓` / `Alt+↑` | 위와 동일 (별칭) | Tab의 기본 포커스 이동을 지키고 싶을 때 |
| `Esc` | 답변란 포커스 해제 | Tab을 가로챈 대신 남긴 탈출구 (preventDefault 안 함) |

문장 이동 키는 hotkeys가 아니라 `checkpoint.js`가 답변 textarea에 직접 keydown을
붙여서 처리한다 (다른 입력칸의 Tab 포커스 이동은 그대로 둬야 하므로 document
capture로 잡지 않는다). 하이라이트는 캐럿이 속한 문장을 따라가므로, 이동은
`setSelectionRange`로 캐럿을 다음 문장 첫 글자에 놓는 것으로 끝난다. 처음·끝
문장에서는 아무 일도 하지 않는다.

keydown은 capture 단계(`addEventListener(..., true)`)로 document에 등록
(textarea 포커스 중에도 동작해야 함). IME 조합 중(`e.isComposing`)이면 무시.

## 글자수 규칙 (dashboard, copy, spellcheck 공용)

- 공백 포함 글자수: `answer.length`
- 공백 제외: `answer.replace(/\s/g, '').length`
- 바이트: `new Blob([answer]).size` (UTF-8)
- 제한: `qna.total_count` (0이거나 없으면 제한 없음으로 취급)
- `include_space`가 false면 제한 비교는 공백 제외 기준으로.

## 자소서 목록 페이지 (`/resume_list`) — 2026-07-19 실페이지 검증

편집 페이지와 별개의 AngularJS 화면(칸반 보드). 전용 모듈:
`src/core/list-main.js`(MAIN 월드) + `src/features/list-progress.js`, `list-stats.js`.

- 컨트롤러 스코프 진입점: `[ng-repeat="category_area in column.list"]` 엘리먼트에서
  프로토타입 체인을 올라가 `resumesInCurrentSeason`(현재 시즌 자소서 배열)을 찾는다.
- 각 resume: `{id, name, category, end_time, qnas[](답변 포함), ...}` — 목록인데도 qnas 전문이 포함됨.
- **카테고리 숫자 코드**: 0 작성중 / 1 제출완료 / 10 미제출 / 2,3 서류 합·불 /
  6,7 1차 합·불 / 8,9 2차 합·불 / 4,5 최종 합·불 / 100 AI마스터자소서.
  카드의 현재 카테고리 = 그 지원건이 도달한 가장 먼 단계 (뒤 단계 카드는 앞 단계를 통과한 것).
- 카드 DOM: `li.resume-node[resume_node_id="<id>"]`, 내부 `.name`, `.d-day`, `.date`.
  카드 이동은 드래그(`div.dropzone`). **카드 리스트는 수시로 재렌더되어 주입 노드가 사라진다**
  → 오버레이는 onState 주기 + MutationObserver로 재적용할 것.
- 목록 state 스키마: `{ page:'list', resumes:[{id, category, qnaTotal, qnaFilled}] }`
  (편집 페이지 state와 `page` 필드로 구분)

### 통계 산정식 (list-stats)

각 단계 분모는 "그 단계 결과가 나온 카드"만. afterX = 그 단계 뒤로 넘어간 모든 카드.
- 서류 통과율 = (2 + after서류) / (2 + 3 + after서류), after서류 = 6+7+8+9+4+5
- 1차 통과율 = (6 + after1차) / (6 + 7 + after1차), after1차 = 8+9+4+5
- 2차 통과율 = (8 + after2차) / (8 + 9 + after2차), after2차 = 4+5
- 최종 합격 = 4 / (4+5), 발표 대기 = 1, 지원 = 1+2+3+6+7+8+9+4+5
- 분모 5 미만이면 %대신 분수로 표기 (표본 부족 시 수치 요동 방지)

### 진행률 표시 (list-progress) — 디자인 I-1a, 2026-07-26

- 대상: category === 0 (작성 중)만. 미제출(10) 제외(사용자 결정). `qnaTotal === 0`이면 미표시.
- **폐기된 옛 방식**: 카드 하단부터 비율만큼 차오르는 주황 그라데이션 + 우상단 알약 뱃지.
  채움 높이가 카드 높이에 비례해서 **카드마다 눈금이 달라 나란히 놓으면 비교가 성립하지 않았다**
  (면적 인코딩 + 가변 기준선). 반투명 틴트라 스켈레톤처럼도 보였다. 다시 쓰지 말 것.
- **현재**: 모든 카드에서 같은 자리·같은 크기인 고정 눈금 2개.
  - **좌측 타일** (`.jsl-tile`, 46px 고정폭, 카드 높이 전체): 큰 분자(21px/700) + 분모(11.5px).
    카드 `padding-left`에 46px, `padding-bottom`에 5px를 **1회만** 더해 본문을 밀어낸다
    (`data-jsl-inset` 플래그로 재적용 시 누적 방지 / unpaint 시 복원).
  - **밑변 세그먼트** (`.jsl-seg`, 타일 우측~카드 우변, 높이 4px): 한 칸 = 한 문항.
    문항이 20개를 넘으면 칸=문항 대응이 깨지므로 20칸에 비율로 근사(숫자는 실제값 유지).
- 상태 3단 (`.jsl-t0/1/2`) — **색 + 칸 수 + 숫자 3중 인코딩** (color-not-only):
  - `t0` 미작성(filled 0): 무채 `#f2f0e9` / 숫자 `#6b6a63`
  - `t1` 작성 중: 연주황 `#fff1e6` / 숫자 `#c74f00`
  - `t2` 전 문항 채움: 주황 반전 `#f26200` / 숫자 흰색
- **초록(완료색)을 쓰지 말 것**: 사이트 테마가 주황 단색이고, 이 카드들은 전부 제출 전이라
  문항을 다 채워도 '완료'가 아니다. 빨강은 사이트 자체의 D-day 긴급 배지 색이라 건드리지 않는다.

#### 갱신 경로 — 폴링 금지, 변화 시점에 당겨온다 (2026-07-26 실페이지 측정)

`JSL.onState`(2초 브로드캐스트)만 기다리면 드래그·새로고침 반응이 최대 2초 늦다.
실측: 유휴 상태에서 `JSL_STATE`가 **7초에 1회**만 도착(백그라운드 탭 타이머 스로틀).
그리기 자체는 병목이 아니다 — 카드 145장 순회 0.1ms, `getComputedStyle` 145회 0.2ms.

- MutationObserver 감지 → **60ms 디바운스 후 `JSL.getState()`로 직접 조회**. 왕복 0.2~0.6ms 실측.
  총 지연 약 60ms. `onState`는 안전망으로만 남긴다.
- 연속 변경(드래그 중) 대비: 진행 중 요청에 합류(`pulling`) + 요청 간 하한 250ms(`MIN_GAP`).
  변경 30회 연속 발생 시 조회 2회로 합쳐지는 것 확인.
- **`applyAll` 끝에서 `mo.takeRecords()`로 자기 유발 변경 기록을 버린다.** 안 버리면 주입이
  스스로를 다시 트리거한다.
- `visibilitychange` → visible 시 즉시 조회(백그라운드에서 낡은 상태로 복귀하는 것 방지).
- 초기 진입 시 첫 브로드캐스트를 기다리지 않고 즉시 조회, 스코프가 없으면 500ms 간격 재시도(최대 6초).
- `getComputedStyle`은 카드당 최초 페인트 1회만(`reserveSpace`). 읽기/쓰기를 섞으면
  카드 수만큼 강제 리플로우가 난다.

## 채용공고 JD 패널 (`src/features/jd-panel.js`) — 2026-07-22 실페이지 검증

편집 페이지 왼쪽 여백에 뜨는 위젯. 이력서와 연결된 채용공고 정보를 보여준다.
(자소설닷컴 편집 화면 우상단의 "채용공고" 버튼은 **이 공고와 무관하게 지원자 채팅방을 여는
버튼**이었다 — 실제 JD와는 다른 기능이니 헷갈리지 말 것.)

- **디자인 의도**: 카드/모달처럼 보이지 않게 배경·테두리·그림자가 있는 컨테이너를 두지 않는다.
  이미지/텍스트를 화면 왼쪽 위에 그냥 놓아 페이지 여백의 일부처럼 보이게 한다(사용자 요청:
  "뒷배경처럼"). 지원자수·조회수 등 부가 메타는 자리만 차지한다는 피드백으로 전부 뺐다 —
  이미지형이면 이미지만, 텍스트형이면 제목+본문만 보여준다.
- **접기 버튼은 접힘·펼침 모두 화면 왼쪽 끝(`left:0`)에 고정된 주황 세로 손잡이**
  (28×100px, 오른쪽만 둥근 모서리). 자리는 상태와 무관하게 안 움직이고 안의 내용만
  바뀐다 — 접힘은 `사진 아이콘 + "공고" + ›`, 펼침은 `‹ + "접기"`. 라벨은
  `writing-mode:vertical-rl` 세로쓰기. 펼친 이미지는 손잡이를 덮지 않도록
  `PANEL_LEFT`(=손잡이 폭+6)에서 시작한다.
  **위치 결정 이력** (같은 실수 반복 방지):
  - 처음엔 작은 흰 원형 버튼이었는데 접힌 상태에서 **버튼의 존재 자체를 못 알아채고
    "공고가 안 뜬다"고 오해**했다. → 접힘을 눈에 띄는 주황 손잡이로.
  - 펼침을 문항 탭 위 흰 알약("접기")으로 뒀더니, **알약이 탭보다 가로로 넓어서 오른쪽
    자소서 카드의 제목 줄을 파고들었다.** 탭 위 세로 여백은 있어도 가로가 탭 폭뿐이다.
  - 탭 **아래**로 옮기는 안도 검토했지만 그 자리는 사이트의 문항 추가/삭제 버튼
    (`add_qna()` / `removeMode()`, `li.add-qna` / `li.remove-qna`)이 이미 쓰고 있어 역시 겹친다.
  - 결론: 사이트 UI가 전혀 없는 **화면 왼쪽 끝**에 두 상태를 다 고정하면 겹침이
    구조적으로 불가능하다. 그래서 여기로 정했다.
  - 과거 버그: 탭 기준 `toggleTop`을 이미지의 `top`과 `Math.min`으로 클램프해서 버튼이
    이미지 모서리와 겹쳐 보였던 일이 있다. 지금은 탭 기준 계산 자체를 안 쓴다.
  아이콘은 유니코드 화살표(⌄, 폰트마다 굵기·크기가 들쭉날쭉) 대신 인라인 SVG.
  드래그 이동 기능은 없다 — 위치가 고정이라 필요성이 없음.
- **위치/크기는 고정값이 아니라 매번 실측**: 상단바 `.gnb`뿐 아니라 그 아래 두 번째 툴바
  `.function_bar`(맞춤법검사/저장기록/메모장/친구첨삭/자소서 전문 첨삭 받기 줄)까지 같이
  봐야 한다 — `.gnb`만 보고 좌표를 잡았다가 `.function_bar`를 가리는 걸 실페이지에서
  확인함. 왼쪽 문항 탭 `span.qna-number`와 `.resume-editor-wrapper`의 실제 `left`도 읽어서
  그 사이 빈 여백에만 정확히 들어가도록 top/left/width를 계산한다(`computeBounds()`).
  창 크기·줌 배율마다 여백 크기가 달라서 고정 px/vw 값으로는 툴바를 침범하거나 폭이 안
  맞았음. `resize` 이벤트 + 500ms 폴링(페이지 이탈 감지 루프에 합침)으로 재계산한다.
  (참고: 이 페이지 자체는 문서 스크롤이 없다 — `document.documentElement.scrollHeight`가
  `innerHeight`와 같음. 내부 콘텐츠만 개별 스크롤되는 구조라 패널을 `position:fixed`로 둬도
  "페이지와 같이 스크롤 안 됨" 문제가 생기지 않는다.)
- **"카드처럼 안 보이게" 튜닝**: 흰 배경/테두리/그림자/둥근모서리/hover 확대 다 뺐다. 이미지
  자체 스크롤(포스터가 화면보다 길 때)은 필요해서 남기되 스크롤바만 숨겼다
  (`scrollbar-width:none` + 웹킷 `::-webkit-scrollbar{display:none}`, 휠/드래그 스크롤은
  그대로 동작). 접기 버튼도 반투명 유리효과 대신 존재감을 최소화한 흰 원형 버튼으로.

- 연결고리: `resume.employment_company_id` (Angular 스코프, bridge-main.js가 snapshot에 포함).
- 조회: `GET /api/v1/employment_companies/:id?skip_read_log=true` — jasoseol.com 동일 출처라
  별도 권한/인증 불필요, 쿠키 자동 포함. 응답에 `title, end_time, view_count, resumes_count,
  employments[].field(모집부문명), content` 등이 있음.
- **`content`는 회사가 올린 원문 HTML 조각인데, 실페이지 확인 결과 상당수가 `<img>` 태그
  하나뿐인 "포스터 이미지형" 공고였다** (태그를 걷어내면 순수 텍스트 0자). 즉 담당업무·자격요건
  같은 JD 본문이 텍스트로 안 잡히는 공고가 흔하다 — DOM/OCR 없이는 그 이미지 안의 텍스트를
  가져올 방법이 없음. 그래서 `content`를 태그 제거한 순수 텍스트 길이로 텍스트형/이미지형을
  판별해서, 텍스트형이면 본문을, 이미지형이면 `<img src>`를 뽑아 크게 보여준다. 이미지 클릭 시
  이미지 파일 자체가 아니라 `employment_page_url`(회사 자체 채용 사이트, "채용 사이트" 버튼과
  동일 링크)로 새 탭 이동한다 — 이미지 URL로 바로 이동하면 브라우저가 다운로드로 처리해버림.
- fetch는 `employment_company_id`가 바뀔 때만 한다 (state는 타이핑마다 오므로 매번 재조회하면 안 됨).

## 채팅방 → 그 회사 공고 모달 (`src/features/chat-jd.js`) — 2026-07-27 실계정 검증

오른쪽 채팅 패널에서 **다른 회사(B사) 채팅방**을 열면 헤더 아래에 주황 버튼 줄이 생기고,
누르면 그 회사의 공고 목록이 화면 가운데 모달로 뜬다. 자소서 쓰던 페이지를 안 벗어나는 게 목적.

- **채팅 UI가 두 개다.** 이걸 놓쳐서 "어떤 방에서는 버튼이 아예 안 뜬다"는 버그가 났었다.
  둘 다 `div.chat-ctrl` 안에 들어 있고, 상황에 따라 한쪽만 보인다.
  | | A. React 채팅 | B. 페이지 내 Angular 채팅 |
  |---|---|---|
  | 뿌리 | `iframe[src*="chat-slide"]`의 `contentDocument` | `.chat-container.chat-window` 엘리먼트 |
  | 언제 | 상단바 채팅 버튼으로 열 때 | **자소서 페이지에서 사이트가 스스로 "이 기업 방"을 띄울 때** |
  | 헤더 블록 | `.sticky` | `.chat-window-head` |
  | 헤더 줄 | `h-[52px]` div | `.chat-info-wrapper` (52px) |
  | 뒤로/닫기 | `aria-label`에 back | `.close-chat` |
  **회사명 앵커 `a[href^="/companies/:id"]`는 양쪽에 똑같이 있다** — 그래서 뿌리만 일반화하면
  나머지 로직은 공유된다. iframe은 같은 출처라 `contentDocument`로 그냥 읽힌다
  (`all_frames`도, 추가 권한도 불필요).
- **"보이는 창" 판정을 크기로만 하면 안 된다.** 사이트가 채팅을 감추는 방식이 둘 다 다르다:
  - A는 iframe을 `display:none` + 0x0으로 만든다.
  - B는 **크기를 그대로 둔 채 패널을 화면 오른쪽 밖으로 밀어낸다**
    (실측: 열림 `left=2200` / 닫힘 `left=2560`, `innerWidth=2560`. `.chat-ctrl`의 `open-chat` 클래스가 토글된다).
  그래서 크기 + **뷰포트 교차**를 같이 본다. `offsetParent`는 `position:fixed`에서 null이라 못 쓴다.
- **숨은 창도 마지막으로 보던 방의 회사 앵커를 그대로 들고 있다.** 그래서 `querySelector`로
  창 하나만 집으면 "숨은 창에 버튼을 꽂아놓고 정작 보이는 창엔 아무것도 안 뜨는" 상태가 된다
  (실제로 보고된 증상). 보이는 창을 **전부** 찾아 각각 버튼 줄을 관리해야 한다.
- **열린 채팅방의 회사 식별**: 방 헤더의 회사명이 앵커다. `a[href^="/companies/:id"]`의
  `:id`가 곧 `company_group_id`. 실측: `/companies/269` = 현대오토에버, `/companies/4155` = 유진투자선물.
  방 목록 화면이나 회사 방이 아닌 채팅(전체·직무별·인사담당자)에는 이 앵커가 **없다** →
  버튼 줄을 자동으로 숨기는 판정에 그대로 쓴다.
  (백업 경로: `GET /api/v1/chats`의 항목 중 `type_number === 2`인 것이 회사 방이고 그 `type_id`가
  company_group_id다. 포스코 `type_id:14` ↔ `company_groups/14` 일치 확인. 지금은 앵커만 쓴다.)
- **회사 → 공고 전체**: `GET /api/v1/company_groups/:id/employment_companies`
  마감된 공고까지 전부 온다(현대오토에버 20건, 진행 중 0건). 각 항목에 `employments[]`가
  들어 있어 모집부문 조회를 위한 추가 요청이 필요 없다.
- **"내가 쓴 공고" 매칭**: `GET /api/v1/resumes`(내 자소서 전체, 270건).
  **연결 키는 `employment_company_id`가 아니라 `resume.employment_id`다** — 자소서는 공고가 아니라
  그 안의 모집부문에 매여 있다. `employments[].id` → 공고 id 역인덱스를 만들어 맞춘다.
  `/api/v1/resumes` 응답에는 `employment_company_id`가 아예 없으니 이 경로 말고는 방법이 없다.
  실측: 현대오토에버 5건, 앰코테크놀로지코리아 2건 정확히 매칭됨.
- **공고 본문**: `GET /api/v1/employment_companies/:id?skip_read_log=true` — JD 패널이 쓰는 그 API.
  텍스트형/포스터 이미지형 판별 규칙도 jd-panel과 동일(태그 걷어낸 순수 텍스트 15자 미만이면 이미지형).
- 통계 칩은 SPEC의 카테고리 코드를 그대로 쓴다. "서류 통과"는 `category === 2`뿐 아니라
  그 뒤 단계로 넘어간 카드(6,7,8,9,4,5)를 모두 포함한다 — 위 통계 산정식과 같은 정의.

### 구현상 주의

- **React가 우리 노드를 수시로 날린다.** 창마다 MutationObserver(120ms 디바운스)를 따로 걸어
  다시 꽂고, `mo.takeRecords()`로 자기 유발 변경을 버린다(list-progress와 같은 패턴).
  창의 등장·교체·가시성 변화는 옵저버로 안 잡히므로 500ms 폴링 + `resize`로 잡는다.
  헤더 줄 엘리먼트는 리렌더마다 새 노드로 갈리므로 **삽입 기준점은 매번 새로 찾는다**
  (캐시해 두면 엉뚱한 자리에 꽂힌다).
- **버튼 줄은 헤더 안이 아니라 헤더 줄 바로 아래**에 넣는다. 헤더는
  `flex ... justify-between` 한 줄에 회사명(≈239px)+아이콘 2개가 이미 335px를 다 쓰고 있어서
  안에 끼우면 라벨이 잘린다. 삽입 기준점은 `a.closest('.sticky')`의 직계 자식 중 앵커를 품은 줄.
- **모달은 iframe이 아니라 최상위 문서에** 그린다. iframe 안에 그리면 채팅 패널 폭(≈358px)에
  갇혀 포스터를 크게 볼 수 없다. `z-index: 2147483647`.
- **Esc는 두 문서 모두에 걸어야 한다.** 포커스가 채팅 iframe 안에 있으면 keydown이
  최상위 문서로 오지 않는다.
- 모달 패널은 `height` 고정이 아니라 `max-height`. 고정하면 공고가 3개뿐인 회사에서 아래가 텅 빈다.
- 조회는 전부 캐시한다: 내 자소서 1회, 회사별 공고 목록 1회, 공고 상세 1회.

## 공통 원칙

- **읽기 전용**: 스코프의 answer/question을 절대 수정하지 않는다. 쓰기는 사이트 자체
  버튼 클릭 위임만 (`spellCheck`, `save`).
- 사이트 구조 변경으로 스코프/셀렉터를 못 찾으면: 콘솔 경고 1회 + 기능 비활성. 예외 전파 금지.
- 외부 네트워크 전송 금지(제3자 서버로 데이터 전송 금지라는 뜻). jasoseol.com 자체 API를
  동일 출처에서 조회하는 것(JD 패널의 `employment_companies` 조회 등)은 예외 — 사용자 데이터를
  어디로 보내는 게 아니라 사이트가 이미 공개 제공하는 정보를 읽어오는 것뿐이다.
- 저장은 `chrome.storage.local`만.
- 코드는 바닐라 JS (빌드 없음, `chrome://extensions` 개발자 모드 로드). 주석과 UI 문구는 한국어.
