// usage: [taskset -c 0,1] node scene-compare.cjs <url> <chromium|firefox|webkit> <gpu|software|default> <label> <out.jsonl> [wide|phone] [optin]
// A cold context, /, then what the page downloaded, drew and held. Drawing is counted on the
// WebGL prototype, so a page that never makes a renderer reads zero with nothing else changed.
const pw = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [url, type, mode, label, out, size = 'wide', optin] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ARGS = { gpu: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'], software: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'], default: [] }[mode];
const INIT = () => {
  const G = (window.__g = { draws: 0, tris: 0, contexts: 0 });
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/.test(t)) G.contexts++; return orig.call(this, t, ...a); };
  const P = window.WebGL2RenderingContext?.prototype; if (!P) return;
  const count = (m, n, i = 1) => { G.draws++; if (m === 4) G.tris += (n / 3) * i; if (m === 5) G.tris += (n - 2) * i; };
  for (const [name, f] of [['drawArrays', (a) => count(a[0], a[2])], ['drawElements', (a) => count(a[0], a[1])], ['drawArraysInstanced', (a) => count(a[0], a[2], a[3])], ['drawElementsInstanced', (a) => count(a[0], a[1], a[4])]]) { const o = P[name]; P[name] = function (...a) { f(a); return o.apply(this, a); }; }
  window.__fps = (ms) => new Promise((res) => { const d0 = G.draws, t0 = G.tris; let n = 0; const s = performance.now(); const tick = () => { n++; if (performance.now() - s < ms) requestAnimationFrame(tick); else res({ fps: +((n / (performance.now() - s)) * 1000).toFixed(1), drawsPerSec: Math.round(((G.draws - d0) / ms) * 1000), trisPerSec: Math.round(((G.tris - t0) / ms) * 1000) }); }; requestAnimationFrame(tick); });
};
const cpuBusy = () => { const c = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number); return { total: c.reduce((a, b) => a + b), idle: c[3] + c[4] }; };
(async () => {
  const b = await pw[type].launch({ args: type === 'chromium' ? ARGS : [] });
  const ctx = await b.newContext(size === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: type !== 'firefox', hasTouch: true } : { viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  if (optin) await page.addInitScript(() => { try { localStorage.setItem('agentdock:scene', 'on'); } catch {} });
  const reqs = []; page.on('response', async (r) => { if (r.url().includes('/_next/static/') || r.url() === `${url}/`) { const body = await r.body().catch(() => null); reqs.push({ u: r.url().split('/').pop(), bytes: body ? body.length : 0, t: r.request().resourceType() }); } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 120))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 120)));
  const t0 = Date.now();
  await page.goto(`${url}/`, { waitUntil: 'load', timeout: 120000 });
  const load = Date.now() - t0;
  const R = { label, type, mode, size, optin: !!optin, version: b.version(), load };
  let liveAt = null;
  try { await page.locator('.dock-board[data-scene="live"]').waitFor({ timeout: 20000 }); liveAt = Date.now() - t0; } catch {}
  R.liveAt = liveAt;
  R.scene = await page.locator('.dock-board').first().getAttribute('data-scene');
  await wait(mode === 'gpu' || liveAt === null ? 3000 : 9000);
  const a = cpuBusy(); R.live = await page.evaluate(() => window.__fps(5000)); const z = cpuBusy();
  R.machineBusyCores = +(((z.total - a.total - (z.idle - a.idle)) / (z.total - a.total)) * (require('os').cpus().length)).toFixed(2);
  await page.mouse.move(2, 1070); await wait(mode === 'gpu' ? 27000 : 30000);
  R.rest = await page.evaluate(async () => { const d0 = window.__g.draws; await new Promise((r) => setTimeout(r, 3000)); return { drawsIn3s: window.__g.draws - d0 }; });
  R.scene2 = await page.locator('.dock-board').first().getAttribute('data-scene');
  R.page = await page.evaluate(() => { const m = performance.memory; try { gc(); } catch {} const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint'); const svg = document.querySelector('.dock-board svg'); return { heapMB: m ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, canvases: document.querySelectorAll('canvas').length, contexts: window.__g.contexts, fcp: paint?.startTime ?? null, domNodes: document.getElementsByTagName('*').length, svg: !!svg, button: [...document.querySelectorAll('.dock-controls button, .dock-offer button')].map((x) => x.textContent) }; });
  const js = reqs.filter((r) => r.t === 'script'); R.js = { requests: js.length, bytes: js.reduce((s, r) => s + r.bytes, 0), biggest: Math.max(0, ...js.map((r) => r.bytes)) };
  R.errors = errors.slice(0, 4);
  fs.appendFileSync(out, `${JSON.stringify(R)}\n`); console.log(JSON.stringify(R));
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
