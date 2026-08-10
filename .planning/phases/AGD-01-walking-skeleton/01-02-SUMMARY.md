---
phase: AGD-01-walking-skeleton
plan: 02
subsystem: github-fetch-wall
tags: [ssrf, redirects, rate-limit, streaming-caps, secrets]
status: complete

requires:
  - 01-01 (check-boundaries rule 5 no-host-sprawl, which reserves src/github/)
provides:
  - src/github/client.ts — normalizeRepo / githubFetch / readCapped / GitHubError / rateLimitState
  - src/github/types.ts — TreeEntry / RepoMetadata / RepoTree / RateLimit / GitHubFailure
  - src/github/repo.ts — fetchRepoMetadata
  - src/github/tree.ts — fetchRepoTree (commit SHA, 40-hex asserted)
  - src/github/raw.ts — fetchRawFile (zero-quota host)
  - src/github/scan.ts — fetchRepoScanInputs / CAPS
  - src/env.ts — normalizeGithubToken, GITHUB_TOKEN in the schema
affects:
  - src/env.test.ts (5 new cases)

tech-stack:
  added: []
  patterns:
    - One directory owns every outbound byte; the boundary scanner enforces it
    - Redirects re-validated per hop, never followed and never refused wholesale
    - Exhaustion classified from headers, never from a status code
    - Content-Length is a claim by the party being defended against, so it is never read

key-files:
  created:
    - src/github/types.ts
    - src/github/client.ts
    - src/github/client.test.ts
    - src/github/repo.ts
    - src/github/tree.ts
    - src/github/raw.ts
    - src/github/scan.ts
    - src/github/scan.test.ts
    - src/github/permalink.test.ts
  modified:
    - src/env.ts
    - src/env.test.ts

decisions:
  - normalizeRepo rejects CR/LF explicitly, because JS `$` matches before a trailing newline
  - normalizeGithubToken split out of parseEnv so the client needs no DATABASE_URL
  - The live permalink check costs ONE core request, not two

metrics:
  duration: ~25m
  completed: 2026-08-10

actuals:
  tokens: 47000
  tasks: 3
  commits: 0
---

# Phase AGD-01 Plan 02: The Fetch Wall Summary

One directory owns every byte AgentDock reads from the internet: a hardcoded
two-host allowlist, an anchored `owner/repo` pattern applied before any URL is
constructed, per-hop redirect re-validation, a streaming byte counter that never
consults `Content-Length`, and rate-limit exhaustion classified from headers.

## Not committed

**No `git commit` or `git push` was run.** The maintainer commits. The plan's
per-task commit protocol was skipped for that reason; everything is in the
working tree.

## What was verified, with real output

| Command | Result |
|---|---|
| `bun run typecheck` | clean |
| `bun run test` | 12 files, **184 passed** (all three plans combined) |
| `bun run check:boundaries` | `2 migration file(s), package.json, 1 schema module, 23 source file(s)` → OK |
| `CI=1 bun run test` | `9 passed \| 3 skipped (12)` files, `175 passed \| 9 skipped (184)` |
| `bun run ci` | boundaries OK, biome clean, tsc clean, 184 passed |

The live permalink suite skips **visibly** under CI:

```
↓ src/github/permalink.test.ts > the Trees API returns a commit SHA (live)
    > returns a sha that resolves as a blob permalink on github.com
```

## The undocumented assumption, measured

`src/github/permalink.test.ts` ran live and passed. The rate limit went
**57 → 56** across the run, which is the honest measurement:

- **Cost: ONE unauthenticated core request per run**, not two. `fetchRepoTree` is
  the only core call; the blob probe goes to `github.com`, which is not the
  core-quota host. The plan estimated two; one is what it actually spends.
- **If it ever fails:** the remedy is one extra core call per ingest to
  `/repos/{owner}/{repo}/commits/{ref}`, reading `.sha` from there. That takes an
  ingest from two core calls to three — roughly twenty repositories an hour
  unauthenticated rather than thirty. Recorded in the test file itself so nobody
  has to rediscover it.

**Conditional requests save no quota while unauthenticated.** A 304 consumes core
quota because GitHub's exemption applies only to authorized requests, so no
`If-None-Match` is sent anywhere. The ETag is still captured on the metadata
response, because the column exists and Phase 2 wants it the moment a token
appears.

Total core budget spent by this plan: **1 request** (the live check).
No credential was read, printed, or logged.

## The SSRF table and the redirect matrix

Fourteen rejection cases, each asserting the stubbed fetch was **never invoked** —
a validator that rejects after the request has left has already failed. Five
acceptance cases, plus one extra (`anthropics/.git`, which must not normalize to
an empty repository name).

| Location returned | Result |
|---|---|
| `https://evil.tld/x` | refused — `Refusing to contact evil.tld.` |
| `http://api.github.com/repos/a/b` | refused — scheme downgrade |
| `https://api.github.com.evil.tld/x` | refused — suffix, not the host |
| `https://api.github.com/repositories/123` | **followed** — the rename case |
| three consecutive same-host hops | refused at the third, after exactly 3 calls |
| a 3xx with no `location` | refused |

Exhaustion, classified from headers rather than status: a 403 with
`x-ratelimit-remaining: 0` → `rate_limited` carrying the reset epoch; a 429 with
`retry-after` → `rate_limited`; **a 403 with quota remaining → not exhaustion**,
returned to the caller as a 403.

`readCapped` on a 1,000-chunk stream against a 4 KB cap: the source produced
fewer than 10 chunks and its `cancel()` ran. A response declaring
`content-length: 1` while streaming megabytes is still cut at the cap.

