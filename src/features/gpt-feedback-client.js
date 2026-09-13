// 웹 GPT의 보이는 입력창으로 전달한다. 비공개 API/React 내부 상태를 사용하지 않는다.
(function () {
  'use strict';
  if (window.__jslFeedbackClient) return;
  window.__jslFeedbackClient = true;
  const documentKey = crypto.randomUUID(), attempts = new Map();
  const conversation = () => JSLGpt.conversation(location.href);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const normalized = s => String(s || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  const visible = el => !!el && el.getClientRects().length > 0;
  function read(el) {
    if (el instanceof HTMLTextAreaElement) return normalized(el.value);
    // innerText는 p의 CSS 여백까지 줄바꿈으로 바꾼다. ProseMirror 문단의 실제 텍스트를 읽는다.
    const blocks = [...el.childNodes];
    function text(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeName === 'BR') return node.classList.contains('ProseMirror-trailingBreak') ? '' : '\n';
      return [...node.childNodes].map(text).join('');
    }
    if (blocks.length && blocks.every(node => ['P', 'DIV'].includes(node.nodeName)))
      return normalized(blocks.map(node => node.textContent === '' ? '' : text(node)).join('\n'));
    return normalized(el.innerText);
  }
  const echoText = value => normalized(value).replace(/\n+/g, '\n');
  const sameText = (a, b) => echoText(a) === echoText(b);
  const users = () => [...document.querySelectorAll('[data-message-author-role="user"][data-message-id]')];
  const busy = () => [...document.querySelectorAll('[data-testid="stop-button"], [data-is-streaming="true"], .result-streaming')].some(visible);
  function composer() {
    const candidates = [...document.querySelectorAll('#prompt-textarea[contenteditable="true"], textarea#prompt-textarea')].filter(visible);
    if (candidates.length !== 1) throw Error('GPT 입력창을 찾지 못했습니다. 페이지 로딩과 로그인을 확인해 주세요.');
    const editor = candidates[0], form = editor.closest('form');
    if (!form || editor.readOnly || editor.disabled || editor.getAttribute('aria-disabled') === 'true') throw Error('GPT 입력창이 준비되지 않았습니다.');
    return { editor, form };
  }
  function button(form) {
    const primary = [...form.querySelectorAll('button[data-testid="send-button"]')].filter(visible);
    const candidates = primary.length ? primary : [...form.querySelectorAll('button[type="submit"]')].filter(visible);
    return candidates.length === 1 && !candidates[0].disabled && candidates[0].getAttribute('aria-disabled') !== 'true' ? candidates[0] : null;
  }
  function hasAttachments(form) {
    return [...form.querySelectorAll('input[type="file"]')].some(el => el.files?.length) ||
      !!form.querySelector('[data-testid*="attachment"], [data-testid*="file-preview"], [data-testid*="upload-preview"], [aria-label*="Remove file"], [aria-label*="파일 삭제"], [aria-label*="파일 제거"]');
  }
  function insert(editor, text) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, text);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(editor); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) throw Error('GPT 입력창에 질문을 넣지 못했습니다.');
    }
  }
  async function deliver(message) {
    let clicked = false, inserted = false, edited = false, watchedEditor;
    const onEdit = () => { edited = true; };
    try {
      if (message.documentKey !== documentKey || conversation() !== message.conversation) throw Error('GPT 대화가 변경되었습니다.');
      if (typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 300000) throw Error('전달할 질문 형식을 확인해 주세요.');
      const { editor, form } = composer();
      if (read(editor)) throw Error('GPT 입력창에 작성 중인 내용이 있습니다. 그 내용을 먼저 처리한 뒤 다시 보내 주세요.');
      if (hasAttachments(form)) throw Error('GPT 입력창의 첨부 파일을 먼저 확인해 주세요.');
      if (busy()) throw Error('GPT가 답변 중입니다. 답변이 끝난 뒤 다시 보내 주세요.');
      const before = new Set(users().map(el => el.dataset.messageId));
      insert(editor, message.prompt);
      inserted = true; watchedEditor = editor; editor.addEventListener('input', onEdit);
      const expected = normalized(message.prompt);
      let sendButton;
      const buttonDeadline = Date.now() + 2400;
      while (Date.now() < buttonDeadline) {
        if (conversation() !== message.conversation || !editor.isConnected || edited || !sameText(read(editor), expected)) throw Error('GPT 입력 내용 또는 대화가 변경되어 전송을 멈췄습니다.');
        sendButton = button(form);
        if (sendButton) break;
        await wait(100);
      }
      if (!sendButton) throw Error('질문은 GPT 입력창에 넣었지만 전송 버튼을 확인하지 못했습니다. GPT에서 직접 확인해 주세요.');
      const authorized = await chrome.runtime.sendMessage({ type: 'feedback:authorize', attempt: message.attempt,
        conversation: message.conversation, documentKey });
      if (!authorized?.ok || !authorized.authorized) throw Error(authorized?.error || '전송 준비가 변경되었습니다.');
      if (conversation() !== message.conversation || !editor.isConnected || edited || !sameText(read(editor), expected) || busy() ||
          hasAttachments(form) || button(form) !== sendButton) throw Error('GPT 입력 상태가 변경되어 전송을 멈췄습니다.');
      clicked = true;
      sendButton.click();
      const echoDeadline = Date.now() + 8000;
      while (Date.now() < echoDeadline) {
        if (conversation() !== message.conversation) break;
        if (users().some(el => !before.has(el.dataset.messageId) &&
            echoText((el.querySelector('.whitespace-pre-wrap') || el).innerText) === echoText(expected))) return { status: 'sent' };
        await wait(100);
      }
      return { status: 'unknown', error: '전송 버튼은 눌렀지만 새 메시지를 확인하지 못했습니다. GPT 대화를 확인해 주세요. 자동으로 다시 보내지 않습니다.' };
    } catch (e) { return { status: clicked ? 'unknown' : 'blocked', error: e.message + (inserted && !clicked ? '\n질문은 GPT 입력창에 남아 있습니다. 내용을 확인한 뒤 이어서 처리해 주세요.' : '') }; }
    finally { watchedEditor?.removeEventListener('input', onEdit); }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (message?.type === 'feedback:page-info') {
      let ready = false;
      try { composer(); ready = true; } catch { /* 문서가 떠도 GPT 입력창은 나중에 준비될 수 있다. */ }
      reply({ conversation: conversation(), documentKey, url: location.href, title: document.title, ready });
      return;
    }
    if (message?.type !== 'feedback:deliver') return;
    if (!attempts.has(message.attempt)) attempts.set(message.attempt, deliver(message));
    attempts.get(message.attempt).then(reply);
    return true;
  });
  let last = '';
  function announce() {
    const id = conversation();
    if (!id || id === last) return;
    last = id;
    chrome.runtime.sendMessage({ type: 'feedback:hello' }).catch(() => {});
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['gpt-conversation:' + conversation()]) { last = ''; announce(); }
  });
  setInterval(announce, 1000);
  announce();
})();
