<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AgentDock invariants

**This file holds what is true of the repository. [CLAUDE.md](CLAUDE.md) holds
how to work in it.** Both are short on purpose; anything long enough to need a
section of its own belongs in [README.md](README.md) or in a doc comment beside
the code it describes.

Everything below is enforced somewhere — by `bun run check:boundaries`, by a
test, or by PostgreSQL. None of it is a preference, and none of it should be
re-litigated in a diff. If you believe one is wrong, say so and stop; do not
route around it.

## The database is shared

AgentDock owns two schemas, `agentdock` and `agentdock_test`, and holds no
privilege on anything else in the instance. Another application's data may be
one schema over.

- Every table hangs off `pgSchema()`. `search_path` is a default, not a fence.
- A migration that names any other schema, leaves a target unqualified, or
  carries an unreviewed destructive verb fails `bun run check:boundaries`.
- `CREATE EXTENSION` never appears in an AgentDock migration. `pg_trgm` lives in
  `public`, installed out of band by a superuser; the migration that needs it
  carries a guard that fails loudly and names the command.
- There is no `db:push` and no `db:pull`. Those diff live database state, and
  the boundary scanner fails the build if such a script appears.
- Only `bun run corpus:reset` deletes corpus rows, and only behind two gates. It
  issues no `DROP` of any kind.

## AgentDock reads; it never runs

- Nothing from a scanned repository is executed. No `child_process`, no
  `node:vm`.
- Repository content never reaches disk. No `writeFileSync`, no
  `createWriteStream`. That removes archive extraction and path traversal by
  construction.
- Untrusted Markdown is never parsed into markup. No `rehype-raw`, no
  `dangerouslySetInnerHTML`.
- Every GitHub hostname lives in `src/github/`, so `git grep` answers "what can
  this reach" completely.

## No page renders a verdict

AgentDock reports what it observed. It never says an artifact is safe, clean,
verified, trusted, approved or malicious, and it publishes no grade or risk
score. The boundary scanner enforces the vocabulary across `src/app/**` and
`src/components/**`; the small list of sanctioned exceptions is in the scanner
itself, each with its reason.

Null and empty are different facts and must not render the same: an artifact
nothing analysed reads differently from one analysed and found to declare
nothing.

## Popularity schedules work; it never ranks artifacts

`MIN_REPOSITORY_STARS` in `src/corpus/policy.ts` is the single definition of the
discovery floor. Everything else reads it from there — the topic sweep's floor,
the outcome messages, the UI copy.

- It is an **entry gate**. A repository already in the corpus is never removed,
  hidden or downranked because its stars fell.
- It is **never a ranking input**. `src/db/queries/search.ts` and
  `src/db/queries/packages.ts` must not import it, and `policy.test.ts` asserts
  the complete list of modules that may.

## The web server does not ingest

`register()` starts nothing. A deploy, a restart, a crash recovery and a
rollback each issue zero GitHub requests. Ingestion is `bun run sync`, from
cron.

There is no `INGEST_WORKER` variable — the poll loop was deleted rather than
defaulted off, because a flag leaves the coupling one environment variable away
from returning. `src/instrumentation.test.ts` asserts the module does not so
much as name the worker.

## Nothing accepts a repository from the public

AgentDock has no accounts, no sign-in and no operator review. There is no
submission form and **no server function anywhere** — `src/app/no-public-ingest.test.ts`
asserts that structurally, because a server function is reachable by direct POST
whether or not a page renders a form for it.

`enqueueJob` stays: it holds the denylist check and the queue ceiling, and the
scheduler goes through it. What must not come back is a public caller.

## Every cap says what it dropped

A run that stops at a limit prints how much it left behind, and where. A sweep
that could not page through a shard names the shard and its size. A cap that
prints nothing reads as "we covered everything", which is the one thing this
project must never accidentally claim.

## Provenance is exact or absent

Every "source on GitHub" link points at the commit sha AgentDock actually read,
never at a branch. Bodies are stored as capped excerpts with attribution, never
as mirrors.
