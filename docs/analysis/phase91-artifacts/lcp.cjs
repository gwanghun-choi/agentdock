// usage: node lcp.cjs <outJsonl> <baseUrl> <condition,condition,...> [runs=5]
// READ ONLY. GET navigations only; nothing is clicked. Spaced 1.5 s apart.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [out, BASE, condArg, runsArg = '5'] = process.argv.slice(2);
const RUNS = +runsArg;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const DESK = { viewport: { width: 1920, height: 1080 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const SLOW4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const COND = {
  'desktop-cold': { ctx: DESK },
  'desktop-warm': { ctx: DESK, warm: true },
  'mobile-cold': { ctx: PHONE },
  'mobile-warm': { ctx: PHONE, warm: true },
  'desktop-cpu4x-cold': { ctx: DESK, cpu: 4 },
  'mobile-cpu4x-cold': { ctx: PHONE, cpu: 4 },
  'desktop-slow4g-cold': { ctx: DESK, net: SLOW4G },
  'mobile-slow4g-cpu4x-cold': { ctx: PHONE, net: SLOW4G, cpu: 4 },
  'x-no3d-reduced-cold': { ctx: { ...DESK, reducedMotion: 'reduce' } },
  'x-nojs-cold': { ctx: { ...DESK, javaScriptEnabled: false }, nojs: true },
  'x-nofont-cold': { ctx: DESK, block: /\.woff2/ },
  'x-swiftshader-cold': { ctx: DESK, soft: true },
  'x-chrome-stable-cold': { ctx: DESK, chrome: true },
};
const INIT = () => {
  const M = (window.__m = { lcp: [], long: [], cls: 0, t: {} });
  const name = (e) => (e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '') : null);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) M.lcp.push({ t: e.startTime, render: e.renderTime, load: e.loadTime, size: e.size, url: e.url, el: name(e.element), text: e.element ? (e.element.textContent || '').trim().slice(0, 60) : null }); }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) M.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) M.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  const mark = (k) => { if (!(k in M.t)) M.t[k] = Math.round(performance.now()); };
  const poll = () => {
    const b = document.querySelector('.dock-board');
    if (document.querySelector('h1')) mark('h1InDom');
    if (b && Object.keys(b).some((k) => k.startsWith('__reactFiber'))) mark('hydrated');
    if (b && b.dataset.scene === 'loading') mark('sceneLoading');
    if (document.querySelector('.dock-board canvas')) mark('canvas');
    if (b && b.dataset.scene === 'live') mark('sceneLive');
    if (document.fonts && document.fonts.status === 'loaded' && [...document.fonts].some((f) => f.status === 'loaded')) mark('fontLoaded');
    if (!M.stop) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};
const READ = () => {
  const n = performance.getEntriesByType('navigation')[0];
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  const res = performance.getEntriesByType('resource').map((r) => ({ u: r.name.replace(location.origin, '').slice(0, 80), i: r.initiatorType, s: Math.round(r.startTime), rs: Math.round(r.responseStart), e: Math.round(r.responseEnd), tx: r.transferSize, enc: r.encodedBodySize, b: r.renderBlockingStatus, p: r.nextHopProtocol }));
  const M = window.__m || {};
  M.stop = true;
  return {
    nav: { interim: Math.round(n.firstInterimResponseStart || 0), finalHead: Math.round(n.finalResponseHeadersStart || 0), connect: Math.round(n.connectEnd), reqStart: Math.round(n.requestStart), ttfb: Math.round(n.responseStart), docEnd: Math.round(n.responseEnd), domInt: Math.round(n.domInteractive), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), tx: n.transferSize, enc: n.encodedBodySize, dec: n.decodedBodySize },
    paint, lcp: M.lcp, long: M.long, cls: M.cls, t: M.t, res,
    fonts: [...document.fonts].map((f) => [f.family, f.status, f.display]),
    h1: (() => { const e = document.querySelector('h1'); if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), font: getComputedStyle(e).fontFamily.slice(0, 40) }; })(),
  };
};
const READ_NOJS = () => new Promise((res) => {
  const lcp = []; const n = performance.getEntriesByType('navigation')[0];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp.push({ t: e.startTime, size: e.size, el: e.element ? e.element.tagName.toLowerCase() : null, text: e.element ? (e.element.textContent || '').trim().slice(0, 60) : null }); }).observe({ type: 'largest-contentful-paint', buffered: true });
  setTimeout(() => res({ nav: { ttfb: Math.round(n.responseStart), docEnd: Math.round(n.responseEnd), domInt: Math.round(n.domInteractive), load: Math.round(n.loadEventEnd), enc: n.encodedBodySize }, paint: Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)])), lcp, long: [], cls: 0, t: {}, res: [] }), 300);
});

async function one(browser, c, context, label, i) {
  const ctx = context || (await browser.newContext(c.ctx));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (c.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu });
  if (c.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', c.net); }
  if (c.block) await page.route(c.block, (r) => r.abort());
  if (!c.nojs) await page.addInitScript(INIT);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 120)));
  let reqs = 0; page.on('request', () => reqs++);
  const resp = await page.goto(`${BASE}${process.env.LCP_PATH || '/'}`, { waitUntil: 'load', timeout: 90000 });
  const settle = c.cpu || c.net || c.soft ? 12000 : 5000;
  await wait(settle);
  const d = await page.evaluate(c.nojs ? READ_NOJS : READ);
  const h = resp.headers();
  const row = { label, i, reqs, id: h['x-vercel-id'], cache: h['x-vercel-cache'], commit: (h['x-agentdock-commit'] || '').slice(0, 7), errors, ...d };
  fs.appendFileSync(out, JSON.stringify(row) + '\n');
  const last = (d.lcp || []).at(-1) || {};
  console.log(label.padEnd(26), i, 'ttfb', d.nav.ttfb, 'final', d.nav.finalHead, 'int', d.nav.interim, 'fcp', d.paint['first-contentful-paint'], 'lcp', Math.round(last.t), last.el, 'load', d.nav.load, 'hyd', d.t.hydrated, 'live', d.t.sceneLive, 'id', (h['x-vercel-id'] || '').slice(0, 10), 'reqs', reqs);
  await page.close();
  if (!context) await ctx.close();
}

(async () => {
  for (const label of condArg.split(',')) {
    const c = COND[label];
    const args = c.soft ? ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : GPU;
    const browser = await chromium.launch(c.chrome ? { channel: 'chrome', args } : { args });
    if (c.warm) {
      const ctx = await browser.newContext(c.ctx);
      const seed = await ctx.newPage();
      await seed.goto(`${BASE}/`, { waitUntil: 'load' });
      await wait(4000);
      await seed.close();
      for (let i = 0; i < RUNS; i++) { await one(browser, c, ctx, label, i); await wait(1500); }
      await ctx.close();
    } else {
      for (let i = 0; i < RUNS; i++) { await one(browser, c, null, label, i); await wait(1500); }
    }
    console.log(label, 'browser', browser.version());
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
