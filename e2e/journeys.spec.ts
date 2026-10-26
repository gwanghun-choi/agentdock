import { expect, type Page, test } from '@playwright/test';

// The reader's journeys through search and detail, in a real browser against
// the production build, under the real Content-Security-Policy. The data is
// e2e/seed.mjs's: seven committed fixtures and one synthetic repository, so
// every count below is a fact of that corpus, not of production.

const total = async (page: Page) =>
  Number(((await page.locator('.result-count strong').textContent()) ?? '').replace(/,/g, ''));

async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

/** Every console error on a page, for the CSP and hydration check. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('search: Enter shows results for the query and keeps it in the field', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.fill('#q', 'review');
  await page.press('#q', 'Enter');
  await page.waitForURL(/\/artifacts\?q=review$/);
  expect(await total(page)).toBeGreaterThan(0);
  await expect(page.locator('#q')).toHaveValue('review');
  expect(errors).toEqual([]);
});

test('type filter: one click applies it, keeps the query, and its removal restores the search', async ({
  page,
}) => {
  await page.goto('/artifacts?q=review');
  await page.click('.facet .chip:has-text("Subagents")');
  await page.waitForURL(/q=review&type=agent$/);
  const badges = await page.locator('.rows .badge').allTextContents();
  expect(badges.length).toBeGreaterThan(0);
  expect(badges.every((b) => b.includes('Subagent'))).toBe(true);
  await page.click('.applied a:has-text("Subagents")');
  await page.waitForURL(/\/artifacts\?q=review$/);
  await expect(page.locator('.applied')).toHaveCount(0);
});

test('capability filter: toggles on and off, composes with a type, and Clear all removes both', async ({
  page,
}) => {
  await page.goto('/artifacts?q=review');
  await page.click('.facet .chip:has-text("Agent Skills")');
  await page.click('.facet .chip:has-text("No Bash grant declared")');
  await page.waitForURL(/type=skill&cap=no_shell/);
  await expect(page.locator('.applied a')).toHaveCount(3);
  await page.click('.applied a:has-text("Clear all")');
  await page.waitForURL(/\/artifacts\?q=review$/);
});

// The corpus's four bilingual descriptions are baoyu-skills' English ones that
// quote Chinese trigger phrases; nothing in it is Chinese, Japanese or Korean alone.
test('language filter: narrows to a writing system, names it per row, survives paging state, and comes off', async ({
  page,
}) => {
  await page.goto('/artifacts');
  const all = await total(page);
  await page.click('.facet .chip:has-text("Mixed languages")');
  await page.waitForURL(/\/artifacts\?lang=mixed$/);
  expect(await total(page)).toBe(4);
  const metas = await page.locator('.rows .row-meta').allTextContents();
  expect(metas.every((m) => m.includes('Mixed languages'))).toBe(true);
  await expect(page.locator('.rows .row-desc[lang]')).toHaveCount(0);

  await page.click('.facet .chip:has-text("Agent Skills")');
  await page.waitForURL(/type=skill&lang=mixed$/);
  await page.click('.sort a:has-text("Name")');
  await page.waitForURL(/type=skill&lang=mixed&sort=name$/);
  expect(await total(page)).toBe(4);

  await page.click('.applied a:has-text("Description: Mixed languages")');
  await page.waitForURL(/\/artifacts\?type=skill&sort=name$/);
  await page.goto('/artifacts?lang=xx');
  expect(await total(page)).toBe(all);

  await page.goto('/artifacts?lang=mixed&q=translate');
  await page.click('.rows .row-title a');
  await expect(page.locator('.detail-head')).toContainText('Description language: Mixed languages');
});

test('a new query keeps the applied filters and the chosen sort', async ({ page }) => {
  await page.goto('/artifacts?type=command&sort=name');
  await page.fill('#q', 'commit');
  await page.press('#q', 'Enter');
  await page.waitForURL(/q=commit&type=command&sort=name$/);
});

test('sort: links reorder the same set, reset the page, and survive filters and paging', async ({
  page,
}) => {
  await page.goto('/artifacts?q=skill');
  const relevanceTotal = await total(page);
  await expect(page.locator('.sort .chip[aria-current]')).toHaveText('Relevance');
  await page.click('.sort .chip:has-text("Name")');
  await page.waitForURL(/\/artifacts\?q=skill&sort=name$/);
  expect(await total(page)).toBe(relevanceTotal);
  const names = (await page.locator('.rows .row-title a').allTextContents()).map((n) =>
    n.toLowerCase(),
  );
  expect(names.length).toBeGreaterThan(1);
  // Ordered by the database's collation, so compared loosely: the first name
  // sorts no later than the last on this page.
  expect(names[0].localeCompare(names.at(-1) ?? '')).toBeLessThanOrEqual(0);
  await page.click('.pager a[rel="next"]');
  await page.waitForURL(/q=skill&sort=name&page=2$/);
  await page.click('.facet .chip:has-text("Agent Skills")');
  await page.waitForURL(/q=skill&type=skill&sort=name$/);
  await page.goBack();
  await page.waitForURL(/q=skill&sort=name&page=2$/);
  await expect(page.locator('.sort .chip[aria-current]')).toHaveText('Name');
  // Browsing offers no Relevance: with no query every row would tie.
  await page.goto('/artifacts');
  await expect(page.locator('.sort .chip')).toHaveText([
    'Recently indexed',
    'Newly added',
    'Content changed',
    'Name',
  ]);
});

test('highlight and reason: query words are marked as text, and the row says where they matched', async ({
  page,
}) => {
  await page.goto('/artifacts?q=debugging');
  const marks = await page.locator('.rows mark').allTextContents();
  expect(marks.length).toBeGreaterThan(0);
  expect(marks.every((m) => m.toLowerCase().startsWith('debug'))).toBe(true);
  await expect(page.locator('.row-why').first()).toContainText('Matched in');
  // A path query marks the path where the substring test matched.
  await page.goto('/artifacts?q=.claude/agents');
  await expect(page.locator('.row-meta .path mark').first()).toHaveText('.claude/agents');
});

test('a query holding markup is shown as text and runs nothing', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async (d) => {
    dialog = true;
    await d.dismiss();
  });
  const q = '<script>alert(1)</script>';
  await page.goto(`/artifacts?q=${encodeURIComponent(q)}`);
  await expect(page.locator('#q')).toHaveValue(q);
  expect(await page.locator('main script:not([src])').count()).toBe(0);
  expect(dialog).toBe(false);
});

test('empty state: a query of stop words says nothing matched and offers a way out', async ({
  page,
}) => {
  await page.goto('/artifacts?q=the&type=agent');
  await expect(page.locator('.empty')).toContainText('No artifacts matched "the"');
  await page.click('.empty a:has-text("Clear search")');
  await page.waitForURL(/\/artifacts\?type=agent$/);
  expect(await total(page)).toBeGreaterThan(0);
});

test('pagination: numbered pages, next, last page and a page past the end', async ({ page }) => {
  await page.goto('/artifacts');
  const n = await total(page);
  const last = Math.ceil(n / 25);
  await expect(page.locator('.pager [aria-current="page"]')).toHaveText('1');
  await page.click('.pager a[rel="next"]');
  await page.waitForURL(/page=2$/);
  await expect(page.locator('.result-bar')).toContainText('Showing 26–50');
  await page.click(`.pager a[aria-label="Page ${last}"]`);
  await page.waitForURL(new RegExp(`page=${last}$`));
  await expect(page.locator('.rows > li')).toHaveCount(n - (last - 1) * 25);
  await expect(page.locator('.pager a[rel="next"]')).toHaveCount(0);
  await page.goto(`/artifacts?page=${last + 1}`);
  await expect(page.locator('.empty')).toContainText(`There is no page ${last + 1}`);
});

test('detail, Back and a shared URL', async ({ page, browser }) => {
  await page.goto('/artifacts?q=code-reviewer&type=agent');
  const name = ((await page.locator('.rows .row-title a').first().textContent()) ?? '').trim();
  await page.locator('.rows .row-title a').first().click();
  await page.waitForURL(/\/r\//);
  await expect(page.locator('h1')).toHaveText(name);
  const source = page.locator('.detail-actions a').first();
  expect(await source.getAttribute('href')).toMatch(
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]{40}\//,
  );
  await page.goBack();
  await page.waitForURL(/q=code-reviewer&type=agent$/);
  await expect(page.locator('#q')).toHaveValue('code-reviewer');

  // A fresh context, as a link pasted into another browser would be.
  const other = await (await browser.newContext()).newPage();
  await other.goto('/artifacts?q=skill&type=skill&cap=no_scripts&sort=name&page=2');
  await expect(other.locator('#q')).toHaveValue('skill');
  await expect(other.locator('.facet:not(.sort) .chip[aria-current]')).toHaveText([
    'Agent Skills',
    'Any language',
    'No bundled script files',
  ]);
  await expect(other.locator('.sort .chip[aria-current]')).toHaveText('Name');
  await expect(other.locator('.pager [aria-current="page"]')).toHaveText('2');
});

test('subagent detail: breadcrumb, section links and the plugin relation both ways', async ({
  page,
}) => {
  await page.goto('/r/fixture/ui-edge-cases/.claude/agents/code-reviewer.md');
  await expect(page.locator('.crumbs li')).toHaveText([
    'Artifacts',
    'Subagents',
    'fixture/ui-edge-cases',
    'code-reviewer',
  ]);
  for (const id of await page
    .locator('.toc a')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
    await expect(page.locator(id)).toHaveCount(1);
  }
  await page.goto('/r/fixture/ui-edge-cases/plugins/review-kit/.claude-plugin/plugin.json');
  await page.click('#related ~ ul.notes a:has-text("security-reviewer")');
  await page.waitForURL(/security-reviewer\.md$/);
  await expect(page.locator('#related ~ ul.notes').first()).toContainText(
    'Inside the plugin review-kit',
  );
});

test('setup: an MCP file shows its servers, blanks a credential, and copies JSON by keyboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/r/fixture/ui-edge-cases/.mcp.json');
  await expect(page.locator('.toc a[href="#setup"]')).toHaveCount(1);
  // One block per server, each opening with its name; the JSON block follows them.
  const server = (name: string) =>
    page.locator('#setup ~ dl.install').filter({ hasText: `Server${name}Transport` });
  await expect(server('fixture-search')).toContainText('uvx fixture-search --api-key <redacted>');
  await expect(server('fixture-docs')).toContainText('DOCS_TOKEN — names only');
  // Nowhere on the page, not only in the setup block.
  expect(await page.content()).not.toContain('FIXTURE-FAKE');
  const copy = page.getByRole('button', { name: 'Copy JSON' });
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(copy.locator('xpath=following-sibling::*[@role="status"]')).toHaveText('Copied');
  const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(Object.keys(json.mcpServers).sort()).toEqual([
    'fixture-db',
    'fixture-docs',
    'fixture-search',
  ]);
  expect(json.mcpServers['fixture-db']).toEqual({
    type: 'http',
    url: 'https://example.invalid/mcp',
  });
  expect(json.mcpServers['fixture-docs'].env).toBeUndefined();
});

test('setup: a hook lists each handler as inert text, a credential blanked', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await page.goto('/r/fixture/ui-edge-cases/.claude/settings.json');
  const rows = page.locator('#setup ~ dl.handler');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('PreToolUse');
  await expect(rows.nth(0)).toContainText('--token=<redacted>');
  await expect(rows.nth(1)).toContainText('echo "<script>alert(1)</script>"');
  expect(await page.content()).not.toContain('FIXTURE-FAKE');
  expect(dialog).toBe(false);
});

test('a file name holding # opens from its repository, and its links keep the #', async ({
  page,
}) => {
  await page.goto('/r/fixture/ui-edge-cases');
  await page.click('a:has-text("c#-review")');
  await page.waitForURL(/c%23-review\.md$/);
  await expect(page.locator('h1')).toHaveText('c#-review');
  expect(await page.locator('.detail-actions a').first().getAttribute('href')).toMatch(
    /\/blob\/[0-9a-f]{40}\/\.claude\/commands\/c%23-review\.md$/,
  );
  await expect(page.locator('#setup ~ dl.install').first()).toContainText('/c#-review [file]');
});

test('setup: a plugin shows no install command, a skill links its directory at the commit', async ({
  page,
}) => {
  await page.goto('/r/fixture/ui-edge-cases/plugins/review-kit/.claude-plugin/plugin.json');
  await expect(page.locator('#setup ~ dl.install').first()).toContainText('Install command');
  await expect(page.locator('main')).not.toContainText('/plugin install');
  await page.goto('/r/fixture/ui-edge-cases/plugins/review-kit/skills/review-checklist');
  expect(
    await page.locator('a:has-text("Browse the directory at this commit")').getAttribute('href'),
  ).toMatch(/\/tree\/[0-9a-f]{40}\/plugins\/review-kit\/skills\/review-checklist$/);
});

test('versions: each row names its content, and GitHub history is one link away', async ({
  page,
}) => {
  await page.goto('/r/fixture/ui-edge-cases/.claude/agents/code-reviewer.md');
  const row = page.locator('#versions ~ table.files tbody tr').first();
  await expect(row.locator('td').nth(1)).toHaveText(/^[0-9a-f]{12}$/);
  expect(
    await page
      .locator('a:has-text("commits to this file, up to the one shown")')
      .getAttribute('href'),
  ).toMatch(/\/commits\/[0-9a-f]{40}\/\.claude\/agents\/code-reviewer\.md$/);
});

test('keyboard: / focuses search, Tab reaches a sort link and a result, focus is visible', async ({
  page,
}) => {
  await page.goto('/');
  // SearchHotkey binds the key on hydration and marks <html> when it has.
  await page.waitForSelector('html[data-hotkeys]');
  await page.keyboard.press('/');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('q');
  await page.keyboard.type('review');
  await page.keyboard.press('Enter');
  await page.waitForURL(/q=review$/);
  const tabTo = async (expr: string, limit = 80) => {
    for (let i = 0; i < limit; i++) {
      if (await page.evaluate(expr)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`Tab never reached ${expr}`);
  };
  await tabTo(`!!document.activeElement?.closest('.sort')`);
  expect(
    await page.evaluate(() => {
      const el = document.activeElement as Element;
      return el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none';
    }),
  ).toBe(true);
  await tabTo(`!!document.activeElement?.closest('.row-title')`);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/r\//);
});

test('related: siblings in the same plugin, then the rest of the repository, each a working link', async ({
  page,
}) => {
  await page.goto('/r/fixture/ui-edge-cases/plugins/review-kit/agents/security-reviewer.md');
  const related = page.locator('#related ~ ul.notes');
  await expect(related.first()).toContainText('Inside the plugin review-kit');
  await expect(
    page.locator('h3:has-text("Other components of the same plugin") + ul'),
  ).toContainText('review-checklist');
  const elsewhere = page.locator('h3:has-text("Elsewhere in fixture/ui-edge-cases") + ul');
  // The plugin itself is named once, as the container, not again here.
  await expect(elsewhere).not.toContainText('review-kit');
  await expect(elsewhere).toContainText('code-reviewer');
  await elsewhere.locator('a:has-text("c#-review")').click();
  await page.waitForURL(/c%23-review\.md$/);
  await expect(page.locator('h1')).toHaveText('c#-review');
});

test('related: a row the listing leaves out is not offered, and the search hand-off keeps the type', async ({
  page,
}) => {
  await page.goto('/r/disler/claude-code-hooks-mastery/.claude/commands/prime.md');
  const elsewhere = page.locator('h3:has-text("Elsewhere in") + ul');
  await expect(elsewhere).toContainText('question');
  // cook.md's frontmatter did not parse, so it is unlisted — on the repository
  // page with its reason, never suggested as a next step.
  await expect(elsewhere).not.toContainText('cook');
  await page.click('#related ~ p a:has-text("Search Slash Commands for")');
  await page.waitForURL(/\/artifacts\?q=prime&type=command$/);
  expect(await total(page)).toBeGreaterThan(0);
});

test('date orders: newly added and content changed, each saying what its date is', async ({
  page,
}) => {
  await page.goto('/');
  await page.click('.board-actions a:has-text("Newly added")');
  await page.waitForURL(/\/artifacts\?sort=added$/);
  const listed = await total(page);
  await expect(page.locator('.sort .chip[aria-current]')).toHaveText('Newly added');
  await expect(page.locator('.sort-note')).toContainText('first indexed');
  await expect(page.locator('.rows .row-meta').first()).toContainText(
    /first indexed \d{4}-\d{2}-\d{2}/,
  );
  // A sort reorders the same set: same total, and filters compose with it.
  await page.click('.sort .chip:has-text("Content changed")');
  await page.waitForURL(/\/artifacts\?sort=changed$/);
  expect(await total(page)).toBe(listed);
  await expect(page.locator('.sort-note')).toContainText('not when that change was committed');
  await page.click('.facet .chip:has-text("Subagents")');
  await page.waitForURL(/type=agent&sort=changed$/);
  await expect(page.locator('.sort .chip[aria-current]')).toHaveText('Content changed');
  // An empty result keeps the order in its exits.
  await page.goto('/artifacts?q=zzqqnothing&sort=added');
  await expect(page.locator('.rows li')).toHaveCount(0);
});

test('bad parameters fall back to defaults, and parameterised listings are noindex', async ({
  page,
}) => {
  await page.goto('/artifacts?page=abc&type=bogus&lang=zz&cap=nope&sort=stars');
  await expect(page.locator('.facet:not(.sort) .chip[aria-current]')).toHaveText([
    'All types',
    'Any language',
  ]);
  await expect(page.locator('.sort .chip[aria-current]')).toHaveText('Recently indexed');
  expect(await page.locator('meta[name=robots]').getAttribute('content')).toContain('noindex');
  await page.goto('/artifacts?type=agent');
  await expect(page.locator('meta[name=robots]')).toHaveCount(0);
});

test('another spelling of an artifact or repository address redirects to the one the site links', async ({
  request,
}) => {
  // Both answered 200 with the linked page's content before (production, 2026-10-23).
  for (const [from, to] of [
    ['/r/ANTHROPICS/Skills/skills/pdf', '/r/anthropics/skills/skills/pdf'],
    ['/r/anthropics/skills/skills/pdf/SKILL.md', '/r/anthropics/skills/skills/pdf'],
    [
      '/r/Fixture/ui-edge-cases/.claude/commands/c%23-review.md',
      '/r/fixture/ui-edge-cases/.claude/commands/c%23-review.md',
    ],
    ['/r/ANTHROPICS/skills', '/r/anthropics/skills'],
  ]) {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status(), from).toBe(308);
    expect(res.headers().location, from).toBe(to);
  }
  for (const linked of [
    '/r/anthropics/skills/skills/pdf',
    '/r/fixture/ui-edge-cases/.claude/commands/c%23-review.md',
  ]) {
    expect((await request.get(linked, { maxRedirects: 0 })).status(), linked).toBe(200);
  }
});

test('every page carries its own description and sharing card', async ({ page }) => {
  // A hook declares no description: the page used to ship no description tag,
  // and the repository and listing cards were the site's own (2026-10-23).
  await page.goto('/r/fixture/ui-edge-cases/.claude/settings.json');
  expect(await page.locator('meta[name=description]').getAttribute('content')).toBe(
    'Hook Configuration at .claude/settings.json in fixture/ui-edge-cases, as read at commit eeeeeee.',
  );
  for (const path of ['/r/fixture/ui-edge-cases', '/artifacts?type=hook']) {
    await page.goto(path);
    expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toBe(
      await page.title(),
    );
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('search, filter and sort without horizontal overflow', async ({ page }) => {
    await page.goto('/artifacts');
    await noHorizontalOverflow(page);
    await page.fill('#q', 'mcp');
    await page.press('#q', 'Enter');
    await page.waitForURL(/q=mcp$/);
    await noHorizontalOverflow(page);
    const chip = page.locator('.facet .chip:has-text("Subagents")');
    await chip.scrollIntoViewIfNeeded();
    await chip.tap();
    await page.waitForURL(/q=mcp&type=agent$/);
    await page.goto('/artifacts?q=review');
    await page.locator('.sort .chip:has-text("Name")').tap();
    await page.waitForURL(/sort=name/);
    await noHorizontalOverflow(page);
  });

  test('a very long name wraps on 320px, in the list and on its page', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/artifacts?q=extremely');
    await noHorizontalOverflow(page);
    await page.locator('.rows .row-title a').first().tap();
    await page.waitForURL(/\/r\//);
    await noHorizontalOverflow(page);
  });

  test('related lists and date orders fit 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/r/fixture/ui-edge-cases/plugins/review-kit/agents/security-reviewer.md');
    await page.locator('#related').scrollIntoViewIfNeeded();
    await noHorizontalOverflow(page);
    for (const sort of ['added', 'changed']) {
      await page.goto(`/artifacts?sort=${sort}`);
      await noHorizontalOverflow(page);
    }
    await page.goto('/');
    await noHorizontalOverflow(page);
  });

  test('setup blocks wrap on 320px: a JSON configuration and a hook command', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['.mcp.json', '.claude/settings.json']) {
      await page.goto(`/r/fixture/ui-edge-cases/${path}`);
      await page.locator('#setup').scrollIntoViewIfNeeded();
      await noHorizontalOverflow(page);
    }
  });
});
