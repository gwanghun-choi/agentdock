// usage: [taskset ...] node scene.cjs <baseUrl> <gpu|software> <outJson>
// READ ONLY on production. three announces its renderer and scene to __THREE_DEVTOOLS__, the
// hook it ships for the devtools extension, so nothing in the app has to expose them.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [base, mode, out] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ARGS = mode === 'gpu' ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] : ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'];
const INIT = () => {
  const T = (window.__t = { renderers: [], scenes: [], rev: null });
  const hook = new EventTarget();
  hook.addEventListener('register', (e) => { T.rev = e.detail.revision; });
  hook.addEventListener('observe', (e) => { const o = e.detail; if (o.isWebGLRenderer) T.renderers.push(o); else if (o.isScene) T.scenes.push(o); });
  window.__THREE_DEVTOOLS__ = hook;
  const G = (window.__gl = { draws: 0, tris: 0, points: 0, frames: 0, programs: 0, shaders: 0, linkMs: 0, compileMs: 0, textures: 0, delTex: 0, buffers: 0, delBuf: 0, bufBytes: 0, texBytes: 0, ctx: 0 });
  const P = WebGL2RenderingContext.prototype;
  const count = (mode, n, inst = 1) => { G.draws++; if (mode === 4) G.tris += (n / 3) * inst; if (mode === 5) G.tris += (n - 2) * inst; if (mode === 0) G.points += n * inst; };
  const wrap = (name, f) => { const o = P[name]; P[name] = function (...a) { f(a, this); return o.apply(this, a); }; };
  const timed = (name, key) => { const o = P[name]; P[name] = function (...a) { const s = performance.now(); const r = o.apply(this, a); G[key] += performance.now() - s; return r; }; };
  wrap('drawArrays', (a) => count(a[0], a[2]));
  wrap('drawElements', (a) => count(a[0], a[1]));
  wrap('drawArraysInstanced', (a) => count(a[0], a[2], a[3]));
  wrap('drawElementsInstanced', (a) => count(a[0], a[1], a[4]));
  wrap('createProgram', () => G.programs++);
  wrap('createShader', () => G.shaders++);
  timed('linkProgram', 'linkMs'); timed('compileShader', 'compileMs');
  const gp = P.getProgramParameter; P.getProgramParameter = function (...a) { const s = performance.now(); const r = gp.apply(this, a); G.linkMs += performance.now() - s; return r; };
  wrap('createTexture', () => G.textures++); wrap('deleteTexture', () => G.delTex++);
  wrap('createBuffer', () => G.buffers++); wrap('deleteBuffer', () => G.delBuf++);
  wrap('bufferData', (a) => { if (a[1] && a[1].byteLength) G.bufBytes += a[1].byteLength; else if (typeof a[1] === 'number') G.bufBytes += a[1]; });
  wrap('texStorage2D', (a) => { let w = a[3], h = a[4], t = 0; for (let i = 0; i < a[1]; i++) { t += w * h; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); } G.texBytes += t * (a[2] === 0x881a || a[2] === 0x8c3a ? 8 : 4); });
  wrap('texImage2D', (a) => { const s = a[8] ?? a[5]; const w = s && s.width ? s.width : a[3]; const h = s && s.height ? s.height : a[4]; if (w && h) G.texBytes += w * h * (a[7] === 0x140b || a[7] === 0x1406 ? 8 : 4); });
  window.__sample = (ms) => new Promise((res) => {
    const d0 = G.draws, t0 = G.tris, p0 = G.points; const times = []; const s = performance.now(); let last = s; let rendered = 0; const ren = T.renderers[0]; const c0 = ren ? ren.info.render.frame : 0;
    const tick = () => { const now = performance.now(); times.push(now - last); last = now; if (now - s < ms) requestAnimationFrame(tick); else { times.sort((a, b) => a - b); rendered = (ren ? ren.info.render.frame : 0) - c0; const n = rendered || 1; res({ rafFps: +((times.length / (now - s)) * 1000).toFixed(1), renderFps: +((rendered / (now - s)) * 1000).toFixed(1), rendered, drawsPerFrame: +((G.draws - d0) / n).toFixed(1), trisPerFrame: Math.round((G.tris - t0) / n), pointsPerFrame: Math.round((G.points - p0) / n), p50: +times[times.length >> 1].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1), worst: +times[times.length - 1].toFixed(1), n: times.length }); } };
    requestAnimationFrame(tick);
  });
  window.__info = () => {
    const r = T.renderers.at(-1); let sc = null, most = -1; for (const c of T.scenes) { let n = 0; c.traverse(() => n++); if (n > most) { most = n; sc = c; } } if (!r) return null;
    const mats = new Set(), geos = new Set(); let meshes = 0, inst = 0, instTotal = 0, lights = 0, pts = 0, shadow = 0;
    sc?.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m.type + ':' + m.uuid)); if (o.geometry) geos.add(o.geometry.uuid); if (o.isMesh) meshes++; if (o.isInstancedMesh) { inst++; instTotal += o.count; } if (o.isLight) { lights++; if (o.castShadow) shadow++; } if (o.isPoints) pts++; });
    return { rev: T.rev, renderers: T.renderers.length, memGeometries: r.info.memory.geometries, memTextures: r.info.memory.textures, programs: r.info.programs?.length, sceneGeometries: geos.size, sceneMaterials: mats.size, materialTypes: [...mats].map((m) => m.split(':')[0]).reduce((a, m) => ((a[m] = (a[m] || 0) + 1), a), {}), meshes, instanced: inst, instanceTotal: instTotal, points: pts, lights, shadowLights: shadow, pixelRatio: r.getPixelRatio(), size: [r.domElement.width, r.domElement.height], shadowMap: r.shadowMap.enabled, shadowType: r.shadowMap.type, tier: r.domElement.dataset.tier ?? null, attrs: r.getContext().getContextAttributes().antialias };
  };
};
(async () => {
  const R = { mode, base };
  const browser = await chromium.launch({ args: ARGS });
  R.browser = browser.version();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const errors = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const cpu = async (ms, f) => { const g = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])); const a = await g(); const t = Date.now(); const r = await f(); const b = await g(); return { ...r, mainThreadPct: +(((b.TaskDuration - a.TaskDuration) * 100000) / (Date.now() - t)).toFixed(1), scriptPct: +(((b.ScriptDuration - a.ScriptDuration) * 100000) / (Date.now() - t)).toFixed(1) }; };
  const t0 = Date.now();
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 90000 });
  const loadMs = Date.now() - t0;
  await page.locator('.dock-board[data-scene="live"]').waitFor({ timeout: 120000 });
  R.timeline = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const r = performance.getEntriesByType('resource').filter((x) => x.encodedBodySize > 150000 && /\.js/.test(x.name)).map((x) => ({ start: Math.round(x.startTime), end: Math.round(x.responseEnd), gz: x.encodedBodySize, dec: x.decodedBodySize })); return { load: Math.round(n.loadEventEnd), docEnd: Math.round(n.responseEnd), chunk3d: r, liveAt: Math.round(performance.now()) }; });
  R.shader = await page.evaluate(() => ({ programs: __gl.programs, shaders: __gl.shaders, linkMs: +__gl.linkMs.toFixed(1), compileMs: +__gl.compileMs.toFixed(1) }));
  R.renderer = await page.evaluate(() => { const g = document.querySelector('.dock-board canvas'); const c = __t.renderers.at(-1)?.getContext(); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; });
  console.log(mode, 'renderer', R.renderer, 'load', loadMs, JSON.stringify(R.timeline));
  await wait(mode === 'gpu' ? 3500 : 9000);
  R.live = await cpu(0, () => page.evaluate(() => __sample(3000)));
  console.log('live', JSON.stringify(R.live));
  await page.mouse.move(1400, 500); await wait(200);
  for (let i = 0; i < 8; i++) { await page.mouse.move(1300 + i * 30, 450 + i * 15); await wait(60); }
  R.hover = await cpu(0, () => page.evaluate(() => __sample(2000)));
  console.log('hover', JSON.stringify(R.hover));
  await page.locator('#q').focus(); await page.keyboard.type('rev', { delay: 60 });
  R.search = await cpu(0, () => page.evaluate(() => __sample(2000)));
  console.log('search', JSON.stringify(R.search));
  await page.locator('#q').fill(''); await page.locator('#q').blur();
  const chip = page.locator('.hero-types a[href$="type=skill"]'); await chip.focus(); await wait(300);
  R.fly = await cpu(0, () => page.evaluate(() => __sample(2000)));
  console.log('fly', JSON.stringify(R.fly));
  await page.keyboard.press('Escape'); await page.evaluate(() => document.activeElement?.blur());
  R.info = await page.evaluate(() => __info());
  console.log('info', JSON.stringify(R.info));
  R.res = await page.evaluate(() => { const g = __gl; return { programs: g.programs, textures: g.textures, delTex: g.delTex, buffers: g.buffers, delBuf: g.delBuf, bufMB: +(g.bufBytes / 1048576).toFixed(1), texMB: +(g.texBytes / 1048576).toFixed(1) }; });
  // Rest: the loop must stop by itself.
  await page.mouse.move(2, 1070);
  await wait(mode === 'gpu' ? 27000 : 30000);
  R.rest = await cpu(0, async () => page.evaluate(async () => { const d0 = __gl.draws; const f0 = __t.renderers.at(-1).info.render.frame; await new Promise((r) => setTimeout(r, 5000)); return { drawsIn5s: __gl.draws - d0, framesIn5s: __t.renderers.at(-1).info.render.frame - f0 }; }));
  console.log('rest', JSON.stringify(R.rest));
  // Scrolled away: no drawing while the hero is out of view.
  await page.evaluate(() => window.scrollTo(0, 2500)); await wait(1500);
  R.offscreen = await page.evaluate(async () => { const d0 = __gl.draws; await new Promise((r) => setTimeout(r, 3000)); return { drawsIn3s: __gl.draws - d0 }; });
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(600);
  // Pause.
  const pause = page.locator('.dock-controls button');
  await pause.click(); await wait(1500);
  R.paused = await page.evaluate(async () => { const d0 = __gl.draws; await new Promise((r) => setTimeout(r, 3000)); return { drawsIn3s: __gl.draws - d0 }; });
  await pause.click(); await wait(400);
  R.resumed = await page.evaluate(() => __sample(1500));
  console.log('paused', JSON.stringify(R.paused), 'resumed', JSON.stringify(R.resumed));
  R.heapMB = await page.evaluate(() => { gc(); return +(performance.memory.usedJSHeapSize / 1048576).toFixed(1); });
  // Context loss: what the reader is left with.
  const lost = await page.evaluate(async () => {
    const c = __t.renderers.at(-1).getContext(); const e = c.getExtension('WEBGL_lose_context'); e.loseContext();
    await new Promise((r) => setTimeout(r, 1500));
    const b = document.querySelector('.dock-board'); const svg = b.querySelector('svg');
    return { scene: b.dataset.scene, canvas: b.querySelectorAll('canvas').length, svgOpacity: getComputedStyle(svg).opacity, svgVisible: svg.getBoundingClientRect().width > 0, controls: document.querySelectorAll('.dock-controls').length, chips: document.querySelectorAll('.hero-types a').length };
  });
  R.contextLoss = lost;
  console.log('contextLoss', JSON.stringify(lost));
  await page.screenshot({ path: out.replace('.json', '-after-loss.png') });
  R.errors = errors;
  fs.writeFileSync(out, JSON.stringify(R, null, 1));
  console.log('errors', JSON.stringify(errors.slice(0, 5)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
