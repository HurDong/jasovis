// 자소설 → 이미 연결된 웹 GPT. 사용자가 전송 버튼을 누른 요청만 처리한다.
(function () {
  'use strict';
  const F = JSLFeedback, prefix = 'feedback:', operations = new Set();
  const session = chrome.storage.session;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const get = async k => (await session.get(k))[k];
  const put = (k, value) => session.set({ [k]: value });
  const draftKey = (tab, d) => `${prefix}draft:${tab}:${d.resumeId}:${d.question.id}`;
  const attemptKey = id => prefix + 'attempt:' + id;
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
  const info = tab => chrome.tabs.sendMessage(tab, { type: 'feedback:page-info' }, { frameId: 0 });
  async function sourceState(sender) {
    if (sender.frameId !== 0 || !sender.tab || origin(sender) !== 'https://jasoseol.com') throw Error('열린 자소설 지원서에서 실행해 주세요.');
    return readTarget(sender.tab.id);
  }
  async function choices(state) {
    const all = await chrome.storage.local.get(null), linked = new Map(), tabs = [];
    for (const [k, value] of Object.entries(all)) if (k.startsWith('gpt-conversation:') && value?.resume?.id === String(state.resume.id)) {
      const id = k.slice('gpt-conversation:'.length), meta = all['feedback-chat:' + id];
      linked.set(id, { conversation: id, title: meta?.title || '연결된 GPT 대화 (' + id.slice(0, 8) + ')', linked: true });
    }
    for (const tab of await chrome.tabs.query({ url: 'https://chatgpt.com/*' })) {
      const id = JSLGpt.conversation(tab.url);
      if (!id) continue;
      const link = all[key(id)];
      if (link && link.resume.id !== String(state.resume.id)) continue;
      tabs.push({ conversation: id, title: tab.title || 'GPT 대화', linked: !!link });
    }
    for (const tab of tabs) linked.set(tab.conversation, tab);
    const items = [...linked.values()];
    const preferred = all['feedback-preferred:' + state.resume.id];
    const connected = items.filter(t => t.linked);
    const selected = connected.some(t => t.conversation === preferred) ? preferred : connected.length === 1 ? connected[0].conversation : '';
    return { items, selected };
  }
  async function select(message, sender, data) {
    const id = message.conversation;
    if (!validId(id) || !(await choices(data.state)).items.some(t => t.conversation === id)) throw Error('열려 있는 GPT 대화를 선택해 주세요.');
    const lock = 'conversation:' + id;
    if (locks.has(lock)) throw Error('대화에서 다른 작업을 처리 중입니다.');
    locks.add(lock);
    try {
      const old = await binding(id);
      if (old && old.resume.id !== String(data.state.resume.id)) throw Error('다른 지원서에 연결된 대화입니다.');
      const fresh = await sourceState(sender);
      if (fresh.documentKey !== data.documentKey || String(fresh.state.resume.id) !== String(data.state.resume.id)) throw Error('지원서가 변경되었습니다.');
      // 명시적 선택 시 새 연결을 만들거나, 같은 지원서의 변경된 문항 구성을 갱신한다.
      if (!old || !JSLGpt.sameQuestions(old, fresh.state)) await chrome.storage.local.set({ [key(id)]: { ...JSLGpt.metadata(fresh.state), revision: crypto.randomUUID() } });
      await chrome.storage.local.set({ ['feedback-preferred:' + data.state.resume.id]: id });
      return { selected: id };
    } finally { locks.delete(lock); }
  }
  async function freshAttempt(record) {
    const data = await readTarget(record.sourceTab);
    if (data.documentKey !== record.documentKey) throw Error('자소설 페이지가 새로고침되었습니다. 다시 준비해 주세요.');
    F.check(record.draft, data.state);
    if (data.editorAnswer !== record.draft.answer) throw Error('답변 입력란의 원문이 변경되거나 읽히지 않습니다. 인용을 다시 선택해 주세요.');
    const link = await binding(record.conversation);
    if (!link || link.revision !== record.revision || !JSLGpt.sameQuestions(link, data.state)) throw Error('GPT 연결 또는 지원서 문항이 변경되었습니다. 연결을 다시 선택해 주세요.');
  }
  async function targetTab(conversation) {
    const tabs = (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(t => JSLGpt.conversation(t.url) === conversation);
    if (tabs.length > 1) throw Error('같은 GPT 대화가 여러 탭에 열려 있습니다. 사용할 탭 하나만 남겨 주세요.');
    if (tabs.length) return tabs[0];
    const meta = (await chrome.storage.local.get('feedback-chat:' + conversation))['feedback-chat:' + conversation];
    const url = meta?.url && JSLGpt.conversation(meta.url) === conversation && new URL(meta.url).origin === 'https://chatgpt.com'
      ? meta.url : 'https://chatgpt.com/c/' + conversation;
    return chrome.tabs.create({ url });
  }
  async function send(message, sender, data) {
    const d = F.validate(message.draft, true), id = message.attempt;
    F.check(d, data.state);
    if (!validId(id) || !validId(message.conversation)) throw Error('전송 요청을 다시 준비해 주세요.');
    const previous = await get(attemptKey(id));
    if (previous) {
      if (previous.sourceTab !== sender.tab.id) throw Error('다른 탭의 전송 요청입니다.');
      return { status: previous.status === 'sent' || previous.status === 'blocked' ? previous.status : 'unknown',
        error: previous.error || '이미 처리한 요청입니다. GPT 대화를 확인해 주세요.' };
    }
    const lock = 'conversation:' + message.conversation, resumeLock = 'resume:' + d.resumeId;
    if (locks.has(lock) || locks.has(resumeLock)) throw Error('이 대화 또는 지원서에서 다른 작업을 처리 중입니다.');
    locks.add(lock); locks.add(resumeLock);
    const record = { sourceTab: sender.tab.id, documentKey: data.documentKey, conversation: message.conversation,
      draft: d, status: 'preparing', created: Date.now() };
    try {
      const link = await binding(record.conversation);
      if (!link || link.resume.id !== d.resumeId) throw Error('이 지원서와 연결된 GPT 대화를 선택해 주세요.');
      record.revision = link.revision;
      await put(attemptKey(id), record);
      await freshAttempt(record);
      const tab = await targetTab(record.conversation);
      record.targetTab = tab.id;
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      let page;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try { page = await info(tab.id); } catch { /* 새 탭의 콘텐츠 스크립트 로드를 기다린다. */ }
        if (page?.conversation === record.conversation && page.ready) break;
        await wait(250);
      }
      if (page?.conversation !== record.conversation || !page.ready) throw Error('GPT 입력창을 준비하지 못했습니다. 로그인과 페이지 로딩을 확인해 주세요.');
      record.targetDocument = page.documentKey;
      await freshAttempt(record);
      record.status = 'ready';
      await put(attemptKey(id), record);
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'feedback:deliver', attempt: id,
        conversation: record.conversation, documentKey: page.documentKey, prompt: F.prompt(d) }, { frameId: 0 });
      if (!['sent', 'blocked', 'unknown'].includes(result?.status)) throw Error('GPT 전송 응답을 확인하지 못했습니다.');
      record.status = result.status;
      // client의 blocked는 클릭하지 않았다는 확정 응답이다. 채널 실패는 아래 catch에서 별도로 처리한다.
      record.error = result.error;
      delete record.draft; // 종료된 요청에는 중복 방지용 결과만 남긴다.
      await put(attemptKey(id), record);
      return { status: record.status, error: record.error };
    } catch (e) {
      const latest = await get(attemptKey(id));
      record.status = latest?.status === 'committing' ? 'unknown' : 'blocked';
      record.error = e.message;
      delete record.draft;
      await put(attemptKey(id), record);
      return { status: record.status, error: e.message };
    } finally { locks.delete(lock); locks.delete(resumeLock); }
  }
  async function handle(message, sender) {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab) throw Error('지원하지 않는 요청입니다.');
    if (message.type === 'feedback:authorize') {
      if (origin(sender) !== 'https://chatgpt.com' || !validId(message.attempt)) throw Error('GPT 전송 요청을 확인하지 못했습니다.');
      const record = await get(attemptKey(message.attempt));
      if (!record || record.status !== 'ready' || record.targetTab !== sender.tab.id || record.targetDocument !== message.documentKey ||
          record.conversation !== message.conversation || Date.now() - record.created > 60000) throw Error('전송 준비가 만료되거나 변경되었습니다.');
      await freshAttempt(record);
      const page = await info(sender.tab.id);
      if (page.documentKey !== record.targetDocument || page.conversation !== record.conversation) throw Error('GPT 대화가 변경되었습니다.');
      record.status = 'committing';
      await put(attemptKey(message.attempt), record); // 버튼 클릭 전에 기록. 워커 재시작에도 재클릭 금지.
      return { authorized: true };
    }
    if (message.type === 'feedback:hello') {
      if (origin(sender) !== 'https://chatgpt.com') throw Error('GPT 대화가 아닙니다.');
      const page = await info(sender.tab.id);
      if (page?.conversation && await binding(page.conversation)) await chrome.storage.local.set({
        ['feedback-chat:' + page.conversation]: { url: page.url, title: page.title } });
      return {};
    }
    const data = await sourceState(sender);
    if (message.type === 'feedback:load') {
      const d = F.create(data.state), k = draftKey(sender.tab.id, d);
      const saved = await get(k);
      return { draft: saved?.draft || d, ...await choices(data.state) };
    }
    if (message.type === 'feedback:save') {
      const d = F.validate(message.draft);
      if (d.resumeId !== String(data.state.resume.id)) throw Error('지원서가 변경되었습니다.');
      await put(draftKey(sender.tab.id, d), { draft: d, updated: Date.now() });
      return {};
    }
    if (message.type === 'feedback:targets') return choices(data.state);
    if (message.type === 'feedback:select') return select(message, sender, data);
    if (message.type === 'feedback:send') return send(message, sender, data);
    throw Error('알 수 없는 질문 요청입니다.');
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message?.type?.startsWith(prefix) || ['feedback:deliver', 'feedback:page-info'].includes(message.type)) return;
    // 같은 요청의 동시 전송/승인 경쟁을 직렬화한다.
    const operation = message.type + ':' + (message.attempt || sender.tab?.id);
    if (operations.has(operation)) { reply({ ok: false, error: '같은 요청을 처리 중입니다.' }); return; }
    operations.add(operation);
    handle(message, sender).then(data => reply({ ok: true, ...data }), e => reply({ ok: false, error: e.message }))
      .finally(() => operations.delete(operation));
    return true;
  });
  // 세션 보관: 탭이 닫히면 인용 원문과 질문도 정리한다.
  chrome.tabs.onRemoved.addListener(async tabId => {
    const all = await session.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith(prefix + 'draft:' + tabId + ':') ||
      (k.startsWith(prefix + 'attempt:') && all[k].sourceTab === tabId));
    if (keys.length) await session.remove(keys);
  });
})();
