// 자소설 → 이미 연결된 웹 GPT → 자소설. 사용자가 보내기를 누른 질문만 전달하고, 그 질문의 답만 읽어 보관한다.
// 자소설 탭마다 질문 칸은 하나다. 새로 보내면 이전 질문 기록을 지운다. 탭은 옮기지 않는다.
(function () {
  'use strict';
  const F = JSLFeedback, prefix = 'feedback:', operations = new Set();
  const session = chrome.storage.session;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const get = async k => (await session.get(k))[k];
  const put = (k, value) => session.set({ [k]: value });
  const attemptKey = id => prefix + 'attempt:' + id;
  const slotKey = tab => prefix + 'slot:' + tab;
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
  const info = tab => chrome.tabs.sendMessage(tab, { type: 'feedback:page-info' }, { frameId: 0 });
  const BLOCK_TYPES = new Set(['heading', 'text', 'code', 'boundary']);
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
    if (data.documentKey !== record.documentKey) throw Error('자소설 페이지가 새로고침되었습니다. 다시 보내 주세요.');
    F.check(record.ask, data.state);
    if (data.editorAnswer !== record.ask.answer) throw Error('답변 입력란의 원문이 바뀌거나 읽히지 않습니다. 다시 보내 주세요.');
    const link = await binding(record.conversation);
    if (!link || link.revision !== record.revision || !JSLGpt.sameQuestions(link, data.state)) throw Error('GPT 연결 또는 지원서 문항이 변경되었습니다. 대화를 다시 골라 주세요.');
  }
  // 열린 대화 탭을 쓰고, 없으면 뒤에 연다. 보내는 동안 사용자의 탭은 옮기지 않는다.
  async function targetTab(conversation) {
    const tabs = (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(t => JSLGpt.conversation(t.url) === conversation);
    if (tabs.length > 1) throw Error('같은 GPT 대화가 여러 탭에 열려 있습니다. 사용할 탭 하나만 남겨 주세요.');
    if (tabs.length) return tabs[0];
    const meta = (await chrome.storage.local.get('feedback-chat:' + conversation))['feedback-chat:' + conversation];
    const url = meta?.url && JSLGpt.conversation(meta.url) === conversation && new URL(meta.url).origin === 'https://chatgpt.com'
      ? meta.url : 'https://chatgpt.com/c/' + conversation;
    return chrome.tabs.create({ url, active: false });
  }
  async function activate(tabId) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  }
  // 자소설 화면에 보여줄 요청 요약. 답변 원문·프롬프트는 돌려주지 않는다.
  function summary(id, record) {
    if (!record) return null;
    return { id, status: record.status, error: record.error || '', conversation: record.conversation, sentAt: record.sentAt || null,
      streaming: !!record.progress?.streaming, reply: record.reply || null, lost: !!record.lost, review: record.review || null,
      request: record.request ? structuredClone(record.request) : null };
  }
  const lineOf = record => F.headline(record.request.number);
  // 확인 불가로 멈춘 요청을 사용자가 "보냈어요"라고 확인한 경우. 다시 보내지 않고, 열린 대화에서 첫 줄로 보낸 메시지를 찾아 답을 기다린다.
  async function claim(message, sender) {
    if (!validId(message.attempt)) throw Error('요청 기록을 찾지 못했습니다.');
    const key = attemptKey(message.attempt), record = await get(key);
    if (!record || record.sourceTab !== sender.tab.id || !record.request) throw Error('요청 기록을 찾지 못했습니다.');
    if (record.status === 'sent' && record.userMessage) return { status: 'sent' };
    if (record.status === 'blocked') throw Error('보내지 못한 요청입니다. 다시 보내 주세요.');
    const tabs = (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(t => JSLGpt.conversation(t.url) === record.conversation);
    if (tabs.length > 1) throw Error('같은 GPT 대화가 여러 탭에 열려 있습니다. 하나만 남긴 뒤 다시 눌러 주세요.');
    if (!tabs.length) throw Error('보낸 GPT 대화 탭이 열려 있지 않습니다. GPT에서 확인을 눌러 대화를 연 뒤 다시 눌러 주세요.');
    let found;
    try { found = await chrome.tabs.sendMessage(tabs[0].id, { type: 'feedback:locate', line: lineOf(record) }, { frameId: 0 }); }
    catch { throw Error('GPT 대화 페이지를 읽지 못했습니다. GPT 탭을 새로고침한 뒤 다시 눌러 주세요.'); }
    if (found?.conversation !== record.conversation || !validId(found.messageId)) throw Error('GPT 대화에서 보낸 요청을 찾지 못했습니다. 실제로 보내지 않았다면 다시 보내기를 눌러 주세요.');
    Object.assign(record, { status: 'sent', userMessage: found.messageId, sentAt: record.sentAt || Date.now(), error: '', targetTab: tabs[0].id, lost: false });
    await put(key, record);
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'feedback:start-watch', attempt: message.attempt, messageId: found.messageId, line: lineOf(record) }, { frameId: 0 }).catch(() => {});
    await notify(record, message.attempt);
    return { status: 'sent' };
  }
  async function notify(record, id) {
    try {
      await chrome.tabs.sendMessage(record.sourceTab, { type: 'feedback:changed', attempt: id, done: !!record.reply,
        questionId: record.request?.questionId, number: record.request?.number }, { frameId: 0 });
    }
    catch { /* 자소설 탭이 닫혔거나 새로고침 중이면 다음 불러오기에서 반영된다. */ }
  }
  async function waitReady(tabId, conversation) {
    let page;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try { page = await info(tabId); } catch { /* 새 탭의 콘텐츠 스크립트 로드를 기다린다. */ }
      if (page?.conversation === conversation && page.ready) return page;
      await wait(250);
    }
    throw Error('GPT 입력창을 준비하지 못했습니다. 로그인과 페이지 로딩을 확인해 주세요.');
  }
  // 질문 칸은 하나다. GPT에 갔을 수 있는 질문만 칸을 차지하고, 이전 질문(답을 기다리던 것 포함)은 지운다.
  async function occupy(tab, id) {
    const old = await get(slotKey(tab));
    if (old && old !== id) await session.remove(attemptKey(old));
    await put(slotKey(tab), id);
  }
  async function send(message, sender, data) {
    const a = F.validate(message.ask), id = message.attempt;
    F.check(a, data.state);
    if (!validId(id) || !validId(message.conversation)) throw Error('보내기를 다시 눌러 주세요.');
    const previous = await get(attemptKey(id));
    if (previous) {
      if (previous.sourceTab !== sender.tab.id) throw Error('다른 탭의 전송 요청입니다.');
      return { status: previous.status === 'sent' || previous.status === 'blocked' ? previous.status : 'unknown',
        error: previous.error || '이미 처리한 요청입니다. GPT 대화를 확인해 주세요.' };
    }
    const lock = 'conversation:' + message.conversation, resumeLock = 'resume:' + a.resumeId;
    if (locks.has(lock) || locks.has(resumeLock)) throw Error('이 대화 또는 지원서에서 다른 작업을 처리 중입니다.');
    locks.add(lock); locks.add(resumeLock);
    const record = { sourceTab: sender.tab.id, documentKey: data.documentKey, conversation: message.conversation, ask: a,
      request: { resumeId: a.resumeId, questionId: a.question.id, number: a.question.number,
        quote: { text: a.quote.text, start: a.quote.start }, request: a.request },
      status: 'preparing', created: Date.now() };
    let flashed = false;
    try {
      const link = await binding(record.conversation);
      if (!link || link.resume.id !== a.resumeId) throw Error('이 지원서와 연결된 GPT 대화를 골라 주세요.');
      record.revision = link.revision;
      await put(attemptKey(id), record);
      await freshAttempt(record);
      const tab = await targetTab(record.conversation);
      record.targetTab = tab.id;
      let page = await waitReady(tab.id, record.conversation);
      const deliver = async background => {
        record.targetDocument = page.documentKey;
        await freshAttempt(record);
        record.status = 'ready'; record.created = Date.now();
        await put(attemptKey(id), record);
        return chrome.tabs.sendMessage(tab.id, { type: 'feedback:deliver', attempt: id, background,
          conversation: record.conversation, documentKey: page.documentKey, prompt: F.prompt(a) }, { frameId: 0 });
      };
      let result = await deliver(true);
      if (result?.status === 'blocked' && result.retry && !tab.active) {
        // 뒤에 있는 탭에서 입력이 반영되지 않았다(넣은 글은 지웠다). 잠깐 앞으로 가져와 넣고 곧바로 자소설로 돌아온다.
        flashed = true;
        await activate(tab.id);
        page = await waitReady(tab.id, record.conversation);
        result = await deliver(false);
      }
      if (!['sent', 'blocked', 'unknown'].includes(result?.status)) throw Error('GPT 전송 응답을 확인하지 못했습니다.');
      record.status = result.status;
      // client의 blocked는 클릭하지 않았다는 확정 응답이다. 채널 실패는 아래 catch에서 별도로 처리한다.
      record.error = result.error;
      if (result.status === 'sent') {
        record.userMessage = validId(result.messageId) ? result.messageId : null;
        record.sentAt = Date.now();
        if (!record.userMessage) { record.status = 'unknown'; record.error = '보낸 메시지를 찾지 못해 답을 기다릴 수 없습니다. GPT 대화에서 확인해 주세요.'; }
      }
      delete record.ask; // 답변 원문은 남기지 않는다. 판독과 되돌리기에 필요한 고른 곳·질문만 request에 있다.
      await put(attemptKey(id), record);
      if (record.status !== 'blocked') await occupy(sender.tab.id, id);
      return { status: record.status, error: record.error };
    } catch (e) {
      const latest = await get(attemptKey(id));
      record.status = latest?.status === 'committing' ? 'unknown' : 'blocked';
      record.error = e.message;
      delete record.ask;
      await put(attemptKey(id), record);
      if (record.status !== 'blocked') await occupy(sender.tab.id, id);
      return { status: record.status, error: e.message };
    } finally {
      if (flashed) await activate(sender.tab.id).catch(() => {});
      locks.delete(lock); locks.delete(resumeLock);
    }
  }
  function cleanBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length > 400) throw Error('GPT 답 형식을 읽지 못했습니다.');
    return blocks.map(b => {
      if (!b || !BLOCK_TYPES.has(b.type) || (b.text != null && typeof b.text !== 'string')) throw Error('GPT 답 형식을 읽지 못했습니다.');
      return { type: b.type, text: String(b.text || '').slice(0, 20000) };
    });
  }
  // GPT 탭의 감시자가 보낸 답. 보낸 요청의 바로 다음 답만 받는다.
  async function reply(message, sender) {
    if (origin(sender) !== 'https://chatgpt.com' || !validId(message.attempt) || !validId(message.messageId)) throw Error('GPT 답을 확인하지 못했습니다.');
    const record = await get(attemptKey(message.attempt));
    const conversation = JSLGpt.conversation(sender.tab.url || sender.url);
    // 클릭 직후에는 워커가 아직 전송 결과를 기록하기 전이다. 감시자는 잠시 뒤 다시 보낸다.
    if (record && ['ready', 'committing'].includes(record.status) && record.conversation === conversation) return { done: false, pending: true };
    if (!record || record.status !== 'sent' || record.conversation !== conversation || record.userMessage !== message.messageId)
      throw Object.assign(Error('기다리는 요청이 아닙니다.'), { gone: true });
    if (record.reply) return { done: true };
    const blocks = cleanBlocks(message.blocks);
    record.targetTab = sender.tab.id;
    if (message.phase === 'complete') {
      record.reply = { item: F.parseAnswer(blocks, record.request.quote.text), completedAt: Date.now() };
      record.progress = { streaming: false };
      record.lost = false;
      await put(attemptKey(message.attempt), record);
      await notify(record, message.attempt);
      return { done: true };
    }
    if (record.lost || !record.progress?.streaming) {
      record.progress = { streaming: true };
      record.lost = false;
      await put(attemptKey(message.attempt), record);
      await notify(record, message.attempt);
    }
    return { done: false };
  }
  function cleanReview(review, record) {
    if (review == null) return null;
    const text = v => typeof v === 'string' && v.length <= F.LIMIT.replacement;
    if (review.state === 'stale') return { state: 'stale' };
    if (review.state === 'applied' && Number.isInteger(review.at) && review.at >= 0 && text(review.replacement) && text(review.original) &&
        review.original === record.request?.quote.text && review.replacement === record.reply?.item?.replacement) {
      return { state: 'applied', at: review.at, replacement: review.replacement, original: review.original };
    }
    throw Error('받은 결과를 기록하지 못했습니다.');
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
    if (message.type === 'feedback:reply') return reply(message, sender);
    if (message.type === 'feedback:watch') {
      if (origin(sender) !== 'https://chatgpt.com') throw Error('GPT 대화가 아닙니다.');
      const conversation = JSLGpt.conversation(sender.tab.url || sender.url), all = await session.get(null), waiting = [];
      if (!conversation) return { waiting };
      for (const [k, record] of Object.entries(all)) {
        if (!k.startsWith(prefix + 'attempt:') || record.status !== 'sent' || record.reply || record.conversation !== conversation || !record.userMessage) continue;
        waiting.push({ attempt: k.slice((prefix + 'attempt:').length), messageId: record.userMessage, line: lineOf(record) });
        if (record.lost || record.targetTab !== sender.tab.id) {
          record.lost = false; record.targetTab = sender.tab.id;
          await put(k, record); await notify(record, k.slice((prefix + 'attempt:').length));
        }
      }
      return { waiting };
    }
    const data = await sourceState(sender);
    if (message.type === 'feedback:load') {
      const id = await get(slotKey(sender.tab.id)), record = validId(id) ? await get(attemptKey(id)) : null;
      const mine = record && record.sourceTab === sender.tab.id && record.request?.resumeId === String(data.state.resume.id);
      return { attempt: mine ? summary(id, record) : null, ...await choices(data.state) };
    }
    if (message.type === 'feedback:targets') return choices(data.state);
    if (message.type === 'feedback:select') return select(message, sender, data);
    if (message.type === 'feedback:send') return send(message, sender, data);
    if (message.type === 'feedback:claim') return claim(message, sender);
    if (message.type === 'feedback:review') {
      if (!validId(message.attempt)) throw Error('요청 기록을 찾지 못했습니다.');
      const record = await get(attemptKey(message.attempt));
      if (!record || record.sourceTab !== sender.tab.id || !record.reply) throw Error('요청 기록을 찾지 못했습니다.');
      record.review = cleanReview(message.review, record);
      await put(attemptKey(message.attempt), record);
      return {};
    }
    if (message.type === 'feedback:focus') {
      let conversation = message.conversation;
      if (validId(message.attempt)) {
        const record = await get(attemptKey(message.attempt));
        if (!record || record.sourceTab !== sender.tab.id) throw Error('요청 기록을 찾지 못했습니다.');
        conversation = record.conversation;
      }
      if (!validId(conversation)) throw Error('열 GPT 대화를 골라 주세요.');
      const link = await binding(conversation);
      if (link && link.resume.id !== String(data.state.resume.id)) throw Error('다른 지원서에 연결된 대화입니다.');
      const tab = await targetTab(conversation);
      await activate(tab.id);
      return { focused: true };
    }
    if (message.type === 'feedback:dismiss') {
      if (!validId(message.attempt)) throw Error('요청 기록을 찾지 못했습니다.');
      const record = await get(attemptKey(message.attempt));
      if (record && record.sourceTab !== sender.tab.id) throw Error('다른 탭의 요청입니다.');
      if (record) await session.remove(attemptKey(message.attempt));
      if (await get(slotKey(sender.tab.id)) === message.attempt) await session.remove(slotKey(sender.tab.id));
      return {};
    }
    throw Error('알 수 없는 질문 요청입니다.');
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message?.type?.startsWith(prefix) || ['feedback:deliver', 'feedback:page-info', 'feedback:changed', 'feedback:locate', 'feedback:start-watch'].includes(message.type)) return;
    // 같은 요청의 동시 전송/승인 경쟁을 직렬화한다.
    const operation = message.type + ':' + (message.attempt || sender.tab?.id);
    if (operations.has(operation)) { reply({ ok: false, busy: true, error: '같은 요청을 처리 중입니다.' }); return; }
    operations.add(operation);
    // 응답 전에 풀어야 연속 요청(스트리밍 → 완료)이 '처리 중'에 걸리지 않는다.
    handle(message, sender).finally(() => operations.delete(operation))
      .then(data => reply({ ok: true, ...data }), e => reply({ ok: false, error: e.message, ...(e.gone ? { gone: true } : {}) }));
    return true;
  });
  // 세션 보관: 자소설 탭이 닫히면 질문·답을 정리한다. GPT 탭이 닫히면 기다리는 요청에 표시한다.
  chrome.tabs.onRemoved.addListener(async tabId => {
    const all = await session.get(null), remove = [];
    for (const [k, record] of Object.entries(all)) {
      if (k === slotKey(tabId) || (k.startsWith(prefix + 'attempt:') && record.sourceTab === tabId)) { remove.push(k); continue; }
      if (k.startsWith(prefix + 'attempt:') && record.targetTab === tabId && record.status === 'sent' && !record.reply && !record.lost) {
        record.lost = true;
        await put(k, record);
        await notify(record, k.slice((prefix + 'attempt:').length));
      }
    }
    if (remove.length) await session.remove(remove);
  });
})();
