# Working in this repository

@AGENTS.md holds the invariants — what is true of AgentDock and must stay true.
This file holds the workflow: how to change it, which tool to reach for, and
what to run before saying you are done.

Read AGENTS.md first. Nothing here overrides anything there.

## Ponytail is the default posture

This project is built by the [ponytail](https://github.com/DietrichGebert/ponytail)
plugin's rules, at **full** intensity, and the codebase already reflects them:
one datastore, one client component, no CLI library, no icon package, no cache
layer, no state manager. Changes that add any of those need an argument, not a
preference.

The ladder, in order. Stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative need → skip it, say so.
2. **Is it already in this codebase?** `src/corpus/caps.ts` has the bounds,
   `src/ingest/errors.ts` has the messages, `src/components/Icon.tsx` has the
   glyphs. Look before writing.
3. **Does the standard library or PostgreSQL do it?** A constraint beats
   application code; `ON CONFLICT` beats a select-then-insert that can race.
4. **Does a native platform feature cover it?** A GET form with native controls
   beats a client component. CSS beats JavaScript.
5. **Does an installed dependency solve it?** Never add one for what a few lines
   can do.
6. **Can it be one line?**
7. Only then: the minimum that works.

The ladder shortens the solution, never the reading. Trace the real flow first —
a small diff in the wrong place is a second bug, not laziness.

### The `ponytail:` comment

A deliberate simplification that cuts a real corner with a known ceiling gets a
comment naming both the ceiling and the trigger to revisit. This codebase has
several already; they are load-bearing, not TODOs.

```ts
// ponytail: unindexed on ingest_job.target — a sequential scan at tens of
// thousands of job rows. The upgrade is one additive CREATE INDEX. Not built:
// this is a manual operation over hundreds of rows today.
```

A marker with no named trigger rots silently. `/ponytail-debt` collects every
marker into a ledger and flags the ones without one.

### Commands

| Command | When |
|---|---|
| `/ponytail` | Switch intensity (`lite`/`full`/`ultra`). Default is `full`. |
| `/ponytail-review` | Before finishing a change: what in this diff can be deleted |
| `/ponytail-audit` | Whole-tree sweep for over-engineering. Occasional, not per-change. |
| `/ponytail-debt` | Harvest every `ponytail:` marker into a ledger |

`/ponytail-review` looks for over-engineering only, never correctness. It does
not replace `bun run ci`.

## Before you write code

1. **Read the source, not the docs.** README.md and DEPLOY.md are written from
   the code and can lag it. Where they disagree, the code is right and the
   document is a bug — fix it in the same change.
2. **Find the seam.** Most requirements here have exactly one place they belong:
   a new acquisition bound goes in `src/corpus/caps.ts`, a new ingest outcome in
   `src/ingest/errors.ts` plus `retry.ts`'s total disposition record, a new
   discovery condition in `src/corpus/policy.ts`. Adding a second place is the
   most common way this codebase goes wrong.
3. **Check which invariant you are near.** Anything touching the database
   boundary, the verdict vocabulary, the star floor, ingestion at boot or the
   public surface is covered by AGENTS.md and by a test that will tell you.
4. **Grep every caller before changing a shared function.** One guard in the
   shared function is a smaller diff than a guard in each caller — and patching
   only the path a report names leaves its siblings broken.

## While you write it

- **Preserve existing tests.** A test that starts failing is a question to
  answer, not a line to edit. If the behaviour genuinely changed, change the
  test and say why in the same commit message.
- **Add a regression test for anything that was a bug.** Not a re-statement of
  the fix — a test that fails against the old code.
- **Do not silently change database, schema or search semantics.** A migration,
  a change to `NOT_LISTED_BECAUSE`, a change to the search predicate or to a
  weight is a decision, and it needs the reasoning written down beside it.
- **Comments carry the measurement, not the intent.** This codebase's comments
  record what was measured and what was rejected — "1,152 ms → 25.5 ms",
  "measured 2026-08-11, 253 registry seeds were re-tagged". Keep that register.
  A comment restating the code is noise.
- **Avoid new client-side dependencies.** There is one client component and it
  holds only a pending flag. A package that ships `'use client'` turns every
  import site into a client component; measure before adopting one.

## Before you call it done

Run these, in this order, and paste the real output:

```bash
bun run check:boundaries
bun run lint            # bun run format writes the fixes
bun run typecheck
bun run test
bun run build
```

`bun run ci` is the first four in one command, and it is exactly what CI runs.
The build is separate and comes last because it regenerates a type declaration
the linter reads.

Do not report a partial run as a pass. If a suite skips — the database-backed
ones skip without `DATABASE_URL` — say which and why.

## Git

**Claude does not commit and does not push.** Not with `--no-verify`, not as a
"checkpoint", not to a branch. Leave the change in the working tree and
**recommend a commit message** at the end of the report instead.

Also never: `git reset`, `git restore`, `git checkout -- <file>`, `git clean`,
`git stash`, `git rebase`. Uncommitted work in the tree may be the user's, and
none of those are recoverable from a transcript.

`git status`, `git diff`, `git log` and `git show` are always fine.

## The other tools on this machine

They overlap; this is which one to reach for.

| Tool | Use it for | Not for |
|---|---|---|
| **ponytail** | Every change. The posture, the ladder, the `ponytail:` markers. | Correctness review |
| **GSD** (`/gsd-*`) | Multi-phase work planned in `.planning/` — roadmap, phase plans, execution, verification | A one-file fix |
| **devops-skills** | Container, compose and deployment questions | Application code |

If a task is one file and one test, none of them apply — just do it.

## Deployment work

The deployed copy of this repository is a **deploy target, not a workspace**.
Source changes happen here, in the local checkout, and reach a server through
whatever deployment path the operator uses.

Never edit tracked source on a server. Never run `git clone`, `git pull` or
`git fetch` against a personal remote from one. See [DEPLOY.md](DEPLOY.md) for
the runbook, which is deliberately infrastructure-neutral — no host, no IP, no
database name and no credential belongs in it or in any other tracked file.
