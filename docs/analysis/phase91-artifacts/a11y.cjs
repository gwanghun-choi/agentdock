// usage: node a11y.cjs <outDir>  READ ONLY on production. Keyboard walks, focus styles, landmarks, headings, axe.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const AXE = '/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/axe-core/axe.min.js';
const fs = require('fs');
const out = process.argv[2];
const BASE = 'https://agentdock-delta.vercel.app';
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const FOCUS = () => {
  const e = document.activeElement; if (!e || e === document.body) return null;
  const s = getComputedStyle(e); const b = e.getBoundingClientRect();
  const pseudo = getComputedStyle(e, '::after');
  const name = e.getAttribute('aria-label') || (e.labels && e.labels[0]?.textContent) || e.textContent || e.getAttribute('placeholder') || '';
  return { tag: e.tagName.toLowerCase(), cls: typeof e.className === 'string' ? e.className.slice(0, 30) : '', name: name.trim().replace(/\s+/g, ' ').slice(0, 44), href: (e.getAttribute('href') || '').slice(0, 40), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? `${s.outlineWidth} ${s.outlineColor}` : null, shadow: s.boxShadow !== 'none', inView: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, y: Math.round(b.top + scrollY), hiddenAncestor: !!e.closest('[aria-hidden="true"]') };
};
const walk = async (page, n) => { const seq = []; for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(FOCUS)); if (seq.at(-1) === null) break; } return seq; };
const OUTLINE = () => {
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.getBoundingClientRect().width > 0 || h.closest('.sr-only'));
  let jumps = []; let last = 0;
  for (const h of hs) { const l = +h.tagName[1]; if (last && l > last + 1) jumps.push(`${h.tagName} after H${last}: ${h.textContent.trim().slice(0, 30)}`); last = l; }
  const links = [...document.querySelectorAll('a[href]')].filter((a) => !a.closest('[aria-hidden="true"]') && a.getBoundingClientRect().width > 0);
  const noName = links.filter((a) => !(a.getAttribute('aria-label') || a.textContent.trim() || a.querySelector('img[alt]'))).length;
  const generic = links.filter((a) => /^(click here|here|more|read more|link)$/i.test((a.textContent || '').trim())).map((a) => a.href);
  const byText = {}; for (const a of links) { const t = (a.getAttribute('aria-label') || a.textContent).trim().replace(/\s+/g, ' ').slice(0, 40); (byText[t] = byText[t] || new Set()).add(a.getAttribute('href')); }
  const ambiguous = Object.entries(byText).filter(([, v]) => v.size > 1).map(([k, v]) => `${k} → ${v.size} targets`).slice(0, 10);
  const lm = [...document.querySelectorAll('header,nav,main,footer,aside,section[aria-label],section[aria-labelledby],[role]')].map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''}${e.getAttribute('aria-label') ? '"' + e.getAttribute('aria-label') + '"' : ''}`);
  return { h1: hs.filter((h) => h.tagName === 'H1').length, headings: hs.map((h) => `${h.tagName} ${h.textContent.trim().slice(0, 36)}`).slice(0, 26), jumps, links: links.length, noName, generic, ambiguous, landmarks: lm.slice(0, 26), live: [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map((e) => `${e.tagName.toLowerCase()} ${e.getAttribute('aria-live') || e.getAttribute('role')}`), lang: document.documentElement.lang, title: document.title };
};
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.locator('.dock-board[data-scene="live"]').waitFor({ timeout: 30000 });
  await wait(1200);
  // Skip link first.
  await page.keyboard.press('Tab');
  R.first = await page.evaluate(FOCUS);
  await page.screenshot({ path: `${out}/focus-skip.png` });
  await page.keyboard.press('Enter'); await wait(200);
  R.afterSkip = await page.evaluate(() => ({ hash: location.hash, active: document.activeElement?.tagName, id: document.activeElement?.id }));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.locator('.dock-board[data-scene="live"]').waitFor({ timeout: 30000 });
  R.homeWalk = await walk(page, 34);
  R.homeOutline = await page.evaluate(OUTLINE);
  // Dock panel: a chip by keyboard opens it; Tab enters; Esc closes and hands back.
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.locator('.dock-board[data-scene="live"]').waitFor({ timeout: 30000 });
  await page.locator('.hero-types a[href$="type=hook"]').focus(); await wait(500);
  R.panel = { open: await page.locator('.dock-panel').count(), ariaLabel: await page.locator('.dock-panel').getAttribute('aria-label') };
  await page.screenshot({ path: `${out}/focus-chip-panel.png` });
  await page.keyboard.press('Escape'); await wait(300);
  R.panel.afterEsc = { open: await page.locator('.dock-panel').count(), focus: await page.evaluate(FOCUS) };
  R.panel.liveRegionNear = await page.evaluate(() => document.querySelector('.dock-panel')?.getAttribute('aria-live') ?? null);
  // Launcher: `/` on a page with no field, Ctrl+K; focus trap and restore.
  await page.goto(`${BASE}/r/nobody/nothing`, { waitUntil: 'load' });
  await page.keyboard.press('Control+k'); await wait(300);
  R.launcher = { open: await page.evaluate(() => document.getElementById('search-launcher')?.open ?? null), focus: await page.evaluate(FOCUS) };
  const trap = await walk(page, 8);
  R.launcher.trap = trap.map((t) => (t ? `${t.tag}.${t.cls}` : null));
  R.launcher.allInside = await page.evaluate(() => { const a = document.activeElement; return a === document.body || !!a.closest('dialog'); });
  await page.keyboard.press('Escape'); await wait(200);
  R.launcher.closed = await page.evaluate(() => !document.getElementById('search-launcher')?.open);
  // List page.
  await page.goto(`${BASE}/artifacts`, { waitUntil: 'load' });
  await page.locator('.rows > li').first().waitFor();
  R.listWalk = await walk(page, 30);
  R.listOutline = await page.evaluate(OUTLINE);
  const href = await page.locator('.rows .row-title a').first().getAttribute('href');
  await page.goto(`${BASE}${href}`, { waitUntil: 'load' });
  R.detailWalk = await walk(page, 24);
  R.detailOutline = await page.evaluate(OUTLINE);
  R.detailHref = href;
  // Copy button feedback (dynamic announcement).
  R.copy = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /copy/i.test(x.textContent)); return b ? { text: b.textContent.trim().slice(0, 30), aria: b.getAttribute('aria-live'), label: b.getAttribute('aria-label'), statusNear: !!b.parentElement.querySelector('[aria-live],[role=status]') } : null; });
  // Fallback picture to AT: hidden, and its facts available as text.
  await ctx.close();
  // axe, every page, both the live scene and reduced motion.
  R.axe = {};
  for (const [label, path, opts] of [['home', '/', {}], ['home-reduced', '/', { reducedMotion: 'reduce' }], ['home-390', '/', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ['list', '/artifacts', {}], ['search-empty', '/artifacts?q=zzzzqqqqxxxx', {}], ['detail', href, {}], ['detail-390', href, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ['notfound', '/r/nobody/nothing', {}]]) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, ...opts });
    const p = await c.newPage();
    await p.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await wait(path === '/' ? 2500 : 1500);
    await p.addScriptTag({ path: AXE });
    const r = await p.evaluate(() => axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
    R.axe[label] = { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target })), incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })), passes: r.passes.length };
    console.log('axe', label, JSON.stringify(R.axe[label]).slice(0, 400));
    if (label === 'home-reduced') { R.ariaSnapshotHome = await p.locator('body').ariaSnapshot(); }
    await c.close();
  }
  fs.writeFileSync(`${out}/a11y.json`, JSON.stringify(R, null, 1));
  fs.writeFileSync(`${out}/aria-home-reduced.yml`, R.ariaSnapshotHome || '');
  const brief = (w) => w.filter(Boolean).map((f) => `${f.tag}${f.outline ? '' : f.shadow ? '[shadow]' : '[NO-RING]'}${f.inView ? '' : '[offscreen]'}${f.hiddenAncestor ? '[ARIA-HIDDEN]' : ''}:${f.name.slice(0, 22)}`);
  console.log('first', JSON.stringify(R.first), JSON.stringify(R.afterSkip));
  console.log('home', brief(R.homeWalk).join(' | '));
  console.log('list', brief(R.listWalk).join(' | '));
  console.log('detail', brief(R.detailWalk).join(' | '));
  console.log('panel', JSON.stringify(R.panel));
  console.log('launcher', JSON.stringify(R.launcher));
  console.log('copy', JSON.stringify(R.copy));
  for (const k of ['homeOutline', 'listOutline', 'detailOutline']) console.log(k, JSON.stringify(R[k]).slice(0, 1100));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
