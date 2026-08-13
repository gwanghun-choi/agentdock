import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PackageListItem } from '@/db/queries/packages';
import { compactStars, PackageRows } from './PackageRows';

const item = (over: Partial<PackageListItem> = {}): PackageListItem => ({
  id: 1,
  name: 'canvas-design',
  summary: 'Draw things',
  type: 'skill',
  sourcePath: 'skills/canvas-design/SKILL.md',
  fullName: 'anthropics/skills',
  stars: 167_306,
  commitSha: 'f'.repeat(40),
  scannedAt: new Date('2026-08-12T00:00:00Z'),
  notListedBecause: null,
  ...over,
});

describe('compactStars', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1_000, '1.0k'],
    [1_050, '1.0k'],
    [12_400, '12.4k'],
    [99_900, '99.9k'],
    [100_000, '100k'],
    [167_306, '167k'],
  ])('renders %i as %s', (stars, expected) => {
    expect(compactStars(stars)).toBe(expected);
  });

  /**
   * Truncation, not rounding, and only in this direction. A count shown larger
   * than it is would be the one rounding error that flatters a repository —
   * which is exactly the reading this number must not invite.
   */
  it('never rounds a count upward', () => {
    for (const stars of [1_099, 12_999, 99_999, 1_999_999]) {
      const shown = compactStars(stars);
      const asNumber = Number.parseFloat(shown) * (shown.endsWith('k') ? 1_000 : 1);
      expect(asNumber).toBeLessThanOrEqual(stars);
    }
  });
});

describe('the star count in a row', () => {
  it('is a fact with a spelled-out label, not a bare glyph', () => {
    const html = renderToStaticMarkup(<PackageRows items={[item()]} />);
    expect(html).toContain('167k');
    // The exact count in words, so the abbreviation is never the only thing a
    // reader — or a screen reader — gets.
    expect(html).toContain('167,306 GitHub stars');
  });

  it('shows a zero-star repository rather than hiding the row', () => {
    // COR-07's half of the star policy: popularity gates ENTRY to the corpus and
    // decides nothing about an artifact already in it. A row that vanished at
    // zero would make the listing a popularity filter.
    const html = renderToStaticMarkup(<PackageRows items={[item({ stars: 0 })]} />);
    expect(html).toContain('canvas-design');
    expect(html).toContain('0 GitHub stars');
  });
});

/**
 * The row is a two-column grid whose left column exists so that every type
 * badge in a list lands on the same vertical line — see the component's own
 * doc. That only holds while the badge is a child of `.row-type` and not of
 * `.row-title`, which is where it used to be, and moving it back would restore
 * the ragged left edge without breaking any other assertion in this file.
 */
describe('the shape the type column depends on', () => {
  const html = renderToStaticMarkup(<PackageRows items={[item({ type: 'plugin' })]} />);

  it('puts the badge in its own cell, not inline in the title', () => {
    expect(html).toContain('<div class="row-type">');
    // The badge markup follows .row-type immediately: nothing between the cell
    // and the label it exists to hold.
    expect(html).toMatch(/<div class="row-type"><span class="badge badge-plugin">/);
  });

  it('leaves the title to the name and the repository only', () => {
    const title = html.match(/<p class="row-title">([\s\S]*?)<\/p>/);

    expect(title).not.toBeNull();
    expect(title?.[1]).toContain('canvas-design');
    expect(title?.[1]).toContain('anthropics/skills');
    expect(title?.[1]).not.toContain('badge');
  });

  it('marks the external link so it can be anchored to the row edge', () => {
    // .row-source is what pushes the GitHub permalink to a constant x on every
    // row. Without the class the link still works and still points at the right
    // commit; the metadata line just goes back to four ragged columns.
    expect(html).toContain('class="row-source"');
    expect(html).toContain('source on GitHub');
  });
});
