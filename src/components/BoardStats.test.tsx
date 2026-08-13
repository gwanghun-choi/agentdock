import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardStats } from '@/components/BoardStats';
import type { PackageListItem } from '@/db/queries/packages';

function item(over: Partial<PackageListItem> = {}): PackageListItem {
  return {
    id: 1,
    name: 'thing',
    summary: 'does a thing',
    type: 'skill',
    sourcePath: 'skills/thing/SKILL.md',
    fullName: 'owner/repo',
    stars: 120,
    commitSha: 'abc1234',
    scannedAt: new Date('2026-08-12T00:00:00Z'),
    notListedBecause: null,
    ...over,
  };
}

describe('BoardStats', () => {
  it('renders nothing for an empty window rather than dividing by zero', () => {
    expect(renderToStaticMarkup(<BoardStats items={[]} newestRead={null} />)).toBe('');
  });

  it('counts distinct repositories, not artifacts', () => {
    const html = renderToStaticMarkup(
      <BoardStats
        items={[
          item({ id: 1, fullName: 'a/one' }),
          item({ id: 2, fullName: 'a/one' }),
          item({ id: 3, fullName: 'b/two' }),
        ]}
        newestRead="2026-08-12"
      />,
    );
    expect(html).toContain('<span class="metric">2</span>');
  });

  /**
   * The whole reason these figures are allowed to exist without a new query.
   * A count computed from an 18-item window and printed without its window is
   * read as a corpus total by everyone who sees it, so the window is in the
   * label of every tile that could be mistaken for one.
   */
  it('names the window on every figure that is not a corpus total', () => {
    const html = renderToStaticMarkup(
      <BoardStats items={[item({ id: 1 }), item({ id: 2 })]} newestRead="2026-08-12" />,
    );
    expect(html).toContain('among these 2, not across the corpus');
    expect(html).toContain('Kinds in these 2');
  });

  it('orders the distribution by count and shares add up to the window', () => {
    const html = renderToStaticMarkup(
      <BoardStats
        items={[
          item({ id: 1, type: 'command' }),
          item({ id: 2, type: 'skill' }),
          item({ id: 3, type: 'skill' }),
          item({ id: 4, type: 'skill' }),
        ]}
        newestRead="2026-08-12"
      />,
    );
    // Skill (3) before Command (1).
    expect(html.indexOf('Agent Skill')).toBeLessThan(html.indexOf('Slash Command'));
    expect(html).toContain('--share:0.75');
    expect(html).toContain('--share:0.25');
  });

  it('borrows each type its own badge hue rather than restating a palette', () => {
    const html = renderToStaticMarkup(
      <BoardStats items={[item({ type: 'mcp_server' })]} newestRead="2026-08-12" />,
    );
    expect(html).toContain('dist-bar badge-mcp_server');
  });

  /** A missing date is a different fact from a date, and must not render as one. */
  it('shows an em dash when nothing in the window has a read date', () => {
    const html = renderToStaticMarkup(<BoardStats items={[item()]} newestRead={null} />);
    expect(html).toContain('<span class="metric">—</span>');
  });

  /** The bar and its track are decoration; the label and count beside them say
   *  the same thing in words. */
  it('hides the chart from assistive technology', () => {
    const html = renderToStaticMarkup(<BoardStats items={[item()]} newestRead="2026-08-12" />);
    expect(html).toContain('<span aria-hidden="true" class="dist-track">');
  });
});

/**
 * The bento's own layout, which broke once and did so silently.
 *
 * The first version had a base `.tile-wide { grid-column: span 2 }` and a
 * responsive rule fighting it at equal specificity, so source order decided. It
 * lost: a one-column grid at 390px still had the chart spanning two, the browser
 * opened an implicit second column, and a 34px-wide tile went in the first one.
 * Nothing threw, nothing overflowed the document, and axe had no opinion — it
 * was visible only by measuring a tile.
 *
 * The fix was to remove the fight rather than to win it. `.tiles` renders in
 * exactly one place, so it has exactly one rule, and the span is written as
 * `1 / -1`, which is already correct at every column count. These assert that
 * property, not the source positions — a test that pins the order would have
 * gone on passing while someone reintroduced the second rule set.
 */
describe('the tile grid narrows with the viewport', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');

  it('declares the grid exactly once', () => {
    expect(css.match(/^\.tiles \{/gm)?.length).toBe(1);
    expect(css.match(/^\.tile-wide \{/gm)?.length).toBe(1);
  });

  it('spans the chart in a way that is correct at any column count', () => {
    // `span 2` is a claim about how many columns exist. `1 / -1` is a claim
    // about the row, which stays true when the grid narrows.
    expect(css).toMatch(/\.tile-wide \{\s*grid-column: 1 \/ -1;/);
    // The comment above the rule quotes the old declaration, so match on a real
    // one — with its semicolon — rather than on any mention of the string.
    expect(css).not.toMatch(/grid-column: span 2;/);
  });

  it('still steps down to two columns and then to one', () => {
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toMatch(/@media \(max-width: 68rem\) and \(min-width: 34\.01rem\)/);
  });
});
