// usage: node streaming-check.cjs <baseUrl> <case> — a browser on a late or failed home page. Local only.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const [base, name, js = 'js', wait = '6000'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: js === 'js', colorScheme: 'dark' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  const r = await p.goto(`${base}/`, { waitUntil: 'commit', timeout: 60000 }); const status = r.status();
  await p.waitForTimeout(+wait);
  const box = async (s) => { const l = p.locator(s).first(); return (await l.count()) && (await l.isVisible()); };
  const out = { name, js, status, h1: await box('h1'), search: await box('#q'), chips: await p.locator('.hero-types a').count(), chipDigits: /\d/.test((await p.locator('.hero-types').first().textContent().catch(() => '')) ?? ''), alert: await box('.home-unavailable'), tryAgain: await p.getByRole('link', { name: 'Try again' }).count(), skeletonVisible: await box('.skeleton'), noscriptLine: js === 'js' ? null : (await p.locator('body').innerText()).includes('cannot fill in by itself'), rows: await p.locator('.board .rows:not([aria-hidden]) .row-title a').count(), errors: errs.slice(0, 3) };
  console.log(JSON.stringify(out));
  await p.screenshot({ path: `docs/images/phase94/stream-${name}.png` });
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
