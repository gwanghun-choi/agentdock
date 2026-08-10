---
phase: AGD-01-walking-skeleton
plan: 06
type: execute
wave: 4
depends_on: ["01-04", "01-05"]
files_modified:
  - src/app/page.tsx
  - src/app/actions.ts
  - src/app/globals.css
  - src/app/layout.tsx
  - src/app/skills/page.tsx
  - src/app/r/[owner]/[repo]/page.tsx
  - src/app/r/[owner]/[repo]/[...path]/page.tsx
  - src/components/SubmitForm.tsx
  - src/components/Meta.tsx
  - src/db/queries/packages.ts
  - README.md
  - .github/workflows/ci.yml
autonomous: false
requirements: [FND-09, DIS-01, DIS-02, DIS-09, DIS-11, DIS-12, PRV-01, PRV-02, PRV-03, PRV-05, PRV-06, PRV-07, INS-01, INS-02, ING-02, ING-07, QUA-01, QUA-02, QUA-07, QUA-08]

estimate:
  tokens: 75000
  raw_tokens: 75000
  tasks: 4
  confidence: low

must_haves:
  truths:
    - "Pasting a repository into the home page results in its skills being listed, with the count of what was found and what was stored shown back"
    - "A value that is not owner/repo is refused with no network request made, from a submission arriving by any route and not only through the form"
    - "A detail page shows name, description, type, source repository, path, both licence sources, both freshness timestamps, stars labelled as GitHub's, the declared version or an honest absence, and a permalink to the exact file at the exact indexed commit"
    - "Every page is server-rendered with no client-side data fetching, so the content is in the initial response"
    - "A 1,077-character description and a 78-character path both render without breaking the layout at 360 pixels wide"
    - "Nothing in the interface displays a score, a grade, or a word that reads as a verdict on an artifact"
    - "The status page that disclosed the database role and search path no longer exists"
    - "bun install plus one documented command brings the application up against the existing database"
  artifacts:
    - path: "src/app/page.tsx"
      provides: "The home page — what AgentDock is, the submit entry, the honest budget line, recent skills"
      min_lines: 50
    - path: "src/app/actions.ts"
      provides: "The server action: the validation trust boundary and the ingest call"
      exports: ["submitRepo"]
      min_lines: 30
    - path: "src/app/r/[owner]/[repo]/[...path]/page.tsx"
      provides: "The detail page and its metadata, covering the full field inventory"
      min_lines: 90
    - path: "src/db/queries/packages.ts"
      provides: "Paginated listing, repository listing, and the detail lookup with its latest version"
      exports: ["listPackages", "countPackages", "permalink", "getRepositoryPackages", "getPackageDetail"]
      min_lines: 80
    - path: "README.md"
      provides: "The current structure, the current commands, and the one command that runs it"
      contains: "bun run db:migrate"
      min_lines: 80
  key_links:
    - from: "src/app/actions.ts"
      to: "src/ingest/pipeline.ts"
      via: "the only caller of ingestion; the action adds no second validation path"
      pattern: "ingestRepository"
    - from: "src/app/r/[owner]/[repo]/[...path]/page.tsx"
      to: "src/components/SkillBody.tsx"
      via: "the only place an artifact body is rendered, through the sanitized component"
      pattern: "SkillBody"
    - from: ".github/workflows/ci.yml"
      to: "package.json"
      via: "the runner builds and then runs the same single command a developer runs"
      pattern: "bun run ci"
---

<objective>
Make it a product. A person pastes `anthropics/skills` into a page, waits, and
sees eighteen skills — each with a detail page that shows what the file says, who
published it, when it last changed upstream, when AgentDock last looked, and a
link to the exact bytes at the exact commit.

Purpose: the phase's premise is that a vertical slice with no page to look at is
not a slice. Everything before this plan is machinery that has been proven in
isolation; this is where it becomes something a person can use, and where the
product's central discipline first has to hold in public — AgentDock reports what
it read and never tells anyone an artifact is safe.

