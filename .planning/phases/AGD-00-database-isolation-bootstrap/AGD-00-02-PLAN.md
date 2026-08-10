---
phase: AGD-00-database-isolation-bootstrap
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - biome.json
  - vitest.config.ts
  - .gitignore
  - .env.example
  - src/env.ts
  - src/env.test.ts
autonomous: false
requirements: [FND-06, FND-07, FND-08, FND-09]

estimate:
  tokens: 42000
  raw_tokens: 42000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "`bun install` produces a working toolchain: lint, format, type-check, and test all run from package.json scripts"
    - "The application refuses to start with a readable, actionable error when a required environment variable is missing or malformed"
    - "A configuration error message names the offending variable and never contains its value"
    - "`.env.example` lists every variable AgentDock reads or will read, with placeholders only, and states that GITHUB_TOKEN requires no scopes"
    - "A real `.env` cannot be committed, and `.env.example` can"
    - "No migration command that diffs live database state is reachable from package.json"
  artifacts:
    - path: "package.json"
      provides: "Pinned dependency set and every script this phase will use, declared once"
      contains: "\"ci\":"
      min_lines: 40
    - path: "src/env.ts"
      provides: "parseEnv() — zod validation of process configuration with credential-safe error formatting"
      exports: ["parseEnv", "Env"]
      min_lines: 30
    - path: "src/env.test.ts"
      provides: "Proof that a malformed connection string is rejected without the credential appearing in the error"
      min_lines: 30
    - path: ".env.example"
      provides: "Placeholder-only documentation of every environment variable"
      contains: "REQUIRES NO SCOPES"
      min_lines: 20
  key_links:
    - from: "src/env.test.ts"
      to: "src/env.ts"
      via: "calls parseEnv() with a sentinel credential and asserts the sentinel is absent from the thrown message"
      pattern: "not\\.toContain\\(SENTINEL\\)"
    - from: "package.json"
      to: "scripts/check-boundaries.mjs"
      via: "the ci script invokes the boundary scanner delivered by plan 00-03"
      pattern: "check:boundaries"
---

<objective>
Stand up the real toolchain — TypeScript, Next.js, Biome, Vitest, Bun as
installer and script runner — and make misconfiguration a loud, readable failure
instead of a runtime mystery.

Purpose: everything later in this phase is verified by running a command. Those
commands have to exist and have to be the same ones CI runs. And the single most
common way a credential escapes a project is a validation error that helpfully
prints the value it rejected — so the error formatter is written and tested
before there is anything to leak.

Output: an installed, lint-clean, type-checking repository with a tested
environment contract and a placeholder-only `.env.example`.

Implements CONTEXT.md confirmed decision 5 (credentials in environment variables
only, `.env.example` carries placeholders) and the stack fixed in decision 7
(TypeScript 5.9.3, Next.js 16 App Router, Node runtime with Bun as
installer/script-runner, Biome, Vitest, zod).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/AGD-00-database-isolation-bootstrap/CONTEXT.md
@.gitignore
</context>

<decisions_made_while_planning>

**1. Phase 0 installs 13 packages, not the 35 in STACK.md.**

STACK.md specifies the full v1 dependency set. Most of it belongs to work this
phase explicitly excludes: Octokit and `gray-matter` are for ingestion, the
`unified`/`remark`/`rehype` chain is for rendering untrusted Markdown, `pino` is
for the worker's per-job traces, Tailwind and shadcn are for the UI that Phase 1
builds against its own accessibility and dark-mode criteria. Installing them now
means auditing 22 packages nothing in this phase imports, and pinning versions
that will be four months stale by the time they are first used.

The phase installs exactly what Phase 0 runs.

**2. `src/env.ts` exports a function, not an eagerly-evaluated singleton.**

STACK.md's sketch is `export const env = z.object({...}).parse(process.env)`. That
throws at *import* time, which means the test file that verifies the error
formatting cannot import the module it is testing without first faking the
environment through module-load ordering tricks. Exporting `parseEnv(source)` as
a pure function makes the credential-leak test a three-line assertion, and the
consumer (`src/db/client.ts`, plan 00-04) calls it once. Nothing else changes.

