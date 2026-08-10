# Phase 1 Context — Walking Skeleton

Decisions confirmed before planning. `RESEARCH.md` in this directory carries the evidence.

## Scope

One vertical slice, **Agent Skills only**:

```
owner/repo → repo metadata → SKILL.md discovery → parse → PostgreSQL → list + detail pages
```

Not in this phase: plugins, MCP servers, commands, hooks, capability detectors, search,
MCP registry sync, background job queue, authentication.

## Resolved open questions from RESEARCH.md

1. **Ship unauthenticated.** `GITHUB_TOKEN` stays empty. Unauthenticated core is 60/hr and
   an ingest costs 2 calls, so ~30 repo ingests per hour — ample for local development.
   The client must read `GITHUB_TOKEN` when present and send it, so adding a token later is
   a config change with no code change. Rate-limit state must be surfaced in errors.

2. **Drop `<img>` from the sanitizer allowlist.** No image proxy in this phase. Rendering a
   remote image from an untrusted repo leaks the viewer's IP to an attacker-controlled host
   and invites tracking pixels, for no value in a skill listing. Images render as their alt
   text. Revisit only if a proxy is built.

3. **Introduce the `artifact_type` dimension now, with exactly one value (`skill`).** This
   is the one place where building slightly ahead is cheaper than migrating later against
   live data — Phase 3 adds four more types. Do not build any other speculative
   abstraction.

## Facts from research that bind the implementation

- **The Trees API returns the COMMIT sha when given a branch name**, not the tree sha. This
  is the value that must be stored for permalinks: `github.com/o/r/blob/<commit-sha>/path`
  resolves, `<tree-sha>` 404s. `raw.githubusercontent.com` accepts both, so a raw-only
  smoke test will not catch this mistake. Store the commit SHA.
- **Ingest costs 2 unauthenticated core calls** (repo metadata + recursive tree). File
  bodies come from `raw.githubusercontent.com`, which costs no quota.
- **The spec is violated in practice, including by Anthropic's own repo.** Of 100 real
  `SKILL.md` files sampled: `name`/`description` 100%, non-spec `version` 24%, `metadata`
  20%, `license` 15%, `allowed-tools` 0%, `compatibility` 0%. One file exceeds the 1,024
  description cap; one declares a `name` that does not match its directory. A strict schema
  would discard about a quarter of the corpus. **Therefore: tolerant parse is the default
  path; strict validation is recorded as findings, never as a reason to drop an artifact.**
- **YAML alias bombs are cheap to parse and expensive to serialize.** `js-yaml` expands a
  205 MB alias bomb in 2 ms because aliases are shared references; the blow-up happens when
  the result is stringified into `jsonb`. An input-size cap alone does not stop it — a cap
  on the *serialized output* is also required.
- Pin `js-yaml@4.3.1`. The 5.x major is weeks old; every safety property was verified
  against 4.3.1.
- **A 304 conditional request DOES consume quota when unauthenticated** — GitHub's
  exemption applies only to authorized requests. This corrects `ARCHITECTURE.md`.
- **GraphQL is unavailable unauthenticated** (limit 0), so `ARCHITECTURE.md`'s batched
  metadata plan does not apply in this phase.
- Next 16 renamed `middleware` → `proxy.ts`. A nonce-based CSP requires it; without a nonce
  Next needs `script-src 'unsafe-inline'`, which `PITFALLS.md` forbids. Every page here is
  dynamic anyway, so the nonce path costs nothing already spent.

## Hard constraints

- Accept `owner/repo` only. A submitted URL is normalized to `owner` + `repo` and
  everything else discarded. Never fetch a URL taken from user input or from repo content.
- Fetch hosts are a hardcoded allowlist. Redirects are not followed off-host.
- Nothing from a scanned repository is ever executed or written to disk.
- No risk score, no letter grade, no SAFE/CLEAN/VERIFIED badge anywhere in the UI.
- All tables schema-qualified to `agentdock`; the boundary scanner must pass; no
  destructive migration; `pg_trgm` must not be installed.
- A parse failure on one artifact must not fail the whole repository ingest — record an
  artifact-level status.
- Ingest is idempotent: the same repo at the same commit re-ingested is a no-op.
- Diagnostics that disclose DB role or `search_path` must be development-only or removed.
- `bun run test` is the test entrypoint; `bun test` hangs in this environment.
- Do NOT `git commit` or `git push`. The maintainer commits.
