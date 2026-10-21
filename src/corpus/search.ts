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
  /** Below-floor probes that failed, so that topic's floor cost is unknown this
   * run. The probe is a measurement: its failure no longer stops the topic. */
  unmeasuredFloors: string[];
  seedsUpserted: number;
  /** The names written, so the caller can narrow its fan-out to them — the offer
   * is ordered by global arrival, and 8,865 earlier seeds sit ahead of these. */
  seedNames: string[];
  /** Distinct repositories the sweep named, before the seed cap. */
  reposFound: number;
  /** The first reason any topic stopped short, in the order rate_limited,
   * request_cap, seed_cap, failed; `exhausted` only when every topic finished. */
  stoppedBecause: TopicStop;
  /** One line per topic, so a topic that got nothing is named, not averaged away. */
  topics: TopicOutcome[];
};

type TopicStop = 'exhausted' | 'request_cap' | 'rate_limited' | 'seed_cap' | 'failed';

export type TopicOutcome = {
  topic: string;
  requests: number;
  /** Distinct repositories this topic named that no earlier topic had. */
  found: number;
  stoppedBecause: TopicStop | 'not_reached';
  /**
   * The shards still to walk, highest-star last (a stack), or null once the
   * topic was walked to the floor. The caller stores this and hands it back as
   * `resume`, so the next run continues the same pass instead of re-walking the
   * top of the ladder: measured 2026-08-11, topic:claude-code holds 2,128
   * repositories at 100+ stars alone, about 22 pages, and a sweep restarted
   * from the top every run never got below them.
   */
  pending: StarRange[] | null;
  /**
   * Consecutive runs in which this topic failed on the shard now at the top of
   * `pending`. Stored with the stack and handed back, so the third failure in
   * a row (CORPUS_CAPS.maxShardFailures) drops that shard instead of parking
   * the topic behind it for good. Zero unless this run failed.
   */
  failures: number;
  /** The shard query dropped this run after maxShardFailures, or null. */
  dropped: string | null;
};

/**
 * A resume stack is read back from schema_meta, so it is checked rather than
 * trusted: a range below the floor would sweep what the floor excludes (the
 * floor can change between runs via --search-min-stars), and a malformed one
 * would build a query GitHub rejects. Anything off discards the whole stack,
 * which costs a re-walk from the top — over-fetching, never skipping.
 *
 * A stack also has to end exactly at this floor. The walk is descending, so
 * the shard holding the floor is popped last and is on every unfinished stack;
 * a stack left by a `--search-min-stars=50` run passed the check above at the
 * default floor of 10 and skipped 10–49 for the rest of the pass, and the
 * below-floor probe counts only below 10, so nothing printed the gap.
 */
/**
 * A stored topic entry: the stack, plus how many runs in a row the shard on
 * top of it has failed. Written as a bare array before failures were counted;
 * that shape still reads, with no failures carried.
 */
function readResume(
  entry: unknown,
  minStars: number,
): { stack: StarRange[] | null; failures: number } {
  if (Array.isArray(entry)) return { stack: validResume(entry, minStars), failures: 0 };
  if (typeof entry !== 'object' || entry === null) return { stack: null, failures: 0 };
  const { stack: raw, failures } = entry as { stack?: unknown; failures?: unknown };
  const stack = validResume(raw, minStars);
  return {
    stack,
    failures:
      stack && Number.isInteger(failures) && (failures as number) > 0 ? (failures as number) : 0,
  };
}

function validResume(stack: unknown, minStars: number): StarRange[] | null {
  if (!Array.isArray(stack) || stack.length === 0) return null;
  for (const r of stack as Partial<StarRange>[]) {
    if (typeof r !== 'object' || r === null) return null;
    if (!Number.isInteger(r.min) || (r.min as number) < minStars) return null;
    if (r.max !== null && (!Number.isInteger(r.max) || (r.max as number) < (r.min as number))) {
      return null;
    }
  }
  if (!(stack as StarRange[]).some((r) => r.min === minStars)) return null;
  return stack as StarRange[];
}

