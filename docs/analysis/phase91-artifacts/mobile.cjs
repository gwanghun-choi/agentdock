// usage: node mobile.cjs <outDir>   READ ONLY. Four sizes, home/list/search/detail on production.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const out = process.argv[2];
const BASE = 'https://agentdock-delta.vercel.app';
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[360, 800], [390, 844], [768, 1024], [1024, 768]];
const MEASURE = () => {
  const vis = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0 && b.width > 0 && b.height > 0; };
  const nm = (e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const escaped = []; const clipped = []; const overlaps = [];
  for (const e of document.querySelectorAll('main *, .site-footer *, .site-header *')) {
    if (!vis(e) || e.closest('svg') || e.closest('.sr-only') || e.closest('[aria-hidden="true"]')) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 1 && (s.overflowX === 'hidden' || s.overflowX === 'clip') && s.webkitLineClamp === 'none' && s.textOverflow !== 'ellipsis') clipped.push(`${nm(e)} ${e.scrollWidth}>${e.clientWidth} "${e.textContent.trim().slice(0, 24)}"`);
    const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect();
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') break;
      if (ps.overflowX === 'visible') continue;
      const b = p.getBoundingClientRect();
      if (t.right > b.right + 1 || t.left < b.left - 1) escaped.push(`${nm(e)} in ${nm(p)} by ${Math.round(Math.max(t.right - b.right, b.left - t.left))}px`);
      break;
    }
  }
  const T = [...document.querySelectorAll('main a, main button, main input, main select, main summary, header a, header button, footer a')].filter((e) => vis(e) && !e.closest('[aria-hidden="true"]'));
  const small24 = []; const small44 = [];
  for (const e of T) {
    const b = e.getBoundingClientRect();
    if (Math.min(b.width, b.height) < 24) small24.push(`${nm(e)} ${Math.round(b.width)}x${Math.round(b.height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 16)}"`);
    else if (Math.min(b.width, b.height) < 44) small44.push(nm(e));
  }
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < Math.min(T.length, i + 12); j++) {
    if (T[i].contains(T[j]) || T[j].contains(T[i])) continue;
    const a = T[i].getBoundingClientRect(); const b = T[j].getBoundingClientRect();
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 2 && h > 2) overlaps.push(`${nm(T[i])} & ${nm(T[j])} ${Math.round(w)}x${Math.round(h)}`);
  }
  const counts = [...document.querySelectorAll('.tile-count, .type-count, .chip-count, .type-card strong, .flow-count')].map((e) => { const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(); const p = e.closest('a, .type-card, .chip') || e.parentElement; const b = p.getBoundingClientRect(); return Math.max(0, Math.round(Math.max(t.right - b.right, b.left - t.left))); });
  const sec = {};
  for (const s of ['.site-header', '.hero', '.hero-copy', '.dock-board', '.hero-types', '.board', '.pipeline', '.conditions', '.types', '.site-footer', '.facets', '.toc', '.detail-opening', '.detail-glance']) { const e = document.querySelector(s); if (e) { const b = e.getBoundingClientRect(); sec[s] = [Math.round(b.top + scrollY), Math.round(b.height)]; } }
  const cards = [...document.querySelectorAll('.types .type-card')].map((e) => { const b = e.getBoundingClientRect(); const pad = getComputedStyle(e); return [Math.round(b.width), Math.round(b.height), e.querySelectorAll('li, dd, p').length, Math.round(e.scrollHeight)]; });
  return {
    overflow: document.documentElement.scrollWidth - innerWidth, doc: document.documentElement.scrollHeight, scene: document.querySelector('.dock-board')?.dataset.scene ?? null, canvas: document.querySelectorAll('canvas').length, svg: !!document.querySelector('.dock-board svg'),
    targets: T.length, small24: small24.slice(0, 10), n24: small24.length, n44: small44.length, escaped: escaped.slice(0, 6), clipped: clipped.slice(0, 6), overlaps: overlaps.slice(0, 6), maxCountEscape: counts.length ? Math.max(...counts) : null, sec, cards,
    body13: [...document.querySelectorAll('main p, main li')].filter((e) => vis(e) && parseFloat(getComputedStyle(e).fontSize) < 13).length,
  };
};
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
  let reqs = 0;
  const seedCtx = await browser.newContext();
  const seedP = await seedCtx.newPage();
  await seedP.goto(`${BASE}/artifacts`, { waitUntil: 'load' });
  await seedP.locator('.rows .row-title a').first().waitFor();
  const seed = await seedP.locator('.rows .row-title a').first().getAttribute('href');
  await seedCtx.close();
  const PAGES = [['home', '/'], ['list', '/artifacts'], ['search', '/artifacts?q=code+review'], ['detail', seed]];
  const rows = [];
  for (const [width, height] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 800, hasTouch: width <= 1024, deviceScaleFactor: width < 800 ? 3 : 1 });
    for (const [label, path] of PAGES) {
      const page = await ctx.newPage();
      page.on('request', () => reqs++);
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 120)));
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      await wait(label === 'home' ? 2500 : 1500);
      await page.screenshot({ path: `${out}/${width}-${label}.png` });
      if (label === 'home') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload({ waitUntil: 'load' }); await wait(800);
        await page.screenshot({ path: `${out}/${width}-home-full.png`, fullPage: true });
        const types = page.locator('.types');
        if (await types.count()) await types.screenshot({ path: `${out}/${width}-types.png` });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.reload({ waitUntil: 'load' }); await wait(1500);
      }
      const m = await page.evaluate(MEASURE);
      // Functional on touch: search works at this size.
      let ok = null;
      if (label === 'home') {
        await page.locator('#q').fill('hook');
        await page.keyboard.press('Enter');
        await page.waitForURL(/q=hook/, { timeout: 25000 });
        await page.locator('.rows > li').first().waitFor({ timeout: 25000 });
        ok = { searchRows: await page.locator('.rows > li').count() };
      }
      const row = { width, label, ...m, errors, ok };
      rows.push(row);
      const { sec, cards, small24, ...brief } = row;
      console.log(JSON.stringify(brief).slice(0, 700));
      console.log('   sec', JSON.stringify(sec), 'small24', JSON.stringify(small24).slice(0, 300));
      await page.close();
    }
    await ctx.close();
  }
  fs.writeFileSync(`${out}/mobile.json`, JSON.stringify(rows, null, 1));
  console.log('requests', reqs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
