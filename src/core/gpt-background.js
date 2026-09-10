'use strict';
importScripts('gpt-protocol.js');
const locks = new Set(), prepared = new Map();
const key = id => 'gpt-conversation:' + id;
const origin = sender => { try { return new URL(sender.url).origin; } catch { return ''; } };
const resumeId = url => { try { return new URL(url).pathname.match(/^\/resume\/(\d+)\/?$/)?.[1]; } catch { return null; } };
const binding = async id => (await chrome.storage.local.get(key(id)))[key(id)] || null;
const publicLink = link => link ? { resume: link.resume, revision: link.revision } : null;
async function targets() {
  return (await chrome.tabs.query({ url: 'https://jasoseol.com/*' })).filter(t => resumeId(t.url)).map(t =>
    ({ id: t.id, title: t.title, windowId: t.windowId, resumeId: resumeId(t.url) }));
}
async function source(message, sender) {
  // sender.url는 SPA 이동 전 주소일 수 있으므로 발신 문서에 현재 대화를 재확인한다.
  const result = await chrome.tabs.sendMessage(sender.tab.id, { type: 'gpt:source-check', conversation: message.conversation,
    response: message.response, fingerprint: message.fingerprint }, { frameId: 0 });
  if (!result?.valid) throw Error('대화 또는 응답이 변경되었습니다. 현재 응답에서 다시 적용해 주세요.');
}
async function readTarget(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith('https://jasoseol.com/') || !resumeId(tab.url)) throw Error('대상 탭이 지원서에서 이동했습니다. 다시 선택해 주세요.');
  const data = await chrome.tabs.sendMessage(tabId, { type: 'gpt:state' }, { frameId: 0 });
  JSLGpt.metadata(data?.state);
  if (String(data.state.resume.id) !== resumeId(tab.url)) throw Error('지원서가 전환 중입니다. 로딩 후 다시 시도해 주세요.');
  return data;
}
async function handle(message, sender) {
  if (sender.frameId !== 0 || !sender.tab || origin(sender) !== 'https://chatgpt.com' || !/^[a-zA-Z0-9-]+$/.test(message.conversation || '')) throw Error('ChatGPT 대화에서 실행해 주세요.');
  await source(message, sender);
  const conversation = message.conversation, lock = 'conversation:' + conversation;
  if (message.type === 'gpt:info') return { link: publicLink(await binding(conversation)), targets: await targets() };
  if (locks.has(lock)) throw Error('이 대화에서 다른 입력 또는 연결 변경을 처리 중입니다.');
  locks.add(lock);
  try {
    const link = await binding(conversation);
    if (message.type === 'gpt:connect') {
      const data = await readTarget(message.tabId);
      await source(message, sender);
      const next = { ...JSLGpt.metadata(data.state), revision: crypto.randomUUID() };
      await chrome.storage.local.set({ [key(conversation)]: next });
      return { link: publicLink(next) };
    }
    if (message.type === 'gpt:unlink') {
      await chrome.storage.local.remove(key(conversation));
      return { link: null };
    }
    if (message.type === 'gpt:open') {
      const url = link && !message.list ? 'https://jasoseol.com/resume/' + link.resume.id : 'https://jasoseol.com/resume_list';
      return { opened: (await chrome.tabs.create({ url })).id };
    }
    if (!link || link.revision !== message.revision) throw Error('지원서 연결이 변경되었습니다. 연결을 확인한 뒤 다시 적용해 주세요.');
    if (message.type === 'gpt:prepare') {
      const tabs = (await targets()).filter(t => t.resumeId === link.resume.id);
      // 자동으로 고른 탭은 고정하지 않는다. 매번 유일한지 확인한다.
      const tab = message.tabId == null ? (tabs.length === 1 ? tabs[0] : null) : tabs.find(t => t.id === message.tabId);
      if (!tab) return { chooseTab: true, targets: tabs };
      const data = await readTarget(tab.id);
      if (!JSLGpt.sameQuestions(link, data.state)) throw Error('연결 후 지원서 문항이 변경되었습니다. 연결 변경에서 다시 선택해 주세요.');
      const mapped = JSLGpt.map(message.candidates, data.state, message.choices);
      if (!mapped.packet) return { mapping: { rows: mapped.rows, qnas: mapped.qnas } };
      await source(message, sender);
      for (const [id, item] of prepared) if (item.expires < Date.now()) prepared.delete(id);
      if (prepared.size >= 64) prepared.delete(prepared.keys().next().value);
      const token = crypto.randomUUID();
      prepared.set(token, { conversation, revision: link.revision, senderTab: sender.tab.id, response: message.response,
        fingerprint: message.fingerprint, tabId: tab.id, explicitTab: message.tabId != null, documentKey: data.documentKey,
        packet: mapped.packet, expires: Date.now() + 90000 });
      return { token, title: link.resume.title, numbers: mapped.packet.answers.map(a => a.number) };
    }
    if (message.type !== 'gpt:apply') throw Error('알 수 없는 요청입니다.');
    const pending = prepared.get(message.token);
    prepared.delete(message.token); // 재사용·중복 클릭 방지. 작업자 재시작 시에도 재준비가 필요하다.
    if (!pending || pending.expires < Date.now() || pending.conversation !== conversation || pending.senderTab !== sender.tab.id ||
        pending.revision !== link.revision || pending.response !== message.response || pending.fingerprint !== message.fingerprint) throw Error('입력 준비가 만료되거나 변경되었습니다. 다시 적용해 주세요.');
    const resumeLock = 'resume:' + link.resume.id;
    if (locks.has(resumeLock)) throw Error('같은 지원서에 다른 답변을 입력 중입니다.');
    locks.add(resumeLock);
    try {
      if (!pending.explicitTab && (await targets()).filter(t => t.resumeId === link.resume.id).length !== 1) throw Error('지원서 탭이 여러 개입니다. 탭을 다시 선택해 주세요.');
      const fresh = await readTarget(pending.tabId);
      if (fresh.documentKey !== pending.documentKey || !JSLGpt.sameQuestions(link, fresh.state)) throw Error('대상 지원서가 새로고침되거나 변경되었습니다. 다시 적용해 주세요.');
      JSLGpt.validate(pending.packet, fresh.state, true);
      await source(message, sender);
      return await chrome.tabs.sendMessage(pending.tabId, { type: 'gpt:write', packet: pending.packet,
        documentKey: pending.documentKey }, { frameId: 0 });
    } finally { locks.delete(resumeLock); }
  } finally { locks.delete(lock); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type?.startsWith('gpt:')) return;
  handle(message, sender).then(data => reply({ ok: true, ...data }), e => reply({ ok: false, error: e.message }));
  return true;
});
