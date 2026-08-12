import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_CAP,
  SEARCH_TOPICS,
  type StarRange,
  searchRepositories,
  shardLadder,
  shardQuery,
  subdivide,
  walkShard,
} from './search';

/**
 * The ladder and the subdivision are pure and tested with no network on purpose.
 * They are the part of COR-05 that can be wrong in a way no live run would ever
 * reveal: a ladder with a one-star gap loses every repository at that value, and
 * nothing anywhere reports it.
 */
describe('shardLadder', () => {
  const floors = [0, 1, 2, 10, 99, 1024, 5000];

  it.each(floors)('covers [%i, infinity) with no gap and no overlap', (floor) => {
    const ladder = shardLadder(floor);
    expect(ladder.length).toBeGreaterThan(0);

    // Descending: each rung starts strictly above the next one's top.
    for (let i = 0; i < ladder.length - 1; i += 1) {
      const above = ladder[i];
      const below = ladder[i + 1];
      expect(below.max).not.toBeNull();
      // Gapless AND disjoint in one assertion: the rung below ends exactly one
      // star short of the rung above beginning. Either a gap or an overlap
      // breaks this equality.
      expect(above.min).toBe((below.max as number) + 1);
    }

    // The bottom rung starts at the floor, and only the top rung is open-ended.
    expect(ladder[ladder.length - 1].min).toBe(floor);
    expect(ladder[0].max).toBeNull();
    for (const rung of ladder.slice(1)) expect(rung.max).not.toBeNull();
  });

  it('gives zero stars its own rung, because zero cannot be doubled', () => {
    const ladder = shardLadder(0);
    expect(ladder[ladder.length - 1]).toEqual({ min: 0, max: 0 });
    expect(ladder[ladder.length - 2]).toEqual({ min: 1, max: 1 });
  });

  it('refuses a floor that is not a non-negative integer', () => {
    expect(() => shardLadder(-1)).toThrow();
    expect(() => shardLadder(1.5)).toThrow();
  });

  it('names every star value from the floor upward exactly once', () => {
    // Exhaustive over a bounded window rather than a property: 0..2000 is small
    // enough to enumerate and covers both the geometric rungs and the handover
    // to the open-ended one.
    const ladder = shardLadder(10);
    for (let stars = 10; stars <= 2000; stars += 1) {
      const hits = ladder.filter((r) => stars >= r.min && (r.max === null || stars <= r.max));
      expect(hits).toHaveLength(1);
    }
    // And nothing below the floor is claimed by any rung.
    for (let stars = 0; stars < 10; stars += 1) {
      expect(
        ladder.filter((r) => stars >= r.min && (r.max === null || stars <= r.max)),
      ).toHaveLength(0);
    }
  });
});

describe('subdivide', () => {
  it('halves a multi-value range without gap or overlap', () => {
    const halves = subdivide({ min: 10, max: 19 });
    expect(halves).toEqual([
      { min: 15, max: 19 },
      { min: 10, max: 14 },
    ]);
  });

  it('splits a two-value range into two single values', () => {
    expect(subdivide({ min: 4, max: 5 })).toEqual([
      { min: 5, max: 5 },
      { min: 4, max: 4 },
    ]);
  });

  it('returns null for a single star value, which is indivisible', () => {
    expect(subdivide({ min: 0, max: 0 })).toBeNull();
    expect(subdivide({ min: 7, max: 7 })).toBeNull();
  });

  it('divides an open-ended range by doubling', () => {
    expect(subdivide({ min: 1024, max: null })).toEqual([
      { min: 2048, max: null },
      { min: 1024, max: 2047 },
    ]);
  });

  it('stops dividing an open-ended range above the star ceiling', () => {
    // Otherwise the doubling has no fixed point and a sweep spends its whole
    // budget climbing into star counts no repository has.
    expect(subdivide({ min: 1_000_000, max: null })).toBeNull();
    expect(subdivide({ min: 2_000_000, max: null })).toBeNull();
  });

  it('keeps subdivision gapless all the way down to indivisible', () => {
    // Repeatedly split the low half and check the union still covers the input.
    let range: StarRange = { min: 10, max: 19 };
    const pieces: StarRange[] = [];
    for (;;) {
      const halves = subdivide(range);
      if (halves === null) {
        pieces.push(range);
        break;
      }
      pieces.push(halves[0]);
      range = halves[1];
    }
    const covered = new Set<number>();
    for (const piece of pieces) {
      for (let s = piece.min; s <= (piece.max as number); s += 1) {
        expect(covered.has(s)).toBe(false);
        covered.add(s);
      }
    }
    expect(covered.size).toBe(10);
  });
});

describe('shardQuery', () => {
  it('writes a closed range as a range and an open one as a floor', () => {
    expect(shardQuery('claude-code', { min: 10, max: 19 })).toBe('topic:claude-code stars:10..19');
    expect(shardQuery('mcp-server', { min: 1024, max: null })).toBe(
      'topic:mcp-server stars:>=1024',
    );
  });
});

