const questions = ['현재의 자신을 기술하십시오.', '지원 동기를 작성하십시오.', '관심 분야를 설명하십시오.', '문제를 해결한 경험은?', '추가로 알리고 싶은 내용은?'];
const answers = questions.map((_, i) => '[제목 ' + (i + 1) + ']\n\n  실제 본문 <태그>\t끝\n');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const block = (n, { heading = '문항 ' + n, question = questions[n - 1], answer = answers[n - 1], language = ['', 'css', 'yaml', 'text', ''][n - 1] } = {}) =>
  `<h3>${escape(heading)}</h3>${question ? `<ul><li><strong>문항 원문:</strong> ${escape(question)}</li><li>글자 수 제한: 500자</li><li>선택한 소재: 예시 프로젝트</li><li>작성 전략: 입력에서 제외</li></ul>` : ''}
  <pre class="outer-code"><div class="code-toolbar"><span>${language}</span><button class="code-copy" onclick="window.copied=(window.copied||0)+1">코드 복사</button></div><div><pre class="cm-content"><code class="language-${language}"><span>${escape(answer)}</span></code></pre></div></pre>`;
const full = `<h2>1. 지원 전략 요약</h2><p>지원 전략 설명</p><h2>2. 전체 문항 소재 배치표</h2><table><tr><td>문항 1</td><td>코드가 아닌 소재표</td></tr></table><h1>3. 문항별 검수용 완성본</h1>${[1, 2, 3, 4, 5].map(n => block(n)).join('')}<h2>4. 최종 검수표</h2><table><tr><td>검수 완료</td></tr></table><p>마무리 설명</p><pre><code>자소서가 아닌 설명 코드</code></pre>`;
const turn = (html = full) => `<article><section data-testid="conversation-turn-fixture"><div class="content"><div data-message-author-role="assistant"><div class="markdown">${html}</div></div><button data-testid="copy-turn-action-button">응답 복사</button></div></section></article>`;
const chat = `<!doctype html><html><head><style>body{font-family:Arial;margin:0}article{width:100%}.content{max-width:680px;margin:auto;padding:0 24px}pre{white-space:pre-wrap}code{white-space:pre-wrap}</style></head><body>${turn()}</body></html>`;
function resume(id = 55) {
  return `<!doctype html><html><body><textarea class="answer"></textarea><button onclick="window.saves++">저장하기</button><script>
  window.saves=0; window.model={resume:{id:${id},title:'예시기업 ICT ${id}'},qnas:${JSON.stringify(questions.map((question, i) => ({ id: 91 + i, number: i + 1, question, answer: '기존 ' + (i + 1) })))},
  $apply(fn){fn()},$evalAsync(fn){fn()},qna_change(){},answer_keyup(){}};
  window.angular={element(){return {scope(){return window.model}}}};
  </script></body></html>`;
}
module.exports = { questions, answers, block, full, turn, chat, resume };
