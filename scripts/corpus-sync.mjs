#!/usr/bin/env node
// scripts/corpus-sync.mjs
//
// Discovers repositories, decides which of them are worth reading, reads the
// ones that changed, and prints what it did. This is AgentDock's whole
// ingestion schedule; the web server starts none of it.
//
// Two entry points, one script:
//
//   bun run sync                 the scheduled job — every source, refresh the
//                                corpus, drain the queue, print the summary.
//                                This is what cron runs, twice a day.
//   bun run corpus:sync --...    the same machinery with the caps and sources
//                                exposed, for filling an empty index by hand.
//
// Every cap prints what it dropped. A run that stops at a page cap prints the
// cursor to resume from, a fan-out that stops on a full queue says so, and every
// run ends with how many seeds still hold no job — a cap that prints nothing
// reads as "we covered everything".
//
// The GitHub cost is entirely in --drain and --refresh: two core requests per
// repository out of sixty an hour unauthenticated. Discovery itself spends none
// (the registry and the curated lists are not GitHub, and topic search is a
// separate rate-limit bucket). The drain stops on its own when fewer than two
// core requests remain, rather than spending one per queued job to rediscover
// that the budget is gone.
//
// A sweep resumes itself: where it stopped is stored, so running this again
// continues the same pass rather than restarting it. There is no --cursor flag,
// because a resume point an operator can type is a resume point an operator can
// get wrong.
//
// Usage:
//   bun run corpus:sync --source=registry|seeds|links|search|all [--enqueue=<n> | --no-enqueue]
//                       [--drain=<n>] [--refresh=<n> | --no-refresh] [--stale-hours=<n>]
//                       [--search-requests=<n>] [--search-min-stars=<n>]

const args = process.argv.slice(2);

/** Hand-parsed off process.argv, validated inline. No CLI library, ever. */
function flag(name) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1);
}

