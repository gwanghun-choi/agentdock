import { z } from 'zod';
import { CORPUS_CAPS } from '@/corpus/caps';
import { type SeedRow, upsertSeeds } from '@/db/queries/seeds';
import { readSweepState, writeSweepState } from '@/db/queries/syncState';
import { githubRepoFromUrl } from '@/github/client';
import { fetchServerPage, RegistryError } from './client';
import { REGISTRY_CAPS, type RegistrySeed } from './types';

/**
 * One registry row, validated field by field.
 *
 * `repository` is `.partial().optional()` because `{}` is a real, observed
 * shape — 2.8% of 3,000 sampled rows — and a naive `repository.url` read
 * crashes on it.
 *
 * `source` is z.string(), deliberately not z.enum(['github','gitlab']): an
 * unknown source value must SKIP the row, not fail its validation. "This row is
 * malformed" and "this row names a repository AgentDock does not fetch" are two
 * different facts and the counters must not blend them.
 */
const registryRow = z.object({
  server: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    repository: z
      .object({
        url: z.string().url().optional(),
        source: z.string().optional(),
      })
      .partial()
      .optional(),
  }),
  _meta: z
    .object({
      'io.modelcontextprotocol.registry/official': z
        .object({ updatedAt: z.string() })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
});

export type RegistrySyncResult = {
  /** Pages that parsed. */
  pagesRead: number;
  /** Pages that only parsed after the control-byte retry. */
  pagesSanitized: number;
  rowsSeen: number;
  /** Rows zod rejected — skipped and counted, never thrown out of the loop. */
  rowsInvalid: number;
  /** Valid rows naming no GitHub repository. The expected 41%, not an error. */
  rowsNoGithubRepo: number;
  seedsUpserted: number;
  stoppedBecause: 'exhausted' | 'page_cap' | 'seed_cap' | 'parse_failure';
  /** The cursor to resume from, stored and printed whenever the pass is not done. */
  stoppedAtCursor: string | null;
  /** The watermark this run filtered by, or null while no pass has ever completed. */
  updatedSinceUsed: string | null;
  /** The cursor this run picked up from, or null if it started a new pass. */
  resumedFromCursor: string | null;
  /** When the pass this run belongs to began — possibly several runs ago. */
  passStartedAt: string;
  /** Non-null only on an exhausted pass. The only run that may move the window. */
  watermarkAdvancedTo: string | null;
};

/**
 * The one URL parser used here. src/registry/ may not name github.com — rule 5
 * fails the build on the literal, which is the point — and githubRepoFromUrl
 * already rejects every host but github.com, disposing of the registry's 0.3%
 * gitlab rows with no second branch, while reusing normalizeRepo's length caps
 * and character rules.
 */
function seedFrom(row: z.infer<typeof registryRow>): RegistrySeed {
  const rawUrl = row.server.repository?.url;
  let githubFullName: string | null = null;
  if (rawUrl) {
    try {
      const repo = githubRepoFromUrl(new URL(rawUrl));
      if (repo) githubFullName = `${repo.owner}/${repo.repo}`.toLowerCase();
    } catch {
      // A url zod accepted that URL() rejects is not a GitHub repository. Same
      // outcome as a gitlab row: no seed, counted as such.
      githubFullName = null;
    }
  }

  const rawUpdatedAt = row._meta?.['io.modelcontextprotocol.registry/official']?.updatedAt;
  // Normalized here so src/db/queries/seeds.ts's timestamptz cast cannot fail on
  // a publisher-supplied string. An unparseable value costs the watermark, not
  // the seed — a bad timestamp does not make the repository URL wrong.
  const updatedAt =
    rawUpdatedAt && !Number.isNaN(Date.parse(rawUpdatedAt))
      ? new Date(rawUpdatedAt).toISOString()
      : null;

  return {
    registryName: row.server.name,
    githubFullName,
    version: row.server.version,
    updatedAt,
    description: row.server.description ?? null,
  };
}

/**
 * Named fields only, never the row verbatim. This is what bounds the jsonb: a
 * publisher cannot grow AgentDock's storage by adding keys.
 *
 * discoveredFrom is 'mcp-registry', not the hostname (05-CONTEXT D-12). A
 * hostname written as a data value is a hostname literal in whatever file writes
 * it, and a provenance tag should not decide where code is allowed to live.
 */
function seedRowFor(seed: RegistrySeed & { githubFullName: string }): SeedRow {
  return {
    fullName: seed.githubFullName,
    sourceKind: 'github',
    discoveredFrom: 'mcp-registry',
    discoveredPath: seed.registryName,
    hint: {
      registryName: seed.registryName,
      version: seed.version,
      description: seed.description,
      registryUpdatedAt: seed.updatedAt,
    },
  };
}

/** The schema_meta key this source's resume point and watermark live under. */
export const REGISTRY_SOURCE = 'mcp-registry';

