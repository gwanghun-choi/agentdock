---
phase: AGD-01-walking-skeleton
plan: 06
subsystem: interface-and-documentation
tags: [ui, server-rendering, pagination, provenance, readme, ci]
status: complete

requires:
  - 01-01 (listPackages, countPackages, permalink)
  - 01-04 (SkillBody, metaDescription, globals.css floor, proxy.ts nonce CSP)
  - 01-05 (ingestRepository, the nine outcomes)
provides:
  - src/app/page.tsx — home, submit entry, budget line, recent skills
  - src/app/actions.ts — submitRepo, the trust boundary
  - src/app/skills/page.tsx — the paginated listing
  - src/app/r/[owner]/[repo]/page.tsx — repository page with the incompleteness banner
  - src/app/r/[owner]/[repo]/[...path]/page.tsx — the detail page and its metadata
  - src/components/SubmitForm.tsx, src/components/PackageRows.tsx
  - src/db/queries/packages.ts — getRepositoryPackages, getPackageDetail, sourcePathFromUrl, detailHref
  - README.md rewritten against the real structure
affects:
  - .github/workflows/ci.yml (build before check)
  - src/db/schema.ts ($type narrowing on three jsonb columns)
  - scripts/seed-fixture.mjs (now runs the real pipeline)

tech-stack:
  added: []
  patterns:
    - No CSS framework; ~330 lines of plain CSS on the existing custom properties
    - Route parameter types written by hand, never from the generated helper
    - Every page force-dynamic, because the build runs where there is no database

key-files:
  created:
    - src/app/actions.ts
    - src/components/SubmitForm.tsx
    - src/components/PackageRows.tsx
    - src/app/r/[owner]/[repo]/page.tsx
    - src/app/r/[owner]/[repo]/[...path]/page.tsx
  modified:
    - src/app/page.tsx
    - src/app/layout.tsx
    - src/app/skills/page.tsx
    - src/app/globals.css
    - src/db/queries/packages.ts
    - src/db/schema.ts
    - scripts/seed-fixture.mjs
    - README.md
    - .github/workflows/ci.yml

decisions:
  - The budget line reads the last-seen rate-limit headers instead of fetching; no network on a page render
  - No src/components/Meta.tsx — metaDescription() from plan 01-04 already covers the sink
  - db:seed now runs the real pipeline against frozen bytes, which deletes three of plan 01-01's stubs

metrics:
  duration: ~40m
  completed: 2026-08-10

actuals:
  tokens: 68000
  tasks: 3
  commits: 0
---

# Phase AGD-01 Plan 06: The Interface Summary

Sixty indexed skills across three repositories, each with a detail page that
shows both licence sources labelled by origin, both timestamps labelled
distinctly, GitHub's star count labelled as GitHub's, and a permalink to the
exact file at the exact commit — and not one score, grade or badge anywhere.

## Not committed

**No `git commit` or `git push` was run.** The maintainer commits. Everything
from plans 01-01 through 01-06 is in the working tree.

## Task 4 — the human checkpoint — was NOT performed

Task 4 is `checkpoint:human-verify`. Per the execution instructions it was not
blocked on: implementation is complete and verified automatically, and the
manual browser pass (dark mode, 360-pixel layout, keyboard tabbing, tone) is
still outstanding. Run `bun run dev` and work through the plan's eight-point list.

## What was verified, with real output

In the required order:

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | `Checked 199 installs across 328 packages (no changes)` |
| `bun run build` | Compiled successfully; **all four routes `ƒ (Dynamic)`**, `ƒ Proxy (Middleware)` present |
| `bun run ci` | boundaries OK (**31 source files**), biome clean, tsc clean, **229 tests passed (14 files)** |
| `CI=1 bun run test` | `10 passed \| 4 skipped` files — still skips visibly with no database |

`bun run build` was run **before** `bun run ci`, as required.

Task 1's and Task 2's automated verifications both passed verbatim against a
real `bun run start` server:

