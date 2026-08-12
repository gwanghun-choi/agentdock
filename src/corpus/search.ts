import { CORPUS_CAPS } from '@/corpus/caps';
import type { SeedRow } from '@/db/queries/seeds';
import { GitHubError } from '@/github/client';
import {
  belowFloorQuery,
  SEARCH_TOPICS,
  type StarRange,
  searchRepositories,
  shardLadder,
  shardQuery,
  subdivide,
  walkShard,
} from '@/github/search';

/**
 * A shard the 1,000-result cap put out of reach: GitHub reports more
 * repositories in it than the API will ever page through, and it cannot be
 * subdivided because it is a single star value.
 *
 * This list is the sweep's headline output, not a footnote. COR-05 asks that the
 * result cap "does not silently truncate coverage" — silence is the failure, and
 * incompleteness is a fact about the world that the sweep states with the number
 * attached.
 */
export type UnreachableShard = { query: string; repositories: number };

export type TopicSweepResult = {
  requestsSpent: number;
  /** Shards walked to completion, i.e. every repository in them was seen. */
  shardsCompleted: number;
  unreachableShards: UnreachableShard[];
  /**
   * What the star floor left out, per topic, measured rather than estimated.
   *
   * Kept apart from unreachableShards because the reason differs and conflating
   * them would blur both: an unreachable shard is one the 1,000-result cap will
   * not page through, while this is a region the sweep chose not to ask for. One
   * is a limit of the API, the other is a scheduling decision this project made
   * and is accountable for.
   */
  belowFloorShards: UnreachableShard[];
  seedsUpserted: number;
  /** The names written, so the caller can narrow its fan-out to them — the offer
   * is ordered by global arrival, and 8,865 earlier seeds sit ahead of these. */
  seedNames: string[];
  /** Distinct repositories the sweep named, before the seed cap. */
  reposFound: number;
  stoppedBecause: 'exhausted' | 'request_cap' | 'rate_limited' | 'seed_cap';
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walks every topic's star ladder from the high, sparse end downward,
 * subdividing any shard the result cap puts out of paging reach and naming the
 * ones that cannot be subdivided.
 *
 * Costs zero GitHub CORE requests. Search is a separate bucket (10 a minute
 * unauthenticated), which is why this is the one acquisition source that runs
 * while the core budget is at zero.
 *
 * `spacingMs` exists so tests can pass 0; production never does. `write` exists
 * so the pure tests need no database — omitted, it is upsertSeeds, imported
 * where it is used rather than at module scope so a test that only exercises the
 * walk does not have to have a DATABASE_URL.
 */
export async function sweepTopics(
  options: {
    minStars?: number;
    maxRequests?: number;
    spacingMs?: number;
    topics?: readonly { topic: string }[];
  } = {},
  write?: (rows: SeedRow[]) => Promise<number>,
): Promise<TopicSweepResult> {
  const minStars = options.minStars ?? CORPUS_CAPS.searchMinStars;
  const maxRequests = options.maxRequests ?? CORPUS_CAPS.maxSearchRequests;
  const spacingMs = options.spacingMs ?? CORPUS_CAPS.searchRequestSpacingMs;
  const topics = options.topics ?? SEARCH_TOPICS;

  /** First-seen wins, so a repository found in a sparser, higher-star shard
   * keeps that shard's query as its provenance rather than being relabelled. */
  const found = new Map<string, SeedRow>();
  const unreachableShards: UnreachableShard[] = [];
  const belowFloorShards: UnreachableShard[] = [];
  let requestsSpent = 0;
  let shardsCompleted = 0;
  let stoppedBecause: TopicSweepResult['stoppedBecause'] = 'exhausted';

  const pace = async () => {
    // Not before the first request: a sweep should not open with a six-second
    // pause it does not owe anyone.
    if (requestsSpent > 0 && spacingMs > 0) await sleep(spacingMs);
  };

  for (const { topic } of topics) {
    if (stoppedBecause !== 'exhausted') break;

    // One request, spent before the ladder rather than after it, so the number
    // survives a sweep that later runs out of budget. Without it a default sweep
    // prints a clean run and no incompleteness while leaving most of the topic
    // unseen — measured, 36,512 of topic:claude-code's 57,970 sit below a floor
    // of 10.
    if (minStars > 0 && requestsSpent < maxRequests) {
      const query = belowFloorQuery(topic, minStars);
      try {
        await pace();
        // The count only. The hundred repositories on that page are deliberately
        // discarded: seeding an arbitrary hundred sub-floor repositories would
        // undo the very floor this probe exists to measure the cost of.
        const probe = await searchRepositories(query, 1);
        requestsSpent += 1;
        belowFloorShards.push({ query, repositories: probe.totalCount });
      } catch (error) {
        if (error instanceof GitHubError && error.failure === 'rate_limited') {
          stoppedBecause = 'rate_limited';
          break;
        }
        throw error;
      }
    }

    // A stack. shardLadder is descending, so reversing it and popping from the
    // end walks high-star-first; a subdivision pushes its low half first for the
    // same reason.
    const pending: StarRange[] = [...shardLadder(minStars)].reverse();

    while (pending.length > 0) {
      if (requestsSpent >= maxRequests) {
        stoppedBecause = 'request_cap';
        break;
      }
      if (found.size >= CORPUS_CAPS.maxSeedsPerSource) {
        stoppedBecause = 'seed_cap';
        break;
      }

      const range = pending.pop() as StarRange;
      const query = shardQuery(topic, range);

      let shard: Awaited<ReturnType<typeof walkShard>>;
      try {
        shard = await walkShard(query, maxRequests - requestsSpent, pace);
      } catch (error) {
        // A rate-limited sweep ends with its counters, not with a stack trace.
        // Everything found before it is still written below.
        if (error instanceof GitHubError && error.failure === 'rate_limited') {
          stoppedBecause = 'rate_limited';
          break;
        }
        throw error;
      }
      requestsSpent += shard.requests;

      for (const item of shard.items) {
        if (found.has(item.fullName)) continue;
        found.set(item.fullName, {
          fullName: item.fullName,
          sourceKind: 'github',
          discoveredFrom: 'github-topic-search',
          // The exact query, so a maintainer can see which shard produced a seed.
          discoveredPath: query,
          hint: { topic, stars: item.stars },
        });
      }

      if (shard.budgetExhausted) {
        stoppedBecause = 'request_cap';
        break;
      }

      if (!shard.overCap) {
        shardsCompleted += 1;
        continue;
      }

      const halves = subdivide(range);
      if (halves === null) {
        // Indivisible and over the cap. Named with its measured size — never
        // paged to 1,000 and left, which in this output would be
        // indistinguishable from a shard that was walked to completion.
        unreachableShards.push({ query, repositories: shard.totalCount });
        continue;
      }
      // Low half first: pop() takes the last, so this keeps the walk descending.
      pending.push(halves[1], halves[0]);
    }
  }

  const rows = [...found.values()].slice(0, CORPUS_CAPS.maxSeedsPerSource);
  let seedsUpserted = 0;
  if (rows.length > 0) {
    const upsert = write ?? (await import('@/db/queries/seeds')).upsertSeeds;
    seedsUpserted = await upsert(rows);
  }

  return {
    requestsSpent,
    shardsCompleted,
    unreachableShards,
    belowFloorShards,
    seedsUpserted,
    seedNames: rows.map((r) => r.fullName),
    reposFound: found.size,
    stoppedBecause,
  };
}