Output: home, listing, repository and detail pages; the submit action; a restrained
visual system with no framework; the README rewritten against the real structure;
the build step added to the runner; and a human check of the result.

Implements the CONTEXT.md hard constraints that no risk score, grade or safety
badge appears anywhere, and that diagnostics disclosing the database role or
search path are removed.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-01-walking-skeleton/CONTEXT.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-01-PLAN.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-04-PLAN.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-05-PLAN.md
@src/db/queries/packages.ts
@src/app/globals.css
@README.md
</context>

<decisions_made_while_planning>

**1. The action returns its result; it does not redirect.**

The documented shape for a mutation is a redirect, and the documented trap is that
the redirect throws a control-flow exception which any wrapping `try` swallows
silently. Returning the result instead avoids that trap entirely and keeps
something the requirement asks for: how many skills were found and how many were
stored. The result block carries a link to the repository page, so the shareable
URL is one click away rather than automatic. If a later change reintroduces a
redirect, it must sit outside every `try` and be the last statement — recorded
here so the reason is not lost.

**2. No CSS framework.**

The visual target is restrained developer-tool: borders rather than shadows, one
accent, system fonts, dense rows rather than cards. That is roughly 200 lines of
plain CSS with custom properties, against a build-tool integration, a
configuration file, a content-scanning step and a vocabulary in every file. The
foundation already exists from plan 01-04. Adding a framework to write less CSS
than the framework's own configuration is not a saving.

**3. The status page is deleted, not gated.**

It disclosed the database role name and the connection search path, and the phase
constraint requires it to be development-only or gone. Gating costs a file and a
guard; deleting costs nothing and loses nothing, because the boot assertion
already refuses to start on a wrong role or a loose search path — and a refusal at
boot is strictly more informative than a page someone has to remember to visit.
The root path becomes the real home page.

**4. Explicit promise types for route parameters, not the generated helper.**

The generated route-typing helper is convenient and requires types that only exist
after a build or an explicit generation step, which would make a type-check on a
clean checkout fail. Writing the parameter type by hand is one line and removes
that ordering dependency from the runner entirely.

**5. The rate-limit line is fetched softly and is allowed to be unavailable.**

Reading the remaining budget costs no quota and turns a mystery failure into an
understood one, so the home page shows it. But it is a network call on a page
render, so it runs with a short timeout inside a guard and renders as unavailable
on failure. A home page that cannot load because GitHub is slow would be a worse
outcome than not showing a number.

**6. Install guidance is text, and there is no button that runs anything.**

Copyable instructions per runtime, and a link to the source at the pinned commit.
Nothing in the interface executes an install, and no command in the text pipes a
download into a shell.

**7. The vocabulary rule is applied now by not writing the words.**

There is no automated vocabulary check in this phase — that arrives with the
disclosure work. What applies now is cheaper: the words are never introduced.
Absence of a finding is not something this phase can even express yet, so the
detail page states plainly that AgentDock reads files, does not run them, and
cannot say whether an artifact is safe.

</decisions_made_while_planning>

<reference>

## Reference A — `src/db/queries/packages.ts`, the additions

`listPackages`, `countPackages` and `permalink` from plan 01-01 stay; two lookups
are added and the listing gains a repository filter.