function count(name, fallback) {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`corpus-sync: --${name} must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

const { CORPUS_CAPS } = await import('../src/corpus/caps.ts');
const { syncBudget, drainStop, syncStatus } = await import('../src/corpus/budget.ts');
const { normalizeGithubToken } = await import('../src/env.ts');

// Picked once, from whether a token is set: unauthenticated it is exactly the
// 25/25/25 this script always ran with; authenticated, the caps follow the
// 5,000-an-hour core budget (src/corpus/caps.ts, `authenticated`). Every flag
// below still overrides it.
const budget = syncBudget(normalizeGithubToken(process.env.GITHUB_TOKEN));

/**
 * `bun run sync` — the whole schedule, in one flag.
 *
 * A flag rather than a second package.json script spelling out
 * `--source=all --drain=25 --refresh=25`, because those two numbers are
 * CORPUS_CAPS values and a package.json copy of them is a copy that drifts.
 * Every default it changes is still overridable, so the scheduled job and the
 * by-hand invocation are one code path with one set of caps.
 */
const scheduled = flag('scheduled') !== undefined;

const SOURCES = new Set(['registry', 'seeds', 'links', 'search', 'all']);
const source = flag('source') ?? (scheduled ? 'all' : 'registry');
if (!SOURCES.has(source)) {
  throw new Error(
    `corpus-sync: --source must be one of ${[...SOURCES].join('|')}, got "${source}"`,
  );
}

const noEnqueue = flag('no-enqueue') !== undefined;
const enqueueLimit = count('enqueue', scheduled ? budget.enqueue : CORPUS_CAPS.maxEnqueuePerSync);
const drainLimit = count('drain', scheduled ? budget.drain : 0);

// Re-checking already-stored repositories is opt-in for the same reason
// draining is: both spend the core budget, and an operator filling an empty
// index by hand wants every request going to repositories nobody has read yet.
const noRefresh = flag('no-refresh') !== undefined;
const refreshLimit = count('refresh', scheduled ? budget.refresh : 0);
// Twelve hours, matching the 03:00/15:00 schedule: a repository read by the
// morning run is not re-read by the afternoon one. Below this, two syncs a day
// would spend the whole budget re-reading the same repositories.
const staleHours = count('stale-hours', 12);

const searchRequests = count('search-requests', budget.searchRequests);
const searchMinStars = count('search-min-stars', CORPUS_CAPS.searchMinStars);

const { syncRegistry } = await import('../src/registry/sync.ts');
const { sweepTopics } = await import('../src/corpus/search.ts');
const { fanOutSeeds } = await import('../src/corpus/fanout.ts');
const { refreshStaleRepositories } = await import('../src/corpus/refresh.ts');
const { MIN_REPOSITORY_STARS } = await import('../src/corpus/policy.ts');
const { loadSeedList, seedListRows } = await import('../src/corpus/seedList.ts');
const { expandLinkLists } = await import('../src/corpus/links.ts');
const { upsertSeeds } = await import('../src/db/queries/seeds.ts');
const { fanOutBySource } = await import('../src/corpus/fanout.ts');
const { readSweepState, writeSweepState, recordSyncSucceeded, recordSyncAttempt, lastSyncAttempt } =
  await import('../src/db/queries/syncState.ts');
const { countPackages } = await import('../src/db/queries/packages.ts');
const { reapAbandoned, queueDepth } = await import('../src/db/queries/jobs.ts');
const { drainQueue, REAP_AFTER_MS } = await import('../src/ingest/worker.ts');
const { rateLimitState, fetchCoreRateLimit } = await import('../src/github/client.ts');
const { sql } = await import('../src/db/client.ts');

const startedAt = Date.now();
let failed = false;

/**
 * GitHub Actions reads `::notice::` / `::warning::` lines off stdout and pins
 * them to the run's summary page — no workflow edit, and no file written (a
 * $GITHUB_STEP_SUMMARY append would be this process's first disk write, which
 * AGENTS.md keeps at zero). Printed only on a runner; a cron mail gets the
 * plain lines below.
 */
const onActions = process.env.GITHUB_ACTIONS === 'true';
/**
 * Workflow-command escaping (actions/toolkit's escapeData / escapeProperty).
 * An error message carrying a newline would otherwise end the annotation and
 * start a line the runner parses as a command of its own.
 */
const escapeData = (v) =>
  String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (v) => escapeData(v).replace(/:/g, '%3A').replace(/,/g, '%2C');
function annotate(level, title, message) {
  if (onActions) console.log(`::${level} title=${escapeProperty(title)}::${escapeData(message)}`);
}

/** Stages that threw. Each is isolated, so the rest of the run still happens;
 * the process still exits 1 at the end, so a broken source is never green. */
const stageFailures = [];
/** Wall clock per stage, for the summary: Sync #8's 38 minutes had no breakdown. */
const stageMs = new Map();

/**
 * One acquisition stage, isolated. Before this a single try/catch wrapped the
 * whole run, so a registry outage or one unreadable list stopped the seed
 * list, the topic sweep, the refresh and the drain with it.
 */
async function stage(name, run) {
  const t0 = Date.now();
  try {
    await run();
  } catch (error) {
    // The message only. A cause can carry request headers or statement text.
    const message = (error instanceof Error ? error.message : 'failed').replace(/\.$/, '');
    stageFailures.push(name);
    console.error(`corpus-sync: stage=${name} FAILED — ${message}. The other stages still ran.`);
    annotate('error', `AgentDock sync: ${name} failed`, message);
  } finally {
    stageMs.set(name, Date.now() - t0);
  }
}

/** What each discovery source wrote this run, for the summary and the fan-out. */
const discovered = new Map();
/** Fan-out per source, for the summary. */
let fanOut = [];
/** Core bucket from /rate_limit around the drain; null when not measured. */
let coreBefore = null;
let coreAfter = null;
let drainStoppedBy = null;
let drainedCount = 0;
let refreshedCount = 0;
/** Stored repositories whose last check read nothing; null when refresh did not run. */
let failingChecks = null;
/** Jobs left queued after the drain; null when the drain did not run. */
let backlog = null;
/** Of those, the ones claimable now (not a retry or deferral waiting); null likewise. */
let due = null;
/** Per-job wall clock of this run's drain, in claim order. */
const jobMs = [];
/** The previous scheduled run's `queued`, for the backlog trend; null if unknown. */
let previousQueued = null;
/** Failures put back in the queue for another attempt this run (not rate limits). */
let retriesScheduled = 0;
/** Artifacts the reads this run delisted. */
let delisted = 0;

/**
 * What each job this run drained actually ended as, keyed by the same outcome
 * strings ingest_attempt stores.
 *
 * Counted from runJob's return value rather than queried back out of
 * ingest_attempt afterwards. A query would have to bound itself by time to mean
 * "this run", and two syncs overlapping — which cron makes possible the moment
 * one takes longer than the gap — would then each report the other's work.
 */
const outcomes = new Map();

/** Zero is a fact; an absent key is not. Every known outcome prints. */
function outcomeCount(name) {
  return outcomes.get(name) ?? 0;
}

function currentStatus() {
  return syncStatus({ failed: failed || stageFailures.length > 0, drainStoppedBy, due });
}

/**
 * The block a cron mail is read for.
 *
 * Every number here is counted, never estimated, and every one that could be
 * mistaken for coverage carries what it does not cover. The discovery counts
 * above this are per-source and already printed; this is what the run did to
 * the corpus.
 *
 * The three gate counts are the point of it. `below-star-floor`, `archived` and
 * `forked` are repositories a source named, whose metadata AgentDock fetched,
 * and which the policy then declined — so they are the visible cost of the
 * policy, not a silence.
 */
function summarize() {
  const rate = rateLimitState();
  const drained = [...outcomes.values()].reduce((n, v) => n + v, 0);
  const gated =
    outcomeCount('below_star_floor') + outcomeCount('archived') + outcomeCount('forked');

  // Everything else is arithmetic on the counted outcomes, so this cannot be a
  // literal that drifts: it is whatever the outcomes hold that the named lines
  // above did not claim.
  const otherFailures =
    drained -
    outcomeCount('ok') -
    outcomeCount('unchanged') -
    outcomeCount('no_artifacts') -
    gated -
    outcomeCount('unreadable') -
    outcomeCount('rate_limited');

  // One padded-label helper rather than hand-counted spaces per line. The star
  // floor is interpolated into a label, so hand alignment breaks the moment the
  // constant gains or loses a digit — which is exactly the kind of thing nobody
  // notices in a cron mail.
  const line = (label, value) => console.log(`  ${label.padEnd(30)}${value}`);

  console.log('');
  console.log('AgentDock scheduled sync');
  console.log('');
  line('Status', currentStatus());
  console.log('');
  // "Processed", not "read". A repository the policy declined had its metadata
  // fetched and nothing else, and a line calling that "read" would overstate
  // both what AgentDock looked at and what it spent.
  line('Repositories processed', drained);
  line('  ingested (new or changed)', outcomeCount('ok'));
  line('  unchanged, no files read', outcomeCount('unchanged'));
  line('  no artifacts found', outcomeCount('no_artifacts'));
  console.log('');
  line('Declined by discovery policy', gated);
  line(`  below ${MIN_REPOSITORY_STARS} stars`, outcomeCount('below_star_floor'));
  line('  archived on GitHub', outcomeCount('archived'));
  line('  a fork', outcomeCount('forked'));
  console.log('');
  line('Could not be read', outcomeCount('unreadable'));
  line('Rate limited, deferred', outcomeCount('rate_limited'));
  line('Other failures', otherFailures);
  line('  of which retry next run', retriesScheduled);
  line('Artifacts delisted', delisted);
  // Corpus-wide, not this run: stored repositories whose last check read
  // nothing. Their artifacts stay listed; a number that keeps growing is the
  // signal (src/corpus/refresh.ts).
  line(
    'Stored repos failing checks',
    failingChecks === null ? 'not measured (no refresh)' : `${failingChecks} (before this drain)`,
  );
  line(
    'Jobs still queued',
    backlog === null
      ? 'not measured (no drain)'
      : `${backlog} (${due} due now, ${backlog - due} waiting on a retry time)`,
  );
  line(
    '  since the previous run',
    backlog === null || previousQueued === null
      ? 'not known'
      : `${backlog - previousQueued >= 0 ? '+' : ''}${backlog - previousQueued} (was ${previousQueued})`,
  );
  line(
    'Drain stopped by',
    drainStoppedBy ?? (drainedCount > 0 ? 'its cap or an empty queue' : 'n/a'),
  );
  console.log('');
  line(
    'GitHub core requests left',
    rate ? `${rate.remaining} of ${rate.limit}` : 'no call made this run',
  );
  // Measured from /rate_limit before and after the drain, never estimated. A
  // window that reset mid-run makes the difference meaningless, so it says so.
  line(
    'GitHub core requests spent',
    coreBefore && coreAfter
      ? coreBefore.reset === coreAfter.reset
        ? coreBefore.remaining - coreAfter.remaining
        : 'not measurable (the hourly window reset during the run)'
      : 'not measured',
  );
  line('Budget', budget.authenticated ? 'authenticated (token set)' : 'unauthenticated');
  line('Duration', `${Math.round((Date.now() - startedAt) / 1000)}s`);
  // Measured per job by drainQueue, never estimated. Per-stage seconds say
  // where a run's time went before anyone has to read the log line by line.
  for (const [name, ms] of stageMs) line(`  stage ${name}`, `${Math.round(ms / 1000)}s`);
  if (jobMs.length > 0) {
    const sorted = [...jobMs].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const drainS = jobMs.reduce((n, v) => n + v, 0) / 1000;
    line(
      'Drain throughput',
      `${(jobMs.length / (drainS / 60)).toFixed(1)} jobs/min over ${drainS.toFixed(1)}s of jobs`,
    );
    line(
      '  per job',
      `p50 ${(at(0.5) / 1000).toFixed(1)}s, p95 ${(at(0.95) / 1000).toFixed(1)}s, max ${(sorted.at(-1) / 1000).toFixed(1)}s`,
    );
  }
  console.log('');
  line('Discovered this run', '');
  for (const [name, written] of discovered) line(`  ${name}`, `${written} seed(s) written`);
  for (const name of stageFailures) line(`  ${name}`, 'FAILED, see above');
  line('Enqueued this run', fanOut.reduce((n, r) => n + r.enqueued, 0) + refreshedCount);
  for (const r of fanOut) line(`  new from ${r.source}`, r.enqueued);
  line('  re-checks of stored repos', refreshedCount);
  console.log('');
}

/**
 * The repository names the sources in THIS run wrote, so the fan-out below can
 * be narrowed to them.
 *
 * Not a discovered_from filter: provenance is single-valued and last-writer-wins,
 * so a repository two sources both name carries only the later one — measured on
 * 2026-08-11, expanding the curated link lists re-tagged 253 registry seeds and 4
 * of the 15 operator seeds. A source knows the names it just produced; it cannot
 * rely on the column still agreeing. Read only by a single-source run;
 * --source=all fans out per source instead (fanOutBySource, below).
 */
let scope = null;

/** The names each source wrote this run, for the scheduled run's per-source fan-out. */
const sourceNames = new Map();

/** @param {string[]} names */
function widenScope(names) {
  scope = [...new Set([...(scope ?? []), ...names])];
}

async function runRegistry() {
  const sync = await syncRegistry();
  discovered.set('registry', sync.seedsUpserted);
  console.log(
    `corpus-sync: source=registry pages=${sync.pagesRead} sanitized=${sync.pagesSanitized} ` +
      `rows=${sync.rowsSeen} invalid=${sync.rowsInvalid} no-github-repo=${sync.rowsNoGithubRepo} ` +
      `seeds=${sync.seedsUpserted} stopped=${sync.stoppedBecause} ` +
      `updated-since=${sync.updatedSinceUsed ?? 'none'} ` +
      `resumed-from=${sync.resumedFromCursor ?? 'the start'}`,
  );

  // In words, not just a status token. The registry is ordered by server name
  // and updated_since filters the whole name space, so a run that stopped part
  // way through the names has NOT synced the registry — and a line that reads
  // like it did is how the next run ends up filtering past everything this one
  // never reached.
  if (sync.stoppedBecause === 'exhausted') {
    console.log(
      `corpus-sync: reached the end of the registry's server names. This pass began at ` +
        `${sync.passStartedAt}; every name has now been seen at least once as of then, so the ` +
        `next run filters on updated_since=${sync.watermarkAdvancedTo}.`,
    );
  } else {
    const why = {
      page_cap: `it hit its page cap after ${sync.pagesRead} page(s)`,
      seed_cap: `it hit its seed cap after writing ${sync.seedsUpserted} seed(s)`,
      parse_failure: 'a page could not be parsed even after the control-byte retry',
    }[sync.stoppedBecause];
    console.log(
      `corpus-sync: INCOMPLETE — ${why}. Server names after ` +
        `"${sync.stoppedAtCursor}" were not reached, and how many of them there are is not ` +
        `known from this run. The resume point is stored; run this again to continue the same ` +
        `pass. The updated_since watermark was NOT advanced (still ` +
        `${sync.updatedSinceUsed ?? 'unset'}) — advancing it on a partial pass would hide every ` +
        'unreached name whose last update predates it, permanently.',
    );
  }
  if (sync.stoppedBecause === 'parse_failure') failed = true;
}

