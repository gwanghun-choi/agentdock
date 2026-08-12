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
   * The star value the ladder stops at.
   *
   * A SCHEDULING decision about work not yet done, not a judgment about an
   * artifact — the distinction matters because 05-CONTEXT D-03 refuses stars as
   * a listing input, and these two decisions read as a contradiction otherwise.
   * D-03 refuses to exclude an artifact AgentDock has ALREADY READ from its
   * listings on a popularity signal. This floor decides which repositories to
   * spend a scarce fetch budget on FIRST, among repositories nobody has looked
   * at yet — the same kind of decision the operator seed list makes by ordering
   * on artifact density and the registry sweep makes by ordering on recency.
   * Nothing is excluded by it: a zero-star repository remains submittable by
   * hand, ingestible, and listable.
   *
   * The value is not a quality threshold either. Measured 2026-08-11,
   * topic:claude-code holds 36,487 repositories at 0-1 stars — 63% of the topic,
   * two indivisible star values each roughly eighteen times the 1,000-result cap,
   * so that region is unreachable by sharding at any depth. At this floor the
   * sweep still names more repositories than the ingest budget can consume for
   * months. The floor's job is to make the first few hundred the densest, not to
   * make the set finite.
   */
  searchMinStars: 10,
  /**
   * Milliseconds between search requests. 10 a minute is the unauthenticated
   * ceiling, so 6,500 ms is that rate with margin; a burst instead earns a 403
   * with a retry-after header, which githubFetch turns into a thrown
   * rate_limited error mid-sweep.
   */
  searchRequestSpacingMs: 6_500,
} as const;
