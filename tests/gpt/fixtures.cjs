const detailedPairs = [
  ['지원한 분야에서 배운 역량을 구체적인 경험과 연결하고 앞으로의 성장 계획을 서술해주세요.', '본인의 역량(지식/기술 등), 조직에 보탤 점, 성장 계획(학습 계획, 최종 목표 등)을 포함하여 기술', '본인의 역량, 조직에 보탤 점, 성장 계획을 포함하여 기술'],
  ['기존과 다른 접근으로 어려운 문제를 끝까지 해결했던 경험과 결과를 구체적으로 서술해주세요.', '발생한 문제, 새로운 접근, 개선된 결과를 포함하여 기술', '발생한 문제, 새로운 접근, 개선된 결과를 포함하여 기술'],
  ['다른 사람의 협력을 이끌어 공동의 목표를 달성했던 경험과 본인의 기여를 구체적으로 서술해주세요.', '공동 목표, 함께 했던 사람들, 본인 역할(리더/팔로워), 결과를 포함하여 기술', '공동 목표, 함께했던 사람들, 본인 역할, 결과를 포함하여 기술']
].map(([main, original, summary]) => ({ source: main + '(' + original + ') (최소 700 ~ 최대 1,000)', response: main.replace('해주세요', '해 주세요') + ' ' + summary }));
const questions = ['현재의 자신을 기술하십시오.', '지원 동기를 작성하십시오.', '관심 분야를 설명하십시오.', '문제를 해결한 경험은?', '추가로 알리고 싶은 내용은?'];
if (process.env.JSL_GPT_DETAILED === '1') detailedPairs.forEach((pair, i) => { questions[i] = pair.response; });
const answers = questions.map((_, i) => '[제목 ' + (i + 1) + ']\n\n  실제 본문 <태그>\t끝\n');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const block = (n, { heading = '문항 ' + n, question = questions[n - 1], answer = answers[n - 1], language = ['', 'css', 'yaml', 'text', ''][n - 1] } = {}) =>
  `<h3>${escape(heading)}</h3>${question ? `<ul><li><strong>문항 원문:</strong> ${escape(question)}</li><li>글자 수 제한: 500자</li><li>선택한 소재: 예시 프로젝트</li><li>작성 전략: 입력에서 제외</li></ul>` : ''}
  <pre class="outer-code"><div class="code-toolbar"><span>${language}</span><button class="code-copy" onclick="window.copied=(window.copied||0)+1">코드 복사</button></div><div><pre class="cm-content"><code class="language-${language}"><span>${escape(answer)}</span></code></pre></div></pre>`;
const full = `<h2>1. 지원 전략 요약</h2><p>지원 전략 설명</p><h2>2. 전체 문항 소재 배치표</h2><table><tr><td>문항 1</td><td>코드가 아닌 소재표</td></tr></table><h1>3. 문항별 검수용 완성본</h1>${[1, 2, 3, 4, 5].map(n => block(n)).join('')}<h2>4. 최종 검수표</h2><table><tr><td>검수 완료</td></tr></table><p>마무리 설명</p><pre><code>자소서가 아닌 설명 코드</code></pre>`;
const turn = (html = full) => `<article><section data-testid="conversation-turn-fixture"><div class="content"><div data-message-author-role="assistant"><div class="markdown">${html}</div></div><button data-testid="copy-turn-action-button">응답 복사</button></div></section></article>`;
const chat = `<!doctype html><html><head><style>body{font-family:Arial;margin:0}article{width:100%}.content{max-width:680px;margin:auto;padding:0 24px}pre{white-space:pre-wrap}code{white-space:pre-wrap}</style></head><body>${turn()}</body></html>`;
function resume(id = 55, numbered = false, qnas = null) {
  return `<!doctype html><html><body><textarea class="answer"></textarea><button onclick="window.saves++">저장하기</button><script>
  window.saves=0; window.model={resume:{id:${id},title:'예시기업 ICT ${id}'},qnas:${JSON.stringify(qnas || questions.map((question, i) => ({ id: 91 + i, number: i + 1, question: (numbered ? (i + 1) + '. ' : '') + (process.env.JSL_GPT_DETAILED === '1' && detailedPairs[i] ? detailedPairs[i].source : question), answer: '기존 ' + (i + 1) })))},
  currentQnaIndex:0,switch_qna(number){this.currentQnaIndex=number-1;document.querySelector('textarea').value=this.qnas[number-1].answer;},
  $apply(fn){fn()},$evalAsync(fn){fn()},qna_change(){},answer_keyup(){}};
  window.angular={element(){return {scope(){return window.model}}}};
  </script></body></html>`;
}
// 복합 번호·안내 생략 구조만 재현한 가상 공고. 개인 지원서와 답변을 보관하지 않는다.
const compoundPairs = [
  ['1-1', '예시기업을 선택한 이유를 본인의 경험과 연결하여 서술하시오.', '회사를 선택하는 기준도 설명해주세요.'],
  ['1-2', '입사 후 성장하고 싶은 전문 분야와 목표를 서술하시오.', ''],
  ['2-1', '해당 직무를 수행할 때 필요한 핵심 역량은 무엇입니까?', '두 가지까지 키워드로 작성해주세요.'],
  ['2-2', '위 역량을 키운 활동의 내용과 수행 기간을 구체적으로 기술하시오.', '학습과 프로젝트 등을 포함해주세요. **구체적인 연도는 제외하고 기간만 작성해주세요.'],
  ['2-3', '현재 부족한 역량과 이를 보완할 계획을 구체적으로 서술하시오.', ''],
  ['3-1', '일상에서 가장 중요하게 생각하는 가치와 기준은 무엇입니까?', '키워드를 중심으로 작성해주세요.'],
  ['3-2', '위 가치를 중요하게 생각하게 된 계기와 실천 사례를 서술하시오.', ''],
  ['4-1', '기존 방식의 한계를 발견하고 변화를 시도한 경험은 무엇입니까?', '경험의 핵심을 짧게 작성해주세요.'],
  ['4-2', '그 변화가 필요했던 배경과 본인이 수행한 행동을 기술하시오.', ''],
  ['4-3', '변화를 시도한 경험에서 얻은 교훈과 배운 점을 서술하시오.', ''],
  ['5-1', '가장 오랫동안 몰입했던 활동과 그 주제는 무엇입니까?', '학습과 취미 모두 가능합니다. **[문항2-2]의 답변과 중복은 제외해주세요.'],
  ['5-2', '몰입한 활동의 진행 과정과 구체적인 결과를 기술하시오.', ''],
  ['5-3', '그 활동이 이후 생활과 행동에 준 영향을 구체적으로 서술하시오.', '']
].map(([label, main, guide], i) => ({ label, main, source: '[문항' + label + '] ' + main + (guide ? ' *' + guide : ''),
  response: main + ([0, 5].includes(i) ? ' ' + guide : ''), answer: '[가상 답변 ' + label + ']\n\n  공백과 줄바꿈을 보존합니다.\t끝\n' }));
