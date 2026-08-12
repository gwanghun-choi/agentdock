#!/usr/bin/env node
// scripts/corpus-sync.mjs
//
// Acquires repository seeds from one corpus source, fans them out into the
// ingest queue under an explicit cap, and optionally drains a bounded number of
// the jobs it just created. An operator runs this; there is no cron and no
// in-app scheduler (05-CONTEXT D-08), because a scheduler would need an
// ingest_job.kind column that deliberately does not exist.
//
// Every cap prints what it dropped. A run that stops at a page cap prints the
// cursor to resume from, a fan-out that stops on a full queue says so, and every
// run ends with how many seeds still hold no job — a cap that prints nothing
// reads as "we covered everything".
//
// This script issues no GitHub request of its own. --drain does, through the
// normal ingest path: two core requests per repository out of sixty an hour.
//
// A sweep resumes itself: where it stopped is stored, so running this again
// continues the same pass rather than restarting it. There is no --cursor flag,
// because a resume point an operator can type is a resume point an operator can
// get wrong.
//
// Usage:
//   bun run corpus:sync --source=registry|seeds|links|search|all [--enqueue=<n> | --no-enqueue] [--drain=<n>]
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

const SOURCES = new Set(['registry', 'seeds', 'links', 'search', 'all']);
const source = flag('source') ?? 'registry';
if (!SOURCES.has(source)) {
  throw new Error(
    `corpus-sync: --source must be one of ${[...SOURCES].join('|')}, got "${source}"`,
  );
}

const { CORPUS_CAPS } = await import('../src/corpus/caps.ts');

const noEnqueue = flag('no-enqueue') !== undefined;
const enqueueLimit = count('enqueue', CORPUS_CAPS.maxEnqueuePerSync);
const drainLimit = count('drain', 0);

const searchRequests = count('search-requests', CORPUS_CAPS.maxSearchRequests);
const searchMinStars = count('search-min-stars', CORPUS_CAPS.searchMinStars);

const { syncRegistry } = await import('../src/registry/sync.ts');
const { sweepTopics } = await import('../src/corpus/search.ts');
const { fanOutSeeds } = await import('../src/corpus/fanout.ts');
const { loadSeedList, seedListRows } = await import('../src/corpus/seedList.ts');
const { expandLinkLists } = await import('../src/corpus/links.ts');
const { upsertSeeds } = await import('../src/db/queries/seeds.ts');
const { countPackages } = await import('../src/db/queries/packages.ts');
const { claimJob } = await import('../src/db/queries/jobs.ts');
const { runJob } = await import('../src/ingest/worker.ts');
const { sql } = await import('../src/db/client.ts');

let failed = false;

/**
 * The repository names the sources in THIS run wrote, so the fan-out below can
 * be narrowed to them.
 *
 * Not a discovered_from filter: provenance is single-valued and last-writer-wins,
 * so a repository two sources both name carries only the later one — measured on
 * 2026-08-11, expanding the curated link lists re-tagged 253 registry seeds and 4
 * of the 15 operator seeds. A source knows the names it just produced; it cannot
 * rely on the column still agreeing. Left null by --source=all, which is not
 * singling any source out and keeps the global FIFO.
 */
let scope = null;

/** @param {string[]} names */
function widenScope(names) {
  scope = [...new Set([...(scope ?? []), ...names])];
}

async function runRegistry() {
  const sync = await syncRegistry();
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
  const sweep = await sweepTopics({
    minStars: searchMinStars,
    maxRequests: searchRequests,
  });
  widenScope(sweep.seedNames);
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
  if (sweep.stoppedBecause !== 'exhausted') {
    console.log(
      `corpus-sync: INCOMPLETE — the sweep stopped on ${sweep.stoppedBecause} after ` +
        `${sweep.requestsSpent} request(s). The shards it had not reached are not known from ` +
        'this run, and neither is how many repositories they hold.',
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
  // reason — it too costs nothing.
  if (source === 'registry' || source === 'all') await runRegistry();
  if (source === 'seeds' || source === 'all') await runSeedList();
  if (source === 'links' || source === 'all') await runLinkLists();
  // Search is next for the same reason: a separate rate-limit bucket, so it
  // spends none of the core budget the drain below needs.
  if (source === 'search' || source === 'all') await runTopicSearch();
  // --source=all singles out no source, so its fan-out stays the global FIFO.
  if (source === 'all') scope = null;

  if (noEnqueue) {
    console.log('corpus-sync: --no-enqueue, so no job was created');
  } else {
    // A single-source run fans out the names THAT source just wrote. The offer
    // is ordered by global arrival, so an unscoped fan-out after --source=seeds
    // hands back whichever source wrote first — measured on 2026-08-11, the seed
    // list's densest repository sat 7,971 registry rows and eleven days of quota
    // behind the front of the queue.
    const fan = await fanOutSeeds({ limit: enqueueLimit, only: scope ?? undefined });
    console.log(
      `corpus-sync: fan-out scope=${scope === null ? 'every seed' : `${scope.length} name(s) this run wrote`} ` +
        `considered=${fan.considered} enqueued=${fan.enqueued} denylisted=${fan.denylisted} ` +
        `flooded=${fan.flooded} still-pending=${fan.remaining} across every source ` +
        `(cap ${enqueueLimit})`,
    );
  }

  if (drainLimit > 0) {
    // Bounded, and deliberately not a second worker: claimJob and runJob are
    // already exported, so this is the two calls runWorker makes with the loop
    // bounded instead of endless. It must not grow a sleep, a reap or a signal —
    // those belong to runWorker, which is the always-on process.
    let drained = 0;
    for (let i = 0; i < drainLimit; i += 1) {
      const job = await claimJob(`corpus-sync-${process.pid}`);
      if (!job) break;
      await runJob(job);
      drained += 1;
    }
    console.log(`corpus-sync: drained ${drained} job(s) of at most ${drainLimit}`);
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
} catch (error) {
  // The message only. A cause can carry request headers or statement text.
  console.error(`corpus-sync: ${error instanceof Error ? error.message : 'failed'}`);
  failed = true;
}

await sql.end();
if (failed) process.exit(1);
