// usage: node late-path.cjs <baseUrl> <outJson> <mode: late|whole>
// A browser on the home page. `late` expects a server whose database is past the
// first-byte budget; `whole` one inside it. GET navigations and clicks on a local
// server only; no production endpoint.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [BASE, OUT, MODE] = process.argv.slice(2);
const SHOTS = 'docs/images/phase94';
const INIT = () => {
  const M = (window.__m = { lcp: [], cls: 0, shifts: [], t: {} });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) M.lcp.push({ t: Math.round(e.startTime), size: e.size, el: e.element ? e.element.tagName.toLowerCase() : null }); }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { M.cls += e.value; M.shifts.push([Math.round(e.startTime), +e.value.toFixed(4), e.sources.map((s) => s.node && (s.node.className || s.node.nodeName)).slice(0, 3)]); } }).observe({ type: 'layout-shift', buffered: true });
  const tick = () => {
    const mark = (k, ok) => { if (ok && !(k in M.t)) M.t[k] = Math.round(performance.now()); };
    mark('h1', document.querySelector('h1'));
    mark('search', document.querySelector('#q'));
    mark('chips', /\d/.test(document.querySelector('.hero-types .chip-count')?.textContent ?? ''));
    mark('feed', document.querySelector('.board .rows li a'));
    mark('sceneLive', document.querySelector('.dock-board')?.dataset.scene === 'live');
    if (!M.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const VIEWS = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 1366, hasTouch: true }, phone: { width: 390, height: 844, hasTouch: true, isMobile: true } };
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = {};
  for (const [name, v] of Object.entries(VIEWS)) {
    const { hasTouch, isMobile, ...viewport } = v;
    for (let i = 0; i < 5; i++) {
      const ctx = await b.newContext({ viewport, hasTouch, isMobile });
      const p = await ctx.newPage();
      const errors = []; p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200))); p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      await p.addInitScript(INIT);
      const shoot = i === 0;
      const nav = p.goto(BASE, { waitUntil: 'commit' });
      await nav;
      if (shoot && MODE === 'late') { await p.waitForSelector('h1'); await p.screenshot({ path: `${SHOTS}/${MODE}-pending-${name}.png` }); }
      await p.waitForFunction(() => /\d/.test(document.querySelector('.hero-types .chip-count')?.textContent ?? ''), null, { timeout: 30000 });
      await p.waitForTimeout(name === 'desktop' ? 3500 : 1500);
      const m = await p.evaluate(() => { const M = window.__m; M.stop = true; const n = performance.getEntriesByType('navigation')[0]; return { ...M, finalHead: Math.round(n.finalResponseHeadersStart || n.responseStart), fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1), scene: document.querySelector('.dock-board')?.dataset.scene, chips: document.querySelector('.hero-types .chip-count')?.textContent, rows: document.querySelectorAll('.board .rows > li').length, placeholders: document.querySelectorAll('.skeleton').length, overflow: document.documentElement.scrollWidth - innerWidth }; });
      if (shoot) await p.screenshot({ path: `${SHOTS}/${MODE}-done-${name}.png` });
      (out[name] ||= []).push({ ...m, errors });
      await ctx.close();
    }
  }
  // Usable before the data: a search and a chip, while the placeholders are up.
  if (MODE === 'late') {
    const ctx = await b.newContext({ viewport: VIEWS.desktop });
    let p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'commit' }); await p.waitForSelector('#q');
    const pending = await p.locator('.skeleton').count();
    await p.fill('#q', 'review'); await p.press('#q', 'Enter'); await p.waitForURL(/\/artifacts\?q=review/);
    out.searchWhilePending = { placeholders: pending, url: p.url().replace(BASE, '') };
    await p.goBack(); await p.waitForFunction(() => /\d/.test(document.querySelector('.hero-types .chip-count')?.textContent ?? ''));
    out.backAfterSearch = { chips: await p.locator('.hero-types .chip-count').first().textContent(), rows: await p.locator('.board .rows > li').count(), skeleton: await p.locator('.skeleton').count() };
    await p.close(); p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'commit' }); await p.waitForSelector('.hero-types a[href$="type=hook"]');
    await p.click('.hero-types a[href$="type=hook"]'); await p.waitForURL(/type=hook/);
    out.chipWhilePending = p.url().replace(BASE, '');
    await ctx.close();
  }
  // JavaScript off.
  { const ctx = await b.newContext({ viewport: VIEWS.desktop, javaScriptEnabled: false }); const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1000);
    out.noJs = { h1: await p.locator('h1').count(), search: await p.locator('#q').count(), chipLinks: await p.locator('.hero-types a').count(), firstChip: await p.locator('.hero-types .chip-count').first().textContent(), rows: await p.locator('.board .rows > li a').count(), skeletonVisible: await p.locator('.skeleton').first().isVisible().catch(() => false), browseLink: await p.locator('.board a[href="/artifacts"]').count() };
    await p.screenshot({ path: `${SHOTS}/${MODE}-nojs-desktop.png` }); await ctx.close(); }
  // Reduced motion.
  { const ctx = await b.newContext({ viewport: VIEWS.desktop, reducedMotion: 'reduce' }); const p = await ctx.newPage(); const errors = []; p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
    await p.goto(BASE); await p.waitForFunction(() => /\d/.test(document.querySelector('.hero-types .chip-count')?.textContent ?? '')); await p.waitForTimeout(1500);
    out.reducedMotion = { scene: await p.locator('.dock-board').getAttribute('data-scene'), canvas: await p.locator('.dock-board canvas').count(), errors }; await ctx.close(); }
  await b.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
  for (const name of Object.keys(VIEWS)) { const r = out[name]; console.log(name, 'head', med(r.map((x) => x.finalHead)), 'fcp', med(r.map((x) => x.fcp)), 'lcp', med(r.map((x) => x.lcp.at(-1).t)), r[0].lcp.at(-1).el, 'h1', med(r.map((x) => x.t.h1)), 'chips', med(r.map((x) => x.t.chips)), 'feed', med(r.map((x) => x.t.feed)), 'cls max', Math.max(...r.map((x) => x.cls)).toFixed(4), 'scene', r[0].scene, 'overflow', r[0].overflow, 'errors', r.flatMap((x) => x.errors).length); }
  for (const k of ['searchWhilePending', 'backAfterSearch', 'chipWhilePending', 'noJs', 'reducedMotion']) if (out[k]) console.log(k, JSON.stringify(out[k]));
})().catch((e) => { console.error(e); process.exit(1); });