```ts
export type PackageDetail = {
  id: number;
  name: string;
  summary: string | null;
  type: string;
  sourcePath: string;
  licenseText: string | null;
  meta: Record<string, unknown>;
  fullName: string;
  repoDescription: string | null;
  htmlUrl: string;
  licenseSpdx: string | null;
  stars: number;
  isArchived: boolean;
  pushedAt: Date | null;
  scannedAt: Date | null;
  treeTruncated: boolean;
  commitSha: string;
  declaredVersion: string | null;
  body: string | null;
  parseStatus: string;
  parseErrors: string[];
  ingestedAt: Date;
};

/**
 * The URL carries the artifact's directory; the identity key carries its manifest
 * path. One type, one manifest filename, so the mapping is a suffix.
 *
 * ponytail: suffix mapping while there is one artifact type; Phase 3 resolves the
 * manifest filename from the detector registry instead.
 */
export function sourcePathFromUrl(segments: string[]): string {
  const dir = segments.join('/');
  return dir.length > 0 ? `${dir}/SKILL.md` : 'SKILL.md';
}

export const getPackageDetail = cache(
  async (owner: string, repo: string, segments: string[]): Promise<PackageDetail | null> => {
    // Matched on the lowercased full name, which has a unique expression index.
    const [row] = await db
      .select({ /* the field set above, joined across the three tables */ })
      .from(packageTable)
      .innerJoin(repository, eq(packageTable.repositoryId, repository.id))
      .innerJoin(packageVersion, eq(packageVersion.packageId, packageTable.id))
      .where(
        and(
          sql`lower(${repository.fullName}) = ${`${owner}/${repo}`.toLowerCase()}`,
          eq(packageTable.sourcePath, sourcePathFromUrl(segments)),
        ),
      )
      .orderBy(desc(packageVersion.ingestedAt))
      .limit(1);
    return row ?? null;
  },
);
```

## Reference B — `src/app/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { ingestRepository } from '@/ingest/pipeline';

export type SubmitState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
  href?: string;
  found?: number;
  stored?: number;
  failed?: number;
  truncated?: boolean;
};

/**
 * A server function is reachable by a direct request, not only through the form
 * above it — the framework documents this explicitly. Its validation is therefore
 * a trust boundary, and it is the same validation the pipeline applies, called
 * once, rather than a second copy that can drift.
 */
export async function submitRepo(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const raw = String(formData.get('repo') ?? '');
  const result = await ingestRepository(raw);

  if (!result.ok) return { status: 'error', message: result.message };

  revalidatePath('/skills');
  revalidatePath(`/r/${result.owner}/${result.repo}`);

  return {
    status: 'ok',
    message:
      `Read ${result.fullName} at ${result.commitSha.slice(0, 7)}: ` +
      `${result.found} skill${result.found === 1 ? '' : 's'} found, ${result.stored} stored` +
      (result.failed > 0 ? `, ${result.failed} could not be parsed` : '') +
      (result.truncated ? '. The repository was larger than one pass, so this is partial' : '.'),
    href: `/r/${result.owner}/${result.repo}`,
    found: result.found,
    stored: result.stored,
    failed: result.failed,
    truncated: result.truncated,
  };
}
```

## Reference C — `src/components/SubmitForm.tsx`

```tsx
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { type SubmitState, submitRepo } from '@/app/actions';

const initial: SubmitState = { status: 'idle', message: '' };

/**
 * The only client component in the project, and it holds no data — only the
 * pending flag. Without JavaScript the form still submits and the server still
 * re-renders with the result.
 */
