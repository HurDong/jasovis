const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const engine of ['react', 'angular']) {
      const page = await browser.newPage();
      await page.setContent('<p id="outside">편집기에서 선택해 둔 가상 문장</p><div ng-controller="ChatCtrl"><div class="chat-container chat-window"><div id="chatBody" class="chatBody-10" style="height:300px;width:380px;overflow:auto"></div></div></div><textarea id="draft">전송하지 않은 가상 초안</textarea>');
      await page.evaluate(engine => {
        window.engine = engine;
        window.panel = document.getElementById('chatBody');
        if (engine === 'angular') { panel.removeAttribute('id'); panel.className = 'chat-message-container'; }
        window.quoteSelector = engine === 'react' ? 'blockquote' : '.message_target-message';
        window.row = (id, target) => {
          const el = document.createElement('div');
          el.style.minHeight = '100px';
          if (engine === 'react') {
            el.id = 'chat-message-' + id;
            el.__reactProps$fixture = { children: { props: { message: { id, chat_id: 10,
              target_message: target ? { id: target, chat_id: 10, remove_status: 1 } : null } } } };
          } else { el.className = 'message-content'; el.setAttribute('message_id', id); }
          el.innerHTML = target ? (engine === 'react'
            ? '<blockquote data-sentry-component="TargetMessage">가상 원본 인용</blockquote>'
            : '<div class="message_target-message">가상 원본 인용</div>') : '가상 원본';
          return el;
        };
        panel.append(row(100), row(200, 100));
        window.replaceReply = () => panel.lastElementChild.replaceWith(row(200, 100));
        const scope = { current_chat: { id: 10 }, is_open_chat: true, $root: {}, $apply: fn => fn(), $broadcast: () => {} };
        window.angular = { element: () => ({ scope: () => scope, injector: () => ({ get: () => ({ get: async () => {
          if (window.replaceDuringResolve) replaceReply();
          return { data: [{ id: 200, chat_id: 10, target_message: { id: 100, chat_id: 10, remove_status: 1 } }] };
        } }) }) }) };
        window.bridgeRequest = (action, payload) => new Promise(resolve => {
          const id = 9000 + Math.random();
          const listener = ev => { if (ev.detail.id === id) { removeEventListener('JSL_CHAT_RES', listener); resolve(ev.detail.result); } };
          addEventListener('JSL_CHAT_RES', listener);
          dispatchEvent(new CustomEvent('JSL_CHAT_REQ', { detail: { id, action, payload: { engine, ...payload } } }));
        });
      }, engine);
      for (const file of ['src/core/chat-' + (engine === 'react' ? 'react-main' : 'main') + '.js', 'src/features/chat-reply.js']) {
        const content = process.env.JSL_REPLY_BASELINE
          ? execFileSync('git', ['show', '5a44033:' + file], { cwd: root, encoding: 'utf8' })
          : fs.readFileSync(path.join(root, file), 'utf8');
        await page.addScriptTag({ content });
      }
      // A selection elsewhere must not silently block the quote action.
      if (process.env.JSL_REPLY_CASE !== 'replacement') {
      await page.evaluate(() => {
        const range = document.createRange(); range.selectNodeContents(document.getElementById('outside'));
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        panel.querySelector(quoteSelector).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForFunction(() => document.getElementById('jsl-chat-reply')?.dataset.mode === 'ready', null, { timeout: 2500 });
      await page.getByRole('button', { name: '답글로 돌아가기', exact: true }).click();
      assert.equal(await page.locator('#jsl-chat-reply').isVisible(), false);

      // Quote text selection still supports copying without starting navigation.
      await page.evaluate(() => {
        const quote = panel.querySelector(quoteSelector), range = document.createRange(); range.selectNodeContents(quote);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        quote.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      assert.equal(await page.locator('#jsl-chat-reply').isVisible(), false);

      // Replace the same reply row while resolving/loading: keep navigation and return working.
      }
      await page.evaluate(() => {
        getSelection().removeAllRanges();
        panel.firstElementChild.remove();
        window.replaceDuringResolve = true;
        const quote = panel.querySelector(quoteSelector);
        quote.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        if (engine === 'react') replaceReply();
        // Simulate a delayed older-message page and another render while waiting.
        setTimeout(replaceReply, 300);
        setTimeout(() => panel.prepend(row(100)), 600);
      });
      await page.waitForFunction(() => document.getElementById('jsl-chat-reply')?.dataset.mode === 'ready' && !document.getElementById('jsl-chat-reply').hidden, null, { timeout: 2500 });
      await page.getByRole('button', { name: '답글로 돌아가기', exact: true }).click();
      assert.equal(await page.locator('#jsl-chat-reply').isVisible(), false);
      assert.equal(await page.locator('#draft').inputValue(), '전송하지 않은 가상 초안');

      // Fresh-node support must still reject target tampering and cancellation.
      const result = await page.evaluate(async () => {
        const resolved = await bridgeRequest('resolveReply', { replyId: 200 });
        replaceReply();
        const moved = await bridgeRequest('jump', resolved);
        const tampered = await bridgeRequest('jump', { ...resolved, targetId: 101 });
        await bridgeRequest('cancel', {});
        const cancelled = await bridgeRequest('jump', resolved);
        return { moved, tampered, cancelled };
      });
      assert.equal(result.moved.ok, true);
      assert.equal(result.tampered.ok, false);
      assert.equal(result.cancelled.ok, false);
      await page.close();
    }
    console.log('PASS: Angular/React quote selection, replaced reply rows, original navigation/return, draft preservation, target validation and cancellation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
