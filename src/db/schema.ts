import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { FileEntry } from '@/analyze/types';

const requested = process.env.DATABASE_SCHEMA ?? 'agentdock';

// drizzle-kit loads this module standalone, without parseEnv, so the guard is
// repeated here. This is the file every CREATE TABLE is generated from: a wrong
// value would emit DDL aimed at a schema AgentDock does not own.
if (requested !== 'agentdock' && requested !== 'agentdock_test') {
  throw new Error(
    `Refusing to build a schema module for "${requested}". ` +
      'AgentDock owns only "agentdock" and "agentdock_test".',
  );
}

/**
 * The schema AgentDock owns. Parameterised only so the same definitions can be
 * applied to `agentdock_test`; scripts/check-boundaries.mjs asserts that the
 * committed migrations name `agentdock` and nothing else.
 */
export const AGENTDOCK_SCHEMA = requested;

/**
 * Every table in this project hangs off this object, so every statement Drizzle
 * emits — DDL and queries alike — is schema-qualified. `search_path` is a
 * default, not a fence, and nothing here relies on it.
 */
export const agentdock = pgSchema(AGENTDOCK_SCHEMA);

/**
 * Key/value facts about this deployment of the schema. Written at boot, read by
 * the status page.
 *
 * Phase 5 widened it to carry one more kind of deployment fact: where each
 * corpus acquisition sweep stopped, and how far it can honestly claim to have
 * looked (`corpus_sweep:<source>`, src/db/queries/syncState.ts). That state has
 * to survive between invocations and this phase adds no migration, so it lands
 * here rather than in a column of its own.
 */
export const schemaMeta = agentdock.table('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The artifact-type dimension, introduced at exactly one value.
 *
 * Phase 3 adds plugin, mcp_server, command and hook. Adding a row to a populated
 * table is an INSERT; widening a CHECK constraint on a populated table is a DROP
 * CONSTRAINT, which this project's boundary scanner treats as destructive and
 * requires a review marker for. That asymmetry is the whole reason this table
 * exists today with one row in it.
 */
export const artifactType = agentdock.table('artifact_type', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
});

export const repository = agentdock.table(
  'repository',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // Immutable across rename AND transfer — this, not full_name, is identity.
    githubNodeId: text('github_node_id').notNull(),
    fullName: text('full_name').notNull(), // mutable display value
    owner: text('owner').notNull(),
    defaultBranch: text('default_branch').notNull(),
    description: text('description'),
    homepage: text('homepage'), // API returns "" not null — normalize on write
    // From the API's license.spdx_id ONLY. Never from frontmatter: the sampled
    // corpus writes free prose there ("Complete terms in LICENSE.txt").
    licenseSpdx: text('license_spdx'),
    stars: integer('stars').notNull().default(0),
    isFork: boolean('is_fork').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    topics: text('topics').array().notNull().default(sql`'{}'::text[]`),
    pushedAt: timestamp('pushed_at', { withTimezone: true }), // upstream changed
    scannedAt: timestamp('scanned_at', { withTimezone: true }), // AgentDock looked
    etag: text('etag'),
    lastIngestedSha: text('last_ingested_sha'),
    treeTruncated: boolean('tree_truncated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('repository_node_id_key').on(t.githubNodeId),
    uniqueIndex('repository_full_name_key').on(sql`lower(${t.fullName})`),
    index('repository_stars_idx').on(t.stars.desc()),
  ],
);

