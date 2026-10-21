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

describe('sweepTopics — every topic gets a turn (R8)', () => {
  const FIVE = ['a', 'b', 'c', 'd', 'e'].map((topic) => ({ topic }));

  it('a topic that could take the whole budget takes only its share, and the rest still run', async () => {
    // Every shard claims more than the cap, so each one subdivides and any
    // single topic would consume all sixty requests on its own — the measured
    // shape of topic:claude-code. One item per page keeps the seed cap out of it.
    stubSearch(() => ({ total: 5000, count: 1 }));
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 60, spacingMs: 0, topics: FIVE },
      collect().write,
    );
    expect(result.requestsSpent).toBe(60);
    expect(result.topics.map((t) => t.topic)).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const t of result.topics) {
      expect(t.requests).toBe(12);
      expect(t.stoppedBecause).toBe('request_cap');
      expect(t.pending?.length).toBeGreaterThan(0);
    }
    // Every topic was queried, not just the first.
    for (const { topic } of FIVE) {
      expect(queries.some((q) => q.startsWith(`topic:${topic} stars:>=`))).toBe(true);
    }
  });

  it('what a small topic leaves unspent rolls on to the topics after it', async () => {
    stubSearch((q) =>
      q.startsWith('topic:a ') ? { total: 0, count: 0 } : { total: 5000, count: 1 },
    );
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 60, spacingMs: 0, topics: FIVE },
      collect().write,
    );
    const [a, ...rest] = result.topics;
    expect(a.stoppedBecause).toBe('exhausted');
    expect(a.pending).toBeNull();
    expect(a.requests).toBeLessThan(12);
    expect(rest.reduce((n, t) => n + t.requests, 0)).toBe(60 - a.requests);
  });

  it("one topic's failure is that topic's: the next topic is still swept", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        const q = new URL(String(input)).searchParams.get('q') ?? '';
        if (q.startsWith('topic:a ')) return new Response('{}', { status: 502 });
        return new Response(
          JSON.stringify({ total_count: 1, items: [{ full_name: 'o/r', stargazers_count: 50 }] }),
          { status: 200 },
        );
      }),
    );
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 40, spacingMs: 0, topics: [{ topic: 'a' }, { topic: 'b' }] },
      collect().write,
    );
    expect(result.topics[0].stoppedBecause).toBe('failed');
    expect(result.topics[0].pending?.length).toBeGreaterThan(0);
    expect(result.topics[1].stoppedBecause).toBe('exhausted');
    expect(result.seedNames).toEqual(['o/r']);
    expect(result.stoppedBecause).toBe('failed');
  });

  it('after the shared search bucket runs out, later topics are named not-reached and keep their resume point', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', {
            status: 403,
            headers: { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '0' },
          }),
      ),
    );
    const kept = [{ min: 10, max: 19 }];
    const result = await sweepTopics(
      {
        minStars: 10,
        maxRequests: 40,
        spacingMs: 0,
        topics: [{ topic: 'a' }, { topic: 'b' }],
        resume: { b: kept },
      },
      collect().write,
    );
    expect(result.topics.map((t) => t.stoppedBecause)).toEqual(['rate_limited', 'not_reached']);
    expect(result.topics[1].pending).toEqual(kept);
    expect(result.stoppedBecause).toBe('rate_limited');
  });

  it('a resumed topic continues from its stored shard instead of the top of the ladder', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    const result = await sweepTopics(
      {
        minStars: 10,
        maxRequests: 10,
        spacingMs: 0,
        topics: [{ topic: 'a' }],
        resume: { a: [{ min: 10, max: 19 }] },
      },
      collect().write,
    );
    // The below-floor probe, then exactly the resumed shard — no stars:>=1024.
    expect(queries).toEqual(['topic:a stars:<10', 'topic:a stars:10..19']);
    expect(result.topics[0].pending).toBeNull();
  });

  it('a stored stack below the current floor is discarded, never swept', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    await sweepTopics(
      {
        minStars: 10,
        maxRequests: 30,
        spacingMs: 0,
        topics: [{ topic: 'a' }],
        resume: { a: [{ min: 1, max: 9 }] },
      },
      collect().write,
    );
    expect(queries).not.toContain('topic:a stars:1..9');
    // The top of the ladder for a floor of 10 (shardLadder: 10, 20, ... 640+).
    expect(queries).toContain('topic:a stars:>=640');
  });

  it('a stored stack left by a higher floor is discarded, so the band between is not skipped', async () => {
    stubSearch(() => ({ total: 1, count: 1 }));
    await sweepTopics(
      {
        minStars: 10,
        maxRequests: 30,
        spacingMs: 0,
        topics: [{ topic: 'a' }],
        resume: { a: [{ min: 50, max: 99 }] },
      },
      collect().write,
    );
    expect(queries).not.toContain('topic:a stars:50..99');
    expect(queries).toContain('topic:a stars:>=640');
  });

  it('pages a failed shard already read are counted against the budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        const q = url.searchParams.get('q') ?? '';
        const page = Number(url.searchParams.get('page'));
        if (q === 'topic:a stars:>=640' && page === 3) return new Response('{}', { status: 502 });
        const count = q === 'topic:a stars:>=640' ? 250 : 0;
        const items = Array.from({ length: Math.max(0, Math.min(100, count - (page - 1) * 100)) });
        return Response.json({
          total_count: count,
          items: items.map((_, i) => ({ full_name: `o${page}-${i}/r`, stargazers_count: 700 })),
        });
      }),
    );
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 40, spacingMs: 0, topics: [{ topic: 'a' }, { topic: 'b' }] },
      collect().write,
    );
    // The below-floor probe and three pages, the third the one that failed.
    expect(result.topics[0]).toMatchObject({ stoppedBecause: 'failed', requests: 4 });
    expect(result.requestsSpent).toBe(4 + result.topics[1].requests);
  });

  describe('a shard that fails run after run', () => {
    /** 502 for the queries `failing` names, one repository for every other. */
    function stubFailing(failing: (q: string) => boolean, status = 502) {
      queries = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: URL | string) => {
          const q = new URL(String(input)).searchParams.get('q') ?? '';
          queries.push(q);
          if (failing(q)) {
            return new Response('{}', {
              status,
              headers:
                status === 403 ? { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '0' } : {},
            });
          }
          return Response.json({
            total_count: 1,
            items: [{ full_name: `o/${q.replace(/[^a-z0-9]/gi, '-')}`, stargazers_count: 50 }],
          });
        }),
      );
    }
    const STACK = [
      { min: 10, max: 19 },
      { min: 20, max: 39 },
    ];
    const run = (resume: unknown) =>
      sweepTopics(
        {
          minStars: 10,
          maxRequests: 20,
          spacingMs: 0,
          topics: [{ topic: 'a' }],
          resume: { a: resume },
        },
        collect().write,
      );

    it('counts consecutive failures of the shard on top and keeps it there', async () => {
      stubFailing((q) => q === 'topic:a stars:20..39');
      const first = await run(STACK);
      expect(first.topics[0]).toMatchObject({
        stoppedBecause: 'failed',
        failures: 1,
        dropped: null,
      });
      expect(first.topics[0].pending).toEqual(STACK);

      const second = await run({ stack: first.topics[0].pending, failures: 1 });
      expect(second.topics[0]).toMatchObject({ failures: 2, dropped: null });
      expect(second.topics[0].pending).toEqual(STACK);
    });

    it('drops it on the third failure in a row and names it, so the topic moves on', async () => {
      stubFailing((q) => q === 'topic:a stars:20..39');
      const third = await run({ stack: STACK, failures: 2 });
      expect(third.topics[0]).toMatchObject({
        stoppedBecause: 'failed',
        failures: 0,
        dropped: 'topic:a stars:20..39',
      });
      expect(third.topics[0].pending).toEqual([{ min: 10, max: 19 }]);

      // And the next run walks what is left instead of failing on it again.
      queries = [];
      const next = await run({ stack: third.topics[0].pending, failures: 0 });
      expect(next.topics[0].stoppedBecause).toBe('exhausted');
      expect(queries).not.toContain('topic:a stars:20..39');
    });

    it('starts the count over when a different shard fails after the top one completed', async () => {
      stubFailing((q) => q === 'topic:a stars:10..19');
      const result = await run({ stack: STACK, failures: 2 });
      expect(result.topics[0]).toMatchObject({ failures: 1, dropped: null });
      expect(result.topics[0].pending).toEqual([{ min: 10, max: 19 }]);
    });

    it('an exhausted bucket on that shard is not counted as its failure', async () => {
      stubFailing((q) => q === 'topic:a stars:20..39', 403);
      const result = await run({ stack: STACK, failures: 2 });
      expect(result.topics[0]).toMatchObject({ stoppedBecause: 'rate_limited', failures: 2 });
      expect(result.topics[0].pending).toEqual(STACK);
    });

    it('a failing below-floor probe is a missing number, not a failed topic', async () => {
      stubFailing((q) => q === 'topic:a stars:<10');
      const result = await run(STACK);
      expect(result.topics[0].stoppedBecause).toBe('exhausted');
      expect(result.unmeasuredFloors).toEqual(['topic:a stars:<10']);
      expect(result.belowFloorShards).toEqual([]);
    });
  });

  it('keeps every name the shard that crossed the seed cap returned', async () => {
    const full = ['topic:a stars:>=640', 'topic:a stars:320..639', 'topic:a stars:160..319'];
    stubSearch((q) => (full.includes(q) ? { total: 999, count: 999 } : { total: 0, count: 0 }));
    const result = await sweepTopics(
      { minStars: 10, maxRequests: 60, spacingMs: 0, topics: [{ topic: 'a' }] },
      collect().write,
    );
    // 1,998 after two shards, under the 2,000 cap, so the third ran; its shard is
    // off the stack, so a name cut here would not come back this pass.
    expect(result.topics[0].stoppedBecause).toBe('seed_cap');
    expect(result.seedNames).toHaveLength(2997);
    expect(result.topics[0].pending).not.toContainEqual({ min: 160, max: 319 });
  });
});
