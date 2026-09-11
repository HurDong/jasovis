// 실제 통계 스크립트/CSS + 가상 상태. 실사이트나 사용자 프로필은 사용하지 않는다.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2400, height: 900 } });
    await page.setContent('<html class="jsl-fit"><body style="margin:0;font-family:Arial,sans-serif"><main><div class="scheduler"></div></main></body></html>');
    await page.addStyleTag({ content: process.env.JSL_STATS_BASELINE
      ? require('node:child_process').execFileSync('git', ['show', 'HEAD:src/features/list-design.css'], { cwd: root, encoding: 'utf8' })
      : fs.readFileSync(path.join(root, 'src/features/list-design.css'), 'utf8') });
    await page.evaluate(() => { window.JSL = { register: (_, fn) => fn(), onState: fn => { window.sendState = fn; } }; });
    await page.addScriptTag({ path: path.join(root, 'src/features/list-stats.js') });
    for (const counts of [[31, 13, 3, 17, 0, 2, 2, 2, 1, 1], [1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [999, 1, 1, 999, 2, 1, 1, 1, 1, 1], Array(10).fill(0)]) {
      await page.evaluate(counts => window.sendState({ page: 'list', resumes: counts.flatMap((n, category) => Array.from({ length: n }, () => ({ category }))) }), counts);
      const originalText = await page.locator('#jsl-track').textContent();
      for (const width of [2300, 1920, 1600, 1440, 1439, 1244, 1100, 1000, 999, 768, 1440]) {
        // list-layout가 scheduler.clientWidth로 설정하는 기존 상태를 재현한다.
        await page.evaluate(width => {
          document.querySelector('main').style.width = width + 'px';
          document.documentElement.classList.toggle('jsl-compact', width < 1440);
          document.documentElement.classList.toggle('jsl-narrow', width < 1000);
        }, width);
        assert.equal(await page.locator('#jsl-track').textContent(), originalText);
        if (width < 1000) {
          assert.equal(await page.locator('#jsl-track').isVisible(), false);
          continue;
        }
        const errors = await page.evaluate(() => {
          const errors = [];
          const rect = el => el.getBoundingClientRect();
          for (const cell of document.querySelectorAll('#jsl-track .jsl-tn')) {
            const bounds = rect(cell);
            for (const child of cell.querySelectorAll('.jsl-bd, .jsl-mix, .jsl-legend, .jsl-gauge, .jsl-meta, .jsl-link')) {
              const r = rect(child);
              if (r.left < bounds.left - 1 || r.right > bounds.right + 1 || child.scrollWidth > child.clientWidth + 1) errors.push(child.className);
            }
            const parts = [...cell.querySelectorAll('.jsl-sum, .jsl-mix, .jsl-gauge, .jsl-meta, .jsl-link')].map(rect);
            parts.forEach((a, i) => parts.slice(i + 1).forEach(b => {
              if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) errors.push('overlap');
            }));
          }
          return errors;
        });
        assert.deepEqual(errors, [], `width=${width}, counts=${counts}`);
        if (process.env.JSL_STATS_SCREENSHOT && width === 1244 && counts[0] === 31) await page.locator('#jsl-track').screenshot({ path: process.env.JSL_STATS_SCREENSHOT });
      }
    }
    console.log('PASS: statistics stay within their cells at 1000–2300px, narrow visibility, resize restoration, empty/skewed counts');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