const STOP_PRIORITY: TopicStop[] = ['rate_limited', 'request_cap', 'seed_cap', 'failed'];

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
    /** Per-topic entries a previous run left: { stack: TopicOutcome.pending,
     * failures: TopicOutcome.failures }, or a bare stack from before. */
    resume?: Record<string, unknown>;
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
  const unmeasuredFloors: string[] = [];
  const outcomes: TopicOutcome[] = [];
  let requestsSpent = 0;
  let shardsCompleted = 0;
  let rateLimited = false;

  const pace = async () => {
    // Not before the first request: a sweep should not open with a six-second
    // pause it does not owe anyone.
    if (requestsSpent > 0 && spacingMs > 0) await sleep(spacingMs);
  };

  for (const [index, { topic }] of topics.entries()) {
    const { stack: resumed, failures: carriedFailures } = readResume(
      options.resume?.[topic],
      minStars,
    );
    if (rateLimited) {
      // One bucket for every topic: once it is empty, asking again for the
      // next topic only spends a request to learn the same thing.
      outcomes.push({
        topic,
        requests: 0,
        found: 0,
        stoppedBecause: 'not_reached',
        pending: resumed,
        failures: carriedFailures,
        dropped: null,
      });
      continue;
    }

    // Each topic's share is what is left divided by the topics left, so the
    // first topic can no longer spend the whole sweep — before this, the
    // 2,000-seed cap and the 60-request cap were both global, and
    // topic:claude-code alone exhausted them, leaving the other four topics
    // unswept on every run. Whatever a small topic leaves unspent rolls on to
    // the ones after it.
    const topicsLeft = topics.length - index;
    const requestShare = Math.ceil((maxRequests - requestsSpent) / topicsLeft);
    const seedShare = Math.ceil((CORPUS_CAPS.maxSeedsPerSource - found.size) / topicsLeft);
    const requestEnd = requestsSpent + requestShare;
    const seedEnd = found.size + seedShare;
    const topicStartRequests = requestsSpent;
    const topicStartFound = found.size;
    let stop: TopicStop = 'exhausted';
    // Carried failures belong to the shard on top of the resumed stack. They
    // survive until a shard completes (then 0) and grow when one fails — and
    // since the stack is a stack, a failure before any success is that same
    // shard failing again.
    let failures = carriedFailures;
    let dropped: string | null = null;

    // A stack. shardLadder is descending, so reversing it and popping from the
    // end walks high-star-first; a subdivision pushes its low half first for the
    // same reason. A resumed stack is already in that shape.
    const pending: StarRange[] = resumed ? [...resumed] : [...shardLadder(minStars)].reverse();

    try {
      // One request, spent before the ladder rather than after it, so the
      // number survives a sweep that later runs out of budget. Without it a
      // default sweep prints a clean run and no incompleteness while leaving
      // most of the topic unseen — measured, 36,512 of topic:claude-code's
      // 57,970 sit below a floor of 10.
      if (minStars > 0 && requestsSpent < requestEnd) {
        const query = belowFloorQuery(topic, minStars);
        await pace();
        // Counted before the answer: a request that fails was still spent.
        requestsSpent += 1;
        // The count only. The hundred repositories on that page are deliberately
        // discarded: seeding an arbitrary hundred sub-floor repositories would
        // undo the very floor this probe exists to measure the cost of.
        try {
          const probe = await searchRepositories(query, 1);
          belowFloorShards.push({ query, repositories: probe.totalCount });
        } catch (error) {
          // A measurement, not acquisition: a probe that fails every run used
          // to fail its topic every run before a single shard was walked.
          if (!(error instanceof GitHubError) || error.failure === 'rate_limited') throw error;
          unmeasuredFloors.push(query);
        }
      }

      while (pending.length > 0) {
        if (requestsSpent >= requestEnd) {
          stop = 'request_cap';
          break;
        }
        if (found.size >= seedEnd) {
          stop = 'seed_cap';
          break;
        }

        const range = pending.pop() as StarRange;
        const query = shardQuery(topic, range);

        let shard: Awaited<ReturnType<typeof walkShard>>;
        let attempted = 0;
        try {
          shard = await walkShard(query, requestEnd - requestsSpent, async () => {
            attempted += 1;
            await pace();
          });
        } catch (error) {
          // The pages before the failing one were spent too. Uncounted, the
          // topics after a failed one were handed shares of budget already gone.
          requestsSpent += attempted;
          // An empty bucket says nothing about the shard, so it is not counted.
          if (!(error instanceof GitHubError && error.failure === 'rate_limited')) failures += 1;
          if (failures >= CORPUS_CAPS.maxShardFailures) {
            // Dropped and named, never silently: the next full pass of this
            // topic asks for it again, and a transient failure gets its
            // chance then.
            dropped = query;
            failures = 0;
          } else {
            // Back on the stack, so the next run starts from this shard rather
            // than from the top of the ladder.
            pending.push(range);
          }
          throw error;
        }
        failures = 0;
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
          // Part-walked: the whole shard goes back, because walkShard has no
          // page cursor. Re-reading its first pages next run costs a few
          // requests; skipping its tail would cost repositories silently.
          pending.push(range);
          stop = 'request_cap';
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
    } catch (error) {
      // A rate-limited sweep ends with its counters, not with a stack trace.
      // Everything found before it is still written below.
      if (error instanceof GitHubError && error.failure === 'rate_limited') {
        stop = 'rate_limited';
        rateLimited = true;
      } else if (error instanceof GitHubError) {
        // One topic's failure is that topic's: the others are separate
        // queries, and a 5xx on one used to throw out of the whole sync.
        stop = 'failed';
      } else {
        throw error;
      }
    }

    outcomes.push({
      topic,
      requests: requestsSpent - topicStartRequests,
      found: found.size - topicStartFound,
      stoppedBecause: stop,
      pending: stop === 'exhausted' || pending.length === 0 ? null : pending,
      failures: stop === 'exhausted' || pending.length === 0 ? 0 : failures,
      dropped,
    });
  }

  // Not sliced to maxSeedsPerSource: the seed cap is checked between shards, so
  // the last shard can carry found.size past it by up to one shard (≤ 1,000),
  // and that shard is already off the resume stack. A slice here dropped those
  // names until the topic's next full pass, printing nothing.
  const rows = [...found.values()];
  let seedsUpserted = 0;
  if (rows.length > 0) {
    const upsert = write ?? (await import('@/db/queries/seeds')).upsertSeeds;
    seedsUpserted = await upsert(rows);
  }

  const stops = new Set(outcomes.map((o) => o.stoppedBecause));
  return {
    requestsSpent,
    shardsCompleted,
    unreachableShards,
    belowFloorShards,
    unmeasuredFloors,
    seedsUpserted,
    seedNames: rows.map((r) => r.fullName),
    reposFound: found.size,
    stoppedBecause: STOP_PRIORITY.find((s) => stops.has(s)) ?? 'exhausted',
    topics: outcomes,
  };
}
