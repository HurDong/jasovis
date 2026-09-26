# 우수 답변 목록 안내 검증

`node tests/bank/browser.cjs` (Playwright와 Chrome 필요, 공용 패키지는 `NODE_PATH`로 지정)

실제 bank.js를 가상 편집기와 모의 Chrome storage에서 실행한다.
빈 뱅크·합격 미확인·정상 우수 답변·검색/분류 결과 없음·다른 탭 storage 갱신을 확인한다.
목록 링크 클릭은 요청을 가로채 가상 목록으로 응답하며 새 탭 URL과 기존 초안 보존을 검사한다.
좁은 화면의 링크 접근성도 확인한다. 실계정의 목록 수집·시즌 전환·합격 반영 성공 검증은 아니다.

2026-09-26: 위 가상 Chrome 시나리오 통과. 375px 화면에서 안내·링크 표시를 시각 확인했다.
`node --check src/features/bank.js`, `git diff --check`도 통과했다.

적용 시 확장을 다시 로드하고 작성 중인 초안을 보존한 뒤 자소설 페이지를 새로고침한다.
