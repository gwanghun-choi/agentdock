import { GitHubError, githubFetch, normalizeRepo } from './client';

/**
 * The Search API, which is a different rate-limit bucket from everything else in
 * this directory: 10 requests a minute unauthenticated, against core's 60 an
 * hour. That is why a topic sweep can run while the core budget is at zero.
 *
 * HAZARD, recorded rather than engineered around. githubFetch records whatever
 * `x-ratelimit-*` headers came back into one module-level slot (client.ts:34),
 * and a search response carries the SEARCH bucket's numbers. The home page reads
 * that slot (rateLimitState()) beside copy describing the 60-an-hour core budget,
 * so a search response reaching it would make the page say "10 of 10 remaining"
 * about a budget that is not the one it is describing. It never happens today
 * because the only caller is scripts/corpus-sync.mjs, a separate Bun process
 * whose module state the Next server never sees.
 *
 * That is the reason this module must never be imported from src/app/ or
 * src/components/. Nothing mechanical enforces it — the import would typecheck,
 * lint and pass check:boundaries — so it is written here where a reader adding
 * the import will be.
 */

/** 100 per page x 10 pages. Asking for page 11 is an error, not more data. */
export const RESULT_CAP = 1000;
const PER_PAGE = 100;
const MAX_PAGES = RESULT_CAP / PER_PAGE;

/**
 * A half-open-at-the-top star range. `max: null` means "and above", which is the
 * only shard that can hold an unbounded number of repositories and also the one
 * that reliably holds the fewest.
 */
export type StarRange = { min: number; max: number | null };

export type SearchItem = { fullName: string; stars: number };

/**
 * The topics swept, each with the repository count measured on 2026-08-11 so a
 * reader can see how stale the sizing that chose the ladder and the floor is.
 *
 * These numbers are why the sweep reports what it could not reach: topic:claude-code
 * alone holds more repositories than eighty days of core budget could ingest, and
 * 63% of them sit at 0-1 stars — two indivisible star values, each roughly
 * eighteen times the 1,000-result cap. Full coverage is not expensive, it is
 * unreachable, and it would buy nothing if it were reachable.
 */
export const SEARCH_TOPICS: readonly { topic: string; measuredRepositories: number }[] = [
  { topic: 'claude-code', measuredRepositories: 57_970 },
  { topic: 'mcp-server', measuredRepositories: 23_281 },
  { topic: 'agent-skills', measuredRepositories: 14_524 },
  { topic: 'claude-skills', measuredRepositories: 6_712 },
  { topic: 'claude-plugin', measuredRepositories: 1_688 },
];

/**
 * Where the geometric rungs stop and the open-ended shard begins. Measured:
 * topic:claude-code holds 2,128 repositories at 100+ stars, so everything above
 * this threshold across all five topics fits in a handful of subdivisions.
 */
const LADDER_TOP = 1024;

/**
 * Above this, an open-ended shard stops being subdivided and is reported
 * unreachable instead.
 *
 * The most-starred repository on GitHub holds roughly 430,000 stars, so a shard
 * that begins above a million and still claims more than a thousand
 * repositories is not a dense shard — it is a response that cannot be true.
 * Without this the doubling has no fixed point and a sweep spends its entire
 * budget climbing.
 */
const STAR_CEILING = 1_000_000;

/**
 * A descending, disjoint, gapless cover of [minStars, infinity).
 *
 * Pure, and tested with no network, because this is the part of the sweep that
 * can be wrong in a way no live run would reveal: a ladder with a one-star gap
 * loses every repository at that value and nothing anywhere reports it.
 *
 * Doubling rather than a hand-written list of thresholds. Star counts are
 * distributed roughly log-normally — the measured topic:claude-code distribution
 * is 63% at 0-1 stars and 3.7% at 100+ — so equal-width buckets would put
 * everything in one shard and leave the rest empty. Each rung is [lo, 2lo-1] and
 * the next begins at exactly 2lo, which is what makes the cover gapless by
 * construction rather than by inspection.
 */
export function shardLadder(minStars: number): StarRange[] {
  if (!Number.isInteger(minStars) || minStars < 0) {
    throw new Error(`shardLadder: minStars must be a non-negative integer, got ${minStars}`);
  }
  const out: StarRange[] = [];
  // A floor of 0 cannot double. Start the geometric part at 1 and let [0,0] be
  // its own rung, which is also the honest shape: zero stars is a single
  // indivisible value holding tens of thousands of repositories.
  let lo = minStars;
  if (lo === 0) {
    out.push({ min: 0, max: 0 });
    lo = 1;
  }
  while (lo * 2 <= LADDER_TOP) {
    out.push({ min: lo, max: lo * 2 - 1 });
    lo *= 2;
  }
  out.push({ min: lo, max: null });
  // Descending: the sweep walks from the sparse, high-star end downward, so a
  // budget that runs out has spent itself on the repositories most likely to
  // hold artifacts rather than on the long tail.
  return out.reverse();
}

/**
 * Two halves of a range, or null when the range is a single star value and
 * therefore indivisible.
 *
 * Returning null rather than throwing is the whole point: an indivisible
 * over-cap shard is a fact about GitHub's corpus that the sweep reports, not an
 * error condition. Halves come back high-first, matching shardLadder's own
 * descending order, so both can be consumed the same way.
 */