## Deviations from Plan

### 1. [Rule 1 — Bug] `normalizeRepo` accepted a trailing newline

- **Found during:** Task 1, by the plan's own rejection table.
- **Issue:** `'anthropics/skills\n'` was **accepted**. JavaScript's `$` matches
  before a trailing newline unless the `m` flag is set, so
  `/^[A-Za-z0-9].../.test('anthropics/skills\n')` is `true`. The `.trim()` then
  hid it by removing the character — meaning the anchored pattern the whole
  control rests on was not actually anchored, and removing the trim at any future
  point would have let a CRLF-injection shape through into URL construction.
- **Fix:** an explicit `if (/[\r\n]/.test(input)) return null;` **before** the
  trim, with a comment naming the `$` behaviour. Line terminators are refused
  outright rather than normalized away; ordinary space padding is still accepted,
  as the acceptance table requires.
- **Files modified:** `src/github/client.ts`
- **Regression test:** the plan's own table row now passes for the right reason.

### 2. [Rule 3 — Blocking] `githubFetch` calling `parseEnv()` would have required a database

- **Found during:** Task 1.
- **Issue:** Reference C calls `parseEnv()`, which requires `DATABASE_URL`. Under
  `CI=1` the vitest config deliberately does not load `.env`, so every SSRF and
  redirect test would have thrown on a missing `DATABASE_URL` — breaking the
  QUA-05 requirement that these regressions run with no database and no network.
- **Fix:** `src/env.ts` now exports `normalizeGithubToken(raw)`, the same zod
  schema fragment used by `envSchema.GITHUB_TOKEN`, callable on one value.
  `githubFetch` calls `normalizeGithubToken(process.env.GITHUB_TOKEN)`. Same
  validation, no database coupling, and the `client.ts → env.ts` link the plan
  requires is intact.
- **Files modified:** `src/env.ts`, `src/github/client.ts`

### 3. [Blocked] `.env.example` could not be modified

The plan asks for one line under the GitHub section documenting what the empty
token mode costs. **This environment denies all read access to `.env.example`**
(the permission rule appears to glob `.env*`), so it could not be read to append
correctly without risking a duplicate `GITHUB_TOKEN` entry.

The information was placed in `src/env.ts` instead, directly above the schema
field, where it is guaranteed to be seen by anyone touching the variable:

> AgentDock runs unauthenticated at 60 core requests an hour — two per
> repository, so about thirty repositories an hour — and must degrade to that
> rather than depend on a token existing.

**Action for the maintainer:** add a `GITHUB_TOKEN=` line with that note to
`.env.example` by hand if it is not already there.

### 4. `readRateLimit` requires the headers to be present

Reference C reads `Number(res.headers.get(...))`, and `Number(null)` is `0` — so a
response with **no** rate-limit headers would have recorded a fabricated
`remaining: 0` and every subsequent 403 would have been misreported as
exhaustion. The header presence is now checked before the numbers are parsed.

### 5. Per-task commits skipped

The phase's hard constraints forbid the executor from committing. Constraints won.

## Requirements satisfied

| ID | Evidence |
|---|---|
| ING-02 | 14-case rejection table, each asserting zero fetch calls; hosts hardcoded in one `Set`; `check:boundaries` keeps both hostnames inside `src/github/` |
| ING-03 | `redirect: 'manual'`, `assertAllowedHost` per hop, HTTPS enforced, 2-hop cap; matrix above |
| ING-04 | `spends exactly two API-host requests and takes every body from the raw host` asserts hostnames, not intent |
| ING-05 | No filesystem write exists in `src/github/`; `no-disk-write` rule passes |
| ING-06 | Per-file bytes (512 KB), file count (200), depth (10), entry count (100,000) and wall clock (120 s) each proven by a test; the byte cap is a streaming counter |
| ING-07 | `truncated` is returned as state; a `ponytail:` comment in `tree.ts` names the trigger that would justify a subtree walk |
| ING-10 | No execution path in `src/github/`; `no-execution` rule passes |
| FND-06 | `GITHUB_TOKEN` optional; empty and whitespace-only both normalize to `undefined` |
| FND-08 | A sentinel token appears in no thrown message: transport failures are replaced with a fixed string, and the env formatter never echoes values |
| QUA-05 | The SSRF table and the redirect matrix run with no database and no network — proven by `CI=1 bun run test` |

## Known Stubs

| Stub | File | Reason |
|---|---|---|
| `invalid_repo` is declared in `GitHubFailure` but never thrown | `src/github/types.ts` | `normalizeRepo` returns `null` rather than throwing; the submit action in a later plan is what turns that null into the failure. |
| `rateLimitState()` exported and unused by product code | `src/github/client.ts` | The interface that surfaces "quota reopens at HH:MM" is plan 01-06's. |
| `etag` captured but never sent back | `src/github/repo.ts` | Deliberate: a 304 costs quota while unauthenticated. Phase 2 uses it when a token exists. |

## Notes for later plans

- `bun test` still hangs. `bun run test` is the entrypoint.
- The client sends `cache: 'no-store'` and a fixed `user-agent: agentdock`.
- Every URL is built from the two validated parts with per-segment encoding. Do
  not add a code path that interpolates a raw submitted string.
- Concurrency for raw reads is **2**, deliberately. Raising it is how undocumented
  abuse throttling gets discovered in production.

## Self-Check: PASSED

All nine created files exist on disk. No commit hashes to verify — nothing was
committed, by constraint.
