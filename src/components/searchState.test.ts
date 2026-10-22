import { describe, expect, it } from 'vitest';
import { pageWindow, searchHref, toggleCapability, withType } from '@/components/searchState';

const base = { q: '', types: [] as string[], capabilities: [] as string[], page: 1 };

describe('searchHref', () => {
  it('writes one URL per state, in a fixed parameter order', () => {
    expect(searchHref(base)).toBe('/artifacts');
    expect(
      searchHref({
        q: 'mcp server',
        types: ['agent'],
        capabilities: ['no_shell', 'no_network'],
        page: 3,
      }),
    ).toBe('/artifacts?q=mcp+server&type=agent&cap=no_shell&cap=no_network&page=3');
  });

  it('omits page 1 and encodes what a query can carry', () => {
    expect(searchHref({ ...base, q: 'a&b=c#d', page: 1 })).toBe('/artifacts?q=a%26b%3Dc%23d');
  });
});

describe('the chips', () => {
  const applied = { q: 'review', types: ['agent'], capabilities: ['no_shell'], page: 4 };

  it('a type chip selects its type, keeps the query and capabilities, and resets the page', () => {
    expect(searchHref(withType(applied, 'skill'))).toBe(
      '/artifacts?q=review&type=skill&cap=no_shell',
    );
  });

  it('the applied type chip, and "All types", link to the same search without a type', () => {
    const cleared = '/artifacts?q=review&cap=no_shell';
    expect(searchHref(withType(applied, 'agent'))).toBe(cleared);
    expect(searchHref(withType(applied, null))).toBe(cleared);
  });

  it('a capability chip toggles only its own id', () => {
    expect(searchHref(toggleCapability(applied, 'no_shell'))).toBe(
      '/artifacts?q=review&type=agent',
    );
    expect(searchHref(toggleCapability(applied, 'no_scripts'))).toBe(
      '/artifacts?q=review&type=agent&cap=no_shell&cap=no_scripts',
    );
  });
});

describe('pageWindow', () => {
  it.each([
    [1, 1, [1]],
    [1, 2, [1, 2]],
    [1, 7, [1, 2, null, 7]],
    [3, 7, [1, 2, 3, 4, null, 7]],
    [4, 7, [1, 2, 3, 4, 5, 6, 7]],
    [5, 9, [1, null, 4, 5, 6, null, 9]],
    [7, 7, [1, null, 6, 7]],
    // A gap of one page prints the page, never an ellipsis standing in for it.
    [4, 6, [1, 2, 3, 4, 5, 6]],
    [40, 40, [1, null, 39, 40]],
  ])('page %i of %i → %j', (page, last, expected) => {
    expect(pageWindow(page, last)).toEqual(expected);
  });

  it('never prints more than seven entries, or a page outside 1..last', () => {
    for (let last = 1; last <= 40; last += 1) {
      for (let page = 1; page <= last; page += 1) {
        const w = pageWindow(page, last);
        expect(w.length).toBeLessThanOrEqual(7);
        expect(w).toContain(page);
        for (const p of w) if (p !== null) expect(p >= 1 && p <= last).toBe(true);
      }
    }
  });
});