const compoundQnas = compoundPairs.map((p, i) => ({ id: 201 + i, number: i + 1, question: p.source, answer: '기존 ' + (i + 1) }));
const wrappedPairs = [
  ['학습이나 업무 과정에서 어려움을 해결한 경험과 배운 점을 기술해주세요.', '\r\n\u00a0\u00a0( ※ 수행한 활동 / 본인 역할 / 결과와 교훈을 구체적으로 설명해주세요. )'],
  ['지원 직무를 이해한 내용과 본인이 적합한 이유를 역량과 연결하여 기술해 주세요.', '     ( ※ 관련 지식(개발언어, 자격 등), 경험과 경쟁력을 기술해 주세요)'],
  ['예시기업의 가치 중 하나를 선택하고 본인의 강점과 연결하여 기술해 주세요.', ' ( ※ 회사 채용 홈페이지 참조 : 기업문화 >> 가치 )'],
  ['지원 동기와 앞으로 이루고 싶은 목표 및 준비 계획을 기술해 주세요.', '']
].map(([main, guide], i) => ({ source: main + guide + ' (최소 500자, 최대 700자 입력가능)',
  response: main.replace('기술해주세요', '기술해 주세요'), answer: '괄호 안내 가상 답변 ' + (i + 1) + '\n' }));
const wrappedQnas = wrappedPairs.map((p, i) => ({ id: 301 + i, number: i + 1, question: p.source, answer: '기존 ' + (i + 1) }));
module.exports = { questions, answers, block, full, turn, chat, resume, detailedPairs, compoundPairs, compoundQnas, wrappedPairs, wrappedQnas };
// 한 본 질문에 분량 언어와 안내 표시가 달라도 같은 입력 대상을 가리키는 사례.
const languagePairs = [
  '예시기업을 선택한 이유와 입사 후 이루고 싶은 목표를 기술하십시오.',
  '자신의 성장 과정에서 큰 영향을 준 경험과 인물을 포함하여 기술하시기 바랍니다.',
  '최근 관심을 갖는 사회 현상을 선택하고 본인의 생각을 기술해 주시기 바랍니다.',
  '새로운 방식을 시도하여 목표를 달성한 경험과 본인의 행동을 기술하십시오.'
].map((main, i) => ({ response: main, source: (i + 1) + '. ' + main +
  (i === 1 ? ' (※책 속 인물도 가능)' : '') + [' (700자 이내 (영문작성 시 1400자))', ' [국문 1500자 이내 / 영문 3000자]', ' （1000자 이내（영문 작성 시 2000자））', ' (한글 1000자) (영문 작성 시 2000자)'][i],
  answer: '[가상 작성 ' + (i + 1) + ']\n  답변 원문\t유지\n' }));
module.exports.languagePairs = languagePairs;
module.exports.languageQnas = languagePairs.map((p, i) => ({ id: 401 + i, number: i + 1, question: p.source, answer: '기존 ' + (i + 1) }));