```
TASK1-VERIFY-OK      # brand present, anthropics/skills present,
                     # no "search_path", no "agentdock_app" in the served HTML
TASK2-VERIFY-OK      # listing survives ?page=1&page=2, repository page lists,
                     # blob/f17010c9bb483898c1d9c9f42dde2b3a98889434/ present,
                     # "GitHub stars" present, "does not run" present,
                     # /r/anthropics/no-such-thing/x → 404
```

Task 3's greps: `bun run db:migrate`, `bun run ci`, `60` and `src/github` all
present in README.md; `bun run build` present in `.github/workflows/ci.yml`.

**Zero GitHub requests were spent by this plan.** See below.

## The artifact counts shown back to the user

The reference ingest, run through the real pipeline against the frozen capture:

```
{"ok":true,"owner":"anthropics","repo":"skills",
 "fullName":"anthropics/skills",
 "commitSha":"f17010c9bb483898c1d9c9f42dde2b3a98889434",
 "found":18,"stored":18,"failed":0,"truncated":false}
```

which the submit action renders as:

> Read anthropics/skills at f17010c: 18 skills found, 18 stored.

Two more fixtures were seeded to give the interface real breadth:

| Repository | found | stored | truncated |
|---|---|---|---|
| `anthropics/skills` | 18 | 18 | false |
| `JimLiu/baoyu-skills` | 22 | 22 | false |
| `wshobson/agents` | 20 | 20 | **true** |

60 skills total, which is what made the paginator testable for real:
`Showing 1–25 of 60`, `Showing 26–50 of 60`, `Showing 51–60 of 60`, with
Previous absent on the first page and Next absent on the last.

`wshobson/agents` is the useful one: only 20 of its 180 skill files are in the
capture, so the scan reports incompleteness and the repository page says so —

> AgentDock read part of this repository, so this listing is not everything that
> is in it.

## Observed ingest duration

**210 ms, 282 ms and 217 ms** for the three repositories above — but those are
fixture reads from local disk through the real pipeline, not live ingests. **No
live ingest was performed**, deliberately: the pages are verified against the
pinned commit `f17010c9…`, and a live ingest would move the repository to
whatever HEAD is today and break the permalink assertion. The wall-clock figure
a person will actually see is dominated by 18 sequential-pair `raw` fetches at
concurrency 2 and is not measured here. Task 4's manual pass measures it.

## What the detail page actually renders

From `/r/anthropics/skills/skills/canvas-design`, verbatim:

```
Type                            Agent Skill
Source repository               anthropics/skills · on GitHub
Path in repository              skills/canvas-design/SKILL.md
Licence, declared in the file   Complete terms in LICENSE.txt
Licence, detected by GitHub     not detected
Declared version                not declared
Last changed upstream           2026-08-07
Last read by AgentDock          2026-08-10 08:35 UTC
GitHub stars                    167306
Permalink                       https://github.com/anthropics/skills/blob/f17010c9…/skills/canvas-design/SKILL.md
Frontmatter fields              Uses only specification fields.
```

Both honest-unknown paths are visible on the reference repository itself:
GitHub detects no licence for a 167,306-star repository, and the file declares no
version. From `JimLiu/baoyu-skills` the other direction is visible —
`Declared version 1.117.4`, `Licence, detected by GitHub MIT`, and
`Also declares version, which the specification does not define.`

Parse observations render as observations. `template/SKILL.md` reads:

> name "template-skill" does not match directory "template"

and `claude-api`:

> description is 1068 characters, over 1024

Neither is called invalid, and neither file is dropped.

## Vocabulary and leakage scan across every page

Eight rendered pages concatenated (home, listing, listing page 2, two repository
pages, three detail pages) and scanned:

| Scan | Matches |
|---|---|
| `risk score\|grade\|verified\|trusted\|malicious\|unsafe\|safe to use\|score` | **0** |
| `<img` | **0** |
| stack-frame shapes, `node_modules/`, `Error:` | **0** |
| `search_path`, `agentdock_app`, `postgres://`, `DATABASE_URL` | **0** |

The standing disclosure sits in the site footer, so it is on every page rather
than on one:

