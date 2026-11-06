// usage: node long-path-check.cjs <baseUrl> — rows and pages for very long paths. Local only.
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const [base] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 320, height: 800 }, colorScheme: 'dark' });
  await p.goto(`${base}/artifacts?q=longpathspec`, { waitUntil: 'load' });
  await p.locator('.rows:not([aria-hidden]) > li').first().waitFor();
  const rows = await p.locator('.rows:not([aria-hidden]) > li').count();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log('rows', rows, 'overflow at 320', overflow);
  await p.screenshot({ path: 'docs/images/phase94/long-path-320.png' });
  for (const a of await p.locator('.rows:not([aria-hidden]) .row-title a').evaluateAll((l) => l.map((e) => e.getAttribute('href')))) {
    const r = await fetch(base + a);
    console.log('detail', 'href bytes', a.length, 'status', r.status);
  }
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
