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
 * `.tile-wide { grid-column: span 2 }` sat after the responsive blocks that
 * narrow the grid, so at equal specificity it won: a one-column grid at 390px
 * still had the chart spanning two, which made the browser open an implicit
 * second column and left a 34px-wide tile in the first. Nothing threw, nothing
 * overflowed the document, and axe had no opinion — it was only visible by
 * measuring a tile.
 */
describe('the tile grid narrows with the viewport', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');

  it('declares a step for each of the three widths', () => {
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toMatch(/@media \(max-width: 34rem\) \{\s*\.tiles/);
  });

  it('puts the responsive override after the base rule it has to beat', () => {
    const base = css.indexOf('.tile-wide {\n  grid-column: span 2;');
    const override = css.indexOf('grid-column: 1 / -1;');
    expect(base).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(base);
  });
});