> AgentDock reads files and reports what it read. It does not run them, and it
> cannot say whether an artifact is safe. Read anything before you use it.

## Deviations from Plan

### 1. [Rule 1 — Bug] A page past the end printed "Showing 26–25 of 18"

- **Found during:** Task 2, probing `/skills?page=999`.
- **Issue:** the range was computed from the offset rather than from what was
  actually returned, so any page past the last one rendered a backwards range
  over a total it did not contain — a paginator's first lie.
- **Fix:** the range is now computed only when the page has rows; an empty page
  past the end says `There is no page N` with a link back to the first.
- **Verified:** `page=999` → "There is no page 999"; pages 1–3 report
  `1–25`, `26–50`, `51–60` of 60.

### 2. The home page's budget line reads the last-seen headers instead of fetching

Decision 5 in the plan calls for a soft `rate_limit` request on the home page
render, guarded and short-timeout. That call would have to live in `src/github/`
(the `no-host-sprawl` rule) as new code whose only job is to produce a number
`rateLimitState()` already holds from plan 01-02 — the same number, from the
headers of the request AgentDock most recently made.

So the page reads that instead: no network on a page render, no timeout guard,
no new module, no failure path to design. The line is honest in both states:

> AgentDock runs unauthenticated. GitHub allows it 60 requests an hour and each
> repository costs two, so roughly thirty repositories an hour. **It has not
> called GitHub since this server started.**

and after an ingest, `55 of 60 were left after its most recent request.`

The trade recorded honestly: the number is per server process and resets on
restart, where a live `rate_limit` call would survive one. If that matters later,
add `fetchRateLimit()` to `src/github/` — it is the same guard the plan
described, deferred rather than lost.

### 3. No `src/components/Meta.tsx`

Listed in `files_modified`, but plan 01-04 already built `metaDescription()` in
`src/components/metadata.ts` for exactly this sink, and both `generateMetadata`
functions call it. A second metadata module would have been a wrapper around a
four-line function.

### 4. `listPackages` gained a repository filter AND `getRepositoryPackages` was added

