// usage: node leak.cjs <baseUrl> <cycles> <outJson> [full|nav]
// `full` = Home → Pause → Resume → pick a type → Artifacts → Detail → Home by soft navigation.
// `nav`  = Home ↔ Artifacts only (for production, few requests).
// No element handle is kept across a cycle: locators only. The WebGL/three objects are counted
// through WeakRefs, so counting them does not keep them alive.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [base, cyclesArg, out, mode = 'full'] = process.argv.slice(2);
const CYCLES = +cyclesArg;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const INIT = () => {
  const W = (window.__w = { renderers: [], scenes: [], created: 0, geo: 0, tex: 0, delTex: 0, buf: 0, delBuf: 0, prog: 0, delProg: 0, canv: 0 });
  const hook = new EventTarget();
  hook.addEventListener('observe', (e) => { const o = e.detail; if (o.isWebGLRenderer) { W.renderers.push(new WeakRef(o)); W.created++; } else if (o.isScene) W.scenes.push(new WeakRef(o)); });
  window.__THREE_DEVTOOLS__ = hook;
  const P = WebGL2RenderingContext.prototype;
  const wrap = (n, k) => { const o = P[n]; P[n] = function (...a) { W[k]++; return o.apply(this, a); }; };
  wrap('createTexture', 'tex'); wrap('deleteTexture', 'delTex'); wrap('createBuffer', 'buf'); wrap('deleteBuffer', 'delBuf'); wrap('createProgram', 'prog'); wrap('deleteProgram', 'delProg');
  window.__counts = () => ({ rendererCreated: W.created, renderersAlive: W.renderers.filter((r) => r.deref()).length, scenesAlive: W.scenes.filter((r) => r.deref()).length, netTextures: W.tex - W.delTex, netBuffers: W.buf - W.delBuf, netPrograms: W.prog - W.delProg, canvasesInDom: document.querySelectorAll('canvas').length });
};
const liveCount = async (cdp, ctor) => {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `${ctor}.prototype` });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
  const { result: n } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true });
  await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  return n.value;
};
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const errors = [];
  page.on('console', (m) => ['error'].includes(m.type()) && errors.push(m.text().slice(0, 140)));
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
  let reqs = 0; page.on('request', () => reqs++);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Runtime.enable'); await cdp.send('Memory.enable').catch(() => {}); await cdp.send('HeapProfiler.enable');
  const live = () => page.locator('.dock-board[data-scene="live"]').waitFor({ timeout: 45000 });
  const snapshot = async (i) => {
    // Twice with a pause, then the collector the protocol offers: what is left is held.
    await page.evaluate(() => { gc(); gc(); }); await wait(400);
    await cdp.send('HeapProfiler.collectGarbage'); await wait(300);
    const heap = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(2));
    const dom = await cdp.send('Memory.getDOMCounters');
    const glCtx = await liveCount(cdp, 'WebGL2RenderingContext');
    const canv = await liveCount(cdp, 'HTMLCanvasElement');
    const c = await page.evaluate(() => __counts());
    const row = { cycle: i, heapMB: heap, webgl2Contexts: glCtx, canvasElements: canv, documents: dom.documents, nodes: dom.nodes, listeners: dom.jsEventListeners, ...c, reqs };
    console.log(JSON.stringify(row));
    return row;
  };
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
  await live(); await wait(800);
  const rows = [await snapshot(0)];
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const t0 = Date.now();
  for (let i = 1; i <= CYCLES; i++) {
    if (mode === 'full') {
      await page.locator('.dock-controls button').click(); await wait(120);
      await page.locator('.dock-controls button').click(); await wait(120);
      await page.locator('.hero-types a[href$="type=hook"]').focus(); await wait(180);
      await page.keyboard.press('Escape'); await page.evaluate(() => document.activeElement?.blur());
    }
    await click('.site-header nav a[href="/artifacts"]');
    await page.waitForURL(/artifacts/, { timeout: 30000 });
    await page.locator('.rows .row-title a').first().waitFor({ timeout: 30000 });
    if (mode === 'full') {
      await click('.rows .row-title a');
      await page.waitForURL(/\/r\//, { timeout: 30000 });
      await page.locator('.toc').waitFor({ timeout: 30000 });
    }
    await click('.site-header .brand');
    await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
    await live(); await wait(200);
    if (i % 10 === 0 || i === CYCLES) rows.push(await snapshot(i));
  }
  console.log('softCyclesMs', Date.now() - t0, 'requests', reqs);
  // Search is a native GET form: a full navigation. One document's worth of everything must go.
  let afterSearch = null;
  if (mode === 'full') {
    for (let i = 0; i < 3; i++) {
      await page.locator('#q').fill('review');
      await page.keyboard.press('Enter');
      await page.waitForURL(/q=review/, { timeout: 30000 });
      await page.locator('.rows .row-title a').first().waitFor({ timeout: 30000 });
      await click('.site-header .brand');
      await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
      await live(); await wait(300);
    }
    afterSearch = await snapshot('afterSearch3');
    // Detached DOM, from the heap snapshot itself.
    let chunks = '';
    const onChunk = (e) => { chunks += e.chunk; };
    cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    const s = JSON.parse(chunks);
    const f = s.snapshot.meta.node_fields; const n = f.length; const ni = f.indexOf('name'); const di = f.indexOf('detachedness');
    let detached = 0; const names = {};
    for (let i = 0; i < s.nodes.length; i += n) if (di >= 0 && s.nodes[i + di] === 2) { detached++; const nm = s.strings[s.nodes[i + ni]].slice(0, 40); names[nm] = (names[nm] || 0) + 1; }
    afterSearch.detachedNodes = detached;
    afterSearch.detachedTop = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log('detached', detached, JSON.stringify(afterSearch.detachedTop));
  }
  const res = { base, mode, browser: browser.version(), rows, afterSearch, errors, reqs };
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log('errors', errors.length, JSON.stringify(errors.slice(0, 4)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
