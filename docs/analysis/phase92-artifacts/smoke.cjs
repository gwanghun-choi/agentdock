const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [outJson, imgDir] = process.argv.slice(2);
const B = 'https://agentdock-delta.vercel.app';
const R = { routes: [], checks: {} };
const count = (h) => { const m = h.match(/class="result-count"[^>]*>[\s\S]*?<strong[^>]*>([\d,]+)/); return m ? m[1] : null; };
(async () => {
  for (const [p, want] of [['/',200],['/artifacts',200],['/artifacts?lang=any',200],['/artifacts?q=code%20review',200],['/artifacts?q=%EC%BD%94%EB%93%9C%20%EB%A6%AC%EB%B7%B0',200],['/artifacts?q=%E4%BB%A3%E7%A0%81%E5%AE%A1%E6%9F%A5',200],['/artifacts?q=zzzzqqqqxxxx',200],['/artifacts?type=hook',200],['/artifacts?type=mcp_server',200],['/artifacts?type=agent&sort=name',200],['/artifacts?page=2',200],['/artifacts?q=%3Cscript%3Ealert(1)%3C/script%3E',200],['/r/griddynamics/rosetta',404],['/r/nobody/nothing',404],['/skills',308]]) {
    const t = Date.now(); const r = await fetch(B + p, { redirect: 'manual' }); const h = await r.text();
    R.routes.push({ p, status: r.status, want, ms: Date.now() - t, count: count(h), commit: (r.headers.get('x-agentdock-commit') || '').slice(0, 7), csp: !!r.headers.get('content-security-policy') });
  }
  const list = await (await fetch(B + '/artifacts?type=hook')).text();
  const hook = (list.match(/href="(\/r\/[^"]+)"/) || [])[1];
  const skill = ((await (await fetch(B + '/artifacts?type=skill')).text()).match(/href="(\/r\/[^"]+)"/) || [])[1];
  for (const p of [hook, skill]) { const r = await fetch(B + p); const h = await r.text(); R.routes.push({ p, status: r.status, want: 200, redactedShown: h.includes('&lt;redacted&gt;'), commitLinks: /github\.com\/[^"]+\/blob\/[0-9a-f]{40}\//.test(h) }); }
  const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
  const nonGet = [];
  const watch = (page, errs) => { page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160))); page.on('pageerror', (e) => errs.push(e.message.slice(0, 160))); page.on('request', (q) => { if (!['GET', 'HEAD'].includes(q.method())) nonGet.push(q.method() + ' ' + q.url()); }); };
  // Desktop journey.
  let c = await b.newContext({ viewport: { width: 1440, height: 900 } }); let page = await c.newPage(); let errs = []; watch(page, errs);
  await page.goto(B + '/', { waitUntil: 'load', timeout: 60000 });
  await page.locator('.dock-board[data-scene="live"]').waitFor({ timeout: 40000 });
  R.checks.scene = await page.locator('.dock-board').getAttribute('data-scene');
  await page.screenshot({ path: imgDir + '/home-1440.png' });
  await page.locator('.hero-types a[href$="type=hook"]').focus(); await page.waitForTimeout(500);
  R.checks.panel = await page.locator('.dock-panel').count();
  await page.keyboard.press('Escape');
  await page.fill('#q', 'review'); await page.press('#q', 'Enter'); await page.waitForURL(/q=review/, { timeout: 30000 });
  R.checks.searchCount = await page.locator('.result-count strong').textContent();
  await page.locator('.sort .chip:has-text("Name")').click(); await page.waitForURL(/sort=name/, { timeout: 30000 });
  await page.locator('.rows .row-title a').first().click(); await page.waitForURL(/\/r\//, { timeout: 30000 });
  await page.locator('h1').first().waitFor();
  R.checks.detailH1 = (await page.locator('h1').first().textContent()).trim().slice(0, 60);
  await page.goBack(); await page.waitForURL(/sort=name/, { timeout: 30000 }); R.checks.back = page.url().replace(B, '');
  await page.goto(B + '/artifacts', { waitUntil: 'load' }); await page.locator('html[data-hotkeys][data-platform]').waitFor({ state: 'attached' });
  R.checks.mouseCap = await page.locator('.search-row .field').evaluate((f) => getComputedStyle(f, '::before').display);
  R.checks.desktopErrors = errs; await c.close();
  // A-01 and phone.
  for (const [name, w, h] of [['tablet', 1024, 768], ['tablet-1180', 1180, 820], ['phone', 390, 844]]) {
    c = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true }); page = await c.newPage(); errs = []; watch(page, errs);
    await page.goto(B + '/artifacts', { waitUntil: 'load', timeout: 60000 }); await page.locator('html[data-hotkeys][data-platform]').waitFor({ state: 'attached' });
    R.checks[name] = await page.evaluate(() => { const f = document.querySelector('.search-row .field'); return { chord: getComputedStyle(f, '::before').display, slash: getComputedStyle(f, '::after').display, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
    R.checks[name].errors = errs;
    if (name !== 'tablet-1180') await page.screenshot({ path: `${imgDir}/artifacts-${name}.png` });
    await c.close();
  }
  R.checks.nonGetRequests = nonGet; R.browser = b.version(); await b.close();
  fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 0));
})().catch((e) => { console.error(e); fs.writeFileSync(outJson, JSON.stringify({ ...R, fatal: String(e) }, null, 1)); process.exit(1); });