/**
 * tsvector has no first-class Drizzle column builder, so it is declared as a
 * custom type. The driver reads/writes it as a plain string; PostgreSQL does
 * the tokenizing.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

export const packageTable = agentdock.table(
  'package',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    type: text('type')
      .notNull()
      .references(() => artifactType.id),
    sourcePath: text('source_path').notNull(), // 'skills/canvas-design/SKILL.md'
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    // The frontmatter `license` value, as written. Free prose, never faceted,
    // never mixed with repository.license_spdx.
    licenseText: text('license_text'),
    // Type-specific fields live here, so a second artifact type never forces a
    // column onto the first. $type is a TypeScript-only narrowing — it changes
    // the inferred read type and emits no DDL, so it cannot drift the migration.
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    // Nullable, no default, not in the identity key: (repository_id, type,
    // source_path) already disambiguates a plugin-owned skill from a top-level
    // one, because source_path differs. Adding a fourth column to a populated
    // table's unique constraint is a DROP CONSTRAINT, which this project's
    // boundary scanner treats as destructive — for one bit of information the
    // key already carries.
    parentPath: text('parent_path'),
    delistedAt: timestamp('delisted_at', { withTimezone: true }),
    /**
     * The file inventory: every blob under this artifact's directory prefix,
     * from the tree AgentDock already fetched (src/analyze/files.ts). On
     * `package`, deliberately NOT on `package_version` — a version is minted
     * by contentHash over the manifest's own bytes, so adding a script beside
     * an unchanged SKILL.md mints no version, and a version-scoped inventory
     * would be permanently stale about exactly what CAP-03 discloses. Written
     * by the same upsert that already runs on every scan (persist.ts), so a
     * commit where the tree moved but the manifest did not still refreshes
     * this column. Capped at ANALYZE_CAPS.maxInventoryEntries; the largest
     * real inventory measured is 83 entries.
     */
    files: jsonb('files').$type<FileEntry[]>().notNull().default(sql`'[]'::jsonb`),
    /**
     * Generated, weighted full-text search column: A=name, B=summary,
     * C=source_path with '/' and '.' replaced by spaces (to_tsvector treats
     * a whole slash-delimited path as one lexeme otherwise — verified live,
     * 06-RESEARCH.md), D=type with '_' replaced by a space so a search for
     * "mcp server" reaches type = 'mcp_server'. STORED and maintained
     * entirely by PostgreSQL — no trigger, no application backfill.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
          setweight(to_tsvector('english',
            replace(replace(coalesce(source_path, ''), '/', ' '), '.', ' ')), 'C') ||
          setweight(to_tsvector('english', replace(coalesce(type, ''), '_', ' ')), 'D')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Stable across re-ingestion and across repository rename, because
    // repository_id is keyed on the immutable node id.
    unique('package_identity').on(t.repositoryId, t.type, t.sourcePath),
    index('package_live_idx').on(t.type, t.updatedAt.desc()),
    index('package_search_vector_idx').using('gin', t.searchVector),
    // Typo-tolerance fallback (DIS-04, 06-04). Matches
    // src/db/queries/search.ts's fuzzy-branch expression character for
    // character: a predicate that differs by a space or a coalesce cannot
    // use this index, and the symptom is a plan, not an error. The
    // migration this index ships in carries a DO-block guard as its FIRST
    // statement that fails loudly, naming the exact superuser command, if
    // public.gin_trgm_ops does not exist yet — the index itself is what
    // makes a missing pg_trgm a migrate-time stop rather than a silent
    // runtime degradation (decision 5, 06-04 plan).
    index('package_fuzzy_trgm_idx').using(
      'gin',
      sql`(${t.name} || ' ' || coalesce(${t.summary}, '')) public.gin_trgm_ops`,
    ),
  ],
);
// search_vector shipped in 06-01. package_fuzzy_trgm_idx ships here (06-04),
// using public.gin_trgm_ops — the operator class itself is still installed
// out of band only, by a superuser (D-03), never by an AgentDock migration
// (D-04); the migration's own DO guard fails loudly, naming the exact
// command, when it is absent. The schema qualifier is public rather than
// agentdock because that is where pg_trgm actually lives on the deployment
// target (didim_api, verified 2026-08-12) — AgentDock reads the shared
// operator class and still creates every object it owns inside agentdock.

export const packageVersion = agentdock.table(
  'package_version',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    packageId: bigint('package_id', { mode: 'number' })
      .notNull()
      .references(() => packageTable.id, { onDelete: 'cascade' }),
    // The COMMIT sha. github.com/o/r/blob/<tree-sha>/path returns 404; only the
    // commit sha resolves. raw.githubusercontent.com accepts both, so a raw-only
    // check cannot catch this being wrong.
    commitSha: text('commit_sha').notNull(),
    blobSha: text('blob_sha'),
    contentHash: text('content_hash').notNull(),
    declaredVersion: text('declared_version'), // null renders as "not declared"
    body: text('body'), // capped excerpt, never a mirror
    frontmatter: jsonb('frontmatter')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    parseStatus: text('parse_status').notNull().default('ok'), // ok | partial | failed
    parseErrors: jsonb('parse_errors').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The "we looked" marker. Null and empty are different facts, and CAP-11
     * is the requirement that they must not read the same: every row created
     * in Phases 1-3 has no findings because nothing analyzed it, and
     * rendering that as "not detected" is the assurance this product does
     * not give. Set by the same transaction that writes this version's
     * findings (src/ingest/persist.ts), and only when a new version row was
     * created — never touched again after that.
     */
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
  },
  (t) => [
    // Identical content re-ingested is ON CONFLICT DO NOTHING. Idempotency is a
    // constraint, not a code path that can race.
    unique('package_version_content_key').on(t.packageId, t.contentHash),
    index('package_version_recent_idx').on(t.packageId, t.ingestedAt.desc()),
  ],
);

