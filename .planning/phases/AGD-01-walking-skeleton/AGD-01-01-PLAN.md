---
phase: AGD-01-walking-skeleton
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - scripts/capture-fixtures.mjs
  - scripts/seed-fixture.mjs
  - scripts/check-boundaries.mjs
  - scripts/check-boundaries.test.ts
  - src/db/schema.ts
  - src/db/queries/packages.ts
  - src/ingest/types.ts
  - src/ingest/persist.ts
  - src/ingest/persist.test.ts
  - src/app/skills/page.tsx
  - fixtures/anthropics-skills/
  - drizzle/
autonomous: true
requirements: [DAT-01, DAT-02, DAT-03, DAT-04, DAT-05, DAT-06, PRV-01, ING-05, ING-10, DET-10]

estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A repository row survives a rename because its identity is GitHub's immutable node id, not its full name"
    - "Persisting the same scan twice produces the same rows and no second version — the constraint enforces it, not a read-then-write check"
    - "A package that disappeared from a repository between scans is marked delisted in the same transaction that wrote the survivors, so there is no window where a live package reads as delisted"
    - "A real skill captured from a real repository at a pinned commit renders on a page, and the source link it prints resolves to that exact file at that exact commit"
    - "`artifact_type` exists as a dimension with exactly one row, so Phase 3 adds a type with an INSERT rather than a migration against live data (CONTEXT.md resolved question 3 / D-03)"
    - "A denylisted repository is a row that outlives any re-crawl"
    - "The build fails if application source gains a way to execute a scanned repository, write its content to disk, render raw HTML, or reach a host outside src/github/"
  artifacts:
    - path: "src/db/schema.ts"
      provides: "repository, artifact_type, package, package_version, repository_denylist — every identity key and every day-one column"
      exports: ["repository", "artifactType", "packageTable", "packageVersion", "repositoryDenylist"]
      min_lines: 100
    - path: "src/ingest/types.ts"
      provides: "RepoScan / ScannedPackage — the contract the pipeline produces and persistence consumes"
      exports: ["RepoScan", "ScannedPackage", "ParseStatus"]
      min_lines: 30
    - path: "src/ingest/persist.ts"
      provides: "One transaction: repository upsert on node id, package upsert on the identity triple, version insert-if-absent on content hash, delisting of survivors"
      exports: ["persistScan"]
      min_lines: 60
    - path: "src/db/queries/packages.ts"
      provides: "The read side — listing rows carrying the commit SHA the permalink needs"
      exports: ["listPackages", "countPackages"]
      min_lines: 30
    - path: "src/app/skills/page.tsx"
      provides: "Server-rendered listing that proves a stored row reaches a page with a working permalink"
      min_lines: 25
    - path: "scripts/capture-fixtures.mjs"
      provides: "Manual, pinned capture of the frozen corpus; asserts the Trees sha is the commit sha by resolving a blob permalink"
      min_lines: 50
    - path: "fixtures/anthropics-skills/tree.json"
      provides: "501-entry tree at f17010c9, frozen — the detector and ingestion suites never touch the network"
      min_lines: 1
  key_links:
    - from: "src/ingest/persist.ts"
      to: "src/db/schema.ts"
      via: "onConflictDoUpdate targets the exact unique constraints the schema declares"
      pattern: "onConflictDo"
    - from: "src/app/skills/page.tsx"
      to: "src/db/queries/packages.ts"
      via: "the page's only data access, so the permalink it renders comes from a stored commit SHA"
      pattern: "listPackages"
    - from: "scripts/check-boundaries.mjs"
      to: "src/"
      via: "source boundary rules run inside bun run ci on every push"
      pattern: "checkSourceBoundaries"
---

<objective>
Put the data model in the ground and prove it end to end: a real skill, captured
from a real repository at a pinned commit, persisted through the transaction the
whole phase will use, read back by the query the whole phase will use, rendered
on a page, with a source link that resolves to that exact file at that exact
commit.

Purpose: three of this phase's assumptions are cheap to test now and expensive to
discover later — that the SHA the Trees API returns is the one `blob/` permalinks
need (RESEARCH.md finding 1, assumption A1), that the identity keys make
re-ingest a genuine no-op, and that `artifact_type` is cheaper to introduce at
one value than to retrofit against live rows. This plan settles all three on one
commit. It also installs the phase's dependencies once and lands the source
boundary gate *before* the code it governs, so the temptation and the refusal
arrive in the right order.

Output: five tables in `agentdock` behind a reviewed migration, the persistence
and read functions, a frozen fixture corpus for `anthropics/skills`, a `/skills`
page rendering a real row, and four new source boundary rules inside
`bun run check:boundaries`.

Implements CONTEXT.md resolved question 3 (D-03, `artifact_type` at one value)
and the hard constraints on schema qualification, non-destructive migration, and
never executing or writing repository content.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/AGD-01-walking-skeleton/CONTEXT.md
@.planning/phases/AGD-00-database-isolation-bootstrap/AGD-00-04-PLAN.md
@src/db/schema.ts
@src/db/client.ts
@scripts/check-boundaries.mjs
@package.json
</context>

<decisions_made_while_planning>

**1. Foreign key columns are `bigint`, not `bigserial`. This corrects RESEARCH.md.**

The schema sketch in RESEARCH.md writes `repositoryId: bigserial('repository_id',
{ mode: 'number' })` and the same for `packageId`. `bigserial` is not a type — it
is shorthand for `bigint` plus its own sequence plus a `DEFAULT nextval(...)`.
Applied to a foreign key it creates a sequence nobody advances and a default
nobody wants, and it makes the column silently defaultable on an insert that
forgot it. Primary keys stay `bigserial`; foreign keys are `bigint('...', { mode:
'number' }).notNull().references(...)`. Everything else in that sketch is taken
verbatim.