**3. `GITHUB_TOKEN` is documented in `.env.example` but not required by `parseEnv`.**

FND-07 requires `.env.example` to document it and to state that it needs no
scopes; both are done here. Adding it to the zod schema as required would make
the Phase 0 application refuse to start without a token it never reads — turning
a correct configuration into a failure. It joins the schema in Phase 1, in the
plan that first calls GitHub.

**4. `next.config.ts` is not created.**

Next.js runs without it and auto-detects `src/app`. An empty config file is a
file to keep in sync for no behavior. Phase 1 creates it when it adds the
Content-Security-Policy header (REN-02), which is the first real content it will
hold.

**5. No `dotenv` dependency.**

Bun loads `.env` into the environment of any process it launches, and every
script in `package.json` is launched through `bun run`. Next.js loads `.env` for
the application itself. There is nothing left for `dotenv` to do.

</decisions_made_while_planning>

<reference>

## Reference A — `package.json`

Every script this phase will ever use is declared here, in one place, so no later
plan has to reopen this file. `check:boundaries` and `db:*` point at files that
plans 00-03 and 00-04 deliver; `bun run ci` therefore starts working at the end
of plan 00-03.

```json
{
  "name": "agentdock",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check:boundaries": "node scripts/check-boundaries.mjs",
    "ci": "bun run check:boundaries && bun run lint && bun run typecheck && bun run test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:reset": "node scripts/dev-reset.mjs",
    "db:test:generate": "AGENTDOCK_SCHEMA=agentdock_test AGENTDOCK_MIGRATIONS_OUT=.drizzle-test AGENTDOCK_DATABASE_URL=\"$AGENTDOCK_TEST_DATABASE_URL\" drizzle-kit generate",
    "db:test:migrate": "AGENTDOCK_SCHEMA=agentdock_test AGENTDOCK_MIGRATIONS_OUT=.drizzle-test AGENTDOCK_DATABASE_URL=\"$AGENTDOCK_TEST_DATABASE_URL\" drizzle-kit migrate",
    "db:test:setup": "bun run db:test:generate && bun run db:test:migrate"
  },
  "dependencies": {
    "drizzle-orm": "0.45.2",
    "next": "16.3.0",
    "postgres": "3.4.9",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.7",
    "@types/node": "26.2.0",
    "@types/react": "19.2.7",
    "@types/react-dom": "19.2.4",
    "drizzle-kit": "0.31.10",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

There is deliberately no `db:push` and no `db:pull` script. Plan 00-03 makes that
a machine-checked rule rather than a convention.

If `@types/react` or `@types/react-dom` at the exact patch above does not
resolve, install the current `19.x` and record the resolved version in the
summary — these two are the only entries not verified against the registry in
STACK.md.

## Reference B — `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "allowJs": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".drizzle-test"]
}
```

## Reference C — `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.7/schema.json",
  "files": {
    "includes": ["**", "!node_modules/**", "!.next/**", "!drizzle/**", "!.drizzle-test/**"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always" }
  }
}
```

## Reference D — `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
```

## Reference E — `.gitignore` addition

Append one entry. The existing file already ignores `.env` and `.env.*` with a
single `!.env.example` exception, ignores `node_modules/`, `.next/`, and
`coverage/`, and does not need changing.

```gitignore
# Migrations generated on the fly for the test schema — never reviewed, never applied to dev
.drizzle-test/
```

## Reference F — `.env.example`

```dotenv
# AgentDock environment. Copy to .env and fill in real values.
#
# .env is git-ignored. Never commit a credential, never paste one into an agent
# session, and never record one in a planning document.

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
# AgentDock connects as `agentdock_app`: a non-superuser that owns the
# `agentdock` and `agentdock_test` schemas and holds no privilege on anything
# else in this shared instance.
#
# The password is chosen by the maintainer during the one-time bootstrap, using
# psql's `\password agentdock_app` (see scripts/sql/bootstrap-agentdock.sql).
# It is stored nowhere but your .env.
AGENTDOCK_DATABASE_URL=postgres://agentdock_app:REPLACE_WITH_YOUR_PASSWORD@localhost:5432/mcpdb