async function runSeedList() {
  // No network at all: the operator file is committed, so this source spends
  // neither GitHub quota nor registry bandwidth. Only the fan-out below and
  // --drain reach GitHub.
  const file = loadSeedList();
  const rows = seedListRows(file);
  const kept = rows.slice(0, CORPUS_CAPS.maxSeedsPerSource);
  const upserted = await upsertSeeds(kept);
  widenScope(kept.map((r) => r.fullName));
  sourceNames.set(
    'seeds',
    kept.map((r) => r.fullName),
  );
  discovered.set('seeds', upserted);
  console.log(
    `corpus-sync: source=seeds in-file=${rows.length} written=${upserted} ` +
      `dropped-by-cap=${rows.length - kept.length} (cap ${CORPUS_CAPS.maxSeedsPerSource}) ` +
      `order=file (measured artifact density)`,
  );
  if (rows.length > kept.length) {
    console.log(
      `corpus-sync: INCOMPLETE — the seed file names ${rows.length} repositories and ` +
        `maxSeedsPerSource stopped at ${kept.length}. The entries after "${kept.at(-1)?.fullName}" ` +
        'were not written, and raising the cap is the only way to reach them.',
    );
  }
}

async function runLinkLists() {
  // Zero GitHub core requests: every list is read from the raw host, which
  // consumes no quota, and nothing extracted from a list is ever fetched — an
  // extracted address becomes an owner/repo and travels the ordinary ingest
  // path from there.
  const file = loadSeedList();
  const expansion = await expandLinkLists(file.linkLists);

  const kept = expansion.rows.slice(0, CORPUS_CAPS.maxSeedsPerSource);
  const written = await upsertSeeds(kept);
  widenScope(kept.map((r) => r.fullName));
  sourceNames.set(
    'links',
    kept.map((r) => r.fullName),
  );
  discovered.set('links', written);
  console.log(
    `corpus-sync: source=links lists=${file.linkLists.length} read=${expansion.listsRead} ` +
      `unreadable=${expansion.listsFailed} extracted=${expansion.rows.length} ` +
      `written=${written} over-list-cap=${expansion.overflow} ` +
      `dropped-by-source-cap=${expansion.rows.length - kept.length} ` +
      `core-cost=0 read-at=HEAD`,
  );
  if (expansion.listsFailed > 0) {
    console.log(
      `corpus-sync: INCOMPLETE — ${expansion.listsFailed} list(s) could not be read and ` +
        'contributed nothing. Whatever they name is not in the index because of this run.',
    );
  }
  if (expansion.overflow > 0) {
    console.log(
      `corpus-sync: INCOMPLETE — ${expansion.overflow} link(s) were past ` +
        `maxLinksPerList=${CORPUS_CAPS.maxLinksPerList} and were not extracted. Which ` +
        'repositories they named is not known from this run.',
    );
  }
}

