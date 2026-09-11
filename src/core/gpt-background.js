'use strict';
importScripts('gpt-protocol.js');
const locks = new Set(), prepared = new Map(), undos = new Map();
// 되돌리기는 지원서 탭을 보고 와서 누르는 동작이라 준비 토큰보다 오래 남긴다.
const UNDO_TTL = 600000;
function remember(map, ttl, record) {
  for (const [id, item] of map) if (item.expires < Date.now()) map.delete(id);
  if (map.size >= 64) map.delete(map.keys().next().value);
  const token = crypto.randomUUID();
  map.set(token, { ...record, expires: Date.now() + ttl });
  return token;
}
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
    if (message.type === 'gpt:focus') {
      const target = message.target;
      if (!Number.isInteger(target?.tabId) || target.resumeId !== link.resume.id) throw Error('확인할 지원서 정보가 변경되었습니다.');
      let tab;
      try { tab = await chrome.tabs.get(target.tabId); }
      catch { throw Error('입력했던 탭이 닫혔습니다. 열린 지원서를 직접 확인해 주세요.'); }
      if (!tab.url?.startsWith('https://jasoseol.com/') || resumeId(tab.url) !== target.resumeId) throw Error('입력했던 탭이 다른 페이지로 이동했습니다.');
      await source(message, sender);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      if (target.question) {
        const fresh = await readTarget(tab.id);
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'gpt:review-question', resumeId: target.resumeId,
          documentKey: fresh.documentKey, question: target.question }, { frameId: 0 });
        if (!result?.focused) throw Error(result?.error || '지원서 탭은 열었지만 해당 문항으로 이동하지 못했습니다.');
      }
      return { focused: true };
    }
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
      const token = remember(prepared, 90000, { conversation, revision: link.revision, senderTab: sender.tab.id,
        response: message.response, fingerprint: message.fingerprint, tabId: tab.id, explicitTab: message.tabId != null,
        documentKey: data.documentKey, packet: mapped.packet });
      return { token, title: link.resume.title, numbers: mapped.packet.answers.map(a => a.number) };
    }
    if (message.type === 'gpt:undo') {
      const undo = undos.get(message.token);
      if (!undo || undo.expires < Date.now() || undo.conversation !== conversation || undo.senderTab !== sender.tab.id ||
          undo.revision !== link.revision || undo.response !== message.response ||
          undo.fingerprint !== message.fingerprint) throw Error('되돌리기 정보가 만료되거나 변경되었습니다. 자소설에서 직접 확인해 주세요.');
      const undoLock = 'resume:' + link.resume.id;
      if (locks.has(undoLock)) throw Error('같은 지원서에 다른 답변을 입력 중입니다.');
      locks.add(undoLock);
      try {
        const fresh = await readTarget(undo.tabId);
        if (fresh.documentKey !== undo.documentKey || !JSLGpt.sameQuestions(link, fresh.state)) throw Error('대상 지원서가 새로고침되거나 변경되었습니다. 자소설에서 직접 확인해 주세요.');
        await source(message, sender);
        const result = await chrome.tabs.sendMessage(undo.tabId, { type: 'gpt:undo', documentKey: undo.documentKey,
          resumeId: link.resume.id, revert: undo.revert }, { frameId: 0 });
        undos.delete(message.token); // 대상 탭까지 도달한 뒤에만 소모한다.
        return { ...result, target: { tabId: undo.tabId, resumeId: link.resume.id } };
      } finally { locks.delete(undoLock); }
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
      const result = await chrome.tabs.sendMessage(pending.tabId, { type: 'gpt:write', packet: pending.packet,
        documentKey: pending.documentKey }, { frameId: 0 });
      // 실제로 값이 바뀐 문항만 되돌릴 거리가 된다. expectedAnswer가 입력 직전 답변이다.
      const revert = pending.packet.answers.filter(a => (result?.verified || []).includes(a.number) && a.text !== a.expectedAnswer)
        .map(a => ({ id: a.id, number: a.number, question: a.question, text: a.expectedAnswer, wrote: a.text }));
      const undoToken = revert.length ? remember(undos, UNDO_TTL, { conversation, revision: link.revision,
        senderTab: sender.tab.id, response: message.response, fingerprint: message.fingerprint, tabId: pending.tabId,
        documentKey: pending.documentKey, revert }) : null;
      const reviewQuestion = pending.packet.answers.find(a => (result?.verified || []).includes(a.number)) || pending.packet.answers[0];
      return { ...result, target: { tabId: pending.tabId, resumeId: link.resume.id,
        question: { id: reviewQuestion.id, number: reviewQuestion.number, question: reviewQuestion.question } }, undoToken };
    } finally { locks.delete(resumeLock); }
  } finally { locks.delete(lock); }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type?.startsWith('gpt:')) return;
  handle(message, sender).then(data => reply({ ok: true, ...data }), e => reply({ ok: false, error: e.message }));
  return true;
});