# Same role, same database, different schema. Used only by `bun run db:test:*`
# and by database-backed tests, so a test run can never see or destroy
# development data.
AGENTDOCK_TEST_DATABASE_URL=postgres://agentdock_app:REPLACE_WITH_YOUR_PASSWORD@localhost:5432/mcpdb

# ---------------------------------------------------------------------------
# GitHub — read from Phase 1 onward (repository ingestion)
# ---------------------------------------------------------------------------
# THIS TOKEN REQUIRES NO SCOPES.
#
# Reading public repository metadata and public file contents needs no scopes at
# all, and a scopeless token still receives the full 5,000 requests/hour core
# rate limit. Use a fine-grained token with public read-only access, or a classic
# token with every scope box unchecked.
#
# Do NOT reuse the ambient `gh auth token` on this machine: it carries repo,
# admin:org, admin:enterprise, delete_repo, and workflow. That is an enormous
# blast radius for a service whose entire job is processing untrusted
# supply-chain input.
GITHUB_TOKEN=REPLACE_WITH_A_SCOPELESS_TOKEN
```

## Reference G — `src/env.ts`

```ts
import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
    message: 'must be a postgres:// or postgresql:// connection string',
  });

const envSchema = z.object({
  AGENTDOCK_DATABASE_URL: postgresUrl,
  AGENTDOCK_TEST_DATABASE_URL: postgresUrl.optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process configuration and returns it typed.
 *
 * Failure messages name the variable and describe the problem. They never carry
 * the rejected value: these variables hold credentials, and an error string ends
 * up in terminals, log aggregators, and issue trackers. src/env.test.ts asserts
 * this with a sentinel.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Invalid environment configuration:\n${problems}\n\n` +
      'Every variable is documented in .env.example. If .env is missing, copy it from there.',
  );
}
```

## Reference H — `src/env.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const SENTINEL = 'sentinel-value-that-is-not-a-real-password';

const valid = {
  AGENTDOCK_DATABASE_URL: `postgres://agentdock_app:${SENTINEL}@localhost:5432/mcpdb`,
} as NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('accepts a valid environment and defaults NODE_ENV', () => {
    const env = parseEnv(valid);
    expect(env.AGENTDOCK_DATABASE_URL).toContain('postgres://');
    expect(env.NODE_ENV).toBe('development');
  });

  it('names the missing variable and points at .env.example', () => {
    expect(() => parseEnv({} as NodeJS.ProcessEnv)).toThrowError(/AGENTDOCK_DATABASE_URL/);
    expect(() => parseEnv({} as NodeJS.ProcessEnv)).toThrowError(/\.env\.example/);
  });

  it('rejects a connection string that is not PostgreSQL', () => {
    expect(() =>
      parseEnv({ AGENTDOCK_DATABASE_URL: 'mysql://localhost:3306/mcpdb' } as NodeJS.ProcessEnv),
    ).toThrowError(/postgres:\/\//);
  });

  it('never echoes a credential into the error message', () => {
    let message = '';
    try {
      parseEnv({
        AGENTDOCK_DATABASE_URL: `mysql://agentdock_app:${SENTINEL}@localhost:3306/mcpdb`,
      } as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/AGENTDOCK_DATABASE_URL/);
    expect(message).not.toContain(SENTINEL);
  });

  it('treats the test database URL as optional', () => {
    expect(parseEnv(valid).AGENTDOCK_TEST_DATABASE_URL).toBeUndefined();
  });
});
```

</reference>

<tasks>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 1: Approve the dependency set before anything is installed</name>
  <what-built>
    Nothing yet. This gate runs first, because installing a package executes
    third-party code on this machine and adds it to the supply chain of a service
    whose entire purpose is processing untrusted input.

    The project research documents record that these versions were queried live
    from the npm registry on 2026-08-10, but they do not contain a package
    legitimacy audit. Under the fallback policy every package below is therefore
    treated as UNVERIFIED and needs your eyes before it lands.
  </what-built>
  <how-to-verify>
    Thirteen packages. Confirm each is the well-known project you expect — check
    the publisher, the repository link, and the weekly download order of
    magnitude. A typosquat or a hallucinated name is caught here or not at all.

    Runtime:
      drizzle-orm 0.45.2   https://www.npmjs.com/package/drizzle-orm
      next        16.3.0   https://www.npmjs.com/package/next
      postgres    3.4.9    https://www.npmjs.com/package/postgres
      react       19.2.8   https://www.npmjs.com/package/react
      react-dom   19.2.8   https://www.npmjs.com/package/react-dom
      zod         4.4.3    https://www.npmjs.com/package/zod

    Development:
      @biomejs/biome   2.5.7    https://www.npmjs.com/package/@biomejs/biome
      @types/node      26.2.0   https://www.npmjs.com/package/@types/node
      @types/react     19.x     https://www.npmjs.com/package/@types/react
      @types/react-dom 19.x     https://www.npmjs.com/package/@types/react-dom
      drizzle-kit      0.31.10  https://www.npmjs.com/package/drizzle-kit
      typescript       5.9.3    https://www.npmjs.com/package/typescript
      vitest           4.1.10   https://www.npmjs.com/package/vitest

    Two version choices worth a second's thought, both deliberate:
      - typescript is pinned to 5.9.3, not the 7.x line. TypeScript 7 has no
        stable programmatic API until 7.1, which framework and lint tooling
        cannot yet consume. There is no compile-speed problem here to solve.
      - drizzle-kit is pinned to the 0.31.x stable line. The 1.0 line is still a
        release candidate.
  </how-to-verify>
  <resume-signal>Type "approved" to install this set, or name the packages you want changed or removed.</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Scaffold the repository and install the toolchain</name>
  <reversibility rating="costly">The framework, ORM, and test runner choices propagate into every later file; swapping one after Phase 1 means rewriting the data-access and rendering layers. Already settled in CONTEXT.md decision 7 — recorded here, not re-opened.</reversibility>
  <files>package.json, tsconfig.json, biome.json, vitest.config.ts, .gitignore</files>
  <action>
    Create `package.json`, `tsconfig.json`, `biome.json`, and `vitest.config.ts`
    with exactly the content in References A through D. Append the single entry
    from Reference E to the existing `.gitignore` — do not rewrite that file, the
    secret-handling rules already in it are correct and must survive.

    Then run `bun install`. Bun writes a `bun.lock`; leave it in the working tree
    for the maintainer to commit, since a lockfile is what makes the approved
    dependency set reproducible.

    Do not create `next.config.ts`, do not run `bunx shadcn`, and do not add
    Tailwind — the reasoning is in `<decisions_made_while_planning>`.

    Do not run `tsc` in this task: there are no TypeScript source files yet, and
    the compiler reports "no inputs were found" rather than success. Task 3 adds
    the first source file and type-checks then.
  </action>
  <verify>
    <automated>bun install &amp;&amp; test -d node_modules/next &amp;&amp; test -d node_modules/drizzle-orm &amp;&amp; bun run lint &amp;&amp; git check-ignore -q .env &amp;&amp; ! git check-ignore -q .env.example</automated>
  </verify>
  <done>`bun install` completes, `bun run lint` exits 0, `.env` is ignored by git and `.env.example` is not, and no `db:push` or `db:pull` script exists in package.json.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Environment contract and its credential-leak test</name>
  <files>.env.example, src/env.ts, src/env.test.ts</files>
  <behavior>
    - A complete, valid environment parses, and `NODE_ENV` defaults to `development` when absent.
    - A missing `AGENTDOCK_DATABASE_URL` throws an error that names the variable and points the reader at `.env.example`.
    - A connection string with a non-PostgreSQL scheme is rejected with a message that states which schemes are accepted.
    - A rejected connection string containing a sentinel credential produces an error message that names the variable and does not contain the sentinel.
    - `AGENTDOCK_TEST_DATABASE_URL` is optional and parses to `undefined` when absent.
  </behavior>
  <action>
    Write `src/env.test.ts` first, exactly as Reference H. Run it and confirm it
    fails because `src/env.ts` does not exist — that failure is the point of
    writing it first.

    Then write `src/env.ts` exactly as Reference G, and `.env.example` exactly as
    Reference F.

    The fourth test is the one that matters. A validation library's default
    behavior is to be helpful about what it rejected, and for a connection string
    that means printing the credential. The formatter in Reference G emits only
    the variable path and the issue message, and every message in the schema is
    one this file controls. Keep it that way: if a future variable needs a custom
    message, that message must not interpolate the value.

    `.env.example` carries placeholders only. Do not put a real host, a real
    password, or a real token in it — including one you find in the container's
    environment.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; test -f .env.example &amp;&amp; grep -q 'REQUIRES NO SCOPES' .env.example &amp;&amp; [ "$(grep -cE '^[A-Z_]+=' .env.example)" -ge 3 ] &amp;&amp; [ "$(grep -E '^[A-Z_]+=' .env.example | grep -cv 'REPLACE_WITH')" = "0" ]</automated>
  </verify>
  <done>All five behaviors pass under `bun run test`. `bun run typecheck` exits 0. `.env.example` states that GITHUB_TOKEN requires no scopes, declares at least three variables, and every declared value is a placeholder.</done>
</task>

</tasks>

<!-- planner-discipline-allow: REPLACE_WITH -->

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| npm registry → this machine | Installing a package runs third-party code and permanently joins this project's supply chain. |
| Environment variables → error messages and logs | Credentials enter here; an unguarded formatter carries them straight out to terminals, log files, and issue trackers. |
| Working tree → Git history | A committed `.env` is unrecoverable — the credential must be rotated, not deleted. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-00-SC | Tampering | `bun install` (npm supply chain) | high | mitigate | No package legitimacy audit exists in the research documents, so all 13 packages are treated as unverified. Task 1 is a blocking human checkpoint listing every package with its registry URL, and it is never auto-approved. `bun.lock` freezes the approved resolution. |
| T-00-07 | Information Disclosure | `parseEnv` error formatting | high | mitigate | The formatter emits only the variable path and a message this file controls; `src/env.test.ts` asserts a sentinel credential in a rejected connection string is absent from the thrown message. |
| T-00-08 | Information Disclosure | `.env` reaching Git | critical | mitigate | The existing `.gitignore` ignores `.env` and `.env.*` with a single `!.env.example` exception; Task 2's gate asserts both directions with `git check-ignore`. `.gitignore` is appended to, never rewritten. |
| T-00-09 | Information Disclosure | `.env.example` contents | high | mitigate | Placeholders only, machine-checked: every `KEY=` line in the file must carry a placeholder marker, and the file must declare at least three variables so an emptied file cannot pass. |
| T-00-10 | Elevation of Privilege | `GITHUB_TOKEN` scope creep | high | mitigate | `.env.example` states in capitals that the token requires no scopes, names the ambient `gh` credential as the thing not to reuse, and lists the scopes that credential actually carries. |
| T-00-11 | Tampering | reachable destructive migration commands | high | mitigate | `package.json` declares no `db:push` or `db:pull`. Plan 00-03 turns that from a convention into a machine-checked rule that runs on every push. |
</threat_model>

<verification>
1. `bun install` completes and `node_modules/next`, `node_modules/drizzle-orm`, and `node_modules/vitest` exist.
2. `bun run lint`, `bun run typecheck`, and `bun run test` each exit 0.
3. `git check-ignore .env` succeeds; `git check-ignore .env.example` fails.
4. `.env.example` contains no host, password, or token that would work anywhere.
5. `package.json` contains no script whose value invokes a live-diffing migration command.
</verification>

<success_criteria>
- **FND-06** — configuration is validated by `parseEnv`; missing or malformed values throw an error naming the variable and pointing at `.env.example`. Proven by three tests.
- **FND-07** — `.env.example` documents every variable with placeholders only and states that `GITHUB_TOKEN` requires no scopes. Proven by the placeholder gate and a literal grep.
- **FND-08 (partial)** — no credential can be committed, and no credential can reach an error message. Proven by `git check-ignore` and the sentinel test. The remaining half of FND-08 (no credential in a connection error at runtime) lands in plan 00-04.
- **FND-09 (partial)** — `bun install` produces a working toolchain. The single documented run command lands in plan 00-04, once there is an application to run.
</success_criteria>

<output>
Create `.planning/phases/AGD-00-database-isolation-bootstrap/00-02-SUMMARY.md` when done.
Record the resolved `@types/react` and `@types/react-dom` versions if they differ from the plan.
</output>