async function runTopicSearch() {
  // Zero GitHub CORE requests. The Search API is a separate bucket — 10 a minute
  // unauthenticated against core's 60 an hour — which is why this source runs
  // while core is at zero. --drain below is the only thing here that spends core.
  // Where each topic stopped last run, so a big topic continues down its star
  // ladder instead of re-walking the top every time. The cursor is the
  // per-topic shard stacks as JSON; sweepTopics validates what it reads back.
  const state = await readSweepState('topic-search');
  let resume = {};
  try {
    resume = state.cursor ? JSON.parse(state.cursor) : {};
  } catch {
    resume = {};
  }
  const sweep = await sweepTopics({
    minStars: searchMinStars,
    maxRequests: searchRequests,
    spacingMs: budget.searchSpacingMs,
    resume,
  });
  // With each stack, how many runs in a row its top shard failed: the third
  // drops it (CORPUS_CAPS.maxShardFailures). A bare stack from before still reads.
  const pending = Object.fromEntries(
    sweep.topics
      .filter((t) => t.pending !== null)
      .map((t) => [t.topic, { stack: t.pending, failures: t.failures }]),
  );
  await writeSweepState('topic-search', {
    cursor: Object.keys(pending).length > 0 ? JSON.stringify(pending) : null,
    watermark: null,
    passStartedAt: null,
  });
  widenScope(sweep.seedNames);
  sourceNames.set('search', sweep.seedNames);
  discovered.set('search', sweep.seedsUpserted);
  console.log(
    `corpus-sync: source=search topics=${sweep.requestsSpent > 0 ? 'swept' : 'none'} ` +
      `requests=${sweep.requestsSpent} (search bucket) core-cost=0 ` +
      `shards-completed=${sweep.shardsCompleted} unreachable-shards=${sweep.unreachableShards.length} ` +
      `repos-found=${sweep.reposFound} written=${sweep.seedsUpserted} ` +
      `min-stars=${searchMinStars} stopped=${sweep.stoppedBecause}`,
  );

  // The headline, not a footnote. A sweep that printed only what it found would
  // read as coverage, and the measured truth is that most of every topic is
  // permanently out of paging reach.
  if (sweep.unreachableShards.length > 0) {
    const total = sweep.unreachableShards.reduce((n, s) => n + s.repositories, 0);
    console.log(
      `corpus-sync: INCOMPLETE — ${sweep.unreachableShards.length} shard(s) hold more ` +
        `repositories than the 1,000-result cap will page through and cannot be split further ` +
        `(a single star value has no halves). ${total} repositories are named by these shards ` +
        'and were not enumerated:',
    );
    for (const shard of sweep.unreachableShards) {
      console.log(`corpus-sync:   ${shard.query} — ${shard.repositories} repositories`);
    }
  }
  // Per topic, so a topic that got nothing is named rather than averaged into a
  // total that looks healthy.
  for (const t of sweep.topics) {
    console.log(
      `corpus-sync:   topic:${t.topic} requests=${t.requests} new-repos=${t.found} ` +
        `stopped=${t.stoppedBecause}` +
        (t.pending ? ` resumes-next-run-at=${t.pending.length} shard(s)` : '') +
        (t.failures > 0 ? ` consecutive-failures=${t.failures}` : ''),
    );
    if (t.dropped) {
      console.log(
        `corpus-sync: INCOMPLETE — topic:${t.topic} dropped the shard "${t.dropped}" after ` +
          `${CORPUS_CAPS.maxShardFailures} failed runs in a row, so the topic can move on. Its ` +
          'repositories are not swept until the next full pass of the topic asks for it again.',
      );
    }
  }
  if (sweep.unmeasuredFloors.length > 0) {
    console.log(
      `corpus-sync: INCOMPLETE — the below-floor count could not be measured for ` +
        `${sweep.unmeasuredFloors.join(', ')}; how much of those topics sits below the floor is ` +
        'not known from this run.',
    );
  }
  // A failed topic is a failed source, like a failed registry read: the run
  // exits 1 and writes no last-success. Its shard stays on the stack, so a
  // shard that fails every time keeps the run red rather than a topic silently
  // stuck in a log line.
  const failedTopics = sweep.topics.filter((t) => t.stoppedBecause === 'failed');
  if (failedTopics.length > 0) {
    const names = failedTopics.map((t) => t.topic).join(',');
    stageFailures.push(`search(${names})`);
    const dropped = failedTopics.filter((t) => t.dropped).map((t) => t.dropped);
    const droppedNote = dropped.length > 0 ? `; dropped ${dropped.join('; ')}` : '';
    annotate('error', 'AgentDock sync: search failed', `topic(s) ${names} failed${droppedNote}`);
  }
  if (sweep.stoppedBecause !== 'exhausted') {
    console.log(
      `corpus-sync: INCOMPLETE — the sweep stopped on ${sweep.stoppedBecause} after ` +
        `${sweep.requestsSpent} request(s). Topics that stopped short keep their place, and the ` +
        'next run continues from it; how many repositories the unwalked shards hold is not ' +
        'known from this run.',
    );
  }
  // The floor's cost, measured rather than described. At the default it is most
  // of every topic, and a run that mentioned the floor without the number would
  // still read as coverage.
  if (sweep.belowFloorShards.length > 0) {
    const total = sweep.belowFloorShards.reduce((n, s) => n + s.repositories, 0);
    console.log(
      `corpus-sync: INCOMPLETE — ${total} repositories sit below stars:${searchMinStars} and ` +
        'were not swept. That is a scheduling choice about which unfetched repositories to ' +
        'name first, not a statement about any artifact: a repository below the floor is ' +
        'still submittable, still ingested and still listed. Per topic:',
    );
    for (const shard of sweep.belowFloorShards) {
      console.log(`corpus-sync:   ${shard.query} — ${shard.repositories} repositories`);
    }
  }
}

