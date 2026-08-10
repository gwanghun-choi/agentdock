---
phase: AGD-00-database-isolation-bootstrap
plan: 03
type: execute
wave: 2
depends_on: ["00-01", "00-02"]
files_modified:
  - scripts/check-boundaries.mjs
  - scripts/check-boundaries.test.ts
  - scripts/sql/dev-reset.sql
  - scripts/dev-reset.mjs
  - .github/workflows/ci.yml
autonomous: true
requirements: [FND-03, FND-04, FND-05]

estimate:
  tokens: 38000
  raw_tokens: 38000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A migration file that names any schema other than agentdock fails the build"
    - "A migration file whose CREATE or ALTER target is not schema-qualified fails the build"
    - "A migration file containing a destructive verb fails the build unless it carries an explicit review marker"
    - "A package.json script that invokes a live-diffing migration command fails the build"
    - "A schema module that declares a table without pgSchema() fails the build"
    - "A developer can empty the agentdock schema with one command, and that command cannot affect any other schema"
    - "Every one of these checks runs on every push, using the same command a developer runs locally"
  artifacts:
    - path: "scripts/check-boundaries.mjs"
      provides: "Four boundary rules as pure exported functions plus a CLI entry point"
      exports: ["checkMigrationSql", "checkPackageScripts", "checkSchemaModule", "OWNED_SCHEMA"]
      min_lines: 100
    - path: "scripts/check-boundaries.test.ts"
      provides: "Hostile fixtures for every rule, proving each one actually rejects"
      min_lines: 60
    - path: "scripts/sql/dev-reset.sql"
      provides: "Catalog-driven reset confined to one hardcoded schema name, gated on a session setting"
      contains: "agentdock.allow_reset"
      min_lines: 30
    - path: ".github/workflows/ci.yml"
      provides: "Push and pull-request job that runs the same bun run ci as a developer"
      contains: "bun run ci"
      min_lines: 12
  key_links:
    - from: ".github/workflows/ci.yml"
      to: "package.json"
      via: "the workflow's only project step is `bun run ci`, so CI and local cannot drift apart"
      pattern: "bun run ci"
    - from: "scripts/dev-reset.mjs"
      to: "scripts/sql/dev-reset.sql"
      via: "sets agentdock.allow_reset on the connection, then executes the SQL file the guard requires"
      pattern: "allow_reset"
    - from: "scripts/check-boundaries.test.ts"
      to: "scripts/check-boundaries.mjs"
      via: "imports the pure rule functions and feeds each a fixture that must be rejected"
      pattern: "checkMigrationSql"
---

<objective>
Build the guards that must exist before the first migration is ever generated:
a scanner that refuses any generated SQL capable of reaching outside the
`agentdock` schema, a developer reset that can only empty that one schema, and a
CI job that runs both on every push.

Purpose: the database boundary from plan 00-01 turns a catastrophe into a
permission error. These guards catch the same class of mistake one step earlier,
while it is still a diff a human can read — and they are the reason the
`drizzle-kit generate` → review → `migrate` workflow is trustworthy rather than
merely intended. This plan runs before plan 00-04 because a scanner written after
the first migration is a scanner written to accept whatever that migration
happened to contain.

Output: `bun run check:boundaries` and `bun run db:reset`, both wired into
`bun run ci`, which GitHub Actions runs on every push.

Implements CONTEXT.md confirmed decision 4 (defense in depth at the application
layer, not `search_path` alone) and decision 7's requirement that `push` and
`pull` be unreachable.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/AGD-00-database-isolation-bootstrap/CONTEXT.md
@package.json
</context>

<decisions_made_while_planning>

**1. The scanner uses an allowlist of schema names, not a denylist.**

FND-05 asks for a check that fails when generated SQL references `public` or the
co-tenant schema. Implementing that literally means the guard is only as current
as the list of schemas someone remembered to add. Instead the scanner collects
every schema name the SQL mentions and rejects anything that is not `agentdock`.
That is a strict superset of the requirement, and it keeps working the day a
third application adds a fourth schema to this instance.

