---
phase: 6
slug: search-browse
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-12
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `06-RESEARCH.md` § Validation Architecture (all rows verified against real config/source).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (`package.json`) |
| **Config file** | `vitest.config.ts` — DB-backed suites use `describe.skipIf(!DB_URL)` and the `test-owner/*` sentinel prefix; they skip visibly when `DATABASE_URL` is unset |
| **Quick run command** | `bun run test -- src/db/queries/search.test.ts src/db/queries/packages.test.ts` |
| **Full suite command** | `bun run ci` (check:boundaries + biome + tsc + vitest) |
| **Estimated runtime** | quick ~5 s · full ~60 s (Phase 5 measured `bun run ci` at 52 files / 883 tests) |

---

## Sampling Rate

- **After every task commit:** `bun run test -- src/db/queries/search.test.ts src/db/queries/packages.test.ts`
- **After every plan wave:** `bun run ci`
- **Before `/gsd-verify-work`:** full suite green, plus a headless browse pass over the maintainer's smoke set (`mcp`, `skill`, `claude`, `playwright`, `github`, one exact artifact name, one zero-result query, a type filter, a combined filter, page 2+)
- **Max feedback latency:** 10 s for the quick command

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| assigned by planner | 01 | 1 | DIS-03 | — | Relevance-ranked results, deterministic tie-break | integration (DB) | `bun run test -- src/db/queries/search.test.ts` | ❌ W0 | ⬜ pending |
| assigned by planner | 02 | — | DIS-04 | T-06-01 | Typo query resolves; skips cleanly when `pg_trgm` absent | integration (DB) | same file, `describe.skipIf` on extension presence | ❌ W0 | ⬜ pending |
| assigned by planner | 03 | — | DIS-05 | — | Type filter applied in SQL, not client-side | integration (DB) | same file | ❌ W0 | ⬜ pending |
| assigned by planner | 03 | — | DIS-06 | — | Capability filter incl. absence query "no scripts, no network, no shell"; Phase 4 vocabulary only | integration (DB) | same file | ❌ W0 | ⬜ pending |
| assigned by planner | 03 | — | DIS-07 | — | Zero-result state states fact + offers next step, never "does not exist" | SSR render | `bun run test` + headless browse | ❌ W0 | ⬜ pending |
| assigned by planner | 03 | — | DIS-08 | T-06-03 | `query`/`filters`/`result_count`/`duration_ms` logged in the existing structured shape | unit | `bun run test -- src/log.test.ts` | ❌ W0 | ⬜ pending |
| assigned by planner | — | — | DIS-10 | — | No new runtime dependency; no external service | structural | `bun run ci` | ✅ n/a | ⬜ pending |
| assigned by planner | 01 | 1 | D-20/D-21 | T-06-02 | Detail route resolves for all six artifact types; no path traversal; existing skill URLs still 200 | integration (DB) | `bun run test -- src/db/queries/packages.test.ts` | existing, needs cases | ⬜ pending |
| assigned by planner | 02 | — | D-31/D-32 (COR-07) | — | Suppressed artifact absent from global search, present at repository/direct route | integration (DB) | `src/db/queries/search.test.ts` | ❌ W0 | ⬜ pending |
| assigned by planner | 01 | 1 | D-40 | T-06-04 | Adversarial query set never 500s and never reaches `to_tsquery` | integration (DB) | same file | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/db/queries/search.test.ts` — DIS-03/04/05/06, COR-07-in-search, and the adversarial query set; must follow the existing `describe.skipIf(!DB_URL)` + `test-owner/*` sentinel pattern from `src/db/queries/packages.test.ts`
- [ ] `src/db/queries/packages.test.ts` — new cases for the generalized `sourcePathFromUrl` / `detailHref`: one per non-skill type (command, plugin, hook, mcp_server) plus a skill regression case
- [ ] A `describe.skipIf` guard that skips trigram assertions cleanly when `pg_trgm` is not installed, mirroring the `DATABASE_URL`-absent skip — required because CI and most local databases will not have the extension
- [ ] `src/log.test.ts` — assert the new search log record shape (no test file for `src/log.ts` exists today)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Rendered search flow has no console errors | ROADMAP criterion 1–4 (UX) | Requires a real browser; the project has no E2E framework and must not gain one | Headless browse: `/artifacts` → search `mcp` → apply type filter → open a result detail → back → page 2; assert HTTP 200 and empty console |
| Narrow-width layout does not break | D-51 | Visual | Same headless pass at a narrow viewport; check search input, filter row, result metadata |
| `pg_trgm` present in the target database | D-03 | Requires superuser, out of band | `select extname from pg_extension where extname='pg_trgm'` before running DIS-04 tests |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
