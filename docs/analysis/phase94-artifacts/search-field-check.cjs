// usage: node search-field-check.cjs <baseUrl> <out.json>  — local only. The clear button in
// three engines, at each width and each browser zoom. A zoom of z at width w is a layout
// viewport of w/z CSS pixels, which is what zooming does; real browser chrome is not involved.
const pw = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const [base, out] = process.argv.slice(2);
const WIDTHS = [390, 640, 768, 1024, 1280, 1440, 1920, 2560];
const ZOOMS = [1, 1.25, 1.5, 2];
(async () => {
  const R = {};
  for (const type of ['chromium', 'firefox', 'webkit']) {
    const b = await pw[type].launch();
    const rows = [];
    let shot = false;
    for (const width of WIDTHS) for (const zoom of ZOOMS) {
      const w = Math.round(width / zoom);
      if (w < 320) continue;
      const ctx = await b.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: zoom, colorScheme: 'dark' });
      const p = await ctx.newPage();
      for (const path of ['/', '/artifacts']) {
        await p.goto(base + path, { waitUntil: 'load' });
        await p.locator('html[data-hotkeys]').waitFor();
        await p.locator(path === '/' ? '.hero-search' : '.result-count, main .empty').first().waitFor();
        const q = p.locator('#q'); const c = p.locator('main .field-clear, .hero-search .field-clear').first();
        const hiddenEmpty = !(await c.isVisible());
        const before = await q.boundingBox();
        await q.focus(); await q.fill('ponytail ' + 'x'.repeat(200));
        const box = await c.boundingBox(); const f = await q.boundingBox();
        const pad = await q.evaluate((e) => parseFloat(getComputedStyle(e).paddingRight));
        const inside = box.x >= f.x && Math.abs(box.x + box.width - (f.x + f.width)) <= 1 && box.y >= f.y - 1 && box.y + box.height <= f.y + f.height + 1;
        const moved = Math.abs(before.width - f.width) + Math.abs(before.x - f.x) + Math.abs(before.height - f.height);
        await c.hover(); const hov = await c.boundingBox();
        await p.mouse.move(0, 0); await p.locator('h1').first().click({ position: { x: 1, y: 1 } }).catch(() => {}); const blur = await c.boundingBox();
        // Against the field, since the click that blurs it can scroll the page.
        const f2 = await q.boundingBox();
        const off = (b, r) => [b.x - r.x, b.y - r.y, b.width, b.height].map((n) => n.toFixed(1)).join();
        const stable = off(box, f) === off(hov, f) && off(box, f) === off(blur, f2);
        await p.waitForTimeout(250); // the caps fade out over --dur-fast
        const caps = await p.locator('.search-row .field').first().evaluate((e) => getComputedStyle(e, '::after').opacity);
        await c.click();
        const cleared = (await q.inputValue()) === ''; const focused = await q.evaluate((e) => e === document.activeElement);
        const hiddenAfter = !(await c.isVisible());
        await q.fill('ponytail'); await q.press('Escape'); const esc = (await q.inputValue()) === ''; await q.fill('');
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        rows.push({ width, zoom, path, hiddenEmpty, inside, moved, pad: pad >= box.width - 1, stable, caps, cleared, focused, hiddenAfter, esc, overflow });
      }
      await ctx.close();
    }
    const bad = rows.filter((r) => !(r.hiddenEmpty && r.inside && r.moved === 0 && r.pad && r.stable && +r.caps < 0.01 && r.cleared && r.focused && r.hiddenAfter && r.overflow <= 0));
    R[type] = { version: b.version(), checked: rows.length, failed: bad };
    console.log(type, b.version(), 'checked', rows.length, 'failed', bad.length, JSON.stringify(bad.slice(0, 4)));
    await b.close();
  }
  fs.writeFileSync(out, JSON.stringify(R, null, 1));
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