export function SubmitForm() {
  const [state, action, pending] = useActionState(submitRepo, initial);

  return (
    <form action={action} className="submit">
      <label htmlFor="repo">GitHub repository</label>
      <div className="submit-row">
        <input
          id="repo"
          name="repo"
          required
          placeholder="anthropics/skills"
          // Cosmetic only. The enforcement is in the server action.
          pattern="[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+"
          aria-describedby="repo-help repo-result"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Reading…' : 'Index'}
        </button>
      </div>
      <p id="repo-help" className="muted">
        Owner and repository, like <code>anthropics/skills</code>. Public repositories only.
      </p>
      <p
        id="repo-result"
        role="status"
        aria-live="polite"
        className={state.status === 'error' ? 'error' : 'ok'}
      >
        {state.message}
        {state.href ? <Link href={state.href}> View repository</Link> : null}
      </p>
    </form>
  );
}
```

## Reference D — the detail page field inventory

Every field, its source, and the rule that governs how it is shown.

| Field | Source | Rule |
|---|---|---|
| name | frontmatter, else the directory name | escaped; the single page heading |
| description | frontmatter | escaped; truncated for the meta tag only |
| type | the artifact type | shown as a plain label |
| source repository | the repository's full name | links to the repository's own page on GitHub |
| path in repository | the package's source path | breaks anywhere; the corpus contains a 78-character path |
| licence, declared | frontmatter licence prose | labelled as the author's text; the corpus writes prose, not identifiers |
| licence, detected | the repository's SPDX identifier | labelled as GitHub's; "not detected" when absent, which is the common case |
| last changed upstream | the push timestamp | labelled distinctly from the scan time |
| last read by AgentDock | the scan timestamp | labelled distinctly from the upstream time |
| permalink | full name, commit SHA, source path | the commit SHA, never the tree SHA |
| stars | the star count | labelled "GitHub stars", never presented as an AgentDock signal |
| declared version | the non-specification version field | "not declared" when absent; never synthesized |
| conformance | the recorded key set | "uses only specification fields" or the extra field names, stated as an observation |
| parse status | the stored status and warnings | warnings listed verbatim, as observations |
| body | the stored excerpt | rendered through the sanitized component, with attribution and a source link |
| install | static text per runtime | copyable; nothing executes it |
| disclosure | static | AgentDock reads files; it does not run them and cannot say whether an artifact is safe |

The parse warnings are rendered with verbs of observation. A file whose name
disagrees with its directory reads as *declares the name `x` in a directory named
`y`*, not as *invalid* — the specification is one of two documents that disagree
with each other, and the reference implementation violates it.

## Reference E — install text

```tsx
// Text only. Nothing here is executed, and no line pipes a download into a shell.
const install = [
  { runtime: 'Claude Code (project)', text: `.claude/skills/${slug}/` },
  { runtime: 'Claude Code (personal)', text: `~/.claude/skills/${slug}/` },
];
```

Rendered as: copy the skill directory from the source repository to that path.
The source link beside it is the permalink at the pinned commit, so a reader can
see exactly what they would be copying.

## Reference F — the visual system

Extends the foundation already in `src/app/globals.css` from plan 01-04. No
framework, no shadows, no gradients, no decorative motion.

- **Type:** system sans for the interface, system mono for paths, identifiers and code. One scale, four steps.
- **Colour:** the five existing custom properties. One accent, used for links and focus only. Never colour as a verdict — no green, no red, no amber anywhere an artifact is described.
- **Layout:** one 64rem column, 1rem gutters. A single-column stack below 40rem.
- **Rows, not cards:** the listing is a bordered list with a one-line title row and a clamped description. No card grid, no per-item shadow, no icon per row.
- **Density:** the listing shows name, repository, path and freshness on two lines per item; a reader can scan twenty without scrolling on a laptop.
- **Motion:** transitions on focus and hover colour only, 120ms. Nothing animates on load.
- **Truncation:** descriptions clamp to three lines with the full text on the detail page. Paths wrap anywhere rather than clamping — a truncated path is a useless path.

</reference>

<tasks>

<task type="auto">
  <name>Task 1: Home, the submit action, and the end of the status page</name>
  <files>src/app/page.tsx, src/app/actions.ts, src/components/SubmitForm.tsx, src/app/globals.css, src/app/layout.tsx</files>
  <action>
    Replace `src/app/page.tsx` entirely. What is there now is a diagnostic that
    prints the database role and the connection search path, and the phase
    constraint requires it gone or development-only. Delete it: the boot assertion
    already refuses to start on a wrong role or a loose search path, and a refusal
    at boot is more informative than a page nobody remembers to open.

    The new home page states what AgentDock is in one sentence and one qualifying
    sentence, carries the submit form, states the current request budget honestly,
    and lists the most recent skills. Keep the request-time export and its comment:
    it reads the database, and the build runs where there is none.

    The budget line reads the remaining allowance, which costs no quota, inside a
    guard with a short timeout. It renders as unavailable rather than failing the
    page — a home page that will not load because GitHub is slow is worse than a
    home page without a number on it. Say the real shape of the limit: without a
    token, sixty requests an hour and two per repository.

    Write `src/app/actions.ts` and `src/components/SubmitForm.tsx` exactly as
    References B and C.

    The action is the trust boundary. A server function is reachable by a direct
    request and not only through the form above it, which the framework documents
    explicitly, so the validation that matters is the one inside the pipeline —
    and the action calls it rather than adding a second copy that can drift. The
    pattern attribute on the input is a keyboard convenience and nothing more.

    The action returns its result instead of redirecting. The documented mutation
    shape is a redirect, and its documented trap is that the redirect throws a
    control-flow exception which any wrapping catch swallows silently, leaving a
    form that submitted successfully and did not navigate. Returning the result
    also keeps the counts this phase is asked to show. If a redirect is ever added
    back, it must sit outside every catch and be the last statement.

    Then extend `src/app/globals.css` into the visual system in Reference F,
    keeping everything plan 01-04 put there. Restrained developer tool: borders
    instead of shadows, one accent used only for links and focus, system fonts, a
    single column, rows rather than cards. No gradients, no decorative animation,
    and no colour used as a verdict — a green or red badge beside an artifact is
    the thing this product exists not to do.

    Add the main landmark and its identifier to the layout so the skip link from
    plan 01-04 has a destination.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run lint &amp;&amp; bun run build &amp;&amp; sh -c 'PORT=3026 bun run start &gt;/tmp/agd-01-06a.log 2&gt;&amp;1 &amp; SRV=$!; for i in $(seq 1 40); do curl -sf http://localhost:3026/ &gt;/dev/null 2&gt;&amp;1 &amp;&amp; break; sleep 1; done; H=$(curl -s http://localhost:3026/); kill $SRV 2&gt;/dev/null; echo "$H" | grep -q "AgentDock" || exit 1; echo "$H" | grep -q "anthropics/skills" || exit 1; echo "$H" | grep -qi "search_path" &amp;&amp; exit 1; echo "$H" | grep -qi "agentdock_app" &amp;&amp; exit 1; exit 0'</automated>
  </verify>
  <done>The root path is the AgentDock home page with branding, the submit form, an honest budget line, and recent skills. The diagnostic that disclosed the database role and search path no longer exists in the served output. The visual system is in place with no framework added.</done>
</task>

<task type="auto">
  <name>Task 2: Listing, repository and detail pages — the full field inventory</name>
  <files>src/db/queries/packages.ts, src/app/skills/page.tsx, src/app/r/[owner]/[repo]/page.tsx, src/app/r/[owner]/[repo]/[...path]/page.tsx, src/components/Meta.tsx</files>
  <action>
    Extend `src/db/queries/packages.ts` per Reference A with the repository listing
    and the detail lookup, keeping the three functions plan 01-01 wrote. Both new
    lookups go through the render-scoped cache so a page and its metadata function
    do not query twice in one pass. Resolve the repository by its lowercased full
    name, which has a unique expression index behind it.

    Then build the three pages. Every one of them exports the request-time flag and
    its comment — a page whose only asynchronous work is a database query has no
    request-time API in it, so the framework will happily prerender it at build
    time, and the build runs where there is no database. This has already been
    dodged once in this project; copy the pattern rather than rediscovering it.

    The listing is paginated by a query parameter. Coerce it through a schema with
    a fallback rather than a numeric conversion: a repeated parameter arrives as an
    array, and converting an array to a number produces a value that breaks the
    query silently. Show the total, the current range, and previous and next links
    that disappear at the ends rather than going nowhere.

    The repository page lists that repository's skills and states its scan time. If
    the repository is recorded as incomplete, say so plainly at the top: AgentDock
    read part of this repository, so this listing is not everything that is in it.
    That is the whole of the truncation requirement — a visible state, never a
    silent claim of completeness.

    The detail page covers the field inventory in Reference D exactly, and the
    rules beside each field are the substance. The two licence sources are shown
    separately and labelled by origin, because the frontmatter field carries free
    prose in the measured corpus and the repository field is the only
    identifier-shaped one — and it is empty on the reference repository, so the
    honest-unknown path is the common path and not the edge case. The two
    timestamps are shown separately and labelled distinctly: one is when the
    repository last changed, the other is when AgentDock last read it, and
    collapsing them is a false freshness claim. Stars are labelled as GitHub's.
    The declared version is shown only if the file declares one. The permalink is
    built from the stored commit SHA.

    Parse warnings render as observations, not as verdicts. A file whose declared
    name disagrees with its directory is described in those words rather than
    called invalid — the two governing documents disagree with each other, and the
    reference implementation violates the stricter one.

    The body renders through the sanitized component from plan 01-04, with
    attribution and a link to the source at the pinned commit, and it is an
    excerpt rather than a copy.

    Add the install block from Reference E: copyable text per runtime and nothing
    that executes. No command in that text may pipe a download into a shell.

    Add the standing disclosure line: AgentDock reads files, does not run them, and
    cannot say whether an artifact is safe. Do not write a score, a grade, a badge,
    or any of the words that read as a verdict on an artifact anywhere in these
    pages. The automated vocabulary check arrives with the disclosure work; what
    applies here is cheaper, which is to never introduce the words.

    Write the metadata function on the detail page against the same cached lookup,
    with a plain title and a description truncated before it reaches the tag. Do
    not add a structured-data block — that is the one sink the framework does not
    escape, and the boundary scanner already fails the build on the construction it
    requires.

    Type the route parameters by hand as promises rather than using the generated
    route-typing helper. The helper needs types that exist only after a build or an
    explicit generation step, and depending on that would make a type-check on a
    clean checkout order-dependent for no benefit.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run lint &amp;&amp; bun run build &amp;&amp; sh -c 'PORT=3027 bun run start &gt;/tmp/agd-01-06b.log 2&gt;&amp;1 &amp; SRV=$!; for i in $(seq 1 40); do curl -sf http://localhost:3027/skills &gt;/dev/null 2&gt;&amp;1 &amp;&amp; break; sleep 1; done; L=$(curl -s "http://localhost:3027/skills?page=1&amp;page=2"); R=$(curl -s http://localhost:3027/r/anthropics/skills); D=$(curl -s http://localhost:3027/r/anthropics/skills/skills/canvas-design); N=$(curl -s -o /dev/null -w %{http_code} http://localhost:3027/r/anthropics/no-such-thing/x); kill $SRV 2&gt;/dev/null; echo "$L" | grep -q "canvas-design" || exit 1; echo "$R" | grep -q "canvas-design" || exit 1; echo "$D" | grep -q "blob/f17010c9bb483898c1d9c9f42dde2b3a98889434/" || exit 1; echo "$D" | grep -qi "GitHub stars" || exit 1; echo "$D" | grep -qi "does not run" || exit 1; test "$N" = 404 || exit 1; exit 0'</automated>
  </verify>
  <done>The listing paginates and survives a repeated page parameter. The repository page lists its skills and states incompleteness when recorded. The detail page shows every field in the inventory, including both licence sources, both timestamps, the labelled star count and the commit permalink, and carries the standing disclosure. A missing artifact returns 404.</done>
</task>

<task type="auto">
  <name>Task 3: The README against the real structure, and the runner that builds first</name>
  <files>README.md, .github/workflows/ci.yml</files>
  <action>
    Rewrite `README.md` against what the repository actually contains now, keeping
    the parts that are still true — the one-time database bootstrap, the four
    boundary layers, the reason migrations are applied by the project's own script,
    and the note that the bare test runner hangs on these files.

    Add what this phase created: the directory map with one line each for the
    GitHub client, the detectors, the ingestion pipeline and the pages; the fixture
    corpus and how to recapture it; the fact that AgentDock runs unauthenticated at
    sixty requests an hour, that a token is optional and needs no scopes, and that
    conditional requests save nothing without one; the five source boundary rules
    the build enforces and what each protects; and the four new commands.

    Keep the single documented run command intact and verify it end to end: copy
    the environment file, install, migrate, run. That is the requirement, and it is
    the sentence most likely to be quietly wrong after five plans of change.

    Then add a build step to the runner workflow, before the existing single
    command. The build regenerates a generated type declaration that the linter
    then checks, so a runner that lints before building can fail on a file the
    build was about to fix. The order is install, build, then the one command. The
    build needs no database, because every page that reads one is marked
    request-time.

    State plainly in the README that the runner runs the same single command a
    developer runs, so the two cannot drift.
  </action>
  <verify>
    <automated>grep -q "bun run db:migrate" README.md &amp;&amp; grep -q "bun run ci" README.md &amp;&amp; grep -q "60" README.md &amp;&amp; grep -q "src/github" README.md &amp;&amp; grep -q "bun run build" .github/workflows/ci.yml &amp;&amp; bun install --frozen-lockfile &amp;&amp; bun run build &amp;&amp; bun run ci</automated>
  </verify>
  <done>The README describes the real structure, the real commands and the real request budget, and its run instructions were executed from a clean install. The runner builds before running the single command. `bun install --frozen-lockfile`, then `bun run build`, then `bun run ci` all pass in that order.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Look at it — the interface, the tone, and the long strings</name>
  <what-built>
    The whole slice, end to end: a home page with a submit field, a paginated
    skills listing, a repository page, and a detail page showing the full field
    inventory with a permalink to the exact file at the exact indexed commit. Light
    and dark both work with no script; the pages are server-rendered; the visual
    system is plain CSS with no framework.
  </what-built>
  <how-to-verify>
    Run `bun run dev` and open `http://localhost:3000`.

    1. Submit `anthropics/skills`. It should take a few seconds and report the
       number of skills found and stored, with a link to the repository page.
    2. Submit it a second time. It should report the same counts, and nothing in
       the listing should duplicate.
    3. Submit `https://github.com/anthropics/skills`. It should be refused with a
       message telling you to use the owner-and-repository form. Submit
       `anthropics/definitely-not-real-xyz`. It should tell you AgentDock could not
       read it and that a missing and a private repository are indistinguishable —
       it must not claim the repository does not exist.
    4. Open a detail page. Check that it shows: both licence lines, labelled by
       origin; two separate timestamps, one for when the repository last changed
       and one for when AgentDock last read it; the star count labelled as GitHub's;
       the rendered body; and a source link. Click the source link — it must open
       the real file on GitHub at the indexed commit.
    5. Open the skill named `claude-api` — its description is 1,077 characters.
       Then narrow the window to about 360 pixels. Nothing should overflow
       horizontally and no long path or identifier should push the layout wide.
    6. Switch your system to dark mode and reload. Text should stay readable and
       nothing should invert badly.
    7. Tab through the home page. The skip link should appear first, and every
       focused control should have a visible ring.
    8. Read the pages for tone. There must be no score, no grade, no badge, and no
       word that reads as a verdict on an artifact. Tell me if any wording sounds
       like an endorsement.

    Then say whether the result looks like a restrained developer tool — closer to
    a plain, dense reference site than to a marketing page — or whether it needs
    another pass.
  </how-to-verify>
  <resume-signal>Type "approved", or describe what looks wrong.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| submitted form value → the server function | A server function is reachable by a direct request, not only through the form, so its validation is the control and not a hint. |