try {
  // Registry first when several run: it costs no GitHub quota, so it can never
  // be the thing that starves the sources that do. Links is next for the same
  // reason — it too costs nothing. Each is its own stage: one failing no longer
  // stops the others.
  if (source === 'registry' || source === 'all') await stage('registry', runRegistry);
  if (source === 'seeds' || source === 'all') await stage('seeds', runSeedList);
  if (source === 'links' || source === 'all') await stage('links', runLinkLists);
  // Search is next for the same reason: a separate rate-limit bucket, so it
  // spends none of the core budget the drain below needs.
  if (source === 'search' || source === 'all') await stage('search', runTopicSearch);

  // Fan-out, refresh and drain are stages too: a database error in one of them
  // used to throw past the summary and print nothing of what the run had done.
  await stage('fan-out', async () => {
    if (noEnqueue) {
      console.log('corpus-sync: --no-enqueue, so no job was created');
    } else if (source === 'all') {
      // --source=all used to fan out the global FIFO alone, where the registry's
      // bulk arrival held every slot. Now the cap is shared across the sources
      // that wrote names this run, densest first — the operator's seed list, the
      // star-ordered topic sweep, the curated lists — and what they leave goes to
      // the backlog, which is where the registry's names (and every earlier
      // run's leftovers) wait.
      fanOut = await fanOutBySource(
        enqueueLimit,
        ['seeds', 'search', 'links']
          .filter((name) => sourceNames.has(name))
          .map((name) => ({ source: name, names: sourceNames.get(name) })),
      );
      for (const r of fanOut) {
        console.log(
          `corpus-sync: fan-out source=${r.source} considered=${r.considered} ` +
            `enqueued=${r.enqueued} denylisted=${r.denylisted} flooded=${r.flooded}`,
        );
      }
      const last = fanOut.at(-1);
      console.log(
        `corpus-sync: fan-out enqueued=${fanOut.reduce((n, r) => n + r.enqueued, 0)} ` +
          `still-pending=${last?.remaining ?? 'unknown'} across every source (cap ${enqueueLimit})`,
      );
    } else {
      // A single-source run fans out the names THAT source just wrote. The offer
      // is ordered by global arrival, so an unscoped fan-out after --source=seeds
      // hands back whichever source wrote first — measured on 2026-08-11, the seed
      // list's densest repository sat 7,971 registry rows and eleven days of quota
      // behind the front of the queue.
      const fan = await fanOutSeeds({ limit: enqueueLimit, only: scope ?? undefined });
      fanOut = [{ source, ...fan }];
      console.log(
        `corpus-sync: fan-out scope=${scope === null ? 'every seed' : `${scope.length} name(s) this run wrote`} ` +
          `considered=${fan.considered} enqueued=${fan.enqueued} denylisted=${fan.denylisted} ` +
          `flooded=${fan.flooded} still-pending=${fan.remaining} across every source ` +
          `(cap ${enqueueLimit})`,
      );
    }
  });

  // Re-offers repositories AgentDock has already read, so an upstream commit
  // after the first read is not invisible forever. Fan-out cannot do this: it
  // joins against ANY job row, terminal ones included, on purpose. Runs after
  // fan-out so a brand-new repository is still ahead of a re-check in the queue.
  if (refreshLimit > 0 && !noRefresh) {
    await stage('refresh', async () => {
      const refreshed = await refreshStaleRepositories({
        limit: refreshLimit,
        staleAfterMs: staleHours * 60 * 60 * 1000,
      });
      refreshedCount = refreshed.enqueued;
      failingChecks = refreshed.failingChecks;
      console.log(
        `corpus-sync: refresh stale-after=${staleHours}h considered=${refreshed.considered} ` +
          `enqueued=${refreshed.enqueued} denylisted=${refreshed.denylisted} ` +
          `flooded=${refreshed.flooded} not-reached=${refreshed.notReached} (cap ${refreshLimit}) ` +
          `failing-checks=${refreshed.failingChecks}`,
      );
      if (refreshed.notReached > 0) {
        console.log(
          `corpus-sync: INCOMPLETE — ${refreshed.notReached} stored repositories are past the ` +
            `${staleHours}h staleness cutoff and were not re-checked by this run. They are next in ` +
            'line: the offer is ordered by least-recently-read, so repeated runs rotate through ' +
            'the whole corpus rather than starving the tail.',
        );
      }
    });
  }

  if (drainLimit > 0) {
    await stage('drain', async () => {
      // Bounded and rate-aware, and deliberately not a resident worker:
      // drainQueue (src/ingest/worker.ts) is claimJob and runJob with the loop
      // bounded instead of endless. There is no sleep and no signal handling — a
      // scheduled process that has run out of budget should exit and let cron
      // start the next one, not hold a connection open waiting for a clock.
      //
      // A job whose process died mid-read is returned to the queue first. That
      // sweep used to run on the poll loop's own timer; with no resident loop
      // left, the scheduled run is the only thing that can do it, and doing it
      // before the drain is what lets this run pick the reclaimed job up.
      const reaped = await reapAbandoned(REAP_AFTER_MS);
      if (reaped.length > 0) {
        console.log(`corpus-sync: returned ${reaped.length} abandoned job(s) to the queue`);
      }

      // Free (GitHub does not count /rate_limit), and it seeds the budget check
      // below with the real number instead of nothing.
      coreBefore = await fetchCoreRateLimit();

      // Checked BEFORE each claim rather than after the failure. An ingest costs
      // two core requests, so with fewer than two left the next claim spends
      // one only to hit the wall — and every remaining job would then spend one
      // more to rediscover the same fact. The deadline is the other half: a
      // larger authenticated cap must never carry the run past the Actions
      // timeout with a transaction open.
      const drain = await drainQueue({
        limit: drainLimit,
        stop: () => drainStop(rateLimitState(), Date.now() - startedAt),
        // Counted as each job ends, so a database error later in the drain
        // still leaves what was done in the summary.
        onRun: (run) => {
          outcomes.set(run.outcome, (outcomes.get(run.outcome) ?? 0) + 1);
          delisted += run.removed;
          if (run.retryScheduled) retriesScheduled += 1;
          jobMs.push(run.durationMs);
          drainedCount += 1;
        },
      });
      drainStoppedBy = drain.stoppedBy;
      const drained = drain.runs.length;
      coreAfter = await fetchCoreRateLimit();
      console.log(`corpus-sync: drained ${drained} job(s) of at most ${drainLimit}`);
      if (drainStoppedBy === 'core_budget') {
        const rate = rateLimitState();
        console.log(
          `corpus-sync: INCOMPLETE — stopped with ${drainLimit - drained} of the cap unspent ` +
            `because fewer than two GitHub core requests remain (${rate?.remaining ?? 0} of ` +
            `${rate?.limit ?? 60}). Whatever is still queued is read by the next scheduled run.`,
        );
      }
      if (drainStoppedBy === 'rate_limited') {
        console.log(
          `corpus-sync: INCOMPLETE — stopped with ${drainLimit - drained} of the cap unspent ` +
            'because GitHub answered with a rate limit (a secondary limit leaves the core count ' +
            'high). That job is deferred with its attempt refunded; whatever is still queued is ' +
            'read by the next scheduled run.',
        );
      }
      if (drainStoppedBy === 'deadline') {
        console.log(
          `corpus-sync: INCOMPLETE — stopped with ${drainLimit - drained} of the cap unspent ` +
            `because ${Math.round(CORPUS_CAPS.drainDeadlineMs / 60_000)} minutes had passed since ` +
            'the sync started. Whatever is still queued is read by the next scheduled run.',
        );
      }
      ({ queued: backlog, due } = await queueDepth());
      console.log(
        `corpus-sync: ${backlog} job(s) still queued after the drain, ${due} of them due now`,
      );
      if (drainStoppedBy) {
        annotate(
          'warning',
          'AgentDock sync: drain stopped early',
          `${drainStoppedBy}; ${drained} drained, ${backlog} still queued`,
        );
      } else if (drained === 0 && backlog > 0) {
        annotate(
          'warning',
          'AgentDock sync: nothing drained',
          `${backlog} job(s) queued, none claimable`,
        );
      }
    });
  }

  // COR-06's acceptance number, taken from the function the home page calls and
  // from nothing else. "Parsed artifact" (COR-06) and "above the visibility
  // floor" (COR-07) are one predicate by construction, so a hand-written count
  // here would be a second definition of the same thing, free to drift from the
  // one a reader sees. Printed on every run rather than behind a --count flag:
  // a number an operator has to ask for is a number nobody reads.
  const listed = await countPackages();
  const held = await countPackages({ listingOnly: false });
  console.log(
    `corpus-sync: listed=${listed} of held=${held} artifact(s) — listed is what the home page ` +
      `renders; the ${held - listed} difference is on each repository's own page carrying its reason`,
  );

  // Read before this run overwrites it, for the backlog trend. A backlog that
  // grows run after run is the signal a single PARTIAL_DEADLINE is not.
  if (scheduled) {
    try {
      const previous = await lastSyncAttempt();
      previousQueued = typeof previous?.queued === 'number' ? previous.queued : null;
    } catch {
      previousQueued = null;
    }
  }

  summarize();

  if (stageFailures.length > 0) failed = true;
  annotate(
    'notice',
    `AgentDock sync: ${currentStatus()}`,
    `status=${currentStatus()} processed=${drainedCount} ingested=${outcomeCount('ok')} ` +
      `unchanged=${outcomeCount('unchanged')} queued=${backlog ?? 'n/a'} due=${due ?? 'n/a'} ` +
      `failed-stages=${stageFailures.length === 0 ? 'none' : stageFailures.join(',')} ` +
      `duration=${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
  // Only a run that reached here with every stage intact. The job's exit code
  // says the process finished; this says the sync did.
  if (!failed && scheduled) await recordSyncSucceeded(new Date());
} catch (error) {
  // The message only. A cause can carry request headers or statement text.
  console.error(`corpus-sync: ${error instanceof Error ? error.message : 'failed'}`);
  failed = true;
}

// Every scheduled run, green or red, beside sync:last_success — which a red run
// never writes, so on its own it cannot say whether runs are failing or not
// happening. Counted values only; no message text, so nothing a cause carried.
if (scheduled) {
  try {
    await recordSyncAttempt({
      startedAt: new Date(startedAt).toISOString(),
      ok: !failed,
      failedStages: stageFailures,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      processed: drainedCount,
      ingested: outcomeCount('ok'),
      unchanged: outcomeCount('unchanged'),
      unreadable: outcomeCount('unreadable'),
      rateLimited: outcomeCount('rate_limited'),
      retriesScheduled,
      delisted,
      enqueued: fanOut.reduce((n, r) => n + r.enqueued, 0) + refreshedCount,
      failingChecks,
      queued: backlog,
      due,
      status: currentStatus(),
      drainStoppedBy,
      coreSpent:
        coreBefore && coreAfter && coreBefore.reset === coreAfter.reset
          ? coreBefore.remaining - coreAfter.remaining
          : null,
      authenticated: budget.authenticated,
    });
  } catch {
    // Reporting, not a gate: the run's own exit code already says what happened.
    console.error('corpus-sync: could not record sync:last_attempt');
  }
}

await sql.end();
if (failed) process.exit(1);
