// usage: node search-bench.cjs <baseUrl> <label> <out.jsonl>  — local only.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs'); const crypto = require('crypto');
const [base, label, out] = process.argv.slice(2);
const Q = ['ponytail', 'mcp', 'plugin', 'agent', 'skill', 'hooks', '코드 리뷰', 'コードレビュー', 'no-such-word-anywhere', '"quoted phrase"', '<script>alert(1)</script>', "' or 1=1 --", 'a%20b', 'REVIEW', '   spaced   ', '𝕏😀', 'x'.repeat(200)];
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  for (const q of Q) {
    const url = `${base}/artifacts?q=${encodeURIComponent(q)}`;
    const ttfb = []; let status = 0;
    for (let i = 0; i < 12; i++) { const s = performance.now(); const r = await fetch(url); const rd = r.body.getReader(); await rd.read(); ttfb.push(performance.now() - s); await rd.cancel(); status = r.status; }
    const fcps = []; let page = null;
    for (let i = 0; i < 3; i++) {
      await p.goto(url, { waitUntil: 'load' }); await p.locator('main h1').first().waitFor();
      page = await p.evaluate(() => { const ids = [...document.querySelectorAll('.rows:not([aria-hidden]) .row-title a')].map((a) => a.getAttribute('href')); return { fcp: performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? null, dom: document.getElementsByTagName('*').length, rows: ids.length, ids, count: document.querySelector('.result-count')?.textContent?.trim().slice(0, 60) ?? null, overflow: document.documentElement.scrollWidth - innerWidth }; });
      fcps.push(page.fcp);
    }
    const row = { label, q: q.slice(0, 24), status, ttfbMed: +med(ttfb.slice(2)).toFixed(1), fcpMed: Math.round(med(fcps)), dom: page.dom, rows: page.rows, count: page.count, order: crypto.createHash('md5').update(page.ids.join('\n')).digest('hex').slice(0, 10), overflow: page.overflow };
    fs.appendFileSync(out, `${JSON.stringify(row)}\n`); console.log(JSON.stringify(row));
  }
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