describe('SEARCH_TOPICS', () => {
  it('carries the measured size beside every topic, so stale sizing is visible', () => {
    expect(SEARCH_TOPICS.length).toBeGreaterThan(0);
    for (const entry of SEARCH_TOPICS) {
      expect(entry.topic).toMatch(/^[a-z0-9-]+$/);
      expect(entry.measuredRepositories).toBeGreaterThan(0);
    }
  });
});

// --- the fetching half -------------------------------------------------------

let hosts: string[] = [];
let urls: string[] = [];

function stubSearch(pages: (page: number) => { total_count: number; items: unknown[] }) {
  hosts = [];
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      urls.push(url.toString());
      const page = Number(url.searchParams.get('page'));
      return new Response(JSON.stringify(pages(page)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function items(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    full_name: `Owner${i + offset}/Repo${i + offset}`,
    stargazers_count: 12,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchRepositories', () => {
  it('contacts api.github.com and nothing else, and lowercases every name', async () => {
    stubSearch(() => ({ total_count: 2, items: items(2) }));
    const result = await searchRepositories('topic:claude-code stars:10..19', 1);

    expect(hosts).toEqual(['api.github.com']);
    expect(result.totalCount).toBe(2);
    expect(result.items).toEqual([
      { fullName: 'owner0/repo0', stars: 12 },
      { fullName: 'owner1/repo1', stars: 12 },
    ]);
  });

  it('drops a result whose name does not survive normalizeRepo', async () => {
    stubSearch(() => ({
      total_count: 4,
      items: [
        { full_name: '../../etc/passwd', stargazers_count: 1 },
        { full_name: 'owner/repo\n', stargazers_count: 1 },
        { full_name: 'evil.com/owner/repo', stargazers_count: 1 },
        { full_name: 'good/repo', stargazers_count: 3 },
      ],
    }));
    const result = await searchRepositories('q', 1);
    expect(result.items).toEqual([{ fullName: 'good/repo', stars: 3 }]);
  });

  it('survives a response with no items array and no count', async () => {
    stubSearch(() => ({}) as never);
    await expect(searchRepositories('q', 1)).resolves.toEqual({ totalCount: 0, items: [] });
  });

  it('throws with the status only when the search endpoint refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"message":"Validation Failed","documentation_url":"x"}', { status: 422 }),
      ),
    );
    await expect(searchRepositories('q', 1)).rejects.toThrow('GitHub search returned 422.');
    // The body echoes the query and carries a documentation URL; neither is logged.
    await expect(searchRepositories('q', 1)).rejects.not.toThrow(/documentation_url/);
  });
});

describe('walkShard', () => {
  it('walks a shard under the cap to completion and stops at the short page', async () => {
    stubSearch((page) => ({ total_count: 150, items: page === 1 ? items(100) : items(50, 100) }));
    const shard = await walkShard('q', 10);

    expect(shard.requests).toBe(2);
    expect(shard.items).toHaveLength(150);
    expect(shard.overCap).toBe(false);
    expect(shard.budgetExhausted).toBe(false);
  });

  it('never requests page eleven', async () => {
    // Exactly the cap: ten full pages, and no short page to stop on.
    stubSearch(() => ({ total_count: RESULT_CAP, items: items(100) }));
    const shard = await walkShard('q', 99);

    expect(shard.requests).toBe(10);
    expect(urls.map((u) => new URL(u).searchParams.get('page'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(urls.some((u) => new URL(u).searchParams.get('page') === '11')).toBe(false);
  });

  it('reports an over-cap shard after one request rather than paging it', async () => {
    stubSearch(() => ({ total_count: 36_487, items: items(100) }));
    const shard = await walkShard('topic:claude-code stars:0..1', 10);

    expect(shard.overCap).toBe(true);
    expect(shard.totalCount).toBe(36_487);
    // One request, not ten. Paging the other nine would collect a truncation.
    expect(shard.requests).toBe(1);
    // The page already paid for is kept — those are real repositories.
    expect(shard.items).toHaveLength(100);
  });

  it('stops on the caller budget and says the shard is a prefix', async () => {
    stubSearch(() => ({ total_count: RESULT_CAP, items: items(100) }));
    const shard = await walkShard('q', 3);

    expect(shard.requests).toBe(3);
    expect(shard.budgetExhausted).toBe(true);
    expect(shard.items).toHaveLength(300);
  });

  it('paces every request through the supplied hook', async () => {
    stubSearch((page) => ({ total_count: 150, items: page === 1 ? items(100) : items(50, 100) }));
    let paced = 0;
    await walkShard('q', 10, async () => {
      paced += 1;
    });
    expect(paced).toBe(2);
  });
});
