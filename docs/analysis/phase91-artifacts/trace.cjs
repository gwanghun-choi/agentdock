// usage: node trace.cjs <url> <js|nojs> <runs> <out>. Reads LCP from the browser's own trace, so it works with script off.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [url, mode, runs, out] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
  const rows = [];
  for (let i = 0; i < +runs; i++) {
    const c = await b.newContext({ viewport: { width: 1920, height: 1080 }, javaScriptEnabled: mode !== 'nojs' });
    const p = await c.newPage();
    await b.startTracing(p, { categories: ['loading', 'devtools.timeline', 'blink.user_timing', 'v8', 'disabled-by-default-v8.compile', 'gpu'] });
    await p.goto(url, { waitUntil: 'load', timeout: 60000 });
    await wait(mode === 'nojs' ? 1500 : 6000);
    const t = JSON.parse((await b.stopTracing()).toString()).traceEvents;
    const nav = t.find((e) => e.name === 'navigationStart' && e.args?.data?.isOutermostMainFrame);
    const t0 = nav.ts; const main = nav.pid; const tid = nav.tid;
    const rel = (e) => Math.round((e.ts - t0) / 1000);
    const lcp = t.filter((e) => e.name === 'largestContentfulPaint::Candidate' && e.ts >= t0).map(rel);
    const fcp = t.filter((e) => e.name === 'firstContentfulPaint' && e.ts >= t0).map(rel)[0];
    const resp = t.filter((e) => e.name === 'ResourceReceiveResponse' && e.ts >= t0)[0];
    const first = t.filter((e) => e.name === 'ResourceReceivedData' && e.ts >= t0)[0];
    const acc = {}; let lcpAt = lcp.at(-1) ?? 1e12;
    for (const e of t) {
      if (e.ph !== 'X' || e.pid !== main || e.tid !== tid || e.ts < t0) continue;
      const k = { EvaluateScript: 'script', 'v8.compile': 'compile', FunctionCall: 'script', ParseHTML: 'parseHTML', ParseAuthorStyleSheet: 'parseCSS', Layout: 'layout', UpdateLayoutTree: 'style', PrePaint: 'paint', Paint: 'paint', Layerize: 'paint', Commit: 'paint' }[e.name];
      if (!k) continue;
      const when = rel(e) < lcpAt ? 'beforeLCP' : 'afterLCP';
      acc[when] = acc[when] || {}; acc[when][k] = Math.round((acc[when][k] || 0) + e.dur / 1000);
    }
    const row = { i, fcp, lcp: lcp.at(-1), lcpCandidates: lcp, firstResponse: resp ? rel(resp) : null, firstData: first ? rel(first) : null, acc };
    rows.push(row); console.log(JSON.stringify(row));
    await c.close(); await wait(1500);
  }
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