The plan asks for both; they are not redundant. The repository page needs the
repository row itself — its scan time, its description, and the truncation flag —
which a filtered package listing cannot supply. `getRepositoryPackages` reads the
repository, returns `null` if it is not indexed (which is the page's 404), and
delegates the listing to `listPackages({ fullName })`.

### 5. `scripts/seed-fixture.mjs` now runs the real pipeline

Not in `files_modified`. It was needed: the pages had to be verified against real
ingested data at the **pinned** commit, and a live ingest would have moved the
repository off `f17010c9…` and broken the permalink assertion in Task 2's own
verify command.

The file already existed to "put the frozen fixture into the database through the
real `persistScan()`", but it hand-rolled a stub scan with `frontmatter: {}`,
`parseStatus: 'ok'` and a directory-derived name — three of plan 01-01's five
Known Stubs, each labelled "real parsing arrives in plan 01-03". It now replaces
`globalThis.fetch` with a fixture reader and calls `ingestRepository`, which is a
**net deletion** and clears all three. Any host the fixture does not cover throws
rather than resolving.

### 6. `$type` narrowing on three jsonb columns

`meta`, `frontmatter` and `parse_errors` inferred as `unknown` on read, which the
detail page cannot use. `.$type<…>()` is a TypeScript-only narrowing that emits
no DDL, so no migration is generated and none is needed — chosen over casting at
every call site.

### 7. Four source boundary rules described in the README, not five

The plan says five. `scripts/check-boundaries.mjs` has five *rules* total, of
which one (rule 5) is the source scan and contains **four** checks:
`no-raw-html`, `no-execution`, `no-disk-write`, `no-host-sprawl`. The README
documents the four that exist, in a table with what each protects.

### 8. `.env.example` was not touched

This environment denies all access to `.env*`. The file was not read, edited or
copied. `cp .env.example .env` remains in the README's run instructions and is a
**maintainer action** — the rest of that sequence (`bun install`,
`bun run db:migrate`, `bun run build`, `bun run start`) was executed and works.

### 9. Per-task commits skipped

Forbidden by the phase's hard constraints.

## Requirements satisfied

| ID | Evidence |
|---|---|
| FND-09 | `bun install` → `bun run db:migrate` → `bun run dev` documented and executed (except the `.env` copy, see deviation 8) |
| DIS-01 | 60 skills paginated 25 to a page, browsable with no account; three pages verified |
| DIS-02 | The full field inventory rendered, quoted verbatim above |
| DIS-09 | All four routes report `ƒ (Dynamic)`; content is in the initial response, verified with `curl` and no JavaScript |
| DIS-11 | `light-dark()` with no script, one `<h1>` per page, header/main/footer landmarks, `#main` skip-link destination now exists, `:focus-visible` ring, labelled input, `role="status" aria-live="polite"` result region |
| DIS-12 | `overflow-wrap: anywhere`, `word-break: break-all` on paths, `* { min-width: 0 }`, three-line clamp on descriptions, `.facts` collapses to one column below 40rem. **Visual confirmation at 360 px is Task 4's.** |
| PRV-01 | `blob/f17010c9bb483898c1d9c9f42dde2b3a98889434/` asserted in the served detail page; plan 01-01 proved that URL returns 200 |
| PRV-02 | "Last changed upstream 2026-08-07" and "Last read by AgentDock 2026-08-10 08:35 UTC" as two separate rows |
| PRV-03 | "GitHub stars 167306" |
| PRV-05 | "not declared" on anthropics, "1.117.4" on baoyu — never synthesized |
| PRV-06 | "Licence, declared in the file: Complete terms in LICENSE.txt" and "Licence, detected by GitHub: not detected" |
| PRV-07 | 32 KB excerpt through `SkillBody`, with attribution and a permalink to the pinned source |
| INS-01 / INS-02 | Two copyable paths per runtime; nothing in the interface executes, and no line pipes a download into a shell |
| ING-02 | `submitRepo` performs no validation of its own; it calls `ingestRepository`, whose anchored pattern runs before URL construction. The `pattern` attribute is commented as cosmetic. |
| ING-07 | `wshobson/agents` renders the incompleteness banner; `anthropics/skills` does not |
| QUA-01 / QUA-02 | `bun run ci` |
| QUA-07 | Only the fixed outcome strings reach the page; the leakage scan found no stack frame, path or internal on any page |
| QUA-08 | The runner installs, builds, then runs the one command |

## Known Stubs

| Stub | File | Reason |
|---|---|---|
| `sourcePathFromUrl` maps by filename suffix | `src/db/queries/packages.ts` | Carries a `ponytail:` comment. Phase 3 resolves the manifest filename from the detector registry when there is more than one artifact type. |
| Repository page lists up to 250 artifacts, unpaginated | `src/db/queries/packages.ts` | Bounded by the scan's own 200-file cap, so it cannot overflow. A paginator here would be a paginator for a bound that already exists. |
| The budget number is per server process | `src/app/page.tsx` | Deviation 2. Resets on restart; the honest-unknown state is rendered rather than a guess. |
| No automated vocabulary check | — | The plan defers it to the disclosure work. What applies now is that the words were never written; the scan above is a one-off, not a gate. |

## Notes for later plans

- **Every page must export `dynamic = 'force-dynamic'`.** The build runs where
  there is no database, and a page whose only async work is a query has no
  request-time API in it for the framework to notice.
- The layout owns the single `<main id="main">`. A page that renders its own
  `<main>` produces two landmarks and breaks the skip link.
- Route parameter types are written by hand as promises. Do not reach for the
  generated helper — it needs types that exist only after a build.
- `bun run db:seed [fixture]` is the way to get realistic rows. It costs nothing
  and it exercises the real pipeline.
- The detail URL for a repository-root `SKILL.md` is `/r/{owner}/{repo}/SKILL.md`;
  `sourcePathFromUrl` and `detailHref` are inverses and must stay that way.

## Self-Check: PASSED

All five created files exist on disk, and every claim above was produced by a
command whose output is quoted. Nothing was committed, by constraint.
