// 실제 데이터·네트워크 없는 React 행/저장소/스크롤 로더 재현.
const panel = document.getElementById('chatBody'), rows = document.querySelector('.rows');
let generation = 0, loading = false, pages = 0, stopped = false, noMine = false;
const rooms = [
  { id: 10, title: '가온테크', unread_count: 0 }, { id: 20, title: '누리금융', unread_count: 3 },
  { id: 30, title: '다온모빌리티 플랫폼 개발 채팅방 이름이 길어지는 경우', unread_count: 102 },
  ...Array.from({ length: 25 }, (_, i) => ({ id: 40 + i, title: '테스트 기업 ' + (i + 1), unread_count: 0 }))
];
const store = {
  myChats: rooms, roomInfo: rooms[0], page: 'chatRoom', targetMessage: null,
  setRoomInfo(room) { this.roomInfo = room; setup(); }, setPage(page) { this.page = page; },
  setTargetMessage(value) { this.targetMessage = value; }, setIsOpenChatContentSearch() {}
};
function factory(module) {
  // 공개 저장소 모듈과 같은 메서드 지문. 다른 모듈의 실행 없이 이 모듈만 찾는다.
  function setRoomInfo() {} function setMyChats() {} function setBeforeChatRoom() {} function setTargetMessage() {}
  module.exports = { default: store };
}
const nativeRequire = id => { const m = { exports: {} }; nativeRequire.m[id](m); return m.exports; };
nativeRequire.m = { 'varying-module-id': factory };
window.webpackChunk_N_E = [];
window.webpackChunk_N_E.push = function (entry) { if (entry[2]) entry[2](nativeRequire); return 1; };
function row(id) {
  const mine = !noMine && id % 7 === 0, deleted = id === 196;
  const message = { id, chat_id: store.roomInfo.id, type: mine ? 'self' : 'other',
    content: deleted ? '삭제된 메시지입니다.' : mine ? (id === 189 ? '<img src=x onerror=alert(1)> 텍스트도 실행 없이 보입니다.' : '면접 일정과 준비물을 확인했습니다. 제 메시지 ' + id) : '다른 참여자의 대화 ' + id,
    created_at: new Date(Date.UTC(2026, 8, 8, 0, id - 100)).toISOString(), remove_status: deleted ? 2 : 1 };
  const node = document.createElement('div'); node.id = 'chat-message-' + id; node.className = 'message-row';
  node.__reactProps$fixture = { children: { props: { message } } };
  const author = document.createElement('div'); author.setAttribute('data-sentry-component', 'Author'); author.textContent = mine ? '나' : '상대방';
  const line = document.createElement('div'); line.className = 'line' + (mine ? ' flex-row-reverse' : '');
  const bubble = document.createElement('div'); bubble.setAttribute('data-sentry-component', 'MessageContents'); bubble.textContent = message.content;
  const time = document.createElement('span'); time.className = 'date'; time.textContent = '13:14';
  line.append(bubble, time); node.append(author, line); return node;
}
function metrics() { document.getElementById('state').textContent = '방 ' + store.roomInfo.id + ' · 추가 로딩 ' + pages; }
function setup() {
  generation++; loading = false; pages = 0; panel.className = 'chatBody-' + store.roomInfo.id;
  document.querySelector('header a').textContent = store.roomInfo.title;
  rows.replaceChildren(...Array.from({ length: 50 }, (_, i) => row(150 + i)));
  panel.scrollTop = panel.scrollHeight; metrics();
}
new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting || loading || stopped || pages >= 3) return;
  loading = true; const ticket = generation, old = rows.firstElementChild, oldTop = old.getBoundingClientRect().top;
  document.getElementById('sentinel').style.display = 'none';
  setTimeout(() => {
    if (ticket !== generation) return;
    const first = Number(old.id.slice(13));
    rows.prepend(...Array.from({ length: 30 }, (_, i) => row(first - 30 + i)));
    panel.scrollTop += old.getBoundingClientRect().top - oldTop;
    pages++; loading = false; document.getElementById('sentinel').style.display = ''; metrics();
  }, 400);
}, { root: panel }).observe(document.getElementById('sentinel'));
document.querySelector('form').onsubmit = e => e.preventDefault();
document.getElementById('reset').onclick = () => { noMine = stopped = false; store.setRoomInfo(rooms[0]); };
document.getElementById('empty').onclick = () => { noMine = true; setup(); };
document.getElementById('stall').onclick = () => { stopped = true; };
document.getElementById('rebuild').onclick = () => { const h = document.querySelector('header'), next = h.cloneNode(true); next.querySelector('#jsl-chat-tools')?.remove(); h.replaceWith(next); };
document.getElementById('external').onclick = () => store.setRoomInfo(rooms[1]);
document.getElementById('broken').onclick = () => { delete rows.firstElementChild.__reactProps$fixture; rows.firstElementChild.classList.add('changed'); };
document.getElementById('narrow').onclick = () => { document.querySelector('.window').style.width = '300px'; window.dispatchEvent(new Event('resize')); };
document.getElementById('deleted').onclick = () => { const n = document.getElementById('chat-message-189'); if (!n) return; n.__reactProps$fixture.children.props.message.remove_status = 2; n.querySelector('[data-sentry-component="MessageContents"]').textContent = '삭제된 메시지입니다.'; };
setup();
// OS 창 제어 없이도 visibilitychange 회귀를 재현하는 가상 화면 전용 제어.
const backgroundTest = document.createElement('button');
backgroundTest.textContent = '모의 창 전환';
backgroundTest.onclick = () => {
  const previous = Object.getOwnPropertyDescriptor(document, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => {
    if (previous) Object.defineProperty(document, 'hidden', previous); else delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  }, 600);
};
document.querySelector('.controls').appendChild(backgroundTest);