`pg_catalog` is the one other permitted name: it is the read-only system
namespace, nobody can write to it, and a migration that qualifies a system
function is not a boundary escape.

**2. "Unreviewed DROP" is made concrete rather than left to judgement.**

FND-05 says CI fails on "an unreviewed `DROP`". A destructive verb is rejected
unless the file carries the marker `agentdock:reviewed-destructive` with a
reason. That turns "unreviewed" from a state of mind into a line in the diff,
and it means dropping a column later is possible without disabling the guard.

**3. The reset empties the schema; it does not drop and recreate it.**

ARCHITECTURE.md's recipe is `DROP SCHEMA agentdock CASCADE; CREATE SCHEMA
agentdock AUTHORIZATION agentdock_app;`. The second statement cannot work.
`mcpdb` has a NULL `datacl`, so the default database ACL applies and `PUBLIC`
holds CONNECT and TEMPORARY but **not** CREATE — `agentdock_app` therefore has
no way to create a schema, and a reset built on that recipe would destroy the
schema and be unable to bring it back without another superuser session.

The reset instead drops every object *inside* the schema, generated from a
catalog query filtered to the literal name. Same outcome, and it stays inside
what the role can actually do.

**4. GitHub Actions belongs in this phase, and the reasoning is short.**

FND-05 is written as a statement about CI, so without a runner the requirement is
satisfied only in spirit. The repository already has a GitHub remote, so a
workflow added now actually executes rather than sitting dormant. And the cost is
genuinely near zero: the workflow's only project step is `bun run ci`, the same
command a developer runs, so there is no second list of checks to keep in sync —
which is the usual reason people defer CI and the usual reason it drifts once
added. Phase 1 extends the existing job for QUA-08 rather than introducing CI
under deadline.

No database is involved: all four rules read files, and the tests are pure. The
workflow needs no secret, which is itself worth preserving.

</decisions_made_while_planning>

<reference>

## Reference A — `scripts/check-boundaries.mjs`

Plain ESM with no build step, so it runs identically under `node` and under
`bun`, and so the rules stay importable by a test file. Every rule is a pure
function taking text and returning a list of problems.

```js
#!/usr/bin/env node
// scripts/check-boundaries.mjs
//
// Refuses to let AgentDock's tooling reach outside the `agentdock` schema.
// Run by `bun run check:boundaries`, by `bun run ci`, and by CI on every push.
// Exit 0 means all four rules below hold.
//
//   1. Every schema a committed migration names is one AgentDock owns.
//   2. Every CREATE/ALTER target in a migration is schema-qualified.
//   3. A destructive verb needs an explicit review marker in the same file.
//   4. No package.json script reaches a live-diffing migration command, and
//      every Drizzle table hangs off pgSchema().

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OWNED_SCHEMA = 'agentdock';

// pg_catalog is the read-only system namespace: qualifying a system function is
// not a boundary escape, and nothing can write to it.
const ALLOWED_SCHEMAS = new Set([OWNED_SCHEMA, 'pg_catalog']);

const REVIEW_MARKER = 'agentdock:reviewed-destructive';

// CREATE/ALTER SCHEMA is in here on purpose. agentdock_app has no CREATE on the
// database, so a migration containing one cannot succeed — and drizzle-kit emits
// exactly that statement for a pgSchema() in the first migration it generates.
// Requiring a marker turns a confusing apply-time failure into a review-time stop.
const DESTRUCTIVE =
  /\b(DROP|TRUNCATE|GRANT|REVOKE|CREATE\s+ROLE|ALTER\s+ROLE|CREATE\s+SCHEMA|ALTER\s+SCHEMA|CREATE\s+EXTENSION|CREATE\s+DATABASE)\b/i;

