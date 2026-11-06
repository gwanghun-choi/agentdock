// usage: node compat.cjs <chromium|firefox|webkit> <outDir>   READ ONLY: GET navigations and clicks on links.
const pw = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [engine, out] = process.argv.slice(2);
const BASE = 'https://agentdock-delta.vercel.app';
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { engine, checks: [], errors: [], failed: [] };
let reqs = 0;
const check = (name, ok, detail) => { R.checks.push({ name, ok, detail }); console.log(engine, ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INFO', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 220)); };
const attempt = async (name, f) => { try { await f(); } catch (e) { check(name, false, 'threw: ' + String(e).split('\n')[0].slice(0, 180)); } };
const FEATURES = () => {
  const s = (p, v) => CSS.supports(p, v);
  const gl = (() => { try { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return null; const e = c.getExtension('WEBGL_debug_renderer_info'); const r = e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); c.getExtension('WEBGL_lose_context')?.loseContext(); return r; } catch (e) { return 'throw ' + e; } })();
  return {
    has: CSS.supports('selector(:has(*))'), animTimelineView: s('animation-timeline', 'view()'), viewTimeline: s('view-timeline', '--a block'), timelineScope: s('timeline-scope', '--a'),
    allowDiscrete: s('transition-behavior', 'allow-discrete'), container: s('container-type', 'inline-size'), cqi: s('width', '1cqi'), colorMix: s('color', 'color-mix(in srgb, red, blue)'),
    textWrapBalance: s('text-wrap', 'balance'), textWrapPretty: s('text-wrap', 'pretty'), startingStyle: typeof CSSStartingStyleRule !== 'undefined', ric: typeof requestIdleCallback === 'function', webgl2: gl, ua: navigator.userAgent, dpr: devicePixelRatio,
  };
};
const hiddenAfterScroll = async (page) => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((v) => window.scrollTo(0, v), y); await wait(90); }
  await wait(300);
  const stuck = await page.evaluate(async () => {
    const out = [];
    for (const e of document.querySelectorAll('main h2, main h3, main p, main li, main a')) {
      e.scrollIntoView({ block: 'center' });
      await new Promise((r) => requestAnimationFrame(r));
      let o = 1; for (let p = e; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); o *= +s.opacity; if (s.visibility === 'hidden' || s.display === 'none') o = 0; }
      if (o < 0.15 && (e.textContent || '').trim() && !e.closest('[aria-hidden="true"]') && !e.closest('.sr-only') && !e.closest('dialog') && !e.closest('.board .rows')) out.push(`${e.tagName}.${e.className} "${e.textContent.trim().slice(0, 30)}" ${o.toFixed(2)}`);
      if (out.length > 12) break;
    }
    window.scrollTo(0, 0);
    return out;
  });
  return stuck;
};
(async () => {
  const launch = engine === 'chromium' ? { args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] } : engine === 'firefox' ? { firefoxUserPrefs: {} } : {};
  const browser = await pw[engine].launch(launch);
  R.version = browser.version();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('request', () => reqs++);
  page.on('console', (m) => m.type() === 'error' && R.errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => R.errors.push('pageerror ' + String(e).slice(0, 200)));
  page.on('requestfailed', (r) => R.failed.push(r.url().replace(BASE, '').slice(0, 80) + ' ' + (r.failure()?.errorText || '')));
  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
  check('home load', true, { ms: Date.now() - t0 });
  await wait(1000);
  const f = await page.evaluate(FEATURES);
  check('features', 'info', f);
  R.features = f;
  await attempt('hero', async () => {
    const h = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent, search: !!document.querySelector('#q'), chips: document.querySelectorAll('.hero-types a').length, static: !!document.querySelector('.dock-board svg'), overflow: document.documentElement.scrollWidth - innerWidth }));
    check('hero content', !!h.h1 && h.search && h.chips === 7 && h.overflow <= 0, h);
  });
  let scene = 'unknown';
  await attempt('3d', async () => {
    for (let i = 0; i < 60; i++) { scene = await page.evaluate(() => document.querySelector('.dock-board')?.dataset.scene); if (scene === 'live' || scene === 'failed' || (scene === 'still' && i > 15)) break; await wait(500); }
    const c = await page.evaluate(() => { const c = document.querySelector('.dock-board canvas'); return { canvas: !!c, tier: c?.dataset.tier ?? null, w: c?.width, h: c?.height, staticOpacity: getComputedStyle(document.querySelector('.dock-board svg')).opacity, tags: [...document.querySelectorAll('.dock-tag')].filter((e) => e.getBoundingClientRect().width > 0).length }; });
    check('3d state', scene === 'live' || scene === 'still' || scene === 'failed', { scene, ...c });
    await page.screenshot({ path: `${out}/${engine}-1440-hero.png` });
  });
  await attempt('chip', async () => {
    const chip = page.locator('.hero-types a[href$="type=skill"]');
    await chip.hover(); await wait(600);
    const panel = await page.locator('.dock-panel').count();
    const panelText = panel ? (await page.locator('.dock-panel').innerText()).replace(/\s+/g, ' ').slice(0, 80) : null;
    check('category chip hover opens panel', panel === 1, panelText);
    await chip.click(); await page.waitForURL(/type=skill/, { timeout: 20000 });
    await page.locator('.rows > li').first().waitFor({ timeout: 20000 });
    check('category navigates', page.url().includes('type=skill'), page.url().replace(BASE, ''));
  });
  await attempt('search', async () => {
    await wait(2500);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.locator('#q').fill('code review');
    await page.keyboard.press('Enter');
    await page.waitForURL(/q=code/, { timeout: 25000 });
    await page.locator('.rows > li').first().waitFor({ timeout: 25000 });
    const n = await page.locator('.rows > li').count();
    check('search', n > 0, { url: page.url().replace(BASE, ''), rows: n, title: await page.locator('.rows .row-title a').first().innerText() });
  });
  await attempt('filters', async () => {
    await page.goto(BASE + '/artifacts?type=mcp_server', { waitUntil: 'load' });
    await page.locator('.rows > li').first().waitFor({ timeout: 25000 });
    const allMcp = await page.locator('.rows > li').evaluateAll((l) => l.every((e) => e.querySelector('.badge-mcp_server')));
    check('type filter', allMcp, page.url().replace(BASE, ''));
    await page.goto(BASE + '/artifacts?lang=any', { waitUntil: 'load' });
    await page.locator('.rows > li').first().waitFor({ timeout: 25000 });
    check('language filter', true, await page.locator('h1').first().innerText());
  });
  await attempt('sort', async () => {
    await page.goto(BASE + '/artifacts', { waitUntil: 'load' });
    await page.locator('.rows > li').first().waitFor({ timeout: 25000 });
    const first = await page.locator('.rows .row-title a').first().innerText();
    const link = page.locator('nav.sort a').nth(1);
    const label = await link.innerText();
    await link.click();
    await page.waitForURL(/sort=/, { timeout: 25000 });
    await wait(1500);
    const second = await page.locator('.rows .row-title a').first().innerText();
    check('sort', first !== second, { label, url: page.url().replace(BASE, ''), first, second });
  });
  await attempt('pagination', async () => {
    await page.goto(BASE + '/artifacts', { waitUntil: 'load' });
    await page.locator('.pager a[rel="next"]').waitFor({ timeout: 25000 });
    const a = await page.locator('.rows .row-title a').first().innerText();
    await page.locator('.pager a[rel="next"]').click();
    await page.waitForURL(/page=2/, { timeout: 25000 });
    await wait(1500);
    const b = await page.locator('.rows .row-title a').first().innerText();
    check('pagination', a !== b, { url: page.url().replace(BASE, ''), status: await page.locator('.pager-status').innerText() });
  });
  await attempt('detail', async () => {
    await page.locator('.rows .row-title a').first().click();
    await page.waitForURL(/\/r\//, { timeout: 25000 });
    await page.locator('.toc').waitFor({ timeout: 25000 });
    const commit = await page.locator('a[href*="/blob/"], a[href*="/tree/"], a[href*="/commit/"]').first().getAttribute('href');
    check('detail', /[0-9a-f]{40}/.test(commit || ''), commit);
    const tocPos = await page.evaluate(async () => {
      const toc = document.querySelector('.toc');
      const pos = getComputedStyle(toc).position; const before = toc.getBoundingClientRect().top;
      window.scrollTo(0, 900); await new Promise((r) => setTimeout(r, 500));
      const after = toc.getBoundingClientRect().top;
      const links = [...toc.querySelectorAll('a')].map((a) => { const s = getComputedStyle(a); return [a.textContent.trim().slice(0, 16), s.color, s.borderLeftColor, a.getAnimations().length]; });
      return { pos, before: Math.round(before), after: Math.round(after), links };
    });
    const colours = new Set(tocPos.links.map((l) => l[1]));
    check('sticky navigation', tocPos.pos === 'sticky' && tocPos.after >= 0, { pos: tocPos.pos, before: tocPos.before, after: tocPos.after });
    check('scroll-spy marks a section', f.animTimelineView ? colours.size > 1 : 'info', { colours: [...colours], animated: tocPos.links.some((l) => l[3] > 0), supported: f.animTimelineView });
    await page.screenshot({ path: `${out}/${engine}-1440-detail.png` });
  });
  await attempt('scroll-driven', async () => {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await wait(1200);
    const stuck = await hiddenAfterScroll(page);
    check('no content stuck invisible on home', stuck.length === 0, stuck);
    await page.screenshot({ path: `${out}/${engine}-1440-home-full.png`, fullPage: true });
  });
  await ctx.close();
  // Reduced motion: no canvas, no animation running.
  await attempt('reduced', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p2 = await c2.newPage();
    p2.on('request', () => reqs++);
    await p2.goto(BASE + '/', { waitUntil: 'load' });
    await wait(2500);
    const r = await p2.evaluate(() => ({ scene: document.querySelector('.dock-board')?.dataset.scene, canvas: document.querySelectorAll('canvas').length, running: document.getAnimations().filter((a) => a.playState === 'running').length, svg: !!document.querySelector('.dock-board svg'), big: performance.getEntriesByType('resource').filter((x) => x.encodedBodySize > 200000).length }));
    check('reduced motion', r.canvas === 0 && r.running === 0 && r.svg && r.big === 0, r);
    await p2.screenshot({ path: `${out}/${engine}-1440-reduced.png` });
    await c2.close();
  });
  // Scene-less fallback: a narrow window stays on the drawing.
  await attempt('narrow', async () => {
    const c3 = await browser.newContext({ viewport: { width: 800, height: 900 } });
    const p3 = await c3.newPage();
    p3.on('request', () => reqs++);
    await p3.goto(BASE + '/', { waitUntil: 'load' });
    await wait(2000);
    const r = await p3.evaluate(() => ({ scene: document.querySelector('.dock-board')?.dataset.scene, canvas: document.querySelectorAll('canvas').length, overflow: document.documentElement.scrollWidth - innerWidth, svgVisible: getComputedStyle(document.querySelector('.dock-board svg')).opacity }));
    check('3d fallback at 800px', r.scene === 'still' && r.canvas === 0 && r.overflow <= 0, r);
    await c3.close();
  });
  R.reqs = reqs;
  fs.writeFileSync(`${out}/${engine}.json`, JSON.stringify(R, null, 1));
  console.log(engine, 'version', R.version, 'requests', reqs, 'consoleErrors', R.errors.length, 'failedRequests', R.failed.length);
  console.log(engine, JSON.stringify(R.errors.slice(0, 6)), JSON.stringify(R.failed.slice(0, 6)));
  await browser.close();
})().catch((e) => { console.error(engine, 'FATAL', String(e).slice(0, 500)); fs.writeFileSync(`${out}/${engine}.json`, JSON.stringify({ ...R, fatal: String(e).slice(0, 500) }, null, 1)); process.exit(1); });