export function subdivide(range: StarRange): [StarRange, StarRange] | null {
  if (range.max === null) {
    // An open-ended range has no top to run out of, so it would double upward
    // forever — and against a caller that keeps subdividing whatever comes back
    // over the cap, "forever" means the whole request budget spent walking into
    // empty sky. STAR_CEILING is where that stops.
    if (range.min >= STAR_CEILING) return null;
    return [
      { min: range.min * 2, max: null },
      { min: range.min, max: range.min * 2 - 1 },
    ];
  }
  if (range.min >= range.max) return null;
  const mid = Math.floor((range.min + range.max) / 2);
  return [
    { min: mid + 1, max: range.max },
    { min: range.min, max: mid },
  ];
}

/** The exact string sent as `q`, and the string recorded in a seed's provenance. */
export function shardQuery(topic: string, range: StarRange): string {
  const stars = range.max === null ? `stars:>=${range.min}` : `stars:${range.min}..${range.max}`;
  return `topic:${topic} ${stars}`;
}

/**
 * Everything the star floor left out of a topic, as one query.
 *
 * Measured 2026-08-11, this is not a rounding error: at the default floor of 10,
 * topic:claude-code's sub-floor region holds 36,512 repositories against the
 * ~2,600 the ladder above it walks. A sweep that reported only what it walked
 * would print a clean run and no incompleteness at all while leaving 93% of the
 * topic unseen — which is precisely the silence COR-05 exists to prevent. One
 * request per topic buys the number.
 */
export function belowFloorQuery(topic: string, minStars: number): string {
  return `topic:${topic} stars:<${minStars}`;
}

/**
 * One page of results.
 *
 * Calls githubFetch rather than fetch: the allowlist, the https-only check, the
 * per-hop redirect re-validation, the ten-second timeout and the rate-limit
 * branch are all already written and reviewed there, and a second fetch path to
 * the same host is a second place to get SSRF wrong.
 *
 * Every full_name goes through normalizeRepo before it leaves this function, so
 * a hostile repository name is two validated segments by the time anything
 * downstream builds a URL from it. A name that fails validation is dropped, not
 * repaired.
 */
export async function searchRepositories(
  query: string,
  page: number,
): Promise<{ totalCount: number; items: SearchItem[] }> {
  const params = new URLSearchParams({
    q: query,
    per_page: String(PER_PAGE),
    page: String(page),
  });
  const { response } = await githubFetch(`https://api.github.com/search/repositories?${params}`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    // Status only. A search response body echoes the query and can carry a
    // documentation URL, and neither belongs in a log line.
    throw new GitHubError('unavailable', `GitHub search returned ${response.status}.`);
  }

  const body = (await response.json()) as {
    total_count?: unknown;
    items?: unknown;
  };
  const totalCount = typeof body.total_count === 'number' ? body.total_count : 0;
  const raw = Array.isArray(body.items) ? body.items : [];

  const items: SearchItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { full_name?: unknown; stargazers_count?: unknown };
    if (typeof record.full_name !== 'string') continue;
    const parts = normalizeRepo(record.full_name);
    if (!parts) continue;
    items.push({
      fullName: `${parts.owner}/${parts.repo}`.toLowerCase(),
      stars: typeof record.stargazers_count === 'number' ? record.stargazers_count : 0,
    });
  }
  return { totalCount, items };
}

export type SearchShardResult = {
  /** The exact q sent, so a seed's provenance names the query that produced it. */
  query: string;
  /** GitHub's own count for the shard, whether or not it could be walked. */
  totalCount: number;
  items: SearchItem[];
  /**
   * The shard holds more than the API will ever page through. Subdivide it — do
   * NOT page it to the cap and move on, which is indistinguishable in the output
   * from a shard that was walked to completion.
   */
  overCap: boolean;
  requests: number;
  /** The caller's budget ran out mid-shard, so items is a prefix of the shard. */
  budgetExhausted: boolean;
};

/**
 * Walks one shard to completion, or reports why it could not.
 *
 * Stops at page ten, because 100 x 10 is the ceiling and page eleven is an
 * error rather than more data, and at the first short page, because a page
 * holding fewer than per_page results is the last one.
 *
 * An over-cap shard costs exactly one request: the count is on page one, and
 * paging the rest would spend nine more requests collecting a truncation.
 * The 100 results that first page already paid for are kept — they are real
 * repositories, and the subdivision that follows would otherwise re-fetch them.
 *
 * `pace` is awaited before every request. The sweep passes a sleep; tests pass
 * nothing.
 */
export async function walkShard(
  query: string,
  budget: number,
  pace: () => Promise<void> = async () => {},
): Promise<SearchShardResult> {
  const items: SearchItem[] = [];
  let requests = 0;
  let totalCount = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (requests >= budget) {
      return { query, totalCount, items, overCap: false, requests, budgetExhausted: true };
    }
    await pace();
    const result = await searchRepositories(query, page);
    requests += 1;
    totalCount = result.totalCount;

    if (page === 1 && totalCount > RESULT_CAP) {
      return {
        query,
        totalCount,
        items: result.items,
        overCap: true,
        requests,
        budgetExhausted: false,
      };
    }

    items.push(...result.items);
    if (result.items.length < PER_PAGE) break;
  }

  return { query, totalCount, items, overCap: false, requests, budgetExhausted: false };
}