**2. All four Phase 1 dependencies are installed here, in wave 1, not where they
are first imported.**

`js-yaml` belongs to the parser plan and `react-markdown` to the rendering plan,
and those two plans run in the same wave. Both would edit `package.json` and
`bun.lock`, which is a merge conflict by construction. One install task in wave 1
removes it. The versions are the ones the legitimacy audit approved, pinned
exactly: `js-yaml@4.3.1` — **not** `5.x`, whose major line is eight weeks old and
which nothing here needs.

**3. `artifact_type` is a table with a foreign key, not a check constraint.**

CONTEXT.md fixes the decision (one value, now). The remaining choice was table
versus `text` with a `CHECK`. A table wins on the only axis that matters here:
Phase 3 adds four types, and adding a row is an `INSERT` while widening a `CHECK`
is `ALTER TABLE ... DROP CONSTRAINT` against a populated table — a destructive
verb that this project's boundary scanner deliberately makes expensive. The seed
row is hand-added to the reviewed migration, which is what the
generate-review-migrate workflow is for.

**4. The tracer's row reaches the page through a seed script, not through a test.**

Database-backed tests write to `agentdock_test` and clean up after themselves, so
they cannot leave a row for a page to render. A fifteen-line
`scripts/seed-fixture.mjs` that calls the real `persistScan()` with the frozen
fixture is the smallest thing that makes the slice genuinely end-to-end, and it
keeps earning its place afterwards: it is how a developer gets realistic data
without spending any of the 60-requests-per-hour budget.

**5. `wshobson/agents` bodies are sampled, not captured whole.**

180 `SKILL.md` files would be committed to prove a `match()` function that reads
paths and never opens a file. `tree.json` alone tests the scale case; bodies are
captured only where `parse()` is exercised. That plan is 01-03's; this plan
captures only `anthropics/skills`, which is what the tracer needs.

**6. Capturing fixtures writes repository content to disk, and that does not
violate ING-05.**

ING-05 constrains the ingestion path — the code that processes a repository a
stranger submitted. `scripts/capture-fixtures.mjs` is a manual developer tool run
once against four repositories chosen by the maintainer, and its output is
committed test data. The boundary rule this plan adds is therefore scoped to
`src/`, excluding test files, which is exactly where the requirement bites.

</decisions_made_while_planning>

<reference>

## Reference A — `src/db/schema.ts` additions

Appended to the existing module. `agentdock`, `AGENTDOCK_SCHEMA` and `schemaMeta`
stay exactly as they are; only the import line grows.

```ts
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
import { sql } from 'drizzle-orm';

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
    // column onto the first.
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
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
    frontmatter: jsonb('frontmatter').notNull().default(sql`'{}'::jsonb`),
    parseStatus: text('parse_status').notNull().default('ok'), // ok | partial | failed
    parseErrors: jsonb('parse_errors').notNull().default(sql`'[]'::jsonb`),
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
```

## Reference B — `src/ingest/types.ts`

```ts
/** Result of parsing one artifact. `failed` still produces a row. */
export type ParseStatus = 'ok' | 'partial' | 'failed';

export type ScannedPackage = {
  type: string; // an artifact_type id; 'skill' in this phase
  sourcePath: string; // 'skills/canvas-design/SKILL.md'
  name: string;
  slug: string;
  summary: string | null;
  licenseText: string | null;
  meta: Record<string, unknown>;
  blobSha: string | null;
  contentHash: string;
  declaredVersion: string | null;
  body: string | null;
  frontmatter: Record<string, unknown>;
  parseStatus: ParseStatus;
  parseErrors: string[];
};

/**
 * Everything one pass over one repository learned. The pipeline produces it, the
 * transaction consumes it. Nothing in between touches the database, and nothing
 * here touches the network — which is what makes persistence testable from a
 * frozen fixture.
 */
export type RepoScan = {
  githubNodeId: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  description: string | null;
  homepage: string | null;
  licenseSpdx: string | null;
  stars: number;
  isFork: boolean;
  isArchived: boolean;
  topics: string[];
  pushedAt: Date | null;
  scannedAt: Date;
  etag: string | null;
  commitSha: string;
  treeTruncated: boolean;
  packages: ScannedPackage[];
};
```

## Reference C — `src/ingest/persist.ts`

