// usage: node search-shots.cjs <baseUrl> <label>  — GET only. The search box with a query at each width, and the ponytail list.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const [base, label] = process.argv.slice(2);
const out = '/home/ChoiGwanghun/workspace_auto/agentdock/docs/images/phase94';
(async () => {
  const b = await chromium.launch();
  for (const [width, height, dsf] of [[390, 844, 1], [1280, 800, 1], [1920, 1080, 1]]) {
    const p = await b.newPage({ viewport: { width, height }, colorScheme: 'dark', deviceScaleFactor: dsf });
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.locator('html[data-hotkeys]').waitFor({ timeout: 30000 });
    await p.fill('#q', 'ponytail');
    await p.waitForTimeout(300);
    const f = await p.locator('.hero-search').boundingBox();
    await p.screenshot({ path: `${out}/${label}-search-${width}.png`, clip: { x: Math.max(0, f.x - 8), y: f.y - 8, width: Math.min(f.width + 16, width), height: f.height + 16 } });
    await p.goto(`${base}/artifacts?q=ponytail`, { waitUntil: 'load', timeout: 60000 });
    await p.locator('.rows > li').first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${label}-results-${width}.png` });
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
