import { MIN_REPOSITORY_STARS } from './policy';

/**
 * The bounds every corpus acquisition source shares.
 *
 * One module because each source added in this phase contributes a number and
 * none of them should have to edit fanout.ts to do it. Every number carries the
 * arithmetic it came from and what it does NOT bound, the doctrine
 * src/github/scan.ts:11-29 already sets for CAPS.
 */
export const CORPUS_CAPS = {
  /**
   * Repositories one corpus:sync may enqueue. 25 x 2 core requests = 50 of the
   * unauthenticated 60 an hour (src/ingest/retry.ts's two-per-attempt note),
   * leaving 10 for the in-process worker's own retries and for a human
   * submitting a repository while the sync runs.
   *
   * Bounds one invocation. Does NOT bound total queue depth — MAX_QUEUED
   * (src/db/queries/jobs.ts:11) still does that, and a run that reaches it stops
   * and says so rather than confirming it once per remaining seed.
   */
  maxEnqueuePerSync: 25,
  /**
   * Seeds one source may write in one invocation. Bounds the write volume and
   * the memory a single sweep holds. Does NOT bound how many seeds exist —
   * re-running continues from where the source left off, and a run that reaches
   * this prints how many it left behind.
   */
  maxSeedsPerSource: 2000,
  /**
   * Bytes one curated Markdown list may occupy. Measured on 2026-08-11 against
   * the two lists config/seeds.json actually names: hesreallyhim/awesome-claude-code
   * is 138,758 bytes and punkpeye/awesome-mcp-servers is 1,339,093. The first
   * value tried here was 1 MB, chosen from the research's "tens of kilobytes"
   * description, and it silently cost the larger of the only two lists in the
   * file — so this is the measurement plus roughly 3x headroom, not an estimate.
   *
   * Enforced by the capped reader, so the stream is cancelled at the ceiling
   * rather than read whole and measured afterwards.
   *
   * Bounds the bytes scanned. Does NOT bound how many links are inside them —
   * maxLinksPerList does that.
   */
  maxLinkListBytes: 4 * 1024 * 1024,
  /**
   * Distinct repositories one list may contribute. This one BINDS on real
   * input, and deliberately: measured on 2026-08-11, punkpeye/awesome-mcp-servers
   * reached this ceiling and left 2,390 further link occurrences unextracted,
   * which the sync run prints. A single third-party document should not be able
   * to decide the shape of the index on its own, and 1,000 repositories from one
   * list is already forty hours of unauthenticated ingest budget.
   *
   * Bounds one list, and bounds the set one extraction pass holds in memory.
   * Does NOT bound total seeds — maxSeedsPerSource does — and neither bounds
   * what reaches the queue, which is maxEnqueuePerSync's job.
   */
  maxLinksPerList: 1000,
  /**
   * Search requests one topic sweep may spend. Six minutes of wall clock at the
   * unauthenticated 10-per-minute search rate, which is a separate bucket from
   * the 60-an-hour core budget every other source competes for — a sweep costs
   * zero core requests and can run while core is exhausted.
   *
   * Bounds one sweep's wall clock. Does NOT bound coverage, and nothing does:
   * see searchMinStars. A sweep that stops here says so and names the shards it
   * had not reached.
   */
  maxSearchRequests: 60,
  /**
   * The star value the ladder stops at — the registry's own discovery floor, not
   * a second number.
   *
   * It was 10 while the ingest path accepted anything a source named. Now that
   * `discoveryRejection` refuses a new repository below MIN_REPOSITORY_STARS,
   * a lower sweep floor would write seeds whose only outcome is two core
   * requests spent learning they are ineligible — the most expensive way there
   * is to discover a number the search API already returned. One constant, so
   * the sweep names what the gate accepts.
   *
   * See src/corpus/policy.ts for why a star floor is a scheduling decision
   * rather than a judgment, and measured 2026-08-11: topic:claude-code holds
   * 36,487 repositories at 0-1 stars, 63% of the topic, in two indivisible star
   * values each roughly eighteen times the 1,000-result paging cap. The floor's
   * job is to make the first few hundred the densest, not to make the set
   * finite — at this value the sweep still names more repositories than the
   * ingest budget can consume for months.
   */
  searchMinStars: MIN_REPOSITORY_STARS,
  /**
   * Already-stored repositories one scheduled sync may re-check for upstream
   * changes, oldest read first.
   *
   * 25 x 2 core requests, the same arithmetic as maxEnqueuePerSync above and
   * for the same reason — except that most of these cost nothing beyond those
   * two, because an unmoved commit sha short-circuits before a single file is
   * read (src/github/scan.ts). Two syncs a day therefore re-check up to 50
   * repositories daily against a 60-an-hour unauthenticated budget.
   *
   * Bounds one invocation. Does NOT bound the corpus: a corpus larger than
   * 2 x this per day is re-checked on a rotation rather than in full, which is
   * what ordering on scanned_at buys, and the sync prints how many were still
   * stale when it stopped.
   */
  maxRefreshPerSync: 25,
  /**
   * Milliseconds between search requests. 10 a minute is the unauthenticated
   * ceiling, so 6,500 ms is that rate with margin; a burst instead earns a 403
   * with a retry-after header, which githubFetch turns into a thrown
   * rate_limited error mid-sweep.
   */
  searchRequestSpacingMs: 6_500,
} as const;