```ts
import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';
import type { RepoScan } from './types';

export type PersistResult = {
  repositoryId: number;
  packageIds: number[];
  newVersions: number;
  delisted: number;
};

/**
 * One transaction, three upserts, one delisting.
 *
 * Idempotency is not implemented here — it is delegated to three unique
 * constraints. An application-level "select then insert" races with itself the
 * moment two ingests overlap; ON CONFLICT cannot.
 */
export async function persistScan(scan: RepoScan): Promise<PersistResult> {
  return db.transaction(async (tx) => {
    const [repo] = await tx
      .insert(repository)
      .values({
        githubNodeId: scan.githubNodeId,
        fullName: scan.fullName,
        owner: scan.owner,
        defaultBranch: scan.defaultBranch,
        description: scan.description,
        homepage: scan.homepage,
        licenseSpdx: scan.licenseSpdx,
        stars: scan.stars,
        isFork: scan.isFork,
        isArchived: scan.isArchived,
        topics: scan.topics,
        pushedAt: scan.pushedAt,
        scannedAt: scan.scannedAt,
        etag: scan.etag,
        lastIngestedSha: scan.commitSha,
        treeTruncated: scan.treeTruncated,
      })
      // Keyed on the immutable node id, so a rename arrives as an UPDATE of
      // full_name rather than as a second repository.
      .onConflictDoUpdate({
        target: repository.githubNodeId,
        set: {
          fullName: scan.fullName,
          owner: scan.owner,
          defaultBranch: scan.defaultBranch,
          description: scan.description,
          homepage: scan.homepage,
          licenseSpdx: scan.licenseSpdx,
          stars: scan.stars,
          isFork: scan.isFork,
          isArchived: scan.isArchived,
          topics: scan.topics,
          pushedAt: scan.pushedAt,
          scannedAt: scan.scannedAt,
          etag: scan.etag,
          lastIngestedSha: scan.commitSha,
          treeTruncated: scan.treeTruncated,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    const packageIds: number[] = [];
    let newVersions = 0;

    for (const found of scan.packages) {
      const [pkg] = await tx
        .insert(packageTable)
        .values({
          repositoryId: repo.id,
          type: found.type,
          sourcePath: found.sourcePath,
          name: found.name,
          slug: found.slug,
          summary: found.summary,
          licenseText: found.licenseText,
          meta: found.meta,
        })
        // The array must name the same three columns, in the same order, as the
        // unique('package_identity') constraint.
        .onConflictDoUpdate({
          target: [packageTable.repositoryId, packageTable.type, packageTable.sourcePath],
          set: {
            name: found.name,
            slug: found.slug,
            summary: found.summary,
            licenseText: found.licenseText,
            meta: found.meta,
            delistedAt: null,
            updatedAt: sql`now()`,
          },
        })
        .returning();

      packageIds.push(pkg.id);

      const inserted = await tx
        .insert(packageVersion)
        .values({
          packageId: pkg.id,
          commitSha: scan.commitSha,
          blobSha: found.blobSha,
          contentHash: found.contentHash,
          declaredVersion: found.declaredVersion,
          body: found.body,
          frontmatter: found.frontmatter,
          parseStatus: found.parseStatus,
          parseErrors: found.parseErrors,
        })
        .onConflictDoNothing({
          target: [packageVersion.packageId, packageVersion.contentHash],
        })
        .returning({ id: packageVersion.id });

      newVersions += inserted.length;
    }

    // Same transaction as the upserts. Delisting first would leave a window in
    // which a live package reads as delisted; a separate transaction would leave
    // that window open permanently on a crash.
    const delisted = await tx
      .update(packageTable)
      .set({ delistedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(packageTable.repositoryId, repo.id),
          isNull(packageTable.delistedAt),
          packageIds.length > 0 ? not(inArray(packageTable.id, packageIds)) : sql`true`,
        ),
      )
      .returning({ id: packageTable.id });

    return {
      repositoryId: repo.id,
      packageIds,
      newVersions,
      delisted: delisted.length,
    };
  });
}
```

## Reference D — `src/db/queries/packages.ts`

```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db/client';
import { packageTable, packageVersion, repository } from '@/db/schema';

export type PackageListItem = {
  id: number;
  name: string;
  summary: string | null;
  type: string;
  sourcePath: string;
  fullName: string;
  stars: number;
  commitSha: string | null;
  scannedAt: Date | null;
};

/**
 * cache() dedupes within one render pass, so a page and its generateMetadata do
 * not hit the database twice for the same rows.
 */
export const listPackages = cache(
  async ({ limit = 25, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<
    PackageListItem[]
  > =>
    db
      .select({
        id: packageTable.id,
        name: packageTable.name,
        summary: packageTable.summary,
        type: packageTable.type,
        sourcePath: packageTable.sourcePath,
        fullName: repository.fullName,
        stars: repository.stars,
        scannedAt: repository.scannedAt,
        // Correlated subquery rather than a lateral join: the listing needs one
        // scalar per row, and PRV-01 needs it to be the commit sha.
        commitSha: sql<string | null>`(
          select pv.commit_sha from ${packageVersion} pv
          where pv.package_id = ${packageTable.id}
          order by pv.ingested_at desc limit 1
        )`,
      })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .where(isNull(packageTable.delistedAt))
      .orderBy(desc(packageTable.updatedAt))
      .limit(limit)
      .offset(offset),
);

export const countPackages = cache(async (): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(packageTable)
    .where(isNull(packageTable.delistedAt));
  return row?.n ?? 0;
});

/** github.com/{full_name}/blob/{commit sha}/{path} — never the tree sha. */
export function permalink(fullName: string, commitSha: string, sourcePath: string): string {
  return `https://github.com/${fullName}/blob/${commitSha}/${sourcePath}`;
}
```

## Reference E — `src/app/skills/page.tsx`

Deliberately unstyled. Plan 01-06 owns presentation; this exists to prove a
stored row reaches a page with a resolvable link.

```tsx
import { listPackages, permalink } from '@/db/queries/packages';

// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Skills — AgentDock' };

