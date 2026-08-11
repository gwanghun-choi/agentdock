# Phase 3: Detector Pluralism — Research

**Researched:** 2026-08-11
**Domain:** Multi-format artifact detection for a static-analysis GitHub ingestion pipeline (Claude Code plugins, marketplace catalogs, MCP server declarations, commands, hooks) layered onto an existing skill-only detector architecture.
**Confidence:** HIGH on file layouts and schemas (fetched from official `code.claude.com` and `modelcontextprotocol.io` docs this session, cross-checked against this repo's own already-verified AGD-01/AGD-02 findings). MEDIUM on real-world prevalence of each format (no live corpus sampling was done this session, unlike AGD-01's 100-file skill sample) and on the exact false-positive rate of shape-only plugin detection.

There is no CONTEXT.md for this phase — the maintainer chose to plan from research + requirements directly. Every design decision below is a recommendation with stated evidence and an explicit alternative; the planner should treat unresolved items as decisions to make, not settled facts.

<phase_requirements>
## Phase Requirements

| ID | Description | Research support |
|----|-------------|-------------------|
| DET-02 | Claude Code plugins detected, including when `plugin.json` is absent, via directory shape | [§2 Plugin detection](#2-plugin-detection-det-02) |
| DET-03 | `marketplace.json` treated as a catalog that emits repository seeds, not a package | [§3 Catalog / marketplace.json](#3-catalog-marketplacejson-det-03) |
| DET-04 | MCP server declarations detected and parsed | [§4 MCP server declarations](#4-mcp-server-declarations-det-04) |
| DET-05 | Commands and hooks detected | [§5 Commands and hooks](#5-commands-and-hooks-det-05) |
| DET-06 | Monorepos with many artifacts yield all of them | [§6 Monorepo / nesting](#6-monorepo--nesting-det-06) |
| DET-07 | A malformed/partial artifact is recorded with an explicit parse status, never fails the repository | [§7 Failure isolation](#7-per-candidate-failure-isolation-det-07) |
| DET-09 | A new artifact type = one detector file + one registration, no pipeline change | [§8 Detector interface](#8-the-detector-interface-det-09) |
| QUA-03 | Detectors, analyzers, and identity logic have unit tests | [§9 Fixtures](#9-fixtures-det-10-qua-03-qua-05) |
| QUA-05 | Security fixtures (XSS, SSRF, invisible characters, malformed frontmatter, oversized repository) are permanent regression tests | [§9 Fixtures](#9-fixtures-det-10-qua-03-qua-05) |
</phase_requirements>

## Anti-goals (explicit, so the plan does not drift)

- **No capability detection.** Shell/network/secret/hidden-content extraction is CAP-01..CAP-14, Phase 4. Where a detector *sees* something capability-shaped (e.g. an MCP server's `command`/`args`), it is stored as structural data in `meta`, never interpreted as a risk signal.
- **No plugin-framework abstraction.** The extension point stays a file plus one array element, exactly as `detect/index.ts` already documents.
- **No risk scoring, no safety verdicts**, anywhere, ever — this is a project-wide constraint (STATE.md, REQUIREMENTS.md CAP-10), not a phase-local one.

## Summary

Five findings should shape how this phase is planned.

**One.** Claude Code's own docs, fetched live this session, confirm the plugin manifest is optional and describe exactly what "shape" means: a directory is a plugin when it has `.claude-plugin/plugin.json` **or** any of the default component directories (`skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `workflows/`, `output-styles/`) `[CITED: code.claude.com/docs/en/plugins-reference]`. But those same component directories are *also* the shape of a plain (non-plugin) skills/commands/hooks layout at the repository root — Claude Code's own three-way distinction (skill vs `@skills-dir` plugin vs plugin-bundled skill) turns entirely on the presence of `.claude-plugin/plugin.json`. **Shape-only plugin detection without that manifest is therefore a genuine false-positive risk**, not a hypothetical one: a bare `commands/` or `hooks/` directory in an unrelated repository is structurally identical to a manifest-less plugin. §2 below gives a concrete, conservative rule and states its known failure mode rather than pretending the ambiguity away.

**Two.** `marketplace.json`'s schema is richer than the current `RepoSeed` sketch anticipated, and it is a genuine multiplier: one file lists N plugin entries, each carrying a `source` object that is one of six shapes (`relative path`, `github`, `url`, `git-subdir`, `npm`, `archive`) `[CITED: code.claude.com/docs/en/plugin-marketplaces]`. Only `github`/`url`/`git-subdir` sources are GitHub-reachable and thus seedable by this project's ingestion model; `npm` and `archive` sources have no repository at all and must be recorded but not seeded. There is no existing seed storage — `agentdock.repo_seed` does not exist in `src/db/schema.ts` today, only a sketch of it in `ARCHITECTURE.md`. This phase should create that table, but must **not** wire seeds into `ingest_job`/`enqueueJob` — that coupling is Phase 5's job (COR-03), and doing it now risks exactly the queue-flood scenario the phase brief warns about (`MAX_QUEUED = 500` is a shared, unauthenticated-submission flood ceiling; a single 200-plugin marketplace should not be able to consume 40% of it before Phase 5 has designed prioritization for seed-origin jobs).

**Three.** Claude Code slash commands were **merged into skills** as of a recent release: `[CITED: code.claude.com/docs/en/skills]` *"Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way... Files in `.claude/commands/` support the same frontmatter."* A command is a flat `.md` file with **the identical frontmatter schema** already implemented in `src/detect/frontmatter.ts` and `src/detect/skill.ts` — same YAML fence, same six-plus-fourteen-field vocabulary, same tolerant-parse philosophy. The only structural differences are the path shape (a single file, not a `<name>/SKILL.md` directory) and the identity source (filename minus extension, not directory name). This means the command detector should **reuse** `parseFrontmatter` rather than duplicate a second frontmatter parser — that reuse is what keeps DET-09's "one file" promise honest.

**Four.** Hooks are structurally *not* an installable artifact the way a skill or an MCP server is — a hook is a JSON event-handler declaration (`{"hooks": {"PostToolUse": [...]}}`) that only does something in the context of a specific tool matcher and a specific command to run. It has no name, no description, no independent identity a user would search for. It exists at two independent locations with two different schemas: `hooks/hooks.json` (or inline `plugin.json.hooks`) inside a **plugin**, and `.claude/settings.json`'s top-level `"hooks"` key for a **project**. Recommendation in §5: detect and parse both shapes, but store each repository's hook set as **one package row per hook config file found** (not per individual hook entry), with `meta.hookCount` and `meta.events` (the matched lifecycle event names) as the queryable surface — mirroring how `marketplace.json` is one catalog, not N packages.

**Five.** The `Candidate.parentPath` field and the `package.parent_path` column do not yet exist as a persisted column (`src/db/schema.ts`'s `packageTable` has no `parentPath`); `ARCHITECTURE.md`'s claim that nesting needs "no schema change" is about the **identity** constraint only, which is correct — `(repository_id, type, source_path)` already disambiguates a plugin-owned skill from a top-level skill because `source_path` differs. But `parentPath` as *data* (for UI containment / ranking) does require one additive, nullable `ALTER TABLE package ADD COLUMN parent_path text` migration. This is compliant with every constraint in this project (additive, no `DROP`, `agentdock` schema only) but should not be glossed over as "no schema change at all."

**Primary recommendation:** Extend the existing `Detector` type with two small, additive fields (`producesPackages?: boolean`, `seeds?(...)`) rather than a parallel abstraction; reuse `parseFrontmatter`/the skill's tolerant-validation style for every new format instead of introducing `zod` into `detect/` (zod is installed but used only in `env.ts` today — AGD-01 already deviated from `ARCHITECTURE.md`'s original "one Zod schema per type" plan in favor of hand-rolled tolerant validation, and this phase should stay consistent with what was actually built, not what was originally sketched); compute `parentPath` once, generically, in the pipeline refactor (03-01) rather than per-detector, so DET-09 continues to hold for detectors 6, 7, 8…

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Plugin/catalog/MCP/command/hook path matching | API / server (`src/detect/*`) | — | Pure functions over the in-memory tree array, exactly like the existing skill detector. No I/O, unit-testable with zero mocking — DET-10's requirement. |
| Plugin/MCP/hook JSON parsing | API / server (`src/detect/*`) | — | `JSON.parse` on untrusted input, size-capped like the frontmatter parser. Never in the browser. |
| Frontmatter parsing (commands) | API / server (`src/detect/frontmatter.ts`, reused) | — | Already exists; this phase adds a caller, not a new parser. |
| `parentPath` computation | API / server (`src/ingest/pipeline.ts`, one generic pass) | — | Needs the full candidate set across all detectors for one repository, so it cannot live inside a single detector without breaking DET-09's "no per-type pipeline change" promise. |
| Seed persistence (`repo_seed`) | Database | API / server (`src/ingest/persist.ts`) | An `ON CONFLICT (full_name) DO UPDATE` upsert, same idempotency pattern as `repository`/`package`. |
| Seed → job fan-out | *(explicitly out of scope this phase)* | — | Phase 5 (COR-03) owns turning `repo_seed` rows into `ingest_job` rows with rate-aware prioritization. |
| Per-candidate try/catch, isolation | API / server (`src/ingest/pipeline.ts`) | — | Already exists for `parse()`; this phase must additionally guard `match()` — see §7. |

## Standard Stack

No new runtime dependencies. Confirmed against the registry this session:

| Library | Installed version | Registry-current | Verdict |
|---------|-------------------|-------------------|---------|
| `js-yaml` | 4.3.1 (pinned to the `v4-legacy` tag) | 5.2.3 `[VERIFIED: npm view js-yaml version]` | Keep pinned. AGD-01's research already recorded the reason (`CORE_SCHEMA` returns plain JSON-serializable values; v5's default schema behavior was not evaluated and re-verifying it is out of this phase's scope). |
| `zod` | 4.4.3 | 4.4.3 `[VERIFIED: npm view zod version]` | Already current. **Not recommended for new detector code** — see Summary point above and "Don't Hand-Roll" below. |

**Installation:** none required.

## Package Legitimacy Audit

Not applicable — this phase installs no new packages. `js-yaml` and `zod` were already audited in AGD-01/AGD-02 and remain unchanged.

## Architecture Patterns

### System flow for this phase (data flow, not file listing)

```
                 GitHub Tree (one repo, already fetched by Phase 2's scan)
                              │
                              ▼
        ┌─────────────────────────────────────────────────────────┐
        │  for each Detector in DETECTORS: detector.match(tree)    │   <- pure, path-only, 0 fetches
        │  skill │ plugin │ catalog │ mcp │ command │ hook          │
        └───────────────────────────┬───────────────────────────────┘
                                     │ Candidate[] (all types, flattened)
                                     ▼
        ┌─────────────────────────────────────────────────────────┐
        │  ONE generic pass: assign parentPath                     │   <- new in 03-01, not per-detector
        │  (candidate nested under a plugin candidate's directory?)│
        └───────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
        ┌─────────────────────────────────────────────────────────┐
        │  fetch only candidate.needs paths (raw.githubusercontent)│   <- unchanged from Phase 1/2
        └───────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
        ┌─────────────────────────────────────────────────────────┐
        │  for each candidate: try { detector.parse(candidate) }   │   <- per-candidate isolation, DET-07
        │  catch -> parse_status='failed', continue loop            │
        └───────────────┬─────────────────────────┬─────────────────┘
                         │                          │
            producesPackages=true      producesPackages=false (catalog only)
                         │                          │
                         ▼                          ▼
              packages: ScannedPackage[]     seeds: RepoSeed[]
                         │                          │
                         ▼                          ▼
              persistScan() -> package,     persistSeeds() -> repo_seed
              package_version (existing)     (NEW, additive table, no fan-out)
```

### Recommended project structure (additions only)

```
src/detect/
├── types.ts          # extend Detector: producesPackages?, seeds?()
├── index.ts           # DETECTORS array grows to 6, one import + one element per type
├── skill.ts            # unchanged
├── frontmatter.ts     # unchanged; REUSED by command.ts
├── plugin.ts           # NEW — .claude-plugin/plugin.json present, OR shape-only fallback
├── catalog.ts          # NEW — .claude-plugin/marketplace.json; producesPackages=false
├── mcp.ts               # NEW — .mcp.json (repo/plugin root) + server.json
├── command.ts           # NEW — commands/*.md, reuses parseFrontmatter
└── hook.ts               # NEW — hooks/hooks.json (plugin) + .claude/settings.json "hooks" key

src/ingest/
├── pipeline.ts         # +1 generic parentPath pass, +1 branch for producesPackages=false
├── persist.ts          # +persistSeeds() transaction, alongside existing persistScan()
└── types.ts             # +RepoSeed type

src/db/
└── schema.ts             # +package.parentPath (nullable, additive)
                           # +repo_seed table (new, additive)
                           # +artifact_type rows: plugin, mcp_server, command, hook (INSERT, not migration)

fixtures/
├── plugin-with-manifest/
├── plugin-shape-only/
├── plugin-false-positive/   # a bare commands/ dir that is NOT a plugin — the negative case
├── marketplace/
├── mcp-project-root/
├── mcp-plugin-bundled/
├── mcp-server-json/
├── command-flat-file/
├── hook-plugin-config/
├── hook-project-settings/
└── monorepo-nested/          # plugins/foo/skills/bar/SKILL.md — the DET-06 stress case
```

### Pattern 1: Shape-only plugin detection with an explicit false-positive guard

**What:** A directory is a plugin candidate when it contains `.claude-plugin/plugin.json` (confident) **or** when it contains **at least two** of the recognized component shapes (`skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`) at the same directory level with no manifest (shape-only, lower confidence).

**When to use:** DET-02 requires plugin detection to work when the manifest is absent. Requiring ≥2 component shapes (not 1) is the concrete mitigation for the false-positive risk stated in Summary point one: a single `commands/` directory in an unrelated repo (e.g. this very project's own `scripts/`, or a docs repo with a `commands/` folder of CLI reference pages) is common and proves nothing; two or more component directories co-located (`hooks/hooks.json` **and** `agents/`, say) is a much stronger, still-cheap-to-check signal.

**Known failure mode (state this, do not hide it):** A repository root that legitimately has both a `commands/` directory (e.g. a CLI tool's command reference) and an unrelated `agents/` directory (e.g. a multi-agent simulation project) will still false-positive as a manifest-less plugin. There is no path-only rule that eliminates this; recommend the manifest-less case is recorded with `parse_status='partial'` and a `meta.detectionConfidence: 'shape-only'` flag, never `'ok'`, so the UI can visually distinguish "declared plugin" from "looks like a plugin." This is the honest ceiling, not a solved problem.

**Example (recommended match logic, not verified code — the planner writes the real implementation):**
```typescript
// Illustrative only. Confirms the two rules described above.
const COMPONENT_DIRS = ['skills/', 'commands/', 'agents/', 'workflows/', 'output-styles/'];
const COMPONENT_FILES = ['hooks/hooks.json', '.mcp.json', '.lsp.json'];

function pluginCandidateRoots(tree: TreeEntry[]): string[] {
  // group all paths by their top-level directory, then apply the manifest-or-2-shapes rule
  // (full grouping logic is a planning decision — this states the rule, not the code)
}
```

### Pattern 2: Command detector reuses the skill frontmatter parser

**What:** `command.ts`'s `match()` returns candidates for every `commands/*.md` (and nested `commands/**/*.md`) path; `parse()` calls the *existing*, unmodified `parseFrontmatter` from `frontmatter.ts`, then derives `name` from the filename (minus `.md`) rather than from a parent directory, per the verified mapping table: `[CITED: code.claude.com/docs/en/skills]` *"File under `.claude/commands/` → File name without extension → `.claude/commands/deploy.md` → `/deploy`"*.

**When to use:** Always, for DET-05's command half. This is the concrete form of DET-09's promise: the sixth-and-seventh formats (command, and any future flat-frontmatter format) cost a new `match()` and a thin `parse()` wrapper, not a new parser.

**Example:**
```typescript
// Source: derived from code.claude.com/docs/en/skills (naming rule) and this
// repo's existing src/detect/frontmatter.ts (reused, not reimplemented)
import { parseFrontmatter } from './frontmatter';

export const command: Detector = {
  type: 'command',
  match(tree) {
    return tree
      .filter((e) => e.type === 'blob' && /(^|\/)commands\/.+\.md$/.test(e.path))
      .map((e) => ({ type: 'command', sourcePath: e.path, needs: [e.path] }));
  },
  async parse(c, read) {
    const source = await read(c.sourcePath);
    const parsed = parseFrontmatter(source, c.sourcePath);
    // name = filename without extension (NOT directory, unlike skill.ts)
    const name = c.sourcePath.split('/').pop()!.replace(/\.md$/, '');
    // ... same tolerant-validation shape as skill.ts, different name-source rule
  },
};
```

### Pattern 3: Catalog detector as a non-package-producing Detector

**What:** `catalog.ts` matches `.claude-plugin/marketplace.json`. Its `parse()` still returns a `ParseResult` (for error/warning reporting), but the detector's static `producesPackages: false` tells the pipeline to never push its artifact into `packages[]`; instead the pipeline calls `catalog.seeds(candidate, result)` and pushes the return value into `seeds[]`.

**When to use:** This is the DET-09 stress test named in the brief. See §8 for the full interface recommendation and the rejected alternatives.

**Example:**
```typescript
// Illustrative interface shape — see §8 for the authoritative recommendation
export const catalog: Detector = {
  type: 'catalog',
  producesPackages: false,
  match(tree) {
    return tree
      .filter((e) => e.type === 'blob' && e.path.endsWith('.claude-plugin/marketplace.json'))
      .map((e) => ({ type: 'catalog', sourcePath: e.path, needs: [e.path] }));
  },
  async parse(c, read) { /* JSON.parse, size-capped, tolerant of unknown fields */ },
  seeds(c, result) {
    // Only github/url/git-subdir sources are seedable; npm/archive sources are
    // recorded in the seed's `hint` jsonb but never enqueued (no repository).
  },
};
```

### Anti-Patterns to Avoid

- **A base `Detector` class or a plugin-registration DSL.** `ARCHITECTURE.md` and this repo's own `detect/index.ts` comment are explicit that the extension point is one file + one array element. A sixth format (plugin) and a seventh (catalog) are both proof points for that promise — adding a factory or a dynamic-loading mechanism here would be the exact over-engineering the project's own philosophy warns against.
- **Introducing `zod` for detector schemas.** It is an available, current dependency, but AGD-01 already built and shipped the tolerant hand-rolled pattern (`SPEC_KEYS`, warnings array, `ok`/`partial`/`failed` status) and it is tested, working code today. Switching detector validation style mid-project for five new formats adds a second validation idiom for no behavior change.
- **Wiring `repo_seed` into `ingest_job` in this phase.** `ingestJob`'s own schema comment states plainly: *"No `kind` column and no `priority` column. Phase 5's registry-sync jobs are a different shape and a five-line migration away; guessing at their key now costs the same migration and would be wrong."* The same logic applies to seed-originated jobs — Phase 5 needs to decide how seed volume interacts with `MAX_QUEUED` and submission priority, which this phase cannot responsibly pre-empt.
- **Treating a hook config file as N packages (one per hook entry).** A hook entry has no name, no description, and is meaningless outside its file's context (an event handler is not a searchable artifact on its own). One package row per hook **file**, consistent with how `marketplace.json` is one catalog, not N.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Frontmatter parsing for commands | A second YAML-frontmatter splitter | `parseFrontmatter` from `frontmatter.ts`, already caps input/serialized size and uses `CORE_SCHEMA` | It already handles the CRLF/BOM/duplicate-key/alias-bomb cases AGD-01 measured against 100 real files; a second implementation would need to re-earn all of that. |
| JSON schema validation for plugin/marketplace/mcp/hook manifests | Ad hoc `if (typeof x.field !== 'string')` chains scattered per file, or a new zod schema per type | The same tolerant `{ok, status, warnings[]}` pattern already proven in `skill.ts` | Consistency, and it matches every recognized-field-tolerance rule Anthropic's own docs describe (*"Claude Code ignores top-level fields it does not recognize"*). |
| Directory-shape detection helpers (grouping tree entries by parent dir) | A generic "directory tree" data structure | A `Map<string, TreeEntry[]>` built once per repository scan and passed to any detector that needs directory-level grouping (plugin, catalog) | The tree is already a flat array of ~500–2,000 entries (AGD-01's measured range); a real tree structure is unneeded complexity at this size. |

**Key insight:** every new detector in this phase is a variation on "parse a small YAML/JSON manifest with known-but-not-enforced fields, tolerantly." The codebase already solved that problem once, correctly, with evidence from a real corpus. The job of this phase is applying that solved shape five more times, not re-solving it.

## Runtime State Inventory

Not applicable — this is a greenfield feature phase (new detectors, new table, new column), not a rename/refactor/migration phase.

## Common Pitfalls

### Pitfall 1: Treating `.mcp.json`'s `mcpServers` key as the only MCP declaration shape
**What goes wrong:** A detector that only matches `.mcp.json` misses plugin-bundled MCP servers declared **inline** in `plugin.json` (`"mcpServers": {...}` as an object, not a path), and misses `server.json` (the MCP *registry* publishing manifest, a completely different schema — `name`, `repository`, `packages[]`, `remotes[]` — not `mcpServers`).
**Why it happens:** The two schemas share the word "MCP" and both live at a repository root, inviting a single regex.
**How to avoid:** Two separate match rules inside `mcp.ts` (or two candidates types under one detector): `.mcp.json`-shaped (`mcpServers: {name: {command|url, args?, env?}}`) and `server.json`-shaped (registry manifest: `name`, `description`, `repository`, `version`, `packages[]`). Also check `plugin.json`'s `mcpServers` field when parsing plugin candidates — this is inline data, not a separate file, so it is naturally handled by the plugin detector reading the same manifest it already fetched, not by the mcp detector.
**Warning signs:** A fixture repo with a plugin bundling a database MCP server produces zero MCP package rows.

### Pitfall 2: `match()` throwing and crashing the whole scan
**What goes wrong:** `src/ingest/pipeline.ts`'s current per-candidate isolation wraps `detector.parse()` in try/catch (confirmed by reading the file: `const result = await detector.parse(candidate, read);` is inside the per-candidate loop, but `detector.match(inputs.tree.entries)` at line 192 is called **unguarded**, once per detector, outside any try). A detector whose `match()` throws (e.g. a malformed path with unexpected characters breaking a regex, or a directory-grouping helper indexing past an array bound) aborts the entire repository's ingestion — the DET-07 violation the phase brief specifically asks about.
**Why it happens:** `match()` is documented as "pure" and is trusted not to throw because the existing skill detector's `match()` is a simple `.filter().map()` that cannot throw on any input. New detectors (plugin shape-grouping, catalog parsing multiple source types) are meaningfully more complex and can throw on adversarial or merely unusual paths.
**How to avoid:** Wrap each detector's `match()` call in its own try/catch inside the pipeline's detector loop, exactly as `parse()` already is. On throw: skip that detector for this repository, record a warning (e.g. via the job's `progress`/log line), and continue with the remaining detectors — one detector's bug must not lose every other detector's findings for that repository.
**Warning signs:** A single crafted path (e.g. deeply nested `../`-shaped or absurdly long) causes a 0-package "no_artifacts" result for a repository that visibly has skills.

### Pitfall 3: A `needs` array that grows unbounded from a catalog with many entries
**What goes wrong:** The `Candidate.needs` array declares which paths `parse()` will read, and it exists specifically so a repo with zero artifacts costs zero fetches. A catalog or MCP detector whose `needs` accidentally includes every plugin's *own* manifest (trying to "resolve" the plugin sources eagerly) reintroduces per-repo fetch costs that the two-phase match/parse split was built to prevent, and can blow past `CAPS.maxFiles = 200`.
**Why it happens:** It is tempting for the catalog detector to want to read each listed plugin's `plugin.json` to enrich seed metadata (name, description) beyond what's already inline in `marketplace.json`.
**How to avoid:** Don't. `marketplace.json` entries already carry `name`, `description`, `version`, `author`, `category`, `tags` inline per the schema fetched this session — there is no need to fetch anything beyond the one `marketplace.json` file itself. `needs: [c.sourcePath]` only, same as every other detector.
**Warning signs:** A repository containing one `marketplace.json` with 50 plugin entries suddenly costs dozens of raw fetches instead of one.

### Pitfall 4: Losing a hook's file-format distinction between plugin and project scope
**What goes wrong:** `.claude/settings.json`'s `hooks` key sits alongside unrelated project settings (`enabledPlugins`, `pluginConfigs`, permissions, etc). A hook detector that naively treats any `.claude/settings.json` as "a hooks artifact" produces a misleading package for the (common) case of a `settings.json` with no `hooks` key at all.
**Why it happens:** Path-only `match()` cannot see file contents; `.claude/settings.json` existing is not sufficient evidence of a hook declaration.
**How to avoid:** `match()` still returns a candidate for every `.claude/settings.json` and `hooks/hooks.json` found (cheap, path-only), but `parse()` returns `ok: false` (not a package at all — return a sentinel the pipeline drops silently, not a `parse_status='failed'` row) when the parsed JSON has no non-empty `hooks` key. A `settings.json` with no hooks is not a malformed hook artifact; it is simply not a hook artifact, and should produce **no row**, the same way a repo with no `SKILL.md` produces no skill packages.
**Warning signs:** Every repository with a checked-in `.claude/settings.json` (common, for `enabledPlugins` alone) shows up as having a "hook" package.

## Code Examples

### 1. Plugin manifest schema — verbatim, complete

`[CITED: code.claude.com/docs/en/plugins-reference]`, fetched 2026-08-11.

```json
{
  "name": "plugin-name",
  "displayName": "Plugin Name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": { "name": "Author Name", "email": "author@example.com", "url": "https://github.com/author" },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "metadata": { "catalogId": "cat-123", "tier": "pro" },
  "skills": "./custom/skills/",
  "commands": ["./custom/commands/special.md"],
  "agents": ["./custom/agents/reviewer.md"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json",
  "experimental": { "themes": "./themes/", "monitors": "./monitors.json" },
  "dependencies": ["helper-lib", { "name": "secrets-vault", "version": "~2.1.0" }]
}
```

Only `name` is required if a manifest is present at all — `[CITED: code.claude.com/docs/en/plugins-reference]` *"If you include a manifest, `name` is the only required field."* And critically for tolerant parsing: *"Claude Code ignores top-level fields it does not recognize."* — same posture as the existing `SPEC_KEYS`-and-warnings pattern in `skill.ts`, just applied to a JSON manifest instead of YAML frontmatter.

Directory layout, verbatim:
```
enterprise-plugin/
├── .claude-plugin/           # Metadata directory (optional)
│   └── plugin.json
├── skills/
├── commands/
├── agents/
├── workflows/
├── output-styles/
├── themes/
├── monitors/
├── hooks/
│   ├── hooks.json
│   └── security-hooks.json
├── bin/
├── settings.json
├── .mcp.json
├── .lsp.json
└── scripts/
```
`[CITED: code.claude.com/docs/en/plugins-reference]`: *"The `.claude-plugin/` directory contains the `plugin.json` file. All other directories ... must be at the plugin root, not inside `.claude-plugin/`."*

### 2. marketplace.json schema — verbatim, complete

`[CITED: code.claude.com/docs/en/plugin-marketplaces]`, fetched 2026-08-11.

```json
{
  "name": "company-tools",
  "owner": { "name": "DevTools Team", "email": "devtools@example.com" },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",
      "description": "Automatic code formatting on save",
      "version": "2.1.0",
      "author": { "name": "DevTools Team" }
    },
    {
      "name": "deployment-tools",
      "source": { "source": "github", "repo": "company/deploy-plugin" },
      "description": "Deployment automation tools"
    }
  ]
}
```

Required at top level: `name` (kebab-case), `owner` (object, `name` required), `plugins` (array). Each plugin entry requires `name` and `source`. Six source shapes, verbatim field lists:

| Source | Fields |
|--------|--------|
| Relative path | `string` starting with `./`, resolved against the marketplace root (directory containing `.claude-plugin/`) |
| `github` | `repo` (required, `owner/repo`), `ref?`, `sha?` |
| `url` | `url` (required, git URL), `ref?`, `sha?` |
| `git-subdir` | `url` (required), `path` (required), `ref?`, `sha?` |
| `npm` | `package` (required), `version?`, `registry?` |
| `archive` | `url` (required, HTTPS only), `sha256?` |

**Only `github`, `url`, and `git-subdir` are GitHub-ingestible.** `npm` and `archive` sources have no repository URL at all — a seed generated from one of those can carry the package/archive identifier in `hint` jsonb, but must not be handed to `enqueueJob` (there is no `owner/repo` to normalize).

### 3. `.mcp.json` schema — project scope

`[CITED: code.claude.com/docs/en/mcp]`, fetched 2026-08-11.

```json
{
  "mcpServers": {
    "shared-server": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

stdio form:
```json
{
  "mcpServers": {
    "plugin-database": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": { "DB_PATH": "${CLAUDE_PLUGIN_ROOT}/data" }
    }
  }
}
```
`type` accepts `stdio` (default when `command` is present), `http`, `sse`, or `streamable-http` (an alias for `http`) `[CITED: code.claude.com/docs/en/mcp]`. Plugin-bundled servers live at `.mcp.json` in the **plugin root** or inline as `plugin.json`'s `mcpServers` field — same schema, different location, confirmed by the same doc: *"Plugins define MCP servers in `.mcp.json` at the plugin root or inline in `plugin.json`."*

### 4. `server.json` schema — MCP registry publishing manifest

`[CITED: modelcontextprotocol.io/registry/quickstart]`, fetched 2026-08-11 (WebFetch-summarized; the JSON block below is reproduced from the fetched page's own code sample, not independently re-verified against a live repository this session — treat the exact field names as MEDIUM confidence and re-check against a real `server.json` in the wild during planning if this detector ships).

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.my-username/weather",
  "description": "An MCP server for weather information.",
  "repository": { "url": "https://github.com/my-username/mcp-weather-server", "source": "github" },
  "version": "1.0.1",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@my-username/mcp-weather-server",
      "version": "1.0.1",
      "transport": { "type": "stdio" }
    }
  ]
}
```

`name` follows `io.github.<owner>/<slug>` reverse-DNS convention when GitHub-authenticated with the registry, but the field itself is a free string in the schema — do not assume the `io.github.` prefix is always present (a DNS-authenticated publisher can use a custom domain prefix, per the same doc). This file lives at the **repository root** by convention (`mcp-publisher init` writes it there), and its presence alongside a `package.json` `mcpName` field is the strongest possible path-only signal that a repository is a self-published MCP server.

### 5. Hook config shapes — plugin vs project

Plugin form (`hooks/hooks.json` or inline `plugin.json.hooks`), `[CITED: code.claude.com/docs/en/plugins-reference]`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/format-code.sh" }
        ]
      }
    ]
  }
}
```

Project form (`.claude/settings.json`'s `hooks` key), same inner shape, different container — confirmed via a synthesized (non-verbatim) fetch of `code.claude.com/docs/en/hooks`; treat this shape as **CITED but not word-for-word verified** and re-confirm the top-level key name (`"hooks"` inside `settings.json`, sibling to `enabledPlugins`) during planning if precision matters:
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh" } ] }
    ]
  }
}
```

Hook `type` values, verbatim from the plugin reference page: `command`, `http`, `mcp_tool`, `prompt`, `agent`. Event names span 30+ lifecycle points (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, etc.) — the full verbatim table is in the fetched plugin-reference content; the detector should store the **set of event names present** in `meta.events` rather than re-deriving Claude Code's full lifecycle vocabulary, since new events are added between Claude Code releases and hard-coding the list would silently go stale.

### 6. Current `Detector` interface (read from source, this session)

`[VERIFIED: src/detect/types.ts:28-34]`
```
export type Detector = {
  type: string;
  /** PURE. Path-only. No network, no database, no filesystem. Runs over every tree. */
  match(tree: TreeEntry[]): Candidate[];
  /** Reads only the paths declared in candidate.needs. */
  parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult>;
};
```
`[VERIFIED: src/detect/types.ts:3-11]`
```
export type Candidate = {
  type: string;
  /** The manifest file. Becomes part of the package identity key. */
  sourcePath: string;
  /** Containing plugin or catalog directory. Unused in this phase; Phase 3 fills it. */
  parentPath?: string;
  /** Every path parse() will read, declared up front so the fetch set is cappable. */
  needs: string[];
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| Separate `commands/*.md` custom-command format with its own conventions | Commands merged into the skills system; `.claude/commands/*.md` and `.claude/skills/<name>/SKILL.md` are two file shapes for the same underlying mechanism, sharing frontmatter | Documented as current in `code.claude.com/docs/en/skills`, fetched 2026-08-11; exact version cutover not stated in the fetched page | The command detector should be a thin wrapper around the skill's frontmatter parser, not an independent format |
| `plugin.json` manifest required | Manifest optional; auto-discovery from default component directories, with `name` derived from the directory | Current, per the same fetch | Path-only detection must handle the no-manifest case as a first-class path, not a fallback |

**Deprecated/outdated:** None identified as deprecated within this phase's scope this session — the artifact formats researched are all current, actively-documented conventions as of the fetch date.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | The project-scope hooks schema (`.claude/settings.json`'s `"hooks"` key, sibling to `enabledPlugins`) matches the plugin `hooks/hooks.json` inner shape exactly | §5 Code Example 5 | If the wrapping key or matcher shape differs, the hook detector's `match()`/`parse()` for the project-scope case needs correction; low blast radius since it's isolated to `hook.ts` |
| A2 | `server.json`'s exact field names (`packages[].registryType`, `packages[].identifier`, `repository.source`) are stable as shown in the fetched quickstart example | §4, Code Example 4 | Registry schema is documented as "in preview" by MCP's own docs (`registry.modelcontextprotocol.io` — *"currently in preview. Breaking changes or data resets may occur"*); if the schema has moved, the mcp detector's `server.json` branch needs a re-check against a live repository before shipping |
| A3 | Requiring "≥2 component shapes" (rather than any single one) for manifest-less plugin detection produces an acceptable false-positive rate | §2 Pattern 1 | No corpus was sampled this session to measure this (unlike AGD-01's 100-file skill sample). If ≥2 is still too permissive or too strict against real repositories, the plan should include a step to sample ~20-30 real GitHub repos with `commands/`/`agents/`/`hooks/` directories and measure before locking the threshold |
| A4 | One package row per hook config file (not per hook entry) is the right identity granularity | §Summary point 4, Anti-Patterns | If a future requirement wants per-hook-event filtering/search, this collapses that data into `meta` rather than queryable columns; acceptable now per DAT-05's meta-jsonb escape-hatch pattern, revisit if hooks become search-filterable |
| A5 | `.mcp.json` and `server.json` are the only two MCP-declaration file shapes worth detecting in this phase (excluding `claude_desktop_config.json`, which is a user's local config, never committed to a repo) | §4, Pitfall 1 | If a real corpus shows repos commonly documenting MCP setup via a checked-in `claude_desktop_config.json` example file, that path is currently unhandled; low risk since such files are typically named `*.example.json` and would need a distinct heuristic anyway |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **What is the real-world prevalence of each artifact type?**
   - What we know: `STATE.md`'s Open Questions already flags this as unresolved project-wide ("Actual distribution of artifact types in the wild, which affects detector priority").
   - What's unclear: Whether plugins, MCP servers, commands, or hooks are more common in the GitHub corpus this project will eventually crawl (Phase 5). This affects nothing about correctness in this phase, but could affect which detector to build/test first within the 03-02/03-03 plan split.
   - Recommendation: Not blocking. Build all five in the order the roadmap already specifies (plugin/catalog/mcp in 03-02; command/hook/monorepo/isolation in 03-03) since that grouping is driven by shared mechanics (plugin+catalog+mcp all read JSON manifests; command+hook are the "smaller, isolation-focused" half), not by prevalence.

2. **Should the plugin detector attempt to resolve `commands`/`agents`/`skills` path-override fields from `plugin.json` (the `Component path fields` table) when computing which sub-paths belong to the plugin?**
   - What we know: `plugin.json` can override default directories (e.g. `"commands": ["./custom/cmd.md"]` replaces the default `commands/` scan) — verified verbatim from `code.claude.com/docs/en/plugins-reference`.
   - What's unclear: Whether this phase's `parentPath` computation needs to honor those overrides, or whether a simpler "any skill/command/mcp candidate whose path starts with a plugin candidate's directory prefix" heuristic (ignoring path-override fields) is good enough for DET-06's monorepo requirement.
   - Recommendation: Use the simpler prefix heuristic. Honoring path overrides precisely would require reading and parsing every plugin's manifest before computing `parentPath` for every other candidate, which couples detectors together and risks exactly the fetch-cost blowup warned about in Pitfall 3. The prefix heuristic gets the common case right (nested directory = child) and degrades gracefully (a plugin using an unusual override path just doesn't get its children linked, but each child is still independently discovered and stored as its own package — DET-06's actual requirement, "yield all of them," is still met).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 |
| Config file | `vitest.config.ts` (exists, verified via `ls`) |
| Quick run command | `bun run test` (not `bun test` — CONTEXT.md for AGD-02 and this repo's README both record that Bun's own runner hangs on this project's vitest-based suite) |
| Full suite command | `bun run ci` (`check:boundaries && lint && typecheck && test`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|---------------|
| DET-02 | Plugin detected with manifest | unit | `bun run test -- src/detect/plugin.test.ts` | ❌ Wave 0 |
| DET-02 | Plugin detected without manifest (shape-only), and the false-positive fixture does NOT detect | unit | same file | ❌ Wave 0 |
| DET-03 | `marketplace.json` produces seeds, zero package rows | unit | `bun run test -- src/detect/catalog.test.ts` | ❌ Wave 0 |
| DET-04 | `.mcp.json` and `server.json` each parsed | unit | `bun run test -- src/detect/mcp.test.ts` | ❌ Wave 0 |
| DET-05 | Command frontmatter parsed via reused `parseFrontmatter` | unit | `bun run test -- src/detect/command.test.ts` | ❌ Wave 0 |
| DET-05 | Hook config (both plugin and project shape) parsed; `settings.json` with no hooks key produces zero rows | unit | `bun run test -- src/detect/hook.test.ts` | ❌ Wave 0 |
| DET-06 | Monorepo fixture: nested plugin+skill both persist as distinct packages with correct `parentPath` | unit + integration | `bun run test -- src/ingest/pipeline.test.ts` (extend existing file) | ✅ file exists, extend |
| DET-07 | A `match()` throw in one detector does not abort other detectors' candidates for the same repo | unit | `bun run test -- src/ingest/pipeline.test.ts` | ✅ extend existing |
| DET-09 | Registering a 7th hypothetical detector requires touching only `index.ts` + a new file (documented via a throwaway test detector, then removed — or a code-review checklist item, not a persisted test) | manual-only | — | N/A — this is a structural property, verified by review, not runtime-testable |
| QUA-03 | All new detectors unit-tested against frozen fixtures | unit | `bun run test` (whole suite) | mixed — new files above |
| QUA-05 | Malformed-manifest / oversized-catalog fixtures are permanent regressions | unit | extend `fixtures/adversarial/` with JSON-shaped malformed fixtures (bad `plugin.json`, oversized `marketplace.json`) | ❌ Wave 0 — new adversarial fixtures needed |

### Sampling Rate
- **Per task commit:** `bun run test -- <changed detector's test file>`
- **Per wave merge:** `bun run ci`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `fixtures/plugin-with-manifest/`, `fixtures/plugin-shape-only/`, `fixtures/plugin-false-positive/` — captured or hand-written fixture trees for DET-02
- [ ] `fixtures/marketplace/` — a `marketplace.json` with at least one entry of each source type (relative, github, url, git-subdir, npm, archive) for DET-03
- [ ] `fixtures/mcp-project-root/`, `fixtures/mcp-plugin-bundled/`, `fixtures/mcp-server-json/` — for DET-04
- [ ] `fixtures/command-flat-file/` — for DET-05 (command half)
- [ ] `fixtures/hook-plugin-config/`, `fixtures/hook-project-settings/`, plus a `settings.json` with no `hooks` key (negative case) — for DET-05 (hook half)
- [ ] `fixtures/monorepo-nested/` — `plugins/foo/skills/bar/SKILL.md` plus a top-level skill, for DET-06
- [ ] New `fixtures/adversarial/` entries: malformed `plugin.json`, malformed `marketplace.json`, a `match()`-crashing path shape (for QUA-05 / Pitfall 2 regression), an oversized `marketplace.json` (for Pitfall 3 regression)
- [ ] Consider extending `scripts/capture-fixtures.mjs` with a real public plugin/marketplace repo pin (e.g. a plugin marketplace repository that genuinely exists on GitHub) so at least one fixture per new type is real-world, not hand-written — recommended but not blocking; hand-written fixtures are sufficient to satisfy DET-10's "no network, no token" requirement on their own.

## Security Domain

`security_enforcement: true`, ASVS level 1, `security_block_on: high` (from `.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No | This phase adds no auth surface |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | **Yes** | Every new manifest format (plugin.json, marketplace.json, .mcp.json, server.json, hooks.json, project settings.json) is untrusted repository content. Continue the established pattern: size-capped input, `JSON.parse` (safe, no code-execution path) or `yaml.load` under `CORE_SCHEMA` via the existing `parseFrontmatter`, tolerant-not-rejecting validation with a recorded `parse_status`. |
| V6 Cryptography | No | No new crypto surface; `contentHash` (sha256) reuse is unchanged |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Alias-bomb / billion-laughs JSON or YAML manifest (a `marketplace.json` or `plugin.json` with deeply nested or repeated structures) | Denial of Service | Apply the same two-cap pattern AGD-01 already built for frontmatter (`inputBytes` cap before parse, `serializedBytes` cap after parse via `JSON.stringify`) to every new JSON manifest parser. `JSON.parse` itself has no alias mechanism (unlike YAML), so the primary residual risk is a manifest with many thousands of small array entries (e.g. `marketplace.json` with 100,000 plugin entries) rather than an amplification bomb — cap the `plugins[]` / `packages[]` array length, not just byte size. |
| SSRF via a `marketplace.json` `source: {url: ...}` or `archive: {url: ...}` field | Tampering / SSRF | Already covered by the project-wide invariant (`ARCHITECTURE.md`, verified): *"stored as data and never fetched in the MVP."* This phase must not add any `fetch()` call driven by a value read from a manifest — seeds are stored, never dereferenced by this phase. |
| `match()` throwing on adversarial paths (e.g. pathological regex backtracking on a very long or unusual tree path) | Denial of Service | See Pitfall 2 — wrap every detector's `match()` in the pipeline's own try/catch, same as `parse()` already is. Keep every new `match()` regex simple (no nested quantifiers) so ReDoS is structurally avoided rather than merely caught. |
| A hook `command` field containing shell metacharacters, stored and later rendered | Tampering (stored, not executed) | This phase only *stores* hook declarations for display (capability disclosure of *what a hook would run* is Phase 4's CAP-05, "remote-execution directives are surfaced"). No hook command is ever executed by AgentDock — this is an existing project-wide invariant (ING-10/INS-02), not new to this phase. Render as data, never interpret. |

## Sources

### Primary (HIGH confidence — fetched live this session from official docs)
- `code.claude.com/docs/en/plugins-reference` — plugin.json complete schema, directory layout, component path fields, hooks/MCP/LSP bundling shapes, `dependencies`, `userConfig`
- `code.claude.com/docs/en/plugin-marketplaces` — marketplace.json complete schema, all six plugin source types, strict mode, version resolution
- `code.claude.com/docs/en/mcp` — `.mcp.json` project/user/local scopes, schema, plugin-bundled MCP servers
- `code.claude.com/docs/en/skills` — commands-merged-into-skills finding, complete frontmatter reference table, command-naming rule table
- `modelcontextprotocol.io/registry/quickstart` — `server.json` schema and example (fetched via WebFetch summarization — treat field names as A2 in Assumptions Log)
- This repository's own source, read directly this session: `src/detect/types.ts`, `src/detect/index.ts`, `src/detect/skill.ts`, `src/detect/frontmatter.ts`, `src/github/scan.ts`, `src/github/types.ts`, `src/ingest/pipeline.ts`, `src/ingest/persist.ts`, `src/ingest/types.ts`, `src/ingest/errors.ts`, `src/db/schema.ts`, `src/db/queries/jobs.ts`, `src/ingest/worker.ts`, `scripts/capture-fixtures.mjs`, `package.json`, `vitest.config.ts`

### Secondary (MEDIUM confidence)
- `[VERIFIED: npm view js-yaml version]` → `5.2.3` (project pins `4.3.1` deliberately)
- `[VERIFIED: npm view zod version]` → `4.4.3` (matches installed version)
- WebSearch cross-check for `server.json` / `mcp-publisher` convention: results from `modelcontextprotocol.io/registry/quickstart`, `heyclau.de`, `mcpblog.dev` (used only to confirm the file's existence and root-level location, not for schema detail — schema detail came from the primary fetch)

### Tertiary (LOW confidence)
- None used for load-bearing claims. The `.claude/settings.json` project-hooks schema (Code Example 5, second block) is the one claim in this document sourced from a WebFetch summary rather than a verbatim quote of fetched markdown — flagged inline and in Assumptions Log A1.

## Metadata

**Confidence breakdown:**
- Standard stack (no new deps): HIGH — nothing to verify beyond confirming no new packages are needed
- Plugin/marketplace/mcp schemas: HIGH — fetched live from official docs this session, cross-checked against this project's own prior (AGD-01/AGD-02) verified findings for consistency
- Hooks project-scope schema: MEDIUM — one claim not independently re-verified verbatim
- Prevalence / false-positive rate of shape-only plugin detection: LOW — no corpus sampled this session; flagged as Assumption A3 and Open Question 1

**Research date:** 2026-08-11
**Valid until:** ~30 days for the schemas (Claude Code plugin docs have shown month-scale field additions per the version-gated notes throughout the fetched pages, e.g. "Requires Claude Code v2.1.196 or later" appearing repeatedly) — re-verify plugin.json/marketplace.json schemas if planning is delayed past early September 2026. The MCP registry is explicitly "in preview" per its own docs and should be re-checked immediately before implementation regardless of elapsed time.
