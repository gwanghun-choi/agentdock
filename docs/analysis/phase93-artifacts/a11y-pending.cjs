// usage: node a11y-pending.cjs <baseUrl> : axe on the home page while its placeholders are up
const { chromium } = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const fs = require('fs');
const axe = fs.readFileSync('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/axe-core/axe.min.js', 'utf8');
(async () => { const b = await chromium.launch();
 for (const [w, h, scheme] of [[1280, 800, 'light'], [390, 844, 'dark']]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, bypassCSP: true })).newPage();
  await p.goto(process.argv[2], { waitUntil: 'commit' }); await p.waitForSelector('.skeleton');
  await p.evaluate(axe);
  const r = await p.evaluate(async () => { const pending = document.querySelectorAll('.skeleton').length; const x = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }); return { pending, stillPending: document.querySelectorAll('.skeleton').length, violations: x.violations.map((v) => [v.id, v.impact, v.nodes.length, v.nodes[0].html.slice(0, 90)]) }; });
  console.log(w, scheme, JSON.stringify(r));
 } await b.close(); })();