| stored artifact fields → rendered pages | Names, descriptions, paths and bodies are all attacker-controlled and reach headings, titles, meta content, link text and the body renderer. |
| stored repository fields → outbound links | An artifact author controls the repository's homepage value, and a rendered link is a request the reader makes. |
| application internals → the served page | A page that discloses the database role, the search path, or an exception hands a reader something they should not have. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-45 | Information Disclosure | `submitRepo` | critical | mitigate | The action performs no validation of its own and calls the pipeline, whose anchored pattern is applied before URL construction; the client-side pattern attribute is documented as cosmetic so nobody mistakes it for the control. |
| T-01-46 | Elevation of Privilege | rendered artifact bodies | critical | mitigate | Bodies render only through the sanitized component from plan 01-04, under the policy from the same plan; the boundary scanner fails the build on a raw-markup path. |
| T-01-47 | Tampering | titles and meta content | high | mitigate | Plain strings rendered by the framework, which escapes them; no structured-data block is added, and the construction it would need already fails the build. |
| T-01-48 | Information Disclosure | the diagnostic status page | high | mitigate | Deleted. The served home page is asserted to contain neither the role name nor the search path. |
| T-01-49 | Information Disclosure | error text on the page | high | mitigate | The interface renders only the fixed outcome messages from plan 01-05; no exception is caught and displayed anywhere in a page or an action. |
| T-01-50 | Information Disclosure | an author-controlled homepage link | medium | mitigate | Outbound links to artifact-controlled targets carry the no-opener, no-referrer, nofollow and user-generated relationship set, matching the body renderer's policy. |
| T-01-51 | Denial of Service | the listing query | medium | mitigate | The page parameter is coerced through a bounded schema with a fallback, so a repeated or hostile parameter cannot reach the query as an unbounded value. |
| T-01-52 | Denial of Service | the budget lookup on the home page | low | mitigate | Wrapped in a guard with a short timeout and rendered as unavailable on failure, so a slow upstream cannot make the home page unavailable. |
| T-01-53 | Repudiation | a verdict implied by the interface | high | mitigate | No score, grade, badge or judgment word appears; colour is never used to rate an artifact; the standing disclosure states what AgentDock does not check; a human check reviews the wording before the phase closes. |
</threat_model>

