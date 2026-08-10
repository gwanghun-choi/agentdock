# Stack Research

**Domain:** Local-first open-source package registry / discovery site (GitHub ingestion → Postgres → server-rendered faceted search UI)
**Researched:** 2026-08-10
**Confidence:** HIGH on the language/runtime, framework, search, and background-work decisions. MEDIUM on lint tooling (Biome coverage gap) and on Drizzle-vs-Kysely (both defensible once the DB grant is in place).

---

## The One Decision That Matters First

The prompt frames schema confinement as an ORM/migration-tool question. It is not. **It is a PostgreSQL grant question, and it is currently unsolved because the connecting role has superuser rights** (PROJECT.md, verified 2026-08-10).

No ORM can guarantee it will never emit DDL outside `agentdock`. Drizzle has shipped that exact bug four times in two years (issues [#2632](https://github.com/drizzle-team/drizzle-orm/issues/2632) 2024-07, [#4796](https://github.com/drizzle-team/drizzle-orm/issues/4796) 2025-07, [#5190](https://github.com/drizzle-team/drizzle-orm/issues/5190) 2025-12, [#5329](https://github.com/drizzle-team/drizzle-orm/issues/5329) 2026-02). Choosing a "safer" ORM just moves the trust into a different vendor's diff engine.

PostgreSQL will enforce it for free, permanently, in six lines, run **once, by hand, as the superuser, before any application code exists**:

```sql
CREATE ROLE agentdock LOGIN PASSWORD :'pw';
CREATE SCHEMA agentdock AUTHORIZATION agentdock;
REVOKE ALL ON SCHEMA public    FROM agentdock;
REVOKE ALL ON SCHEMA didim_mcp FROM agentdock;
ALTER ROLE agentdock SET search_path = agentdock;
-- extensions must be installed by the superuser, into a schema agentdock can read:
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

After this, a buggy `drizzle-kit push` that emits `DROP SCHEMA didim_mcp CASCADE` gets `ERROR: must be owner of schema didim_mcp` and the migration aborts. The failure mode becomes *loud and harmless* instead of *silent and catastrophic*. `AGENTDOCK_DATABASE_URL` uses the `agentdock` role, never the superuser.

Everything in section 5 below is defense-in-depth on top of this. It is not a substitute for it.

**Confidence: HIGH.** This is standard PostgreSQL ownership semantics; PG 15+ already revokes `CREATE ON SCHEMA public FROM PUBLIC`, so the two `REVOKE`s close the remaining `USAGE`.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.9.3 | Language, everywhere | One language for parsers, SQL, worker, and UI. **Not 7.0.2** — see Version Compatibility. |
| Node.js | 22.22.3 (installed) | Runtime for web server and worker | Next.js 16 requires Node ≥20.9. The runtime every dependency is tested against. |
| Bun | 1.3.14 (installed) | Package manager + script runner **only** | `bun install` is a pure speed win with zero runtime risk (it produces `node_modules`). Not the server runtime — see §2. |
| Next.js (App Router) | 16.3.0 | Web framework, SSR, routing, API routes | Server Components map exactly onto this workload: URL search params → SQL → HTML. Turbopack is now default and stable. |
| React | 19.2.8 | UI library | Required by Next 16. |
| PostgreSQL | 16 (existing instance, schema `agentdock`) | Storage + full-text search + job queue | Already running. Does all three jobs; the alternative is operating three services. |
| Drizzle ORM | 0.45.2 | Schema-as-TypeScript, typed queries | `pgSchema()` makes every emitted statement schema-qualified. Migrations generate offline. |
| drizzle-kit | 0.31.10 | Migration **generation** only (`generate` + `migrate`) | `generate` provably never opens a DB connection. `push`/`pull` are banned — see §5. |
| postgres (postgres.js) | 3.4.9 | PostgreSQL driver | Drizzle's recommended driver, works on Node and Bun, supports `search_path` as a startup parameter and `LISTEN/NOTIFY`. |
| Tailwind CSS | 4.3.3 | Styling | CSS-first `@theme` config; no JS config file to maintain. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@octokit/rest` | 22.0.1 | GitHub REST client | Always. Hand-rolling `fetch` against GitHub means hand-rolling secondary-rate-limit backoff, which is the #1 way ingestion silently stalls. |
| `@octokit/plugin-throttling` | 11.0.5 | Rate-limit-aware queuing | Always. Reads `x-ratelimit-*` and sleeps rather than 403-ing. |
| `@octokit/plugin-retry` | 8.1.1 | Retry on 5xx / abuse detection | Always. |
| `gray-matter` | 4.0.3 | `SKILL.md` YAML frontmatter parsing | Always. Handles delimiter/BOM/CRLF edge cases you will otherwise get wrong on real-world repos. |
| `yaml` | 2.9.0 | Standalone YAML manifests (plugin/marketplace files) | When a manifest is a bare `.yaml`, not frontmatter. |
| `zod` | 4.4.3 | Validate GitHub responses, parsed frontmatter, and env vars | Always. Every ingested manifest is untrusted input; this is the trust boundary. |
| `unified` + `remark-parse` + `remark-gfm` + `remark-rehype` + `rehype-sanitize` + `rehype-stringify` | 11.0.5 / 11.0.0 / 4.0.1 / 11.1.2 / 6.0.0 / 10.0.1 | Render untrusted README/SKILL Markdown to safe HTML | Always. `rehype-sanitize` filters the **AST** against GitHub's schema, not a regex over an HTML string. This is the XSS boundary — do not shortcut it. |
| `pino` | 10.3.1 | Structured logging | Always in the worker (per-repo ingest traces are the only debugging you get). |
| `pino-pretty` | 13.1.3 | Human-readable dev logs | Dev script only. |
| `radix-ui` | 1.6.7 | Accessible primitives, pulled in by shadcn/ui | Transitively, via shadcn components. |
| `class-variance-authority` / `clsx` / `tailwind-merge` | 0.7.1 / 2.1.1 / 3.6.0 | shadcn/ui's styling helpers | Transitively. |
| `lucide-react` | 1.31.0 | Icons | shadcn default. Tree-shakes per-icon. |

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| Biome | 2.5.7 (`@biomejs/biome`) | Lint + format, one binary | Next 16 **removed `next lint`** and points users at "Biome or ESLint directly". Biome needs no `tsc`, which matters right now — see Version Compatibility. |
| Vitest | 4.1.10 | Unit + integration tests | Runs on Node (same runtime as production). Route Handlers are plain `(Request) => Response` functions — call them directly, no HTTP server, no supertest. |
| `@tailwindcss/postcss` | 4.3.3 | Tailwind v4 PostCSS plugin for Next | The v4 plugin package moved out of `tailwindcss`. |
| `shadcn` CLI | 4.16.2 | Copies component source into the repo | **Not a runtime dependency.** Pull only what's used. |
| `@types/node` | 26.2.0 | Node typings | |

---

## Installation

```bash
# Core
bun add next@16.3.0 react@19.2.8 react-dom@19.2.8 \
        drizzle-orm@0.45.2 postgres@3.4.9 \
        zod@4.4.3 pino@10.3.1

# Ingestion + parsing
bun add @octokit/rest@22.0.1 @octokit/plugin-throttling@11.0.5 @octokit/plugin-retry@8.1.1 \
        gray-matter@4.0.3 yaml@2.9.0 \
        unified@11.0.5 remark-parse@11.0.0 remark-gfm@4.0.1 \
        remark-rehype@11.1.2 rehype-sanitize@6.0.0 rehype-stringify@10.0.1

# Dev
bun add -D typescript@5.9.3 @types/node@26.2.0 @types/react@19 @types/react-dom@19 \
           drizzle-kit@0.31.10 @biomejs/biome@2.5.7 vitest@4.1.10 \
           tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 pino-pretty@13.1.3

# UI components (copies source in, adds radix/cva/clsx/tailwind-merge/lucide as deps)
bunx shadcn@4.16.2 init
bunx shadcn@4.16.2 add button input badge card select checkbox dialog dropdown-menu skeleton
```

`package.json` scripts — note **no `--bun` flag**:

```json
{
  "dev":       "next dev",
  "build":     "next build",
  "start":     "next start",
  "worker":    "node --experimental-strip-types src/worker/index.ts",
  "db:gen":    "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "check":     "biome check . && tsc --noEmit",
  "test":      "vitest run"
}
```

There is deliberately **no `db:push` script.** If it isn't in `package.json`, nobody types it at 2am.

---

## 1. Language / Runtime Verdict

**Full TypeScript. One repo, one `package.json`, one `bun install`. Confidence: HIGH.**

Enumerate the actual workload:

| Work | What it needs | Does Python or Go help? |
|------|---------------|--------------------------|
| GitHub REST/GraphQL calls under rate limits | An HTTP client with backoff | No. Octokit is the best-maintained client in any language. |
| Markdown / YAML / JSON parsing | String work + a safe sanitizer | No. `unified`/`remark` is the reference implementation of the CommonMark+GFM pipeline; Python's `markdown-it-py` is a port of the JS one. |
| Static capability analysis (does this script shell out? touch the network?) | Regex, then eventually an AST | No. `web-tree-sitter` has first-class Node bindings and the same grammars. |
| PostgreSQL queries | A driver | No. |
| Server-rendered, SEO-indexable, faceted search UI | React on the server | **Yes — decisively toward TypeScript.** |

Nothing here is numerical, statistical, or ML. Python's advantage is `numpy`/`pandas`/`torch`, and this project uses none of them. What Python *would* add: a second toolchain, a second dependency manager, a second type system, a second test runner, an IPC boundary between the ingester and the app, and a place for the artifact schema to drift out of sync. That is pure operational cost paid for zero capability.

Go's advantage is a single static binary and cheap concurrency. Ingestion is I/O-bound on GitHub's rate limiter, not on CPU — the concurrency ceiling is GitHub's, not the runtime's. And you would still need the React UI, so Go means *two* languages, not one. Go wins if AgentDock ever becomes a high-QPS public service; it is the wrong trade for a part-time solo maintainer today.

The decisive constraint is in PROJECT.md: *"One maintainer, part-time."* Context-switching between two language ecosystems is the single largest recurring tax a solo project pays, and it is paid on every commit, not once.

**Verdict: TypeScript. Not a split. Not Go.**

---

## 2. Bun: Toolchain Yes, Runtime No

**Use Bun for `install` and `run`. Run the server and worker on Node 22. Confidence: MEDIUM-HIGH.**

| Bun role | Verdict | Reason |
|----------|---------|--------|
| Package manager (`bun install`) | **Yes** | Produces a normal `node_modules`. Materially faster. If it ever misbehaves, `npm install` is a drop-in recovery. Zero lock-in. |
| Script runner (`bun run dev`) | **Yes** | It's just a process launcher here; the launched process is `next`, which runs on Node. |
| Next.js server runtime (`bun --bun next dev/start`) | **No, not yet** | See below. |
| Test runner (`bun test`) | **No** | See §9. |
| PostgreSQL client (`Bun.sql`) | **No** | See below. |

**Why not Bun as the Next.js runtime.** Bun's own docs say only that it "can run Next.js development and production servers" — there is no supported-configuration statement, no caveat list, and Vercel does not offer a Bun runtime at all. Meanwhile Bun's Node-compat page still lists `node:http` as *partially* implemented, specifically: *"The outgoing client request body is buffered instead of streamed."* The ingestion worker's whole job is outgoing HTTP. That particular limitation is survivable, but it tells you the compat surface Next and Octokit sit on is still being filled in. There is no upside here to trade for that: this app serves one developer on localhost. Bun's runtime speed is solving a problem AgentDock does not have.

**Why not `Bun.sql`.** Bun's SQL docs explicitly list `LISTEN`/`NOTIFY` and `COPY` as unimplemented. `LISTEN/NOTIFY` is the natural upgrade path for instant job pickup in §8, and losing it for nothing gained is a bad trade. `postgres.js` supports both, and runs fine on Bun *and* Node — so choosing it costs nothing and keeps the door open.

**The exact recommendation:** `bun install` and `bun run <script>`, where every script launches Node. Revisit the runtime question only if `bun install` ever stops being enough.

---

## 3. Web Framework: Next.js 16 App Router

**Confidence: HIGH.**

The workload shape is: a URL like `/search?q=fastapi&type=skill&runtime=claude-code&page=2` must produce indexable HTML from a SQL query, fast, with no client-side data fetching. That is precisely the React Server Component request/response cycle. Search state lives in the URL; a Server Component reads `searchParams`, runs one SQL query, and returns HTML. No client state manager, no data-fetching library, no API layer for the UI to call. **The framework choice eliminates three other dependencies**, which is why it dominates.

| Alternative | Why not |
|-------------|---------|
| **Astro 7.2.0** | Best-in-class for static content, and package detail pages would be a great fit. But faceted search with live filter interactions means islands + a client data path, i.e. rebuilding what RSC gives free. Two rendering models for one site. |
| **TanStack Start 1.168.42** | Genuinely good and the router is better than Next's. But it is much younger, its SSR/SEO/streaming story has far less production mileage, and every shadcn/Tailwind/Next tutorial the solo maintainer will hit assumes Next. Ecosystem gravity is a real cost at 1 FTE. |
| **SvelteKit 2.70.2** | Excellent framework, smaller bundles. Loses on ecosystem: shadcn-svelte trails shadcn/ui, and the maintainer's transferable-knowledge return is lower. Not wrong, just not better here. |
| **Remix / React Router v7** | Merged into React Router; the loader/action model is fine for this. But it gives up RSC streaming and PPR, and offers nothing Next doesn't. |

**Next 16 specifics to plan around** (from the [Next.js 16 release post](https://nextjs.org/blog/next-16)):

- Turbopack is the **default** bundler for dev and build. No webpack config.
- **Caching is opt-in.** All dynamic code executes at request time unless you add `"use cache"`. This is the right default here — search results must not be stale — and package detail pages are the obvious `"use cache"` candidates later.
- `middleware.ts` → **`proxy.ts`**. Use the new name from day one.
- `params` / `searchParams` / `cookies()` / `headers()` are **async**. `await searchParams` in every search page.
- `next lint` is **removed**; `next build` no longer lints. This is why Biome is a first-class choice, not a preference (§9).
- Parallel route slots now require explicit `default.js` or the build fails.
- Requires Node ≥20.9 (have 22.22 ✓), TypeScript ≥5.1.

---

## 4. Backend / API Shape: Next Route Handlers, and a Discipline

**No separate API server. Confidence: HIGH.**

Adding Hono/Elysia/NestJS means a second process, a second port, a second config, CORS, and a serialization boundary — to serve routes Next already serves, for a single-node local app. That is the definition of machinery without payoff.

The corner-painting risk (a public read API and a CLI client later) is real, and it is solved by **one architectural rule, not a framework**:

```
src/db/queries.ts     ← plain async functions. searchPackages(), getPackage(). No React. No Request.
src/app/search/page.tsx        ← Server Component: await searchPackages(params)
src/app/api/v1/packages/route.ts ← later: export async function GET(req) { ... searchPackages(...) }
src/worker/index.ts   ← same queries module, no HTTP involved
```

All data access lives in plain functions that know nothing about HTTP or React. The UI calls them directly (zero overhead). When a public JSON API is needed, it is a thin Route Handler over the same functions — maybe 30 lines per endpoint, with `zod` validating query params. When a CLI is needed, it talks to that JSON API.

The cost of deferring the API server is ~0. The cost of adding it now is permanent. Defer it.

**Skip tRPC too.** tRPC's value is end-to-end types across a client↔server network boundary. Server Components mean there is no such boundary for the UI, and a *public* API deliberately wants a stable, documented, non-tRPC contract. It solves a problem this architecture doesn't have.

---

## 5. Database Access + Migrations — Schema Confinement

**Drizzle ORM 0.45.2 + drizzle-kit 0.31.10, in `generate`/`migrate` mode only, on top of the role grant from the top of this document. Confidence: MEDIUM-HIGH.**

### 5a. How each candidate confines DDL/DML to one schema

| | Declaring a non-public schema on every table | `search_path` handling | Where the migration-history table lands | Can its tooling touch objects outside the target schema? |
|---|---|---|---|---|
| **Drizzle** | `pgSchema('agentdock')` — `mySchema.table(...)`. Every generated statement is emitted as `"agentdock"."packages"`, verified in the [schemas docs](https://orm.drizzle.team/docs/schemas). | Irrelevant to correctness, because queries are fully qualified. Set it anyway as belt-and-braces. | **Defaults to a separate `drizzle` schema**, per [drizzle.config docs](https://orm.drizzle.team/docs/drizzle-config-file): `{ table: "__drizzle_migrations", schema: "drizzle" }`. **Must be overridden** to `schema: 'agentdock'` or AgentDock creates a second schema in a database it doesn't own. | **`generate`: structurally no** — it never opens a connection. **`push`/`pull`: yes, demonstrably.** |
| **Prisma 7.9.1** | `@@schema("agentdock")` per model, `schemas = ["agentdock"]` in the datasource. Multi-schema went GA in ORM 6.13.0. | Driven by `?schema=` on the connection URL. | Goes wherever `?schema=` points, or `public` if omitted ([discussion #21452](https://github.com/prisma/prisma/discussions/21452)). Must set `?schema=agentdock` explicitly. | **Yes, and worse: `prisma migrate dev` requires a shadow database** — it creates and drops a scratch database on the same server to diff against. On an instance AgentDock does not administer, that is a categorical disqualifier. You can supply `shadowDatabaseUrl`, but that is more machinery, not less. |
| **Kysely 0.29.5** | `db.withSchema('agentdock')` on the builder; DDL is hand-written. | Explicit per query. | First-class `migrationTableSchema` option on `MigratorProps` — but the docs warn it must never change after the first run, or Kysely creates a fresh empty history table and re-runs every migration. | **No.** There is no diff engine. Every statement that reaches PostgreSQL is one you typed. |

### 5b. Why not Prisma

The shadow database ends it. Everything else about Prisma 7 here is workable; requiring `CREATE DATABASE` on a shared instance owned by another application is not. Secondary: Prisma's generated client and query engine are meaningful weight for a project whose queries are "select with filters, ordered by rank".

### 5c. Kysely is the strictly-safest option, and it is still not the recommendation

Kysely genuinely cannot emit DDL you didn't write. If confinement were the *only* criterion, Kysely wins outright and it remains a fully defensible choice.

But confinement is already solved by the role grant, at the database layer, where it belongs — and once it is, the second criterion takes over: a part-time maintainer writing every `CREATE TABLE` twice (once as SQL, once as a TypeScript interface, kept in sync by hand or by bolting on `kysely-codegen`) is ongoing labor with a persistent drift bug attached. Drizzle's schema file is the single source of truth for both types and DDL.

**If the maintainer would rather write SQL than trust a codegen, switch to Kysely and lose nothing but convenience.** That is the honest framing.

### 5d. The concrete Drizzle rules

```ts
// src/db/schema.ts
import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const agentdock = pgSchema('agentdock');           // every table hangs off this
export const packages = agentdock.table('packages', { /* ... */ });
```

```ts
// drizzle.config.ts
export default {
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['agentdock'],                                  // never the default
  migrations: { schema: 'agentdock', table: '__drizzle_migrations' },  // NOT the default 'drizzle'
  dbCredentials: { url: process.env.AGENTDOCK_DATABASE_URL! },
};
```

**Rule 1 — `drizzle-kit push` and `drizzle-kit pull` are banned.** They are the only commands that read live database state and diff it, and therefore the only ones that can generate DDL for objects that exist in the database but not in your TypeScript. In a database containing `didim_mcp`, that is every object another team owns.

The evidence is not one bug, it is a recurring class:

- [#2632](https://github.com/drizzle-team/drizzle-orm/issues/2632) (2024-07) — "Using schemaFilter in Drizzle config results in unintended schema drop"
- [#4796](https://github.com/drizzle-team/drizzle-orm/issues/4796) (2025-07) — "`drizzle-kit push` append `DROP SCHEMA` at the end for other schema name"
- [#5190](https://github.com/drizzle-team/drizzle-orm/issues/5190) (2025-12) — "push tries to delete non-public schemas by default"
- [#5329](https://github.com/drizzle-team/drizzle-orm/issues/5329) (2026-02) — "push attempts to drop policies in excluded schemas **despite `schemaFilter: ["public"]`**"

Two details make this decisive rather than historical. First, the maintainer's fix for #5329 was shipped in **`drizzle-kit@1.0.0-beta.19`** (2026-03-23) — the 1.0 line, which is still at `1.0.0-rc.4` on npm and is *not* the `latest` tag you install. The stable 0.31.x line is not stated to carry the fix. Second, on 2026-04-16 a user reported on that same thread that the identical class of bug still produced cross-schema policy drops via the `migrate` path, and was told to open a new issue.

Also note the default changed against you: drizzle-kit 0.x used to manage only `public`; current docs state **"drizzle-kit push and drizzle-kit pull will by default manage all schemas."** An unconfigured `push` in this database is a live grenade.

**Rule 2 — the only sanctioned workflow is `generate` → read the SQL → `migrate`.** `drizzle-kit generate` is [documented](https://orm.drizzle.team/docs/drizzle-kit-generate) as a purely file-based operation: it reads schema files, diffs against the previous local snapshot, and writes `.sql` + `snapshot.json`. It does not require `dbCredentials` and never opens a connection. It is therefore *structurally incapable* of noticing `didim_mcp` exists. `migrate` then applies exactly the SQL files that are committed to git and were read by a human.

**Rule 3 — read every generated `.sql` before applying it, and grep for the words `DROP` and `didim_mcp`.** Cheap CI check: fail if a migration file contains a statement whose target isn't schema-qualified to `agentdock`.

**Rule 4 — belt and braces on the connection.** postgres.js:

```ts
export const sql = postgres(process.env.AGENTDOCK_DATABASE_URL!, {
  connection: { search_path: 'agentdock' },
  max: 10,
});
```

This is redundant with `pgSchema()` qualification and with the role-level `ALTER ROLE ... SET search_path`. Redundancy is the point: it means a raw `sql\`...\`` query written in a hurry still lands in the right schema.

**Net risk after all four layers plus the role grant:** to damage `didim_mcp`, a bug would have to appear in offline-generated SQL, survive human review, survive the CI grep, *and* be executed by a role that lacks ownership of the target. That is an acceptable residual for a solo project.

---

## 6. Search: PostgreSQL-Native, and Honest About Its Ceiling

**Confidence: HIGH.**

### The design

A stored generated `tsvector` column with weighted fields, plus a GIN index — [the pattern PostgreSQL 16's own docs recommend](https://www.postgresql.org/docs/16/textsearch-tables.html):

```sql
ALTER TABLE agentdock.packages ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(name, '')),        'A')
   || setweight(to_tsvector('english', coalesce(description, '')), 'B')
   || setweight(to_tsvector('english', coalesce(keywords, '')),    'C')
   || setweight(to_tsvector('english', coalesce(readme_text, '')), 'D')
  ) STORED;

CREATE INDEX packages_search_idx ON agentdock.packages USING GIN (search_vector);
CREATE INDEX packages_name_trgm  ON agentdock.packages USING GIN (name gin_trgm_ops);
```

**The regconfig must be a literal** (`to_tsvector('english', ...)`, two-arg form). The one-arg form depends on `default_text_search_config` and is only STABLE, and PostgreSQL rejects non-IMMUTABLE expressions in generated columns. This is the single most common way this migration fails.

Query:

```sql
SELECT id, name, description,
       ts_rank_cd(search_vector, q, 32) AS rank
FROM   agentdock.packages, websearch_to_tsquery('english', $1) AS q
WHERE  search_vector @@ q
  AND  ($2::text   IS NULL OR artifact_type = $2)     -- facets are plain WHERE
  AND  ($3::text[] IS NULL OR runtimes @> $3)
ORDER  BY rank DESC, stars DESC
LIMIT 20 OFFSET $4;
```

- **`websearch_to_tsquery`, not `to_tsquery`.** It accepts raw user input — quoted phrases, `or`, leading `-` for negation — and *never throws a syntax error*. `to_tsquery` will 500 your search page the first time someone types an apostrophe.
- **`ts_rank_cd(..., 32)`** — cover-density ranking (rewards terms appearing close together, which is right for "fastapi review skill"), normalization flag 32 = `rank/(rank+1)`, bounding scores into 0..1 so they can be blended with a popularity signal like stars.
- **Facet counts** in a single extra query using `count(*) FILTER (WHERE artifact_type = 'skill')` style aggregates — one round trip for the whole sidebar, not one per facet.
- **Typo tolerance via `pg_trgm`**, used as a *fallback*, not as the primary path: if FTS returns 0 rows, re-query `WHERE name % $1 ORDER BY similarity(name, $1) DESC`. This catches "kubernets", "postgress", and partial names. Set `pg_trgm.similarity_threshold` around 0.3.
- **`unaccent` caveat:** `unaccent()` is STABLE, not IMMUTABLE, so it **cannot go directly in the generated column**. Either wrap it in an `IMMUTABLE` SQL function (the standard trick, but it lies to the planner if the dictionary is ever updated) or create a custom text search configuration that includes the unaccent dictionary and use *that* regconfig. Given the corpus is overwhelmingly English developer text, **skip `unaccent` in v1**.

### What this can do

Keyword and phrase search over name/description/keywords/README with field weighting; English stemming ("reviewing" matches "review"); boolean and negation; typo tolerance on names; arbitrary faceted filtering combined with relevance ranking; sub-10ms on a corpus of 10⁵ artifacts. **There is no performance argument for anything else at this scale.**

### What this cannot do

- **Synonyms and abbreviations.** "k8s" will not match "kubernetes"; "postgres" will not match "PostgreSQL" (different stems). Fixable with a hand-maintained `thesaurus` dictionary or a synonym expansion table — cheap for the 30 terms that actually matter in this domain, and worth doing before reaching for embeddings.
- **Conceptual / intent search.** "help me make my API faster" will not surface a profiling skill. This is the genuine capability gap.
- **Cross-lingual.** A Korean-language skill description won't match an English query.
- **Semantic dedup.** Detecting that two differently-worded skills do the same thing.

### The signal that would justify pgvector

`pgvector` is not in the current image, so adopting it means changing the database image (`pgvector/pgvector:pg16`) — which means coordinating a restart of a database another application depends on. That is not a code change, it is an ops negotiation. It needs evidence.

**Instrument from day one:** log every query string, its result count, and which result (if any) was clicked, into `agentdock.search_log`. Ten lines of code, and it is the only thing that can turn this decision from taste into data.

Escalate only when: **zero-result rate on non-trivial queries exceeds ~15%**, *and* a sample of those queries shows they are intent-shaped ("find me something that…") rather than typos or genuinely-absent content. If they are typos, fix `pg_trgm`. If they are missing content, ingest more repos. Only intent-shaped failures are an embeddings problem.

---

## 7. Frontend UI Layer

**Confidence: HIGH on Tailwind/shadcn, MEDIUM on the dark-mode call.**

**Tailwind CSS 4.3.3.** The v4 model is CSS-first: `@import "tailwindcss"` plus an `@theme { --color-*: ... }` block in `app/globals.css`. JS config files are **no longer auto-detected** — they work only via an explicit `@config "./tailwind.config.js"` directive, and `corePlugins`/`safelist`/`separator` are gone. Start CSS-first; there is no reason to create a JS config for a greenfield project. Plugin package is `@tailwindcss/postcss` (Next uses the PostCSS path, not the Vite plugin). Browser floor is Chrome 111+/Safari 16.4+/Firefox 128+ — irrelevant for a developer-audience tool, and it matches Next 16's own floor.

**shadcn/ui via the `shadcn` CLI 4.16.2.** All components are updated for Tailwind v4 and React 19; primitives now carry `data-slot` attributes, `forwardRef` is gone, and colors are OKLCH. Crucially, **this is not a dependency** — the CLI copies TSX source into `src/components/ui/`, so the dependency count is Radix + `cva` + `clsx` + `tailwind-merge`, and every component is editable in place. Pull the ten components listed in the install block and nothing more. `toast` is deprecated in favor of `sonner`.

**Dark mode: a `@custom-variant` plus an inline script. Skip `next-themes`.**

```css
/* globals.css */
@custom-variant dark (&:where(.dark, .dark *));
```

```html
<!-- in <head>, before paint, with <html suppressHydrationWarning> -->
<script>try{const t=localStorage.theme??(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.classList.toggle('dark',t==='dark')}catch{}</script>
```

That is the entire feature. `next-themes` (0.4.6) exists to handle exactly this FOUC + hydration problem, and it is small and correct — **so if the hand-rolled version causes one hydration warning you can't kill in ten minutes, install it and move on.** This is a low-stakes call either way; don't spend an afternoon on it.

**Dense result rendering: plain server-rendered semantic markup + CSS Grid. Reject `@tanstack/react-table`.**

TanStack Table is a client-side sorting/filtering/pagination engine. In this app, **sorting, filtering, and pagination all happen in SQL, driven by URL search params** — which is also what makes results shareable, bookmarkable, back-button-correct, and crawlable. Adding a client table library would duplicate the server's job on the client, ship state that must be kept in sync with the URL, and break SEO on the site's most important page. It is the single most tempting wrong dependency in this stack.

A result row is `<article>` with a CSS Grid layout. Column headers are `<Link>`s that rewrite `?sort=`. Virtualization is unnecessary because pages hold 20–50 rows; if a page ever needs 200+, add `@tanstack/react-virtual` then, not now.

---

## 8. Background Work: a Job Table and `SKIP LOCKED`

**Confidence: HIGH.**

```sql
CREATE TYPE agentdock.job_status AS ENUM ('queued','running','done','failed');

CREATE TABLE agentdock.ingest_job (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url    text NOT NULL,
  status      agentdock.job_status NOT NULL DEFAULT 'queued',
  attempts    int  NOT NULL DEFAULT 0,
  locked_at   timestamptz,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingest_job_claim_idx ON agentdock.ingest_job (status, created_at);
```

Claim, in one statement:

```sql
UPDATE agentdock.ingest_job
   SET status = 'running', locked_at = now(), attempts = attempts + 1
 WHERE id = (
   SELECT id FROM agentdock.ingest_job
    WHERE status = 'queued'
       OR (status = 'running' AND locked_at < now() - interval '15 minutes')  -- crash recovery
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
 )
RETURNING *;
```

Worker: claim → if null, sleep 2s → ingest → mark `done`, or `failed` if `attempts >= 3`. Roughly forty lines total.

**Crash survival is that one `OR` clause.** A worker killed mid-ingest leaves a `running` row with a stale `locked_at`; fifteen minutes later it is reclaimed automatically. No dead-letter service, no heartbeat protocol, no supervisor. This works because **ingestion is naturally idempotent** — every write is an upsert keyed on `(repo_url, artifact_path)` — so re-running a partially-completed job is harmless. Preserve that property deliberately; it is what buys the simplicity.

`FOR UPDATE SKIP LOCKED` also means running two workers is safe with zero additional code, if ingestion ever needs parallelism.

| Rejected | Why |
|----------|-----|
| **Synchronous on submit** | A repo with 200 files behind GitHub's rate limiter takes minutes. Exceeds every reasonable HTTP timeout, and a browser refresh loses the work. Non-starter. |
| **In-process array queue** | Loses everything on crash. The stated requirement is explicitly crash survival. |
| **Redis + BullMQ 6.0.9** | Redis is **not running** — this means installing, configuring, supervising, and backing up a second stateful service, plus reasoning about job state that can disagree with database state. For one user on localhost. The best queue is the one you already operate. |
| **pg-boss 12.27.0 / graphile-worker 0.17.3** | Both are good, both support a custom `schema` option, and in a normal project either would be the right answer. Here the disqualifier is specific: **each ships its own migration system that runs DDL inside your database.** Section 5 is entirely about minimizing the number of tools permitted to run DDL against this shared instance. Adding a second one — with its own upgrade cycle, its own `CREATE TYPE`/`CREATE TABLE`/`CREATE FUNCTION` set, and its own history table — spends the exact budget being protected, to save forty lines. |
| **cron / `node-cron`** | Solves *scheduling*, not *durability*. Still needed for periodic re-crawl, but that is `setInterval` in the worker inserting `queued` rows — not a dependency. |

**Later, if 2s polling latency ever annoys anyone:** `NOTIFY agentdock_job` in the insert trigger and `LISTEN` in the worker. postgres.js supports it (Bun.sql does not — see §2). Not needed for v1; polling a single-row indexed query every 2s costs nothing.

---

## 9. Quality Tooling

**TypeScript 5.9.3 — deliberately not 7.0.2. Confidence: HIGH.**
TypeScript 7.0 (the Go-native compiler, GA 2026-07-08) is 8–12× faster and genuinely exciting. It also **ships without a stable programmatic API**, expected in 7.1 — which means `typescript-eslint` and the framework tooling for Vue/Svelte/Astro/MDX/Angular cannot consume it yet. Next 16 runs `tsc` as part of `next build`, and Next's minimum is only TS 5.1. Adopting a compiler whose extension API is explicitly unfinished, on a project that does not have a compile-speed problem, is buying risk with no return. Pin 5.9.3, revisit at 7.1. `tsc --noEmit` in the `check` script.

**Biome 2.5.7 for lint + format. Confidence: MEDIUM-HIGH.**
Two independent reasons, not just preference:

1. **Next.js 16 removed `next lint`** and its release notes direct users to "Biome or ESLint directly." The default path no longer exists; a choice must be made.
2. Biome does **type-aware linting without the TypeScript compiler**, using its own inference engine — so the TS 7 API gap above simply doesn't apply to it. `typescript-eslint`, by contrast, is the tool most directly blocked by it.

Plus the usual: one Rust binary replaces ESLint + Prettier + a config graph, and it is fast enough to run on save.

**Honest gap:** Biome's type inference catches roughly ~85% of what `typescript-eslint` does (e.g. `noFloatingPromises` at ~75% recall), and there is no equivalent of `eslint-plugin-next` or `eslint-plugin-react-hooks` rule coverage. For a solo project where `tsc --noEmit` runs anyway and Next's build catches the framework-specific mistakes, that is an acceptable trade for eliminating an entire config surface. If a Hooks-rules bug ever bites, add ESLint *just* for `react-hooks` — don't preemptively.

**Vitest 4.1.10 for unit + integration. Confidence: MEDIUM-HIGH.**
Runs on Node, i.e. the same runtime as production — which is exactly why it beats `bun test` here, given §2's split. `bun test` would test parsers on a runtime the server never uses; the delta is small but it is pure downside.

What to actually test, in priority order:

1. **Manifest parsers.** Fixture `SKILL.md` / `plugin.json` in → expected structured record out. Highest value by far: this is where real-world repos will break you, and every bug becomes a permanent fixture. Include hostile fixtures (missing frontmatter, CRLF, BOM, 10MB README, YAML bombs, HTML/script tags in descriptions).
2. **Search SQL.** Against a real `agentdock_test` schema in the existing instance — created and dropped in `globalSetup`. No Docker, no testcontainers, no separate database. This is the payoff for having a schema-scoped design.
3. **Route Handlers.** They are plain `(req: Request) => Response` functions. Import and call them. **No supertest, no running server, no MSW.**

**Component testing: skip entirely.** Nothing in this UI holds logic worth a test — it is server-rendered markup over query results. Adding jsdom + Testing Library would be scaffolding for tests nobody writes. If a real interaction regression ever ships, add one Playwright (1.62.1) smoke test for the search flow. Not before.

**Env validation: `zod` 4.4.3, hand-rolled, ~15 lines.**

```ts
// src/env.ts
import { z } from 'zod';
export const env = z.object({
  AGENTDOCK_DATABASE_URL: z.string().url(),
  GITHUB_TOKEN: z.string().min(1),
  LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info'),
}).parse(process.env);
```

**Reject `@t3-oss/env-nextjs` (0.13.11).** Its value is enforcing the server/client variable split via build-time magic. AgentDock has no client-side env vars — every secret is server-only. It would be a dependency wrapping a single `.parse()` call. `zod` is in the stack regardless, because validating GitHub API responses and untrusted parsed frontmatter is a genuine trust boundary.

**Logging: `pino` 10.3.1 + `pino-pretty` 13.1.3 in dev.**
The worker is the case that matters: when an ingest fails on repo #847 of a batch, structured JSON with a `repo_url` field is the difference between `grep` and re-running the batch. Bind a child logger per job (`log.child({ jobId, repoUrl })`). The web app barely needs it; Next's own request logging is improved in 16 and sufficient there.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `drizzle-kit push` / `pull` | The only drizzle commands that diff live DB state; four documented incidents of emitting DDL against schemas excluded by `schemaFilter`. In a DB containing `didim_mcp`, unacceptable. | `drizzle-kit generate` (offline, DB-free) → human review → `drizzle-kit migrate` |
| Connecting as the superuser role | Makes every ORM bug catastrophic instead of loud. | A dedicated `agentdock` role owning only `agentdock` (see top of doc) |
| Prisma | `prisma migrate dev` requires a **shadow database** — creating/dropping databases on an instance AgentDock doesn't administer. | Drizzle, or Kysely if you prefer hand-written SQL |
| Redis + BullMQ | An entire stateful service, not currently running, for a queue with one producer and one consumer on localhost. | `agentdock.ingest_job` + `FOR UPDATE SKIP LOCKED` |
| pg-boss / graphile-worker | Each installs its own DDL-running migration system into the shared database — spending exactly the risk budget §5 exists to protect — to save ~40 lines. | Same job table |
| Elasticsearch / OpenSearch / Meilisearch / Typesense | A second datastore, a second index to keep in sync, a second thing to back up — for a corpus where Postgres GIN answers in <10ms. Also explicitly out of scope in PROJECT.md. | Postgres FTS + `pg_trgm` |
| pgvector / embeddings | Not in the current image; adopting it means restarting a database another app depends on. No evidence of need yet. | Ship FTS, log queries and zero-result rate, decide on data |
| Hono / Elysia / NestJS | A second HTTP server, port, and config to serve routes Next already serves, on a single-node local app. | Next Route Handlers over plain functions in `src/db/queries.ts` |
| tRPC | Its value is typed types across a client↔server boundary. RSC removes that boundary for the UI, and a *public* API wants a stable non-tRPC contract. | Server Components + `zod`-validated Route Handlers |
| Redux / Zustand / Jotai | Search/filter state belongs in the URL — that's what makes results linkable, back-button-correct, and crawlable. | `searchParams` + `<Link>` |
| TanStack Query / SWR | Server Components fetch on the server. There is no client cache to manage. | `await` in a Server Component |
| `@tanstack/react-table` | Duplicates SQL sorting/filtering on the client, desynchronizes from the URL, and breaks SEO on the most important page. | Server-rendered semantic markup + CSS Grid; sort links rewrite `?sort=` |
| ESLint 10 + Prettier + typescript-eslint | Three tools and a config graph; `next lint` is gone in Next 16 anyway; and typescript-eslint is precisely the tool blocked by TS 7's missing programmatic API. | Biome 2.5.7 |
| TypeScript 7.0.2 | GA, but no stable programmatic API until 7.1 — framework/lint tooling can't consume it. No compile-speed problem to solve here. | TypeScript 5.9.3; revisit at 7.1 |
| `@t3-oss/env-nextjs` | Solves the server/client env split. There are no client env vars in this app. | `z.object({...}).parse(process.env)` |
| `bun --bun next dev` / `Bun.sql` | Bun's Node compat still lists `node:http` client bodies as buffered-not-streamed; `Bun.sql` lacks `LISTEN/NOTIFY`. No upside for a localhost app. | `bun install` + Node 22 runtime + `postgres.js` |
| `bun test` | Would exercise parsers on a runtime the server never uses. | Vitest 4.1.10 (runs on Node) |
| Docker Compose for PostgreSQL | The database already runs. A second instance means a second source of truth and drift. | Connect to `mcpdb`, schema `agentdock` |
| Turborepo / Nx / pnpm workspaces | One app, one `package.json`. | A single package |
| NextAuth / Clerk / Lucia | No user accounts in this milestone. Auth added before there is anything to authorize is pure config. | Nothing. Add when submissions need attribution. |
| Any sandbox/container execution of scanned repos (Docker-in-Docker, gVisor, Firecracker, `npm install` in a jail) | PROJECT.md forbids executing ingested code outright. Building a sandbox implies you intend to. | Static analysis only: fetch, parse, pattern-match |
| `marked` + post-hoc regex sanitizing | Sanitizing an HTML *string* is how XSS ships. Every ingested README is untrusted supply-chain input. | `rehype-sanitize` — filters the AST against GitHub's schema |
| `unaccent()` inside the generated tsvector column | It's STABLE, not IMMUTABLE; PostgreSQL rejects it in a generated column. | Skip it in v1 (corpus is English); if needed, a custom text search configuration |

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| TypeScript everywhere | Python/FastAPI backend | If AgentDock ever does real ML — training a classifier over artifact behavior, or running local embedding models. Not for HTTP + Markdown + SQL. |
| TypeScript everywhere | Go backend | If this becomes a high-QPS public service with a real CPU-bound analysis stage. You still need a JS frontend, so it's a two-language decision. |
| Next.js 16 | Astro 7.2.0 | If faceted search were dropped and the site became browse-and-read only. Astro would win on output size. |
| Next.js 16 | TanStack Start 1.168.42 | If the maintainer values routing/type ergonomics over ecosystem gravity and can absorb the smaller community. |
| Drizzle (generate-only) | Kysely 0.29.5 + hand-written SQL migrations | If the maintainer would rather write DDL than trust a codegen. Strictly safer on confinement; costs schema/type sync work. Fully defensible. |
| Drizzle | Prisma 7.9.1 | Only if AgentDock ever gets its own dedicated database where a shadow DB is harmless. |
| Node runtime | Bun runtime (`bun --bun`) | After benchmarking the real dependency set under Bun and confirming Octokit + postgres.js + Next 16 all behave. Optimization, not a starting point. |
| Job table + SKIP LOCKED | pg-boss 12.27.0 (`schema: 'agentdock'`) | If job types grow past ~5 with real scheduling, priorities, and cron semantics. Then the DDL cost buys something. |
| Postgres FTS | pgvector on `pgvector/pgvector:pg16` | Only after `search_log` shows >15% zero-result rate on *intent-shaped* queries. Requires restarting a shared database. |
| Biome | ESLint 10.8.1 + `eslint-plugin-react-hooks` | If a Hooks-rules bug actually ships. Add narrowly; don't reintroduce the whole config graph. |
| Vitest | `node --test` (stdlib, Node 22 strips TS types natively) | If you want literally zero test dependencies and `node:assert` is enough. Loses `expect`, watch-mode DX. |
| Hand-rolled dark mode | `next-themes` 0.4.6 | The moment the inline script produces a hydration warning you can't kill in ten minutes. Low stakes; don't burn an afternoon. |

---

## Stack Patterns by Variant

**If the DB role grant cannot be applied (superuser is the only usable role):**
- Switch from Drizzle to **Kysely + hand-written SQL migrations**.
- Because the database will not stop a bad statement, the tool must not be able to generate one. This is the only scenario where Drizzle's diff engine is an unacceptable risk.

**If ingestion needs to scale past a few thousand repos:**
- Keep the job table; run 2–4 workers. `SKIP LOCKED` already makes this safe with no code change.
- The bottleneck will be GitHub's rate limit, not the queue — so the real fix is a conditional-request cache (ETag / `If-None-Match`), stored in the job table. That work is free of rate-limit cost.

**If a public read API arrives:**
- Add `app/api/v1/**/route.ts` over the existing `src/db/queries.ts` functions. Validate params with `zod`. Add a `Cache-Control` header and Next's `"use cache"`.
- Still no separate API server.

**If a CLI client arrives:**
- It calls the public HTTP API. It does not connect to PostgreSQL. Direct DB access from a distributed client would leak credentials and couple the CLI to the schema.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `next@16.3.0` | Node ≥20.9, TypeScript ≥5.1, React 19.2.x | Node 22.22.3 ✓. Turbopack default; `params`/`searchParams`/`cookies()`/`headers()` are async; `middleware.ts` → `proxy.ts`. |
| `typescript@5.9.3` | Biome 2.5.7, Next 16, Vitest 4 | **Do not jump to 7.0.2** — no stable programmatic API until 7.1; framework and lint tooling can't consume it. |
| `tailwindcss@4.3.3` | `@tailwindcss/postcss@4.3.3`, shadcn `new-york-v4` registry | CSS-first `@theme`. JS config only via explicit `@config`. Chrome 111+/Safari 16.4+. |
| `shadcn@4.16.2` | Tailwind v4 + React 19 | Uses the `registry/new-york-v4` path. `toast` deprecated → `sonner`. |
| `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10` | PostgreSQL 16, `postgres@3.4.9` | `latest` is the 0.x line; 1.0 is at `1.0.0-rc.4` and **not** stable. The #5329 schemaFilter fix landed in `1.0.0-beta.19`, i.e. the 1.0 line — another reason `push` stays banned on 0.31.x. |
| `postgres@3.4.9` | Node 22 and Bun 1.3 | Supports `connection: { search_path }` and `LISTEN/NOTIFY`. |
| `zod@4.4.3` | Node 22, TS 5.9 | v4 API differs from v3; follow v4 docs. |
| PostgreSQL 16 | `pg_trgm`, `pgcrypto`, `unaccent`, `uuid-ossp` available | **No `pgvector`.** `gen_random_uuid()` is built in since PG 13 — `pgcrypto` is not needed just for UUIDs. |
| `@octokit/rest@22.0.1` | plugin-throttling 11.0.5, plugin-retry 8.1.1 | Compose via `Octokit.plugin(throttling, retry)`. |
| Bun 1.3.14 | Used only as installer/script runner | Produces standard `node_modules`; `npm install` is always a fallback. |

---

## Sources

**Version data (authoritative — queried live from the npm registry, 2026-08-10):**
- `https://registry.npmjs.org/<pkg>/latest` and `/<pkg>` dist-tags for: next (16.3.0), react/react-dom (19.2.8), drizzle-orm (0.45.2; `beta` 1.0.0-beta.22, `rc` 1.0.0-rc.4), drizzle-kit (0.31.10), prisma/@prisma/client (7.9.1), kysely (0.29.5), postgres (3.4.9), pg (8.23.0), hono (4.13.1), elysia (1.4.29), typescript (7.0.2 latest; 5.9.3 last 5.x), tailwindcss (4.3.3), @tailwindcss/postcss (4.3.3), vitest (4.1.10), @biomejs/biome (2.5.7), eslint (10.8.1), prettier (3.9.6), zod (4.4.3), pino (10.3.1), pino-pretty (13.1.3), @octokit/rest (22.0.1), @octokit/plugin-throttling (11.0.5), @octokit/plugin-retry (8.1.1), graphile-worker (0.17.3), pg-boss (12.27.0), bullmq (6.0.9), @tanstack/react-table (9.1.2), @tanstack/react-start (1.168.42), astro (7.2.0), @sveltejs/kit (2.70.2), gray-matter (4.0.3), yaml (2.9.0), unified (11.0.5), remark-parse (11.0.0), remark-gfm (4.0.1), remark-rehype (11.1.2), rehype-sanitize (6.0.0), rehype-stringify (10.0.1), shadcn (4.16.2), radix-ui (1.6.7), class-variance-authority (0.7.1), clsx (2.1.1), tailwind-merge (3.6.0), lucide-react (1.31.0), next-themes (0.4.6), playwright (1.62.1), @types/node (26.2.0). — **Confidence: HIGH** (registry is the source of truth for versions)

**Schema confinement (§5):**
- https://orm.drizzle.team/docs/drizzle-config-file — verified `schemaFilter` default ("push and pull will by default manage all schemas"), `migrations` default `{ table: "__drizzle_migrations", schema: "drizzle" }`, `tablesFilter`, `extensionsFilters`
- https://orm.drizzle.team/docs/schemas — `pgSchema()` usage; docs state schemaFilter must be configured for drizzle-kit
- https://orm.drizzle.team/docs/drizzle-kit-generate — verified `generate` requires no `dbCredentials` and opens no connection
- https://github.com/drizzle-team/drizzle-orm/issues/2632 — closed 2024-08-28, "schemaFilter results in unintended schema drop"
- https://github.com/drizzle-team/drizzle-orm/issues/4796 — closed 2026-01-03, "push appends DROP SCHEMA for other schema name"
- https://github.com/drizzle-team/drizzle-orm/issues/5190 — closed 2026-01-15, "push tries to delete non-public schemas by default"
- https://github.com/drizzle-team/drizzle-orm/issues/5329 — closed 2026-03-23; maintainer: *"fixed in drizzle-orm@1.0.0-beta.19 and drizzle-kit@1.0.0-beta.19"*; follow-up report 2026-04-16 that the class of bug persisted via `drizzle-kit migrate` (statuses fetched live via GitHub API)
- https://www.prisma.io/docs/orm/prisma-schema/data-model/multi-schema — `@@schema`, `schemas = [...]`, model-move semantics
- https://github.com/prisma/prisma/discussions/21452 — `_prisma_migrations` lands where `?schema=` points, or `public`
- https://kysely.dev/docs/migrations — Migrator, `FileMigrationProvider`, DB-level locking
- https://jsr.io/@kysely/kysely/doc/~/MigratorProps and https://kysely-org.github.io/kysely-apidoc/interfaces/MigratorProps.html — `migrationTableSchema` (Postgres/MSSQL only; must never change after first run)

**Search (§6):**
- https://www.postgresql.org/docs/16/textsearch-tables.html — verified the `GENERATED ALWAYS AS (to_tsvector('english', ...)) STORED` + `USING GIN` pattern and the immutability requirement

**Runtime and framework (§2, §3, §9):**
- https://nextjs.org/blog/next-16 — Turbopack default, Cache Components, `proxy.ts`, async `params`/`cookies()`, **`next lint` removed → "Use Biome or ESLint directly"**, Node ≥20.9 / TS ≥5.1
- https://bun.com/docs/runtime/nodejs-apis — `node:http` outgoing client body buffered not streamed; `node:worker_threads`/`node:test` partial
- https://bun.com/docs/api/sql — `Bun.sql` unimplemented list includes `LISTEN`/`NOTIFY`, `COPY`
- https://bun.com/docs/guides/ecosystem/nextjs — `bun --bun next dev`; no supported-configuration or caveat statement
- https://www.infoq.com/news/2026/08/typescript-7-released/ and https://www.theregister.com/devops/2026/07/09/speedier-type-checks-in-typescript-70-as-first-stable-go-release-ships/ — TS 7.0 GA 2026-07-08; **no stable programmatic API until 7.1**, blocking typescript-eslint and framework tooling — **Confidence: MEDIUM** (secondary reporting; corroborated by two independent outlets and by the 7.0 beta announcement)
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/ — Project Corsa background

**Tooling and UI (§7, §8, §9):**
- https://tailwindcss.com/docs/upgrade-guide — v4 CSS-first `@theme`, `@config` for JS configs, `@tailwindcss/postcss`, browser floor
- https://ui.shadcn.com/docs/tailwind-v4 and https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4 — v4/React 19 registry, `data-slot`, OKLCH, `toast` → `sonner`
- https://biomejs.dev/blog/biome-v2/ — type-aware linting without the TypeScript compiler, plugins, domains
- https://github.com/timgit/pg-boss and https://timgit.github.io/pg-boss/ — `schema` option, `pg-boss migrate --schema`, own migration system — **Confidence: MEDIUM** (schema option confirmed; exact 12.x DDL footprint not audited line-by-line)

---
*Stack research for: local-first OSS agent-artifact registry*
*Researched: 2026-08-10*
