const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../src/core/gpt-feedback.js');
const answer = '첫 문장입니다. 같은 단어와 같은 단어를 씁니다.\n\n두 번째 문장입니다. 🧩 한글 끝.';
const state = () => ({ resume: { id: 55 }, qnas: [
  { id: 91, number: 1, question: '문제를 해결한 경험은?', answer, active: true },
  { id: 92, number: 2, question: '다른 문항', answer: '보내면 안 되는 다른 문항 내용', active: false }
] });
const code = text => ({ type: 'code', text });
const p = text => ({ type: 'text', text });

test('고른 곳 하나와 질문을 원문 그대로 보관한다 (UTF-16 이모지 포함)', () => {
  const at = answer.indexOf('🧩');
  const a = F.ask(state(), answer, at, at + 2, '  이모지 괜찮아?  ');
  assert.equal(a.quote.text, '🧩'); assert.equal(a.request, '이모지 괜찮아?');
  assert.deepEqual([a.resumeId, a.question.id, a.question.number], ['55', '91', 1]);
});
test('빈 곳·공백만 고른 곳·범위 밖·너무 긴 곳·너무 긴 질문은 거부한다', () => {
  assert.throws(() => F.ask(state(), answer, 3, 3, ''), /다시 골라/);
  const blank = answer.indexOf('\n\n');
  assert.throws(() => F.ask(state(), answer, blank, blank + 2, ''), /다시 골라/);
  assert.throws(() => F.ask(state(), answer, 0, answer.length + 1, ''), /다시 골라/);
  const long = 'ㄱ'.repeat(8001);
  assert.throws(() => F.ask(state(), long, 0, 8001, ''), /너무 깁니다/);
  assert.throws(() => F.ask(state(), answer, 0, 5, 'ㄱ'.repeat(4001)), /4,000자/);
  const a = F.ask(state(), answer, 0, 5, ''); a.quote.text = '다른 글';
  assert.throws(() => F.validate(a), /다시 골라/);
});
test('요청은 표지·문항·고른 곳·주변 문맥·질문·기본 지시·형식을 담고 다른 문항 본문이나 내부 ID를 보내지 않는다', () => {
  const start = answer.indexOf('같은'), a = F.ask(state(), answer, start, start + 2, '이 단어 반복돼서 어색해?');
  const prompt = F.prompt(a);
  assert.ok(F.isRequest(prompt));
  assert.equal(prompt.split('\n')[0], F.headline(1));
  assert.match(prompt, /문항 1: 문제를 해결한 경험은\?/);
  assert.match(prompt, /고칠 부분: 같은\n주변 문맥: 첫 문장입니다\. 같은 단어와 같은 단어를 씁니다\.\n질문: 이 단어 반복돼서 어색해\?/);
  assert.match(prompt, /빠진 맥락[\s\S]*AI가 쓴 듯한/);
  assert.match(prompt, /지어내지 않습니다/);
  assert.match(prompt, /진단: [^\n]+\n수정안:\n```\n고칠 부분을 대체할 문장\n```\n확인 필요: 없음$/);
  assert.doesNotMatch(prompt, /보내면 안 되는|\b55\b|\b91\b|두 번째 문장/);
});
test('질문을 비워도 보낼 수 있고, 그때는 규칙대로 다듬어 달라고 적는다', () => {
  const prompt = F.prompt(F.ask(state(), answer, 0, 8, ''));
  assert.match(prompt, /고칠 부분: 첫 문장입니다\.\n주변 문맥: [^\n]+\n질문: 따로 없음/);
});
test('주변 문맥은 같은 문단 안에서 앞뒤 160자로 제한하고, 고른 곳이 문단 전체면 생략한다', () => {
  const text = 'ㄱ'.repeat(300) + '가운데' + 'ㄴ'.repeat(300) + '\n다음 문단';
  const at = text.indexOf('가운데'), prompt = F.prompt(F.ask({ resume: { id: 1 }, qnas: [{ id: 2, number: 1, question: 'q', answer: text, active: true }] }, text, at, at + 3, ''));
  const around = /주변 문맥: ([^\n]+)/.exec(prompt)[1];
  assert.equal(around, 'ㄱ'.repeat(160) + '가운데' + 'ㄴ'.repeat(160));
  const whole = F.prompt(F.ask(state(), answer, 0, answer.indexOf('\n'), ''));
  assert.doesNotMatch(whole, /주변 문맥/);
});
test('원문 한 글자 수정, 다른 문항/지원서, 문항 원문 변경을 각각 거부한다', () => {
  const a = F.ask(state(), answer, 0, 5, '');
  const s = state(); s.qnas[0].answer += '!'; assert.throws(() => F.check(a, s), /답변이 바뀌었습니다/);
  const other = state(); other.qnas[0].active = false; other.qnas[1].active = true; assert.throws(() => F.check(a, other), /현재 문항/);
  const resume = state(); resume.resume.id = 56; assert.throws(() => F.check(a, resume), /현재 문항/);
  const question = state(); question.qnas[0].question = '바뀐 질문'; assert.throws(() => F.check(a, question), /현재 문항/);
  assert.doesNotThrow(() => F.check(a, state()));
});
test('읽기 실패나 활성 문항 중복을 빈 문항으로 취급하지 않는다', () => {
  assert.throws(() => F.current(null), /읽지 못했습니다/);
  const s = state(); s.qnas[1].active = true; assert.throws(() => F.current(s), /읽지 못했습니다/);
});
test('정상 형식의 답에서 진단·수정안·확인 필요를 읽고 앞뒤 공백은 고른 곳 기준으로 맞춘다', () => {
  const item = F.parseAnswer([p('요청하신 곳을 봤습니다.'), p('**진단:** 맥락이 없습니다.'), p('수정안:'), code('\n동아리에서 만든 서비스입니다.\n'), p('확인 필요: 동아리 이름')], '  원문입니다.\n');
  assert.equal(item.status, 'ready');
  assert.equal(item.replacement, '  동아리에서 만든 서비스입니다.\n');
  assert.equal(item.diagnosis, '맥락이 없습니다.'); assert.equal(item.ask, '동아리 이름');
  const none = F.parseAnswer([p('진단: 좋아요'), code('새 문장'), p('확인 필요: 없음')], '옛 문장');
  assert.equal(none.ask, '');
  const nextLine = F.parseAnswer([p('진단:\n다음 줄 진단'), code('새 문장'), p('확인 필요:\n다음 줄 확인')], '옛 문장');
  assert.deepEqual([nextLine.diagnosis, nextLine.ask], ['다음 줄 진단', '다음 줄 확인']);
});
test('수정안이 없으면 확인 필요(ask)·답만(note)·읽지 못함으로 나누고, 같은 글은 그대로(same)다', () => {
  assert.equal(F.parseAnswer([p('진단: 근거 부족'), p('확인 필요: 기간을 알려 주세요')], 'x').status, 'ask');
  const note = F.parseAnswer([p('진단: 어색하지 않아요. 반복이 강조로 읽혀요.'), p('확인 필요: 없음')], 'x');
  assert.equal(note.status, 'note'); assert.match(note.diagnosis, /어색하지 않아요/);
  assert.equal(F.parseAnswer([p('그냥 좋은 글이에요.')], 'x').status, 'invalid');
  assert.equal(F.parseAnswer([p('진단: 그대로'), code('원문')], '원문').status, 'same');
});
test('형식을 어긴 답은 읽지 못함이다: 여러 수정안·빈 수정안·틀 문구·너무 긴 수정안', () => {
  for (const blocks of [
    [p('진단: a'), code('하나'), code('둘')],
    [p('진단: a'), code('   ')],
    [p('진단: a'), code('수정안: 새 문장')],
    [p('진단: a'), code('ㄱ'.repeat(8001))]
  ]) assert.equal(F.parseAnswer(blocks, '원문').status, 'invalid');
});
test('바꿀 위치: 기록 위치에 같은 글이 있으면 그 자리, 아니면 유일한 곳만, 바뀌면 교체하지 않는다', () => {
  const text = '같은 단어와 같은 단어';
  assert.equal(F.locate(text, '같은', 7), 7);
  assert.equal(F.locate(text, '같은', 3), -1);
  assert.equal(F.locate(text, '단어와', 99), 3);
  assert.equal(F.locate(text, '', 0), -1);
  assert.equal(F.replaceAt(text, 7, '같은', '다른'), '같은 단어와 다른 단어');
  assert.throws(() => F.replaceAt(text, 1, '같은', '다른'), /원문이 바뀌어/);
});
test('사이트 모델의 CRLF·ng-model 앞뒤 공백 차이는 같은 답변으로 보고 내용 차이는 거부한다', () => {
  assert.ok(F.sameAnswer('가\r\n나', '가\n나'));
  assert.ok(F.sameAnswer('가\n나', '가\n나\n'));
  assert.ok(!F.sameAnswer('가\n나', '가\n다'));
  const s = state(); s.qnas[0].answer = answer.replace(/\n/g, '\r\n').trim();
  assert.doesNotThrow(() => F.check(F.ask(state(), answer + '\n', 0, 5, ''), s));
});
test('뒤 탭 화면 갱신 보조: 표시가 켜진 숨은 탭에서만 프레임 요청을 타이머로 돌리고 취소도 맞춘다', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const calls = [];
  const html = { attrs: new Set(), hasAttribute(name) { return this.attrs.has(name); } };
  const win = { requestAnimationFrame: cb => { calls.push('native'); return 7; }, cancelAnimationFrame: id => calls.push('cancel ' + id) };
  const doc = { hidden: false, documentElement: html };
  const context = vm.createContext({ window: win, document: doc, setTimeout, clearTimeout, performance });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/core/gpt-render-main.js'), 'utf8'), context);
  const tick = () => new Promise(r => setTimeout(r, 40));
  assert.equal(win.requestAnimationFrame(() => calls.push('frame')), 7); // 보이는 탭
  doc.hidden = true;
  assert.equal(win.requestAnimationFrame(() => calls.push('frame')), 7); // 숨었지만 표시 없음
  html.attrs.add('data-jsl-keep-rendering');
  const id = win.requestAnimationFrame(t => calls.push('timer ' + typeof t));
  assert.ok(id < 0);
  const cancelled = win.requestAnimationFrame(() => calls.push('should not run'));
  win.cancelAnimationFrame(cancelled);
  win.cancelAnimationFrame(7);
  await tick();
  assert.deepEqual(calls, ['native', 'native', 'cancel 7', 'timer number']);
});