<verification>
1. The served home page contains neither the database role name nor the search path.
2. Submitting the reference repository lists its skills; submitting it again changes nothing.
3. A full URL and an unreadable repository each produce their own message, and neither claims non-existence.
4. The listing paginates and survives a repeated page parameter.
5. The repository page states incompleteness when it is recorded.
6. The detail page shows both licence sources, both timestamps, the labelled star count, the declared version or its honest absence, the parse observations, the rendered body and the commit permalink — and the permalink resolves.
7. A missing artifact returns 404.
8. Nothing on any page is a score, a grade, a badge or a judgment word.
9. A 1,077-character description and a 78-character path both render without horizontal overflow at 360 pixels.
10. Light and dark both work with no script; the skip link and focus rings work by keyboard.
11. `bun install --frozen-lockfile`, then `bun run build`, then `bun run ci` all pass in that order.
12. A human has verified the interface and approved it.
</verification>

<success_criteria>
- **FND-09** — install plus one documented command runs the application against the existing database, executed from a clean install rather than described.
- **DIS-01** — a paginated listing browsable with no account.
- **DIS-02** — the detail page shows name, description, type, repository, path, licence and freshness.
- **DIS-09** — every page server-rendered with no client-side data fetching; the content is in the initial response.
- **DIS-11** — light and dark with no script, responsive to mobile width, one heading per page, landmarks, a skip link, visible focus, labelled inputs and a live result region.
- **DIS-12** — the corpus's longest description and longest path both render without breaking the layout.
- **PRV-01** — a permalink to the exact file at the exact indexed commit, proven to resolve.
- **PRV-02** — upstream change and AgentDock scan shown as two distinctly labelled timestamps.
- **PRV-03** — stars labelled as GitHub stars.
- **PRV-05** — the declared version shown only when declared, never invented.
- **PRV-06** — both licence sources shown, labelled by origin, with unknown shown honestly.
- **PRV-07** — an excerpt with attribution and a link to the pinned source.
- **INS-01** / **INS-02** — copyable install text per runtime; nothing in the interface executes an install.
- **ING-02** — the submit entry point validates at the trust boundary, not in the browser.
- **ING-07** — an incomplete repository says so on its page.
- **QUA-01** / **QUA-02** — type-check and lint pass as one command.
- **QUA-07** — every failure shows its own actionable message with no internals.
- **QUA-08** — the runner builds and then runs type-check, lint, tests and the migration boundary scan on every push.
</success_criteria>

<output>
Create `.planning/phases/AGD-01-walking-skeleton/01-06-SUMMARY.md` when done.
Record the observed ingest duration for the reference repository, the artifact
counts shown back to the user, anything the human check asked to change, and the
final result of the install, build and check sequence. Record no credential.
</output>
