import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchLauncher } from './SearchLauncher';

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
