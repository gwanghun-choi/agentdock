import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchLauncher } from './SearchLauncher';
import { TYPE_FILTER_IDS } from './typeFilters';

/**
 * The launcher is the one place a "command palette" could quietly turn into a
 * second search implementation — its own endpoint, its own ranking, its own idea
 * of a match — sitting beside the real one and drifting from it. These assert
 * the shape that makes that impossible: a plain GET form aimed at the route that
 * already searches, and no client boundary anywhere near it.
 */
describe('SearchLauncher', () => {
  const html = renderToStaticMarkup(<SearchLauncher />);

  it('is a closed native dialog, so nothing on the page is covered until it is opened', () => {
    expect(html).toContain('<dialog');
    // No `open` attribute in the markup: the element is display:none and absent
    // from the accessibility tree until showModal() puts it in the top layer.
    expect(html).not.toMatch(/<dialog[^>]*\sopen\b/);
    expect(html).toContain('id="search-launcher"');
  });

  it('submits a GET to the artifacts route, with the parameter that route reads', () => {
    expect(html).toMatch(/<form[^>]*action="\/artifacts"/);
    expect(html).toMatch(/<form[^>]*method="get"/);
    expect(html).toContain('name="q"');
  });

  it('closes with the platform, not with a handler', () => {
    // <form method="dialog"> closes the dialog with no JavaScript at all, which
    // is what keeps the whole palette down to one showModal() call.
    expect(html).toMatch(/<form[^>]*method="dialog"/);
  });

  it('names itself, since it has no visible heading', () => {
    expect(html).toMatch(/<dialog[^>]*aria-label="Search artifacts"/);
    expect(html).toContain('for="launcher-q"');
  });

  it('is a Server Component', () => {
    // A 'use client' here would pull the markup, and every icon in it, into the
    // client bundle to gain nothing: this component has no state and no handler.
    expect(readFileSync('src/components/SearchLauncher.tsx', 'utf8')).not.toContain("'use client'");
  });
});

/**
 * The three ids the keyboard shortcut reaches for. They are a contract between a
 * Server Component's markup and a Client Component's `getElementById`, which is
 * the kind of coupling that breaks silently: renaming one leaves a shortcut that
 * does nothing and a page that looks completely correct.
 */
describe('the ids SearchHotkey looks up', () => {
  const hotkey = readFileSync('src/components/SearchHotkey.tsx', 'utf8');

  it('matches the launcher markup', () => {
    const html = renderToStaticMarkup(<SearchLauncher />);

    expect(hotkey).toContain("getElementById('search-launcher')");
    expect(html).toContain('id="search-launcher"');
    expect(hotkey).toContain("getElementById('launcher-q')");
    expect(html).toContain('id="launcher-q"');
  });

  it('still looks up the search field the artifacts route renders', () => {
    expect(hotkey).toContain("getElementById('q')");
    expect(readFileSync('src/app/artifacts/page.tsx', 'utf8')).toContain('id="q"');
  });
});

/**
 * The quick-filter chips. They are links to the artifacts route's own filter
 * URL, which is the whole point: the launcher gains a way in without gaining a
 * second idea of what searching means.
 */
describe('the quick filters', () => {
  const html = renderToStaticMarkup(<SearchLauncher />);

  it('links to the same type parameter the artifacts form submits', () => {
    for (const id of TYPE_FILTER_IDS) {
      expect(html).toContain(`href="/artifacts?type=${id}"`);
    }
  });

  it('offers only types the search route actually accepts', () => {
    // `catalog` is a real artifact type with a badge of its own, and it is not
    // one of the ids parseTypeFilter keeps. A chip for it would look like a
    // filter and behave like no filter at all.
    expect(html).not.toContain('href="/artifacts?type=catalog"');
  });

  it('names the group, because a bare row of chips is not a landmark', () => {
    expect(html).toContain('aria-label="Browse by type"');
  });

  it('does not introduce a second query parameter or endpoint', () => {
    const source = readFileSync('src/components/SearchLauncher.tsx', 'utf8');
    // One route, one parameter name. Anything else here would be the start of a
    // parallel search implementation, which is the failure this component was
    // written to avoid.
    expect(source).not.toMatch(/fetch\(|useState|api\//);
    for (const href of html.match(/href="[^"]*"/g) ?? []) {
      expect(href).toMatch(/^href="\/artifacts(\?type=[a-z_]+)?"$/);
    }
  });
});

/**
 * The two key caps drawn inside the artifacts search field.
 *
 * Every shortcut on this site is bound by SearchHotkey's effect, so with
 * JavaScript off none of them works. The caps are gated on the attribute that
 * effect sets, which makes "is JavaScript running" and "do we claim a shortcut"
 * the same condition rather than two that can drift apart.
 */
describe('the shortcut hints', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const hotkey = readFileSync('src/components/SearchHotkey.tsx', 'utf8');

  it('is SearchHotkey that stamps the attributes they are gated on', () => {
    expect(hotkey).toContain('root.dataset.hotkeys');
    expect(hotkey).toContain('root.dataset.platform');
  });

  it('draws no cap at all until the shortcuts are actually bound', () => {
    expect(css).toContain(':root:not([data-hotkeys]) .search-row .field::before');
    expect(css).toContain(':root:not([data-hotkeys]) .search-row .field::after');
  });

  it('names the modifier the reader actually has', () => {
    expect(css).toContain('[data-platform="mac"] .search-row .field::before');
    expect(css).toContain('content: "⌘K"');
    expect(css).toContain('[data-platform="other"] .search-row .field::before');
    expect(css).toContain('content: "Ctrl K"');
  });

  it('accepts either modifier regardless of which one is printed', () => {
    // The label is cosmetic. Ctrl+K on a Mac and Cmd+K on Linux both still work.
    expect(hotkey).toContain('event.metaKey || event.ctrlKey');
  });
});