// ── 모든 탭에 뜨는 세로 복사 바 (relay) ──────────────────────────────
// 켜기: 동적 콘텐츠 스크립트를 등록해 두면 그 뒤 여는 모든 탭에 자동 주입된다.
//       이미 열려 있는 탭에는 한 번씩 직접 넣는다.
// 끄기: 등록을 풀고 jslRelayOn을 비운다. 떠 있는 막대는 storage 변화를 보고 스스로 사라진다
//       (탭마다 제거 스크립트를 쏘지 않아도 되고, 권한이 이미 걷힌 뒤에도 안전하다).
const RELAY_ID = 'jsl-relay';
const RELAY_ORIGINS = { origins: ['*://*/*'] };
const relayInjectable = url => /^https?:\/\//.test(url || '');

async function relayRegistered() {
  try {
    return (await chrome.scripting.getRegisteredContentScripts({ ids: [RELAY_ID] })).length > 0;
  } catch { return false; }
}

async function relayEnable(resumeId) {
  if (!(await chrome.permissions.contains(RELAY_ORIGINS))) return { needPermission: true };
  await chrome.storage.local.set({ jslRelayOn: String(resumeId) });
  const script = {
    id: RELAY_ID,
    js: ['src/features/relay-panel.js'],
    matches: ['*://*/*'],
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true
  };
  try {
    if (await relayRegistered()) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (e) { return { ok: false, error: e.message }; }
  // 이미 열려 있는 탭은 등록만으로는 안 뜬다 — 새로고침을 기다리지 않게 한 번씩 넣는다.
  const tabs = (await chrome.tabs.query({})).filter(t => relayInjectable(t.url));
  await Promise.all(tabs.map(t =>
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/features/relay-panel.js'] })
      .catch(() => { /* 넣을 수 없는 탭은 건너뛴다 */ })));
  return { on: true, tabs: tabs.length };
}

async function relayDisable() {
  await chrome.storage.local.set({ jslRelayOn: null });
  try { if (await relayRegistered()) await chrome.scripting.unregisterContentScripts({ ids: [RELAY_ID] }); }
  catch { /* 이미 없으면 그만 */ }
  return { on: false };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type?.startsWith('relay:')) return;
  (async () => {
    if (message.type === 'relay:status') {
      const granted = await chrome.permissions.contains(RELAY_ORIGINS);
      const { jslRelayOn = null } = await chrome.storage.local.get('jslRelayOn');
      return { granted, on: jslRelayOn };
    }
    if (message.type === 'relay:enable') return relayEnable(message.resumeId);
    if (message.type === 'relay:disable') return relayDisable();
    if (message.type === 'relay:options') { await chrome.runtime.openOptionsPage(); return { opened: true }; }
    return {};
  })().then(data => reply({ ok: true, ...data }), e => reply({ ok: false, error: e.message }));
  return true;
});

// 권한이 회수되면(사용자가 chrome://extensions에서 직접 끄는 경우 포함) 등록도 같이 푼다.
chrome.permissions.onRemoved.addListener(async () => {
  if (!(await chrome.permissions.contains(RELAY_ORIGINS))) await relayDisable();
});
