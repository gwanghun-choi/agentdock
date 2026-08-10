import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
    delistedAt: timestamp('delisted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Stable across re-ingestion and across repository rename, because
    // repository_id is keyed on the immutable node id.
    unique('package_identity').on(t.repositoryId, t.type, t.sourcePath),
    index('package_live_idx').on(t.type, t.updatedAt.desc()),
  ],
);
// No search_tsv column and no pg_trgm index in this phase: pg_trgm is not
// installed in this instance and must not be installed here.

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
  },
  (t) => [
    // Identical content re-ingested is ON CONFLICT DO NOTHING. Idempotency is a
    // constraint, not a code path that can race.
    unique('package_version_content_key').on(t.packageId, t.contentHash),
    index('package_version_recent_idx').on(t.packageId, t.ingestedAt.desc()),
  ],
);

/** Survives re-crawling: a removed repository is not silently re-added. */
export const repositoryDenylist = agentdock.table('repository_denylist', {
  fullName: text('full_name').primaryKey(), // stored lowercased
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