const QUALIFIED_TARGETS = [
  ['CREATE TABLE', /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi],
  ['ALTER TABLE', /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\S+)/gi],
  ['CREATE TYPE', /\bCREATE\s+TYPE\s+(\S+)/gi],
  ['CREATE VIEW', /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\S+)/gi],
  ['CREATE SEQUENCE', /\bCREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi],
  [
    'CREATE INDEX ... ON',
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(\S+)/gi,
  ],
];

/** Drops -- line comments and block comments so rules match SQL, not prose. */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function unquote(identifier) {
  return identifier.replace(/^[("]+|[)";,]+$/g, '');
}

/** Every schema name the SQL mentions, as a qualifier or in a SCHEMA statement. */
export function schemasReferenced(sql) {
  const found = new Set();
  for (const m of sql.matchAll(/(?:"([A-Za-z_][\w$]*)"|\b([A-Za-z_][\w$]*))\s*\.\s*["A-Za-z_]/g)) {
    found.add(m[1] ?? m[2]);
  }
  for (const m of sql.matchAll(
    /\b(?:CREATE|DROP|ALTER)\s+SCHEMA\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([A-Za-z_][\w$]*)"?/gi,
  )) {
    found.add(m[1]);
  }
  return found;
}

/** Rules 1-3, against one migration file's text. */
export function checkMigrationSql(rawSql, ownedSchema = OWNED_SCHEMA) {
  const problems = [];
  const sql = stripSqlComments(rawSql);
  const allowed = new Set([...ALLOWED_SCHEMAS, ownedSchema]);

  for (const schema of schemasReferenced(sql)) {
    if (!allowed.has(schema)) {
      problems.push(`names schema "${schema}", which AgentDock does not own`);
    }
  }

  for (const [label, re] of QUALIFIED_TARGETS) {
    for (const m of sql.matchAll(re)) {
      const target = unquote(m[1]);
      if (!target.includes('.')) {
        problems.push(`${label} target "${target}" is not schema-qualified`);
        continue;
      }
      const schema = unquote(target.split('.')[0]);
      if (schema !== ownedSchema) {
        problems.push(`${label} target "${target}" is outside schema "${ownedSchema}"`);
      }
    }
  }

  const destructive = sql.match(DESTRUCTIVE);
  if (destructive && !rawSql.includes(REVIEW_MARKER)) {
    problems.push(
      `contains "${destructive[0]}" without a review marker. ` +
        `If it is intended, add a comment containing "${REVIEW_MARKER}: <reason>".`,
    );
  }

  return problems;
}

/** Rule 4a: no reachable command that diffs live database state. */
export function checkPackageScripts(packageJsonText) {
  const problems = [];
  const scripts = JSON.parse(packageJsonText).scripts ?? {};
  for (const [name, body] of Object.entries(scripts)) {
    if (/drizzle-kit\s+(push|pull)/i.test(body)) {
      problems.push(`script "${name}" invokes a migration command that diffs live database state`);
    }
    if (/^db:(push|pull)$/i.test(name)) {
      problems.push(`script "${name}" uses a banned script name`);
    }
  }
  return problems;
}

/** Rule 4b: every table hangs off pgSchema(), never a bare table builder. */
export function checkSchemaModule(text) {
  const problems = [];
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  if (!/pgSchema\s*\(/.test(stripped)) {
    problems.push('does not call pgSchema(); tables would land in the default schema');
  }
  if (/(^|[^.\w])pgTable\s*\(/.test(stripped)) {
    problems.push('calls a bare table builder; every table must hang off the pgSchema() object');
  }
  return problems;
}

function main() {
  const problems = [];
  let migrationsChecked = 0;

  const migrationsDir = process.env.AGENTDOCK_MIGRATIONS_OUT ?? 'drizzle';
  if (existsSync(migrationsDir)) {
    for (const file of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
      migrationsChecked += 1;
      for (const problem of checkMigrationSql(readFileSync(join(migrationsDir, file), 'utf8'))) {
        problems.push(`${migrationsDir}/${file}: ${problem}`);
      }
    }
  }

  for (const problem of checkPackageScripts(readFileSync('package.json', 'utf8'))) {
    problems.push(`package.json: ${problem}`);
  }

  const schemaPath = 'src/db/schema.ts';
  const schemaChecked = existsSync(schemaPath);
  if (schemaChecked) {
    for (const problem of checkSchemaModule(readFileSync(schemaPath, 'utf8'))) {
      problems.push(`${schemaPath}: ${problem}`);
    }
  }

  // Say what was inspected, so "0 problems" over 0 files is visible rather than
  // mistaken for a pass.
  console.log(
    `check-boundaries: ${migrationsChecked} migration file(s), package.json, ` +
      `${schemaChecked ? '1' : '0'} schema module`,
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} boundary problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-boundaries: OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

## Reference B — `scripts/check-boundaries.test.ts`

Every rule gets a fixture that must be rejected and one that must pass. The
fixtures are inline strings; a scanner tested only against the project's own
correct migrations proves nothing.

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkMigrationSql,
  checkPackageScripts,
  checkSchemaModule,
} from './check-boundaries.mjs';

const GOOD = `
CREATE TABLE "agentdock"."schema_meta" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL
);
CREATE INDEX "schema_meta_value_idx" ON "agentdock"."schema_meta" ("value");
`;

describe('checkMigrationSql', () => {
  it('accepts a fully qualified migration inside the owned schema', () => {
    expect(checkMigrationSql(GOOD)).toEqual([]);
  });

  it('rejects a statement naming a schema AgentDock does not own', () => {
    const problems = checkMigrationSql('CREATE TABLE "didim_mcp"."mcp_tools" ("id" int);');
    expect(problems.join(' ')).toMatch(/does not own/);
  });

  it('rejects a schema-qualified reference to public', () => {
    const problems = checkMigrationSql('ALTER TABLE "public"."users" ADD COLUMN "x" int;');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects an unqualified target', () => {
    const problems = checkMigrationSql('CREATE TABLE "packages" ("id" int);');
    expect(problems.join(' ')).toMatch(/not schema-qualified/);
  });

  it('rejects an unqualified index target', () => {
    const problems = checkMigrationSql('CREATE INDEX "i" ON "packages" ("id");');
    expect(problems.join(' ')).toMatch(/not schema-qualified/);
  });

  it('rejects a destructive verb with no review marker', () => {
    const problems = checkMigrationSql('DROP TABLE "agentdock"."schema_meta";');
    expect(problems.join(' ')).toMatch(/review marker/);
  });

  it('accepts a destructive verb that carries a review marker', () => {
    const sql =
      '-- agentdock:reviewed-destructive: column replaced in the same migration\n' +
      'ALTER TABLE "agentdock"."schema_meta" DROP COLUMN "value";';
    expect(checkMigrationSql(sql)).toEqual([]);
  });

  it('does not let a comment smuggle in a forbidden schema name', () => {
    expect(checkMigrationSql(`-- unrelated note about public.foo\n${GOOD}`)).toEqual([]);
  });

  it('rejects CREATE SCHEMA, which the application role cannot execute', () => {
    const problems = checkMigrationSql(`CREATE SCHEMA "agentdock";\n${GOOD}`);
    expect(problems.join(' ')).toMatch(/review marker/);
  });
});

describe('checkPackageScripts', () => {
  it('accepts this repository as committed', () => {
    expect(checkPackageScripts(readFileSync('package.json', 'utf8'))).toEqual([]);
  });

  it('rejects a script that diffs live database state', () => {
    const problems = checkPackageScripts('{"scripts":{"sync":"drizzle-kit push"}}');
    expect(problems.length).toBe(1);
  });

  it('rejects a banned script name even with a harmless body', () => {
    const problems = checkPackageScripts('{"scripts":{"db:push":"echo no"}}');
    expect(problems.length).toBe(1);
  });
});

describe('checkSchemaModule', () => {
  it('rejects a module with no pgSchema call', () => {
    const problems = checkSchemaModule("export const t = pgTable('x', {});");
    expect(problems.length).toBe(2);
  });

  it('accepts a module where every table hangs off pgSchema', () => {
    const source =
      "export const agentdock = pgSchema('agentdock');\n" +
      "export const meta = agentdock.table('schema_meta', {});";
    expect(checkSchemaModule(source)).toEqual([]);
  });
});
```

## Reference C — `scripts/sql/dev-reset.sql`

```sql
-- scripts/sql/dev-reset.sql
--
-- Empties the `agentdock` schema. Run through `bun run db:reset --confirm`,
-- which connects as agentdock_app and sets the session flag this file requires.
--
-- Four independent things stop this from reaching another schema:
--   1. the schema name is a literal here; this file takes no parameter, so
--      there is no substitution that could point it elsewhere
--   2. every statement executed is generated from a catalog query filtered to
--      that same literal
--   3. the connecting role owns nothing outside agentdock and agentdock_test,
--      so a statement that escaped 1 and 2 still fails with a permission error
--   4. the session flag and the database name are both asserted first
--
-- The schema itself is deliberately not dropped: agentdock_app has no CREATE
-- privilege on the database and could not recreate it without another
-- superuser session.

DO $$
DECLARE stmt text;
BEGIN
  IF current_database() <> 'mcpdb' THEN
    RAISE EXCEPTION 'Refusing to reset: current_database() is %, expected mcpdb', current_database();
  END IF;

  IF current_setting('agentdock.allow_reset', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to reset: this session did not set agentdock.allow_reset';
  END IF;

  FOR stmt IN
      SELECT format('DROP TABLE IF EXISTS agentdock.%I CASCADE', tablename)
        FROM pg_tables  WHERE schemaname = 'agentdock'
    UNION ALL
      SELECT format('DROP VIEW IF EXISTS agentdock.%I CASCADE', viewname)
        FROM pg_views   WHERE schemaname = 'agentdock'
    UNION ALL
      SELECT format('DROP TYPE IF EXISTS agentdock.%I CASCADE', t.typname)
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'agentdock' AND t.typtype = 'e'
  LOOP
    RAISE NOTICE '%', stmt;
    EXECUTE stmt;
  END LOOP;
END $$;
```

## Reference D — `scripts/dev-reset.mjs`

```js
#!/usr/bin/env node
// scripts/dev-reset.mjs
//
// Empties the agentdock schema by running scripts/sql/dev-reset.sql as
// agentdock_app. Bun loads .env before launching this, so AGENTDOCK_DATABASE_URL
// is already in the environment.
//
//   bun run db:reset --confirm

import { readFileSync } from 'node:fs';
import postgres from 'postgres';

if (!process.argv.includes('--confirm')) {
  console.error('Refusing to reset. This destroys every table in the agentdock schema.');
  console.error('Re-run as: bun run db:reset --confirm');
  process.exit(1);
}

const url = process.env.AGENTDOCK_DATABASE_URL;
if (!url) {
  console.error('AGENTDOCK_DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  connection: { search_path: 'agentdock' },
  onnotice: (notice) => console.log(notice.message),
});

try {
  await sql.unsafe("SET agentdock.allow_reset = 'yes'");
  await sql.unsafe(readFileSync(new URL('./sql/dev-reset.sql', import.meta.url), 'utf8'));
  console.log('agentdock schema emptied. Run `bun run db:migrate` to rebuild it.');
} finally {
  await sql.end();
}
```

## Reference E — `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - run: bun install --frozen-lockfile

      # The migration boundary scan, lint, type-check, and tests — the same
      # single command a developer runs locally, so the two cannot drift.
      # No database and no secret are involved: every check reads files.
      - run: bun run ci
```

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The boundary scanner and its hostile fixtures</name>
  <files>scripts/check-boundaries.mjs, scripts/check-boundaries.test.ts</files>
  <behavior>
    - A fully qualified migration inside the owned schema produces no problems.
    - A statement naming any schema AgentDock does not own is rejected, and the message names the offending schema.
    - A CREATE or ALTER target with no schema qualifier is rejected, including the ON target of an index.
    - A destructive verb is rejected unless the file carries the review marker; with the marker, the same statement passes.
    - A `CREATE SCHEMA` statement is rejected, because the application role has no privilege to run one.
    - A forbidden schema name appearing only inside a comment does not trip the scanner.
    - A script that invokes a live-diffing migration command is rejected; so is a banned script name with a harmless body.
    - This repository's own package.json passes.
    - A schema module with no pgSchema call is rejected; one where tables hang off pgSchema passes.
  </behavior>
  <action>
    Write `scripts/check-boundaries.test.ts` first, exactly as Reference B. Run it
    and confirm every case fails for want of the module — that is the point of
    writing it first.

    Then write `scripts/check-boundaries.mjs` exactly as Reference A. Keep it
    plain ESM with no TypeScript and no dependencies so it runs identically under
    `node` and `bun`, and so the rules stay importable by the test.

    Two details are load-bearing and easy to lose in a rewrite. The schema check
    is an allowlist, so a schema nobody anticipated is still caught — do not
    invert it into a list of forbidden names. And the CLI prints how many files
    it inspected before reporting success, so a run that found nothing to check
    is visible rather than indistinguishable from a clean run.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; bun run check:boundaries &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>All fixture cases pass. `bun run check:boundaries` exits 0 against the current repository and reports what it inspected. `bun run ci` now runs end to end.</done>
</task>

<task type="auto">
  <name>Task 2: Developer reset confined to one schema</name>
  <precondition>Role `agentdock_app` exists and `.env` supplies a working `AGENTDOCK_DATABASE_URL` (plan 00-01 task 2 complete).</precondition>
  <files>scripts/sql/dev-reset.sql, scripts/dev-reset.mjs</files>
  <action>
    Create both files exactly as Reference C and Reference D.

    Do not add a schema-name parameter to the SQL file and do not build the DROP
    statements from anything but the catalog query already filtered to the
    literal schema name — the reason each layer exists is written in the file
    header, and a parameterised version defeats all of them at once.

    Do not use the drop-and-recreate recipe from ARCHITECTURE.md. `agentdock_app`
    cannot create a schema in this database, so that version destroys the schema
    and cannot restore it. The reasoning and the evidence are in
    `&lt;decisions_made_while_planning&gt;`.

    Verify both refusal paths and then a real run. The real run against an empty
    schema drops nothing and must still exit 0 — that is what proves the
    connection, the session flag, and the guard all work before there is anything
    to lose.
  </action>
  <verify>
    <automated>! node scripts/dev-reset.mjs &amp;&amp; ! AGENTDOCK_DATABASE_URL= node scripts/dev-reset.mjs --confirm &amp;&amp; bun run db:reset --confirm</automated>
  </verify>
  <done>Running without `--confirm` exits non-zero with an explanation; running without a database URL exits non-zero naming the variable; running with `--confirm` completes and reports the schema emptied.</done>
</task>

<task type="auto">
  <name>Task 3: Run every guard on every push</name>
  <files>.github/workflows/ci.yml</files>
  <action>
    Create `.github/workflows/ci.yml` exactly as Reference E.

    The job's only project step is `bun run ci`. Do not expand it into a list of
    individual steps: the moment CI has its own copy of the check list, the local
    command and the CI command start to diverge, and the one that catches the
    migration mistake is whichever one nobody updated.

    Do not add a database service, a secret, or an environment block. All four
    boundary rules read files, and both test files are pure — CI needing no
    credential is a property worth keeping.

    Confirm the workflow is valid by running the same command locally with a
    clean install, which is exactly what the runner will do.
  </action>
  <verify>
    <automated>test -f .github/workflows/ci.yml &amp;&amp; grep -q 'bun run ci' .github/workflows/ci.yml &amp;&amp; bun install --frozen-lockfile &amp;&amp; bun run ci</automated>
  </verify>
  <done>`.github/workflows/ci.yml` exists, invokes `bun run ci` as its only project step, requires no secret, and the identical command passes locally from a frozen-lockfile install.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Drizzle's diff engine → committed SQL | Generated SQL is machine output that a human is expected to review; the scanner is the reviewer that never gets tired. |
| Committed SQL → shared `mcpdb` | `drizzle-kit migrate` applies exactly what is on disk, so whatever passes this scanner reaches a database another application uses. |
| Developer keystroke → destructive command | The gap between `db:migrate` and a live-diffing command is one word of muscle memory. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-00-12 | Tampering | generated migration SQL | critical | mitigate | Allowlist scan: every schema name a migration mentions must be one AgentDock owns, so a cross-schema statement fails the build whether or not anyone anticipated that schema's name. Tested against a fixture naming the co-tenant schema. |
| T-00-13 | Tampering | unqualified DDL target | critical | mitigate | Every `CREATE`/`ALTER` target and every index `ON` target must carry an `agentdock.` qualifier; an unqualified target resolves through `search_path` at apply time and is rejected outright. |
| T-00-14 | Tampering | destructive verb reaching a shared database | critical | mitigate | `DROP`, `TRUNCATE`, `GRANT`, `REVOKE`, role, extension, and database statements are rejected unless the file carries an explicit `agentdock:reviewed-destructive` marker with a reason. |
| T-00-15 | Elevation of Privilege | live-diffing migration commands | high | mitigate | Scanner rejects any package.json script that invokes one, and any script using a banned name. This is the documented failure class for this ORM: four separate issues where the diff engine emitted DDL against schemas excluded by its own filter. |
| T-00-16 | Tampering | a table declared outside `pgSchema()` | high | mitigate | Scanner requires `pgSchema()` and rejects a bare table builder in the schema module, so a table cannot silently inherit whatever `search_path` happens to be. |
| T-00-17 | Denial of Service | `db:reset` against the wrong schema | high | mitigate | Four layers: literal schema name with no parameter, catalog query filtered to that literal, a role owning nothing else, and an asserted database name plus session flag. The runner additionally requires an explicit `--confirm`. |
| T-00-18 | Spoofing | CI reporting green without running the checks | medium | mitigate | The workflow's only project step is the same `bun run ci` a developer runs; there is no second list of checks that can silently fall behind. The scanner prints what it inspected, so a run over zero files is visible. |
| T-00-19 | Information Disclosure | CI logs | medium | mitigate | The workflow declares no secret and no environment block, and every check reads files, so there is nothing for a log to leak. |
</threat_model>

<verification>
1. `bun run check:boundaries` exits 0 and reports the number of files inspected.
2. Every hostile fixture in `scripts/check-boundaries.test.ts` is rejected, and every benign one passes.
3. `bun run db:reset` refuses without `--confirm` and refuses without a database URL.
4. `bun run db:reset --confirm` completes against the empty `agentdock` schema.
5. `bun run ci` passes from a `--frozen-lockfile` install, which is what the runner does.
6. `.github/workflows/ci.yml` references no secret and no database service.
</verification>

<success_criteria>
- **FND-03** — no command capable of generating destructive DDL against another schema is reachable from `package.json`, and that is machine-checked on every push rather than remembered.
- **FND-04** — `bun run db:reset --confirm` exists and cannot affect any schema but `agentdock`, proven by four independent constraints and exercised live.
- **FND-05** — CI fails when generated migration SQL names a schema AgentDock does not own, leaves a target unqualified, or carries an unreviewed destructive verb. Each condition has a fixture.
</success_criteria>

<output>
Create `.planning/phases/AGD-00-database-isolation-bootstrap/00-03-SUMMARY.md` when done.
Record the `check-boundaries` inspection counts so plan 00-04 can confirm they increase.
</output>