/**
 * One analyzer's observation about one package_version's content. Never a
 * verdict — see src/analyze/types.ts's Finding doc.
 *
 * Follows repoSeed's shape exactly: agentdock.table(...) never pgTable,
 * bigserial({mode:'number'}) PK, text with a comment instead of an enum for
 * detector_id/category/signal (widening a constrained type on a populated
 * table is a DROP, the same reasoning artifact_type and repoSeed.sourceKind
 * already record), jsonb metadata with a default, withTimezone timestamps,
 * cascade FK to package_version.
 *
 * No capability_category dimension table, and no reference data of any kind
 * in this migration — see CONTEXT.md Binding decision 5. That also keeps
 * scripts/migrate.mjs out of this phase entirely.
 */
export const capabilityFinding = agentdock.table(
  'capability_finding',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    packageVersionId: bigint('package_version_id', { mode: 'number' })
      .notNull()
      .references(() => packageVersion.id, { onDelete: 'cascade' }),
    detectorId: text('detector_id').notNull(),
    /** Bumped when the rule changes, so a precision row names a specific version. */
    detectorVersion: text('detector_version').notNull(),
    // declared | remote_execution | package_install | network_request |
    // external_reference | hidden_content. Text with a comment, not an enum
    // — see the table doc above.
    category: text('category').notNull(),
    /** Which rule inside the detector fired: 'npx', 'pip install', 'U+202E'. */
    signal: text('signal').notNull(),
    /** Observation, never judgment. Verbs: declares, references, invokes, contains. */
    summary: text('summary').notNull(),
    // The file the observation is in. Not always this version's own
    // source_path — a multi-file finding names a path that is not.
    sourcePath: text('source_path').notNull(),
    /** 1-indexed against package_version.body. Null for a structured declaration. */
    startLine: integer('start_line'),
    endLine: integer('end_line'),
    /**
     * Denormalized from this row's own package_version, and the redundancy
     * is deliberate: it buys no query, but it is kept because a finding row
     * is read outside its join in a CAP-13 audit trail. The cost of a
     * denormalized column is drift, so a persistence test asserts every
     * finding's commit_sha equals its version's.
     */
    commitSha: text('commit_sha').notNull(),
    /** Capped at ANALYZE_CAPS.maxEvidenceChars, single line, escaped at render. */
    evidenceText: text('evidence_text'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Any onConflict target for this table must name the same columns, in
    // the same order, as this constraint — persist.ts:136-138's convention.
    unique('capability_finding_identity').on(
      t.packageVersionId,
      t.detectorId,
      t.category,
      t.sourcePath,
      t.startLine,
      t.summary,
    ),
    index('capability_finding_version_idx').on(t.packageVersionId),
  ],
);