/**
 * Walks the registry from where the last run stopped, bounded by pages and by
 * seeds, and stores the GitHub repositories it names.
 *
 * Never throws for one bad row: a row zod rejects is skipped and counted, the
 * posture src/ingest/pipeline.ts already applies per candidate. A page that
 * cannot be parsed at all stops the sweep with its cursor recorded, because
 * continuing past a page whose nextCursor could not be read would silently skip
 * everything after it.
 *
 * THE WATERMARK ADVANCES ONLY ON AN EXHAUSTED PASS. The registry orders by
 * server name and treats `updated_since` as a filter over the whole name space,
 * so a run that stopped at its page cap has seen a prefix of the names and
 * nothing more. Advancing a timestamp on that basis hides every later name whose
 * last update predates it, from every future run, silently. A pass therefore
 * spans as many invocations as it takes — 211 pages at limit=100 against a
 * 40-page cap is about six — each resuming from the stored cursor under the
 * SAME window, and only the invocation that reaches the end earns the right to
 * filter.
 *
 * The value written is the moment the pass began, not the newest updatedAt it
 * saw. "Every name has been seen at least once as of this time" is true of the
 * start of a completed pass; it is not true of a later timestamp, and a row
 * updated mid-pass after its own name was already read would be filtered out of
 * the next pass forever. Clamped by the newest observed value so a clock ahead
 * of the registry's cannot skip either — both directions land on over-fetch,
 * which costs registry bandwidth and no GitHub quota.
 */
export async function syncRegistry(
  options: { maxPages?: number; maxSeeds?: number } = {},
): Promise<RegistrySyncResult> {
  const maxPages = options.maxPages ?? REGISTRY_CAPS.maxPages;
  const maxSeeds = options.maxSeeds ?? CORPUS_CAPS.maxSeedsPerSource;

  const state = await readSweepState(REGISTRY_SOURCE);
  // A pass in flight keeps its own start time and its own window. Only a run
  // that begins with no cursor starts a new pass.
  const passStartedAt =
    state.cursor && state.passStartedAt ? state.passStartedAt : new Date().toISOString();

  const result: RegistrySyncResult = {
    pagesRead: 0,
    pagesSanitized: 0,
    rowsSeen: 0,
    rowsInvalid: 0,
    rowsNoGithubRepo: 0,
    seedsUpserted: 0,
    stoppedBecause: 'exhausted',
    stoppedAtCursor: null,
    updatedSinceUsed: state.watermark,
    resumedFromCursor: state.cursor,
    passStartedAt,
    watermarkAdvancedTo: null,
  };

  let cursor = state.cursor;
  let newestObserved: string | null = null;

  for (let read = 0; read < maxPages; read += 1) {
    let page: Awaited<ReturnType<typeof fetchServerPage>>;
    try {
      page = await fetchServerPage({ cursor, updatedSince: state.watermark });
    } catch (error) {
      if (error instanceof RegistryError && error.failure === 'invalid_response') {
        result.stoppedBecause = 'parse_failure';
        break;
      }
      throw error;
    }

    result.pagesRead += 1;
    if (page.sanitized) result.pagesSanitized += 1;
    result.rowsSeen += page.rows.length;

    const seeds: SeedRow[] = [];
    for (const raw of page.rows) {
      const parsed = registryRow.safeParse(raw);
      if (!parsed.success) {
        result.rowsInvalid += 1;
        continue;
      }
      const seed = seedFrom(parsed.data);
      // Tracked over every valid row, including the 41% naming no repository:
      // they were seen, and the watermark is a claim about having looked.
      if (seed.updatedAt && (newestObserved === null || seed.updatedAt > newestObserved)) {
        newestObserved = seed.updatedAt;
      }
      if (!seed.githubFullName) {
        result.rowsNoGithubRepo += 1;
        continue;
      }
      seeds.push(seedRowFor({ ...seed, githubFullName: seed.githubFullName }));
    }

    // Written per page, not once at the end, so a later page that cannot be
    // parsed costs its own rows and not the whole run's.
    result.seedsUpserted += await upsertSeeds(seeds);
    cursor = page.nextCursor;

    if (cursor === null) {
      result.stoppedBecause = 'exhausted';
      break;
    }
    if (result.seedsUpserted >= maxSeeds) {
      result.stoppedBecause = 'seed_cap';
      break;
    }
    if (read + 1 === maxPages) result.stoppedBecause = 'page_cap';
  }

  if (result.stoppedBecause === 'exhausted') {
    // The one place a watermark may move.
    const advanced =
      newestObserved !== null && newestObserved < passStartedAt ? newestObserved : passStartedAt;
    result.watermarkAdvancedTo = advanced;
    await writeSweepState(REGISTRY_SOURCE, {
      cursor: null,
      watermark: advanced,
      passStartedAt: null,
    });
  } else {
    result.stoppedAtCursor = cursor;
    await writeSweepState(REGISTRY_SOURCE, {
      cursor,
      // Untouched, deliberately. See the note above the function.
      watermark: state.watermark,
      passStartedAt,
    });
  }

  return result;
}
