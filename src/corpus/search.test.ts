import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeedRow } from '@/db/queries/seeds';
import { sweepTopics } from './search';

/**
 * No database and no network. The sweep is exercised against a stubbed global
 * fetch — the same shape src/github/scan.test.ts uses — with the seed write
 * injected, so this file needs neither DATABASE_URL nor GitHub.
 *
 * The host capture is not decoration: COR-05's whole claim is that a topic sweep
 * spends zero GitHub CORE requests, and the mechanical half of that claim is
 * that it contacts exactly one host on exactly one endpoint.
 */

let hosts: string[] = [];
let queries: string[] = [];

type Shard = { total: number; count: number };

/**
 * @param shards Maps a `q` value to how many repositories GitHub claims are in
 * it and how many it will actually hand back.
 */
function stubSearch(shards: (q: string) => Shard) {
  hosts = [];
  queries = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      const q = url.searchParams.get('q') ?? '';
      const page = Number(url.searchParams.get('page'));
      if (page === 1) queries.push(q);
      const shard = shards(q);
      const start = (page - 1) * 100;
      const remaining = Math.max(0, Math.min(100, shard.count - start));
      return new Response(
        JSON.stringify({
          total_count: shard.total,
          items: Array.from({ length: remaining }, (_, i) => ({
            // Distinct per shard so a collapse across shards is visible.
            full_name: `owner${start + i}/${q.replace(/[^a-z0-9]/gi, '-')}`,
            stargazers_count: 5,
          })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
}

const TOPICS = [{ topic: 'claude-code' }];

function collect() {
  const written: SeedRow[][] = [];
  return {
    written,
    write: async (rows: SeedRow[]) => {
      written.push(rows);
      return rows.length;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sweepTopics', () => {
  it('walks every ladder rung and completes it when nothing exceeds the cap', async () => {
    stubSearch(() => ({ total: 3, count: 3 }));
    const sink = collect();

    const result = await sweepTopics(
      { minStars: 10, maxRequests: 100, spacingMs: 0, topics: TOPICS },
      sink.write,
    );

    expect(hosts.every((h) => h === 'api.github.com')).toBe(true);
    expect(new Set(hosts)).toEqual(new Set(['api.github.com']));
    expect(result.unreachableShards).toEqual([]);
    expect(result.stoppedBecause).toBe('exhausted');
    // Every rung completed, one request each, plus the one below-floor probe.
    expect(result.shardsCompleted).toBe(result.requestsSpent - 1);
    expect(result.belowFloorShards).toHaveLength(1);
    expect(result.seedsUpserted).toBeGreaterThan(0);
  });

  it('walks the high-star end first', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    await sweepTopics(
      { minStars: 10, maxRequests: 3, spacingMs: 0, topics: TOPICS },
      collect().write,
    );

    // The open-ended rung, then the one below it. The floor of 10 doubles to
    // 640 before the ladder's top threshold, so 640 is where the sky begins.
    const rungs = queries.filter((q) => !q.includes('stars:<'));
    expect(rungs[0]).toBe('topic:claude-code stars:>=640');
    expect(rungs[1]).toBe('topic:claude-code stars:320..639');
  });

  it('subdivides an over-cap shard rather than paging it to the cap', async () => {
    // One rung is over the cap; its halves are not.
    stubSearch((q) =>
      q === 'topic:claude-code stars:10..19' ? { total: 5000, count: 100 } : { total: 2, count: 2 },
    );
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 100, spacingMs: 0, topics: TOPICS },
      collect().write,
    );

    expect(queries).toContain('topic:claude-code stars:10..19');
    expect(queries).toContain('topic:claude-code stars:15..19');
    expect(queries).toContain('topic:claude-code stars:10..14');
    expect(result.unreachableShards).toEqual([]);
  });

  it('names an indivisible over-cap shard with its measured size', async () => {
    // The measured shape of topic:claude-code: the 0-star and 1-star shards each
    // hold roughly eighteen times the cap and cannot be split, while everything
    // above them fits.
    const INDIVISIBLE = new Set(['topic:claude-code stars:0..0', 'topic:claude-code stars:1..1']);
    stubSearch((q) =>
      INDIVISIBLE.has(q) ? { total: 18_243, count: 100 } : { total: 4, count: 4 },
    );

    const result = await sweepTopics(
      { minStars: 0, maxRequests: 30, spacingMs: 0, topics: TOPICS },
      collect().write,
    );

    expect(result.unreachableShards).toEqual([
      { query: 'topic:claude-code stars:1..1', repositories: 18_243 },
      { query: 'topic:claude-code stars:0..0', repositories: 18_243 },
    ]);
    // The unreachable ones are NOT counted as complete. That distinction is the
    // whole requirement: a silently truncated shard is indistinguishable from a
    // walked one unless the code keeps them apart.
    expect(result.shardsCompleted).toBe(10);
    expect(result.stoppedBecause).toBe('exhausted');
  });

  it('measures what the star floor left out, because that is most of a topic', async () => {
    stubSearch((q) =>
      q.includes('stars:<') ? { total: 36_512, count: 0 } : { total: 1, count: 1 },
    );
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 20, spacingMs: 0, topics: TOPICS },
      collect().write,
    );

    expect(result.belowFloorShards).toEqual([
      { query: 'topic:claude-code stars:<10', repositories: 36_512 },
    ]);
    // Distinct from unreachableShards: one is a limit of the API, the other is a
    // scheduling choice this project made.
    expect(result.unreachableShards).toEqual([]);
  });

  it('does not probe below a floor of zero, because there is nothing below it', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    const result = await sweepTopics(
      { minStars: 0, maxRequests: 5, spacingMs: 0, topics: TOPICS },
      collect().write,
    );

    expect(result.belowFloorShards).toEqual([]);
    expect(queries.some((q) => q.includes('stars:<'))).toBe(false);
  });

  it('stops at the request cap and says so', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 4, spacingMs: 0, topics: TOPICS },
      collect().write,
    );

    expect(result.requestsSpent).toBe(4);
    expect(result.stoppedBecause).toBe('request_cap');
  });

  it('ends with counters rather than a throw when the search bucket is exhausted', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls > 2) {
          return new Response('{}', {
            status: 403,
            headers: {
              'retry-after': '60',
              'x-ratelimit-limit': '10',
              'x-ratelimit-remaining': '0',
            },
          });
        }
        return new Response(
          JSON.stringify({
            total_count: 1,
            items: [{ full_name: `o/${calls}`, stargazers_count: 1 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const sink = collect();
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 100, spacingMs: 0, topics: TOPICS },
      sink.write,
    );

    expect(result.stoppedBecause).toBe('rate_limited');
    // What it found before the limit is still written, not discarded. One seed,
    // not two: the first request is the below-floor probe, whose results are
    // deliberately dropped — seeding a hundred arbitrary sub-floor repositories
    // would undo the floor the probe exists to measure.
    expect(result.seedsUpserted).toBe(1);
  });

  it('records the exact query in each seed and tags provenance once', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    const sink = collect();
    await sweepTopics({ minStars: 10, maxRequests: 2, spacingMs: 0, topics: TOPICS }, sink.write);

    const rows = sink.written[0];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.discoveredFrom).toBe('github-topic-search');
      expect(row.sourceKind).toBe('github');
      expect(row.discoveredPath).toMatch(/^topic:claude-code stars:/);
      expect(row.hint).toMatchObject({ topic: 'claude-code' });
      expect(row.fullName).toBe(row.fullName.toLowerCase());
    }
  });

  it('writes each repository once even when two shards return it', async () => {
    // Same repository in every shard.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              total_count: 1,
              items: [{ full_name: 'Owner/Repo', stargazers_count: 9 }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const sink = collect();
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 5, spacingMs: 0, topics: TOPICS },
      sink.write,
    );

    expect(result.requestsSpent).toBe(5);
    expect(sink.written[0]).toHaveLength(1);
    expect(sink.written[0][0].fullName).toBe('owner/repo');
    expect(result.seedsUpserted).toBe(1);
  });

  it('re-running over the same stubbed responses produces the same seed set', async () => {
    stubSearch(() => ({ total: 2, count: 2 }));
    const first = collect();
    const second = collect();
    const options = { minStars: 10, maxRequests: 6, spacingMs: 0, topics: TOPICS };

    const a = await sweepTopics(options, first.write);
    const b = await sweepTopics(options, second.write);

    expect(a.seedsUpserted).toBe(b.seedsUpserted);
    expect(first.written[0].map((r) => r.fullName)).toEqual(
      second.written[0].map((r) => r.fullName),
    );
  });

  it('spends no request at all when the budget is zero', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 0, spacingMs: 0, topics: TOPICS },
      collect().write,
    );

    expect(result.requestsSpent).toBe(0);
    expect(hosts).toEqual([]);
    expect(result.stoppedBecause).toBe('request_cap');
  });
});