export default async function SkillsPage() {
  const packages = await listPackages();

  return (
    <main>
      <h1>Skills</h1>
      {packages.length === 0 ? (
        <p>No skills indexed yet.</p>
      ) : (
        <ul>
          {packages.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong> — {p.fullName}
              <code>{p.sourcePath}</code>
              {p.commitSha ? (
                <a href={permalink(p.fullName, p.commitSha, p.sourcePath)}>source</a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

## Reference F — `scripts/capture-fixtures.mjs`

```js
#!/usr/bin/env node
// scripts/capture-fixtures.mjs
//
// MANUAL developer tool. Not part of `bun run ci`, never invoked by a test.
//
// Freezes the corpus the detector, parser and ingestion suites read, pinned to
// commit SHAs so a fixture cannot drift with upstream. Every test that consumes
// this output runs with no network and no token.
//
// It also asserts the finding this whole phase leans on: the sha the Trees API
// returns for a ref name is the COMMIT sha, and github.com/o/r/blob/<that>/path
// resolves. If GitHub ever changes that, this script fails here rather than the
// product failing silently with 404s on every permalink.
//
// Usage: bun scripts/capture-fixtures.mjs [slug ...]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PINS = [
  {
    slug: 'anthropics-skills',
    owner: 'anthropics',
    repo: 'skills',
    sha: 'f17010c9bb483898c1d9c9f42dde2b3a98889434',
    bodies: 'all',
  },
];

const UA = { 'user-agent': 'agentdock-fixture-capture', accept: 'application/vnd.github+json' };
const auth = process.env.GITHUB_TOKEN
  ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : {};

async function json(url) {
  const res = await fetch(url, { headers: { ...UA, ...auth } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function capture(pin) {
  const dir = join('fixtures', pin.slug);
  mkdirSync(join(dir, 'files'), { recursive: true });

  const repo = await json(`https://api.github.com/repos/${pin.owner}/${pin.repo}`);
  const tree = await json(
    `https://api.github.com/repos/${pin.owner}/${pin.repo}/git/trees/${pin.sha}?recursive=1`,
  );

  if (tree.sha !== pin.sha) {
    throw new Error(`${pin.slug}: tree sha ${tree.sha} does not match the pin ${pin.sha}`);
  }

  const skills = tree.tree.filter((e) => e.type === 'blob' && e.path.endsWith('SKILL.md'));
  if (skills.length === 0) throw new Error(`${pin.slug}: no SKILL.md in the tree`);

  // The load-bearing assertion. raw.githubusercontent.com accepts both the tree
  // sha and the commit sha, so only the blob URL can catch the wrong one.
  const probe = `https://github.com/${pin.owner}/${pin.repo}/blob/${pin.sha}/${skills[0].path}`;
  const probeRes = await fetch(probe, { redirect: 'manual' });
  if (probeRes.status !== 200) {
    throw new Error(`permalink assertion failed: ${probe} -> ${probeRes.status}`);
  }

  const wanted = pin.bodies === 'all' ? skills : skills.slice(0, pin.bodies);
  for (const entry of wanted) {
    const raw = `https://raw.githubusercontent.com/${pin.owner}/${pin.repo}/${pin.sha}/${entry.path}`;
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`${raw} -> ${res.status}`);
    writeFileSync(join(dir, 'files', encodeURIComponent(entry.path)), await res.text());
  }

  writeFileSync(join(dir, 'repo.json'), `${JSON.stringify(repo, null, 2)}\n`);
  writeFileSync(join(dir, 'tree.json'), `${JSON.stringify(tree, null, 2)}\n`);
  console.log(
    `${pin.slug}: ${tree.tree.length} entries, ${skills.length} SKILL.md, ` +
      `${wanted.length} bodies captured, permalink 200`,
  );
}

const only = process.argv.slice(2);
for (const pin of PINS) {
  if (only.length > 0 && !only.includes(pin.slug)) continue;
  await capture(pin);
}
```

## Reference G — `scripts/seed-fixture.mjs`

```js
#!/usr/bin/env node
// scripts/seed-fixture.mjs
//
// Puts the frozen anthropics/skills fixture into the database through the real
// persistScan(), so a developer has realistic rows without spending any of the
// 60-requests-per-hour unauthenticated budget. Reads only committed fixture
// files; opens no network connection.
//
// Usage: bun run db:seed

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const dir = 'fixtures/anthropics-skills';
const repo = JSON.parse(readFileSync(`${dir}/repo.json`, 'utf8'));
const tree = JSON.parse(readFileSync(`${dir}/tree.json`, 'utf8'));

const { persistScan } = await import('../src/ingest/persist.ts');
const { sql } = await import('../src/db/client.ts');

const paths = tree.tree
  .filter((e) => e.type === 'blob' && e.path.endsWith('SKILL.md'))
  .slice(0, 3);

const packages = paths.map((entry) => {
  const raw = readFileSync(`${dir}/files/${encodeURIComponent(entry.path)}`, 'utf8');
  const dirName = entry.path.split('/').slice(-2, -1)[0] ?? 'skill';
  return {
    type: 'skill',
    sourcePath: entry.path,
    name: dirName,
    slug: dirName,
    summary: null,
    licenseText: null,
    meta: {},
    blobSha: entry.sha,
    contentHash: createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex'),
    declaredVersion: null,
    body: raw.slice(0, 32 * 1024),
    frontmatter: {},
    parseStatus: 'ok',
    parseErrors: [],
  };
});

const result = await persistScan({
  githubNodeId: repo.node_id,
  fullName: repo.full_name,
  owner: repo.owner.login,
  defaultBranch: repo.default_branch,
  description: repo.description,
  homepage: repo.homepage || null,
  licenseSpdx: repo.license?.spdx_id ?? null,
  stars: repo.stargazers_count,
  isFork: repo.fork,
  isArchived: repo.archived,
  topics: repo.topics ?? [],
  pushedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
  scannedAt: new Date(),
  etag: null,
  commitSha: tree.sha,
  treeTruncated: tree.truncated === true,
  packages,
});

console.log(
  `seeded ${repo.full_name} at ${tree.sha}: ` +
    `${result.packageIds.length} package(s), ${result.newVersions} new version(s)`,
);
await sql.end();
```

## Reference H — `scripts/check-boundaries.mjs`, rule 5

Appended alongside the existing rules; `main()` gains one loop and the summary
line gains one count.

```js
import { readdirSync, statSync } from 'node:fs';

// Rule 5: four properties of application source that no later commit may undo.
// Each is a requirement that is structurally enforceable, so it is enforced here
// rather than remembered.
const SOURCE_RULES = [
  {
    id: 'no-raw-html',
    // REN-01. Without a raw-HTML plugin, markup in a body is never parsed into
    // element nodes at all — HTML is text, not markup. Reintroducing one, or
    // reaching for React's raw-HTML escape hatch, defeats the control.
    pattern: /rehype-raw|dangerouslySetInnerHTML|allowDangerousHtml/,
    message: 'reintroduces raw HTML into the render path',
  },
  {
    id: 'no-execution',
    // ING-10. Nothing from a scanned repository is ever executed.
    pattern: /node:child_process|require\(['"]child_process|\bexecSync\b|\bspawnSync\b|node:vm\b/,
    message: 'can execute a subprocess or evaluate code',
  },
  {
    id: 'no-disk-write',
    // ING-05. Not writing repository content to disk removes the archive
    // extraction and path traversal classes by construction.
    pattern: /writeFileSync|writeFile\s*\(|createWriteStream|appendFileSync|mkdirSync/,
    message: 'writes to disk',
  },
];

// ING-02, in auditable form: the hostnames AgentDock may contact appear in one
// directory, so `git grep` answers "what can this reach" completely.
const HOST_PATTERN = /api\.github\.com|raw\.githubusercontent\.com/;
const HOST_DIR = 'src/github/';

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(name)) continue;
    // Test files read fixtures from disk and name hostile strings on purpose.
    if (/\.test\.(ts|tsx)$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Rule 5, against one source file's text.
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function checkSourceBoundaries(path, text) {
  /** @type {string[]} */
  const problems = [];
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  for (const rule of SOURCE_RULES) {
    if (rule.pattern.test(stripped)) problems.push(`${rule.message} (${rule.id})`);
  }

  const normalized = path.split(sep).join('/');
  if (HOST_PATTERN.test(stripped) && !normalized.startsWith(HOST_DIR)) {
    problems.push(`names a GitHub host outside ${HOST_DIR} (no-host-sprawl)`);
  }

  return problems;
}
```

## Reference I — `src/ingest/persist.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RepoScan, ScannedPackage } from './types';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;
const NODE_ID = 'TEST_NODE_ID_persist_spec';

function scan(overrides: Partial<RepoScan> = {}): RepoScan {
  const pkg: ScannedPackage = {
    type: 'skill',
    sourcePath: 'skills/canvas-design/SKILL.md',
    name: 'canvas-design',
    slug: 'canvas-design',
    summary: 'a summary',
    licenseText: null,
    meta: {},
    blobSha: null,
    contentHash: 'hash-a',
    declaredVersion: null,
    body: 'body',
    frontmatter: { name: 'canvas-design' },
    parseStatus: 'ok',
    parseErrors: [],
  };
  return {
    githubNodeId: NODE_ID,
    fullName: 'anthropics/skills',
    owner: 'anthropics',
    defaultBranch: 'main',
    description: null,
    homepage: null,
    licenseSpdx: null,
    stars: 1,
    isFork: false,
    isArchived: false,
    topics: [],
    pushedAt: null,
    scannedAt: new Date(),
    etag: null,
    commitSha: 'f17010c9bb483898c1d9c9f42dde2b3a98889434',
    treeTruncated: false,
    packages: [pkg],
    ...overrides,
  };
}

describe.skipIf(!DB_URL)('persistScan', () => {
  let persistScan: typeof import('./persist').persistScan;
  let sql: typeof import('@/db/client').sql;

  beforeAll(async () => {
    ({ persistScan } = await import('./persist'));
    ({ sql } = await import('@/db/client'));
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
  });

  afterAll(async () => {
    await sql`DELETE FROM repository WHERE github_node_id = ${NODE_ID}`;
    await sql.end();
  });

  it('writes a repository, a package and a version', async () => {
    const result = await persistScan(scan());
    expect(result.packageIds).toHaveLength(1);
    expect(result.newVersions).toBe(1);
  });

  it('is a no-op when the same scan runs again', async () => {
    const before = await persistScan(scan());
    const after = await persistScan(scan());
    expect(after.repositoryId).toBe(before.repositoryId);
    expect(after.packageIds).toEqual(before.packageIds);
    expect(after.newVersions).toBe(0);
  });

  it('keeps repository identity across a rename', async () => {
    const first = await persistScan(scan());
    const renamed = await persistScan(scan({ fullName: 'anthropics/skills-renamed' }));
    expect(renamed.repositoryId).toBe(first.repositoryId);
  });

  it('mints a new version when content changes and reuses the package row', async () => {
    const first = await persistScan(scan());
    const changed = scan();
    changed.packages[0].contentHash = 'hash-b';
    const second = await persistScan(changed);
    expect(second.packageIds).toEqual(first.packageIds);
    expect(second.newVersions).toBe(1);
  });

  it('delists a package that vanished, in the same transaction', async () => {
    await persistScan(scan());
    const emptied = await persistScan(scan({ packages: [] }));
    expect(emptied.delisted).toBe(1);

    const relisted = await persistScan(scan());
    const [row] = await sql<{ delisted_at: Date | null }[]>`
      SELECT delisted_at FROM package WHERE id = ${relisted.packageIds[0]}
    `;
    expect(row.delisted_at).toBeNull();
  });
});
```

</reference>

<tasks>

<task type="tracer">
  <name>Task 1: One real skill — GitHub's frozen bytes to a rendered permalink</name>
  <precondition>`.env` supplies a `DATABASE_URL` that authenticates as `agentdock_app`, the `agentdock` and `agentdock_test` schemas exist (Phase 0 complete), and `api.github.com` is reachable from this machine.</precondition>
  <reversibility rating="costly">The identity keys chosen here — repository on GitHub's node id, package on the (repository, type, source_path) triple, version on (package, content hash) — become the shape every later phase reads and writes. Changing them after Phase 2 stores real corpus rows is a data migration, not an edit. Rated costly rather than one-way because at this point the tables hold one seeded repository: today it is a regenerate, tomorrow it is a backfill. The choice is RESEARCH.md's, measured against the live API, and is recorded rather than re-opened.</reversibility>
  <files>package.json, scripts/capture-fixtures.mjs, scripts/seed-fixture.mjs, src/db/schema.ts, src/ingest/types.ts, src/ingest/persist.ts, src/db/queries/packages.ts, src/app/skills/page.tsx, fixtures/anthropics-skills/, drizzle/</files>
  <action>
    Wire one path through every layer this phase touches, in this order, and stop
    at one repository.

    First install the four dependencies this phase needs, at the exact versions
    the legitimacy audit approved, so that no later plan in this wave has to edit
    the manifest: `bun add react-markdown@10.1.0 remark-gfm@4.0.1
    rehype-sanitize@6.0.0 js-yaml@4.3.1` then `bun add -d @types/js-yaml`.

    The YAML pin is deliberate and must be recorded in the summary: the current
    major of that package is eight weeks old with five patches behind it, and
    this is a parser that eats attacker-controlled supply-chain input. The 4.x
    line is five years mature, still maintained, and every safety property this
    phase depends on was verified against 4.3.1 directly. A future `bun update`
    must not be allowed to jump it silently. Check the resolved version in
    `node_modules`, not the range in the manifest — a manifest can say one thing
    while the installed tree holds another, and the previous major of that parser
    is the one whose default load was the unsafe path. Do not install a raw-HTML rehype
    plugin, a frontmatter convenience wrapper, a syntax highlighter, or an HTTP
    mocking library — the research rejected each by name and gave the reason.

    Then write `scripts/capture-fixtures.mjs` exactly as Reference F, add
    `"fixtures:capture": "bun scripts/capture-fixtures.mjs"` to the scripts block,
    and run it. It spends two of the sixty hourly unauthenticated requests and
    writes `fixtures/anthropics-skills/` — repository metadata, the 501-entry
    tree, and all 18 skill bodies, every one pinned to
    `f17010c9bb483898c1d9c9f42dde2b3a98889434`.

    That script contains the assertion this phase rests on. The Trees API names
    its parameter after a tree, and the response carries an adjacent, plausible,
    forty-hex value that is the wrong one; a permalink built on it returns 404 on
    every page while the raw host happily serves both. The script resolves a real
    blob URL and refuses to write a fixture unless it returns 200. If that
    assertion fails, stop and report it rather than removing it — it means the
    undocumented behaviour this phase was designed around has changed, and the
    fallback is one extra core call to the commits endpoint.

    Then add the five tables to `src/db/schema.ts` exactly as Reference A,
    appending to the existing module and leaving `agentdock`, `AGENTDOCK_SCHEMA`
    and `schemaMeta` untouched. Note that the foreign key columns are `bigint`,
    not the `bigserial` the research sketch used — see the planning decisions
    above.

    Then run `bun run db:generate` and read the SQL it produced before anything
    applies it. Confirm every `CREATE TABLE`, `ALTER TABLE` and `CREATE INDEX`
    target is qualified to the owned schema, that the expression index over the
    lowercased full name came out as an index and not as a column, and that
    nothing you did not ask for is in the file. Then hand-add one line seeding the
    single artifact type: a schema-qualified `INSERT` of id `skill` and label
    `Agent Skill`, with `ON CONFLICT DO NOTHING` so re-running the migration is
    safe. Editing generated SQL before applying it is what the
    generate-review-migrate workflow exists for; the snapshot Drizzle wrote
    alongside is unaffected, so later generates stay correct.

    Then run `bun run check:boundaries` — it must pass and report one more
    migration file than before — and `bun run db:migrate`. Then run `bun run
    db:test:setup` so the test schema carries the new tables too.

    Then write `src/ingest/types.ts`, `src/ingest/persist.ts` and
    `src/db/queries/packages.ts` exactly as References B, C and D. The scan type
    is the seam: everything above it is network and parsing, everything below it
    is one transaction, and neither half can see the other. That is what lets
    persistence be tested from a frozen fixture with no HTTP at all.

    Then write `scripts/seed-fixture.mjs` exactly as Reference G, add
    `"db:seed": "bun scripts/seed-fixture.mjs"` to the scripts block, and run it.
    It reads committed fixture bytes and calls the real persistence function; it
    opens no network connection. The frontmatter it stores is empty and the name
    it derives comes from the directory — parsing arrives in plan 01-03, and
    pretending otherwise here would be scaffolding to delete.

    Then write `src/app/skills/page.tsx` exactly as Reference E, including the
    force-dynamic export and its comment. A page whose only async work is a
    database query has no request-time API in it, so Next will happily prerender
    it at build time, and `next build` runs in CI where there is no database.

    Finally start the built server and confirm the page lists the seeded skills
    and that the source link it renders resolves to the real file at the real
    commit.

    Do not add a second artifact type, a search column, a trigram index, a submit
    form, a detail page, or any styling. The point of this slice is that it is
    thin enough that a wrong assumption costs one commit.
  </action>
  <verify>
    <automated>grep -q '"version": "4\.' node_modules/js-yaml/package.json &amp;&amp; bun run fixtures:capture &amp;&amp; test -f fixtures/anthropics-skills/tree.json &amp;&amp; bun run db:generate &amp;&amp; bun run check:boundaries &amp;&amp; bun run db:migrate &amp;&amp; bun run db:test:setup &amp;&amp; bun run db:seed &amp;&amp; bun run typecheck &amp;&amp; bun run build &amp;&amp; sh -c 'PORT=3021 bun run start &gt;/tmp/agd-01-01.log 2&gt;&amp;1 &amp; SRV=$!; for i in $(seq 1 40); do curl -sf http://localhost:3021/skills &gt;/dev/null 2&gt;&amp;1 &amp;&amp; break; sleep 1; done; BODY=$(curl -s http://localhost:3021/skills); kill $SRV 2&gt;/dev/null; echo "$BODY" | grep -q "blob/f17010c9bb483898c1d9c9f42dde2b3a98889434/" || exit 1; LINK=$(echo "$BODY" | grep -o "https://github.com/anthropics/skills/blob/[^\"]*SKILL.md" | head -1); test -n "$LINK" || exit 1; test "$(curl -s -o /dev/null -w %{http_code} "$LINK")" = 200'</automated>
  </verify>
  <done>The frozen fixture exists at the pinned SHA and its permalink assertion passed. One reviewed migration created five tables in `agentdock` and seeded the single artifact type. The seed script persisted real skills through `persistScan`. `/skills` renders them, and the `blob/<commit-sha>/<path>` link it prints returns 200 from github.com.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Prove idempotency, rename survival and delisting against the real database</name>
  <files>src/ingest/persist.test.ts</files>
  <behavior>
    - Persisting a scan writes one repository, one package, one version.
    - Persisting the identical scan again returns the same ids and mints zero new versions — the unique constraints do the work, not a lookup.
    - A scan whose `fullName` changed but whose node id did not updates the existing repository rather than creating a second one.
    - A scan whose content hash changed reuses the package row and adds one version.
    - A package absent from a later scan is delisted; a package that returns is relisted with a null `delisted_at`.
  </behavior>
  <action>
    Write `src/ingest/persist.test.ts` exactly as Reference I.

    The file assigns the test schema into the environment before importing
    anything that reads it, then imports the schema and client modules
    dynamically. Both modules resolve the schema name at import time, so a static
    import would bind the development schema and this suite would write test rows
    into development data. Vitest runs each file in its own worker, so the
    assignment cannot leak into another suite.

    Every row this suite writes is keyed on one sentinel node id and removed in
    both `beforeAll` and `afterAll`, so a suite killed midway leaves nothing
    behind and the next run starts clean regardless.

    The whole suite is guarded on the database URL being present, so `bun run ci`
    still passes on a machine or a runner without one — and skips visibly in the
    output rather than silently reporting success over nothing.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; CI=1 bun run test 2&gt;&amp;1 | grep -qi skip</automated>
  </verify>
  <done>All five persistence properties pass against `agentdock_test`, the development schema is untouched, and the suite skips visibly when no database URL is present.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Four source boundaries the build refuses to let a later commit cross</name>
  <files>scripts/check-boundaries.mjs, scripts/check-boundaries.test.ts</files>
  <behavior>
    - A source file that reintroduces a raw-HTML render path is reported.
    - A source file that can spawn a subprocess or evaluate code is reported.
    - A source file that writes to disk is reported.
    - A source file outside the GitHub client directory that names a GitHub hostname is reported.
    - The same text inside the GitHub client directory is accepted.
    - A file whose only match is inside a comment is accepted, so a header explaining the rule cannot fail the rule.
    - Test files are not scanned: they name hostile strings and read fixtures from disk on purpose.
  </behavior>
  <action>
    Extend `scripts/check-boundaries.mjs` with the fifth rule exactly as Reference
    H, keeping the existing four rules and their exports untouched. Wire it into
    `main()`: walk the source tree, collect the problems per file with the file
    path as the prefix, and extend the inspection summary line with the number of
    source files scanned, in the same style as the existing counts.

    These four properties are each a requirement that happens to be structurally
    enforceable. The alternative is remembering them during review in month six,
    which is how every one of them is actually lost. Because the rule strips
    comments before matching, the header explaining what is forbidden does not
    itself trip the check — a scanner that cannot describe its own rule is a
    scanner people delete.

    Then add cases to `scripts/check-boundaries.test.ts` covering every behaviour
    above, calling the exported function with inline strings rather than reading
    the real tree, so the suite needs no filesystem layout and stays fast.

    Note for the reviewer: the fixture capture and seed scripts written in task 1
    both touch the filesystem and both name GitHub hosts. They live in `scripts/`,
    which this rule does not scan, and that is deliberate — the requirement
    constrains the code that processes a repository a stranger submitted, not a
    manual tool the maintainer runs against four repositories they chose.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; bun run check:boundaries &amp;&amp; bun run ci</automated>
  </verify>
  <done>`bun run check:boundaries` reports the source files it scanned and passes on the current tree. Its unit tests cover all seven behaviours, including the comment-only and test-file exemptions. `bun run ci` passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TypeScript schema module → emitted DDL | A table declared off the schema object, or a hand-edited migration, can land an object where AgentDock has no business writing. |
| Frozen fixture bytes → the database | The fixture is real repository content: attacker-shaped strings reach `jsonb`, `text` and a rendered page through this path. |
| Application source → the network and the filesystem | A later commit can add an execution path, a disk write, or a call to a host nobody reviewed, and nothing in review reliably catches it. |
| Ingest result → stored rows | A non-transactional write leaves a repository half-updated and a live package reading as delisted. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-01 | Tampering | `src/db/schema.ts` and the generated migration | critical | mitigate | Every table hangs off the existing `pgSchema()` object; the boundary scanner rejects a bare table builder and any unqualified or foreign-schema target; the migration is read by a human before `db:migrate` runs. |
| T-01-02 | Elevation of Privilege | future application source | critical | mitigate | Rule 5 `no-execution` fails the build on a subprocess or code-evaluation import anywhere in `src/`, so ING-10 is enforced by CI rather than by memory. |
| T-01-03 | Information Disclosure | future application source | high | mitigate | Rule 5 `no-host-sprawl` confines both GitHub hostnames to `src/github/`, making `git grep` a complete answer to "what can this process contact". |
| T-01-04 | Tampering | future application source | high | mitigate | Rule 5 `no-disk-write` fails the build on a filesystem write outside tests, so the archive-extraction and path-traversal classes stay eliminated by construction. |
| T-01-05 | Tampering | future application source | high | mitigate | Rule 5 `no-raw-html` fails the build if a raw-HTML render path or React's raw-markup escape hatch appears in `src/`, protecting REN-01 before plan 01-04 builds on it. |
| T-01-06 | Tampering | `persistScan` transaction | high | mitigate | One `db.transaction`: upserts and delisting commit together, so a crash cannot leave a live package marked delisted or a repository half-updated. |
| T-01-07 | Spoofing | repository identity | high | mitigate | Identity is GitHub's immutable node id, not the mutable full name, so a rename or transfer cannot be used to graft content onto another repository's page. A test drives the rename case. |
| T-01-08 | Denial of Service | `package_version` growth | medium | mitigate | Version identity is the content hash under a unique constraint, so a re-ingest loop inserts nothing; the body column stores a capped excerpt rather than a mirror. |
| T-01-09 | Denial of Service | build-time database access | medium | mitigate | `force-dynamic` on `/skills` keeps the page out of static generation, so `next build` needs no database and CI needs no credential. |
| T-01-10 | Tampering | supply chain — four new npm packages | high | mitigate | Every version is pinned exactly and taken from the legitimacy audit; `postinstall` is null for all four; the YAML pin deliberately stays one major behind and the reason is recorded in the summary so a future update is a decision rather than an accident. |
| T-01-11 | Information Disclosure | committed fixture content | low | accept | The fixtures are public repository files at public commits. They are stored to remove the network from the test suite; nothing private is captured and no credential is written. |
</threat_model>

<verification>
1. `fixtures/anthropics-skills/` holds `repo.json`, `tree.json` and 18 bodies, and the capture script's blob-permalink assertion passed at the pinned SHA.
2. `drizzle/` gained exactly one migration; every target in it is qualified to `agentdock`, and it seeds one `artifact_type` row.
3. `bun run check:boundaries` passes and reports the migration count, the schema module, and the number of source files scanned.
4. `bun run db:migrate` and `bun run db:test:setup` both succeed; the five tables exist in both schemas.
5. `bun run db:seed` persists real skills through `persistScan` with no network access.
6. `/skills` renders those rows, and the permalink it prints returns 200 from github.com.
7. Persistence tests prove idempotency, rename survival, version minting and delisting against `agentdock_test`, and skip visibly with no database URL.
8. Boundary-rule tests cover all four source rules plus the comment-only and test-file exemptions.
9. `bun run ci` passes.
</verification>

<success_criteria>
- **DAT-01** — a repository row is keyed on GitHub's immutable node id; a scan carrying a changed full name updates that row instead of creating a second, proven by test.
- **DAT-02** — package identity is `(repository_id, type, source_path)` under a unique constraint; a repeat scan returns the same package ids.
- **DAT-03** — version identity is `(package_id, content_hash)`; an identical re-ingest inserts nothing, enforced by the constraint rather than by a lookup.
- **DAT-04** — `commit_sha`, `scanned_at`, `etag`, `content_hash` and `license_spdx` all exist and are written from the first migration.
- **DAT-05** — type-specific fields live in `meta jsonb` behind the `artifact_type` dimension, so Phase 3's four types add no columns to `package`.
- **DAT-06** — `repository_denylist` exists as a table, so a removal outlives any re-crawl.
- **PRV-01** — the stored SHA is the commit SHA, and the rendered `blob/<sha>/<path>` link is proven to resolve rather than assumed to.
- **ING-05** / **ING-10** — enforced by CI: application source that writes to disk or can execute a subprocess fails `bun run check:boundaries`.
- **DET-10** — the frozen corpus exists, so every later detector test runs with no network and no token.
- CONTEXT.md resolved question 3 (D-03) — `artifact_type` exists with exactly one row.
</success_criteria>

<output>
Create `.planning/phases/AGD-01-walking-skeleton/01-01-SUMMARY.md` when done.
Record the generated migration filename, the `check-boundaries` inspection counts,
the captured fixture's entry and body counts, the YAML version pin and why it is
one major behind, and the number of core API requests the capture spent. Record no
credential.
</output>
