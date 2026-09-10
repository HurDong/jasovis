(function () {
  'use strict';
  const P = globalThis.JSLGpt;
  const entries = new Map(), stale = new WeakMap();
  let current = P.conversation(location.href), busy = false, timer;
  function extract(body) {
    const blocks = [];
    // 블록의 표시 텍스트만 읽는다. pre 안에서는 code.textContent만 사용한다.
    function text(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 || node.matches('button, [data-jsl-gpt], script, style')) return '';
      if (node.tagName === 'BR') return '\n';
      return Array.from(node.childNodes, text).join('');
    }
    function walk(node) {
      if (node.nodeType !== 1 || node.matches('button, [data-jsl-gpt], script, style')) return;
      if (node.matches('table, hr')) { blocks.push({ type: 'boundary' }); return; }
      if (node.tagName === 'PRE') {
        const codes = node.querySelectorAll('code');
        if (codes.length === 1) blocks.push({ type: 'code', text: codes[0].textContent });
        else blocks.push({ type: 'boundary' });
        return;
      }
      if (/^H[1-6]$/.test(node.tagName)) { blocks.push({ type: 'heading', level: Number(node.tagName[1]), text: text(node) }); return; }
      if (node.matches('p, li') && !node.querySelector('pre, h1, h2, h3, h4, h5, h6')) {
        blocks.push({ type: 'text', text: text(node) }); return;
      }
      Array.from(node.children).forEach(walk);
    }
    walk(body);
    return P.parse(blocks);
  }
  const bodyOf = message => message.querySelector('.markdown') || message;
  function complete(message, turn) {
    return !message.closest('[data-is-streaming="true"]') && !turn.querySelector('.result-streaming, [data-is-streaming="true"]') &&
      !!turn.querySelector('[data-testid="copy-turn-action-button"]');
  }
  async function fingerprint(candidates) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(candidates)));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  function valid(entry) {
    return entry.panel.isConnected && entry.message.isConnected && entry.conversation === P.conversation(location.href) &&
      complete(entry.message, entry.turn) && stale.get(entry.message) !== bodyOf(entry.message).textContent;
  }
  async function sourceCheck(entry, expected) {
    if (!valid(entry)) throw Error('대화 또는 응답이 변경되었습니다. 현재 응답에서 다시 적용해 주세요.');
    const candidates = extract(bodyOf(entry.message)), hash = await fingerprint(candidates);
    if (!valid(entry) || (expected && hash !== expected)) throw Error('응답 내용이 변경되었습니다. 다시 적용해 주세요.');
    return { candidates, fingerprint: hash };
  }
  async function send(entry, type, data = {}, expected) {
    const snapshot = await sourceCheck(entry, expected);
    const result = await chrome.runtime.sendMessage({ type, conversation: entry.conversation, response: entry.id,
      fingerprint: snapshot.fingerprint, ...data });
    if (!result?.ok) throw Error(result?.error || '확장과 페이지를 새로고침해 주세요.');
    await sourceCheck(entry, snapshot.fingerprint);
    return result;
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message.type !== 'gpt:source-check') return;
    const entry = entries.get(message.response);
    if (!entry || entry.conversation !== message.conversation) { reply({ valid: false }); return; }
    sourceCheck(entry, message.fingerprint).then(() => reply({ valid: true }), () => reply({ valid: false }));
    return true;
  });
  function el(tag, value, className) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  function button(label, action, className) {
    const node = el('button', label, className); node.type = 'button';
    node.addEventListener('click', action); return node;
  }
  function linkText(entry, link) {
    entry.link = link;
    entry.connected.textContent = link ? '연결: ' + link.resume.title : '이 대화에 연결된 지원서 없음';
    entry.change.hidden = !link; entry.unlink.hidden = !link;
  }
  async function task(entry, fn) {
    if (busy) { entry.status.textContent = '다른 응답의 입력을 처리 중입니다.'; return; }
    busy = true;
    document.querySelectorAll('[data-jsl-gpt] button').forEach(b => { b.disabled = true; });
    try { await fn(); }
    catch (e) { if (entry.panel.isConnected) entry.status.textContent = e.message; }
    finally {
      busy = false;
      document.querySelectorAll('[data-jsl-gpt] button').forEach(b => { b.disabled = false; });
    }
  }
  function chooseTargets(entry, info, connect, expected, applyAfter = true) {
    entry.choices.replaceChildren();
    const tabs = connect ? info.targets : info.targets.filter(t => t.resumeId === entry.link?.resume.id);
    entry.status.textContent = tabs.length ? (connect ? '이 대화에 연결할 지원서를 선택해 주세요.' : '입력할 지원서 탭을 선택해 주세요.') : '지원서 탭이 없습니다. 지원서를 연 뒤 다시 적용해 주세요.';
    for (const tab of tabs) entry.choices.append(button((tab.title || '지원서') + ' · 창 ' + tab.windowId + ' / 탭 ' + tab.id, () => task(entry, async () => {
      await sourceCheck(entry, expected);
      if (connect) linkText(entry, (await send(entry, 'gpt:connect', { tabId: tab.id }, expected)).link);
      if (applyAfter) await apply(entry, tab.id, {}, expected);
      else { entry.choices.replaceChildren(); entry.status.textContent = '연결을 변경했습니다. 이 응답을 입력하려면 자소설에 적용을 눌러 주세요.'; }
    })));
    if (!tabs.length) entry.choices.append(button(connect ? '지원서 목록 열기' : '연결된 지원서 열기', () => task(entry, async () => {
      await send(entry, 'gpt:open', { list: connect }, expected);
      entry.status.textContent = '지원서가 준비되면 이 응답의 자소설에 적용을 다시 눌러 주세요.';
    })));
  }
  function chooseMapping(entry, mapping, tabId, expected) {
    entry.choices.replaceChildren(); entry.status.textContent = '자동으로 대응할 수 없는 답변이 있습니다. 대상 또는 제외를 선택해 주세요.';
    const selects = [];
    for (const row of mapping.rows) {
      const item = el('div', null, 'jsl-gpt-candidate');
      item.append(el('strong', row.candidate.number ? '응답 문항 ' + row.candidate.number : '번호 없는 답변'));
      if (row.candidate.question) item.append(el('div', row.candidate.question));
      if (row.reason) item.append(el('div', row.reason, 'jsl-gpt-muted'));
      const detail = el('details'); detail.append(el('summary', '답변 내용 확인'), el('pre', row.candidate.text)); item.append(detail);
      const select = el('select'); select.setAttribute('aria-label', '답변 후보 ' + (Number(row.candidate.key) + 1) + '의 대상 문항');
      for (const [value, label] of [['', '대상 문항 선택'], ['skip', '이 답변 제외'], ...mapping.qnas.map(q => [q.id, '문항 ' + q.number + ' · ' + q.question])]) {
        const option = el('option', label); option.value = value; select.append(option);
      }
      select.value = row.target || ''; item.append(select); selects.push([row.candidate.key, select]); entry.choices.append(item);
    }
    entry.choices.append(button('선택한 문항에 적용', () => task(entry, async () => {
      if (selects.some(([, select]) => !select.value)) throw Error('각 답변의 대상 문항 또는 제외를 선택해 주세요.');
      await apply(entry, tabId, Object.fromEntries(selects.map(([key, s]) => [key, s.value])), expected);
    }), 'jsl-gpt-primary'));
  }
  async function apply(entry, tabId, choices = {}, expected) {
    const snapshot = await sourceCheck(entry, expected);
    entry.choices.replaceChildren(); entry.status.textContent = '지원서와 문항 확인 중…';
    const info = await send(entry, 'gpt:info', {}, snapshot.fingerprint); linkText(entry, info.link);
    if (!info.link) { chooseTargets(entry, info, true, snapshot.fingerprint); return; }
    const result = await send(entry, 'gpt:prepare', { revision: info.link.revision, candidates: snapshot.candidates, choices,
      ...(tabId == null ? {} : { tabId }) }, snapshot.fingerprint);
    if (result.chooseTab) { chooseTargets(entry, result, false, snapshot.fingerprint); return; }
    if (result.mapping) { chooseMapping(entry, result.mapping, tabId, snapshot.fingerprint); return; }
    entry.status.textContent = result.title + ' · 문항 ' + result.numbers.join(', ') + ' 입력 중…';
    const applied = await send(entry, 'gpt:apply', { revision: info.link.revision, token: result.token }, snapshot.fingerprint);
    entry.status.textContent = applied.error || applied.status || '입력 결과 확인 불가 · 지원서에서 현재 내용을 확인해 주세요.';
  }
  function attach(message, turn, body) {
    const panel = el('div'); panel.dataset.jslGpt = 'true';
    const entry = { id: crypto.randomUUID(), conversation: current, panel, message, turn };
    panel.dataset.jslGptResponse = entry.id;
    entry.status = el('div', '', 'jsl-gpt-status'); entry.status.setAttribute('role', 'status');
    entry.connected = el('span', '', 'jsl-gpt-muted'); entry.choices = el('div', null, 'jsl-gpt-choices');
    entry.change = button('연결 변경', () => task(entry, async () => {
      const snapshot = await sourceCheck(entry);
      const info = await send(entry, 'gpt:info', {}, snapshot.fingerprint);
      chooseTargets(entry, info, true, snapshot.fingerprint, false);
    }));
    entry.unlink = button('연결 해제', () => task(entry, async () => {
      await send(entry, 'gpt:unlink'); entry.choices.replaceChildren(); linkText(entry, null); entry.status.textContent = '이 대화의 연결을 해제했습니다.';
    }));
    const actions = el('div', null, 'jsl-gpt-actions');
    actions.append(button('자소설에 적용', () => task(entry, () => apply(entry)), 'jsl-gpt-primary'), entry.connected, entry.change, entry.unlink);
    panel.append(actions, entry.status, entry.choices);
    // article 전체가 아니라 markdown과 같은 부모/폭에 둔다.
    if (body === message) message.append(panel); else body.after(panel);
    entries.set(entry.id, entry); linkText(entry, null);
    send(entry, 'gpt:info').then(info => { if (valid(entry)) linkText(entry, info.link); }).catch(() => {});
  }
  function scan() {
    // React가 메시지를 복제해 복구하더라도 복제된 확장 DOM에는 이벤트/상태가 없다.
    document.querySelectorAll('[data-jsl-gpt]').forEach(panel => {
      if (!Array.from(entries.values()).some(entry => entry.panel === panel)) panel.remove();
    });
    const next = P.conversation(location.href);
    if (next !== current) {
      for (const entry of entries.values()) { entry.panel.remove(); stale.set(entry.message, bodyOf(entry.message).textContent); }
      entries.clear(); current = next;
    }
    for (const [id, entry] of entries) {
      if (!valid(entry) || !extract(bodyOf(entry.message)).length) { entry.panel.remove(); entries.delete(id); }
    }
    if (!current) return;
    document.querySelectorAll('[data-message-author-role="assistant"]').forEach(message => {
      const turn = message.closest('article, [data-testid^="conversation-turn-"]'), body = bodyOf(message);
      if (!turn || !complete(message, turn) || stale.get(message) === body.textContent || !extract(body).length || Array.from(entries.values()).some(e => e.message === message)) return;
      attach(message, turn, body);
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes['gpt-conversation:' + current];
    if (area === 'local' && change) for (const entry of entries.values()) {
      linkText(entry, change.newValue || null); entry.choices.replaceChildren();
    }
  });
  new MutationObserver(records => {
    if (records.every(r => r.target.nodeType === 1 ? r.target.closest('[data-jsl-gpt]') : r.target.parentElement?.closest('[data-jsl-gpt]'))) return;
    clearTimeout(timer); timer = setTimeout(scan, 180);
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'class'] });
  // pushState 자체가 DOM을 즉시 바꾸지 않는 경우도 처리한다.
  setInterval(() => { if (P.conversation(location.href) !== current) scan(); }, 500);
  scan();
})();