/** Survives re-crawling: a removed repository is not silently re-added. */
export const repositoryDenylist = agentdock.table('repository_denylist', {
  fullName: text('full_name').primaryKey(), // stored lowercased
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Repositories a catalog named, stored and never visited.
 *
 * No status column and no enqueued_at. Phase 5 (COR-03) owns fan-out and needs
 * to decide how seed volume interacts with MAX_QUEUED before any of it exists; a
 * nullable timestamp is a one-line additive migration when it does. This is the
 * same reasoning ingest_job records for its absent kind and priority columns.
 */
export const repoSeed = agentdock.table(
  'repo_seed',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Lowercased owner/repo. Only GitHub-reachable entries are stored at all. */
    fullName: text('full_name').notNull(),
    // github | url | git-subdir. Text with a comment, not an enum: widening a
    // constrained type on a populated table is a DROP, which this project's
    // boundary scanner treats as destructive. Same reason as artifact_type.
    sourceKind: text('source_kind').notNull(),
    /**
     * Where this seed came from. Provenance, not a join.
     *
     * Originally the catalog's own repository as owner/repo, which is still what
     * the ingest path writes. Phase 5 widened it: an operator-driven acquisition
     * source writes its own name instead — 'mcp-registry' today. Never a
     * hostname, deliberately (05-CONTEXT D-12): a hostname as a data value is a
     * hostname literal in whatever file writes it, and check:boundaries rule 5
     * would then decide where that code is allowed to live.
     */
    discoveredFrom: text('discovered_from').notNull(),
    discoveredPath: text('discovered_path').notNull(),
    /** The catalog entry verbatim: name, description, version, subdir, tags. */
    hint: jsonb('hint').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('repo_seed_full_name_key').on(t.fullName)],
);

/**
 * The queue. Deliberately narrow: every claim, every reap and every terminal
 * transition UPDATEs this row, so anything wide belongs in ingest_attempt
 * instead. A jsonb column here would turn the hottest UPDATE in the schema into
 * a non-HOT one and grow the claim index for no read that needs it.
 *
 * No `kind` column and no `priority` column. Phase 5's registry-sync jobs are a
 * different shape and a five-line migration away; guessing at their key now
 * costs the same migration and would be wrong.
 *
 * `status` is text with a comment rather than an enum or a CHECK, for the reason
 * already recorded on artifact_type above: widening a constrained type on a
 * populated table is a DROP, which this project's boundary scanner treats as
 * destructive. The union is enforced in TypeScript.
 */
export const ingestJob = agentdock.table(
  'ingest_job',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // Always a validated `owner/repo` — normalizeRepo() runs before this row exists.
    target: text('target').notNull(),
    // queued | running | succeeded | failed
    status: text('status').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    // Both the retry backoff and the rate-limit reset schedule land here. This
    // column is the scheduler; there is no cron and no timer.
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    // Set on claim, cleared on reap and on terminal. This column IS the liveness
    // signal, which is why there is no heartbeat table.
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    workerId: text('worker_id'),
  },
  (t) => [
    // Dedupes duplicate submits AND makes the reaper's running->queued
    // transition collision-free, because the row never leaves this index.
    // Including 'running' in the predicate is what buys the second property.
    uniqueIndex('ingest_job_active_key')
      .on(t.target)
      .where(sql`${t.status} in ('queued','running')`),
    // The claim's only index. Partial, so it holds claimable rows and nothing else.
    index('ingest_job_claim_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'queued'`),
    // The reaper's scan.
    index('ingest_job_running_idx').on(t.startedAt).where(sql`${t.status} = 'running'`),
  ],
);

/**
 * Append-only. One row per claim, written exactly once when the attempt ends.
 * Never updated, so it can be as wide as the status page needs — which is the
 * whole reason it is a second table.
 */
export const ingestAttempt = agentdock.table(
  'ingest_attempt',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: bigint('job_id', { mode: 'number' })
      .notNull()
      .references(() => ingestJob.id, { onDelete: 'cascade' }),
    attemptNo: smallint('attempt_no').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),

    // The IngestOutcome union, plus 'unchanged'. Not a free string: this value
    // is rendered and is filtered on.
    outcome: text('outcome').notNull(),
    // The reason a person reads. Drawn only from the outcome message table,
    // never from an exception's message.
    errorDetail: text('error_detail'),

    commitSha: text('commit_sha'),
    filesRead: integer('files_read').notNull().default(0),
    artifactsFound: integer('artifacts_found').notNull().default(0),
    artifactsNew: integer('artifacts_new').notNull().default(0),
    artifactsUpdated: integer('artifacts_updated').notNull().default(0),
    artifactsUnchanged: integer('artifacts_unchanged').notNull().default(0),
    artifactsRemoved: integer('artifacts_removed').notNull().default(0),
    parseFailed: integer('parse_failed').notNull().default(0),
    // True when the tree was cut short OR a file-read cap fired. Both are
    // indistinguishable to a reader and both mean the same thing: partial.
    truncated: boolean('truncated').notNull().default(false),

    rateRemaining: integer('rate_remaining'),
    rateReset: timestamp('rate_reset', { withTimezone: true }),
  },
  (t) => [index('ingest_attempt_job_idx').on(t.jobId, t.attemptNo.desc())],
);
