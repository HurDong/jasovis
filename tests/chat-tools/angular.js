const roomList = [{ id: 10, title: '가온테크' }, { id: 20, title: '누리금융' }];
const scope = {
  current_chat: roomList[0], is_open_chat: true, chat_groups: [{ type: 'my', list: roomList }],
  $root: { $$phase: false }, $apply(fn) { fn(); },
  open_chatroom(room) { this.current_chat = room; render(); }
};
window.angular = { element: () => ({ scope: () => scope }) };
function render() {
  document.querySelector('.chat-head-title').textContent = scope.current_chat.title;
  const container = document.querySelector('.chat-message-container'); container.replaceChildren();
  for (let i = 100; i < 120; i++) {
    const row = document.createElement('div'); row.className = 'chat-message ' + (i % 4 ? 'receive' : 'send');
    const bubble = document.createElement('div'); bubble.className = 'message-content'; bubble.setAttribute('message_id', i);
    if (i === 116) { const q = document.createElement('blockquote'); q.className = 'message_target-message'; q.textContent = '상대가 쓴 인용문'; bubble.appendChild(q); }
    bubble.appendChild(document.createTextNode(i % 4 ? '상대 메시지 ' + i : '내 메시지 ' + i));
    row.appendChild(bubble); container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}
document.getElementById('external').onclick = () => scope.open_chatroom(roomList[scope.current_chat.id === 10 ? 1 : 0]);
document.querySelector('form').onsubmit = e => e.preventDefault(); render();
