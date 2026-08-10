---
phase: AGD-01-walking-skeleton
plan: 05
type: execute
wave: 3
depends_on: ["01-01", "01-02", "01-03"]
files_modified:
  - src/log.ts
  - src/ingest/errors.ts
  - src/ingest/errors.test.ts
  - src/ingest/pipeline.ts
  - src/ingest/pipeline.test.ts
autonomous: true
requirements: [ING-01, ING-05, ING-06, ING-07, ING-10, ING-11, DAT-06, PRV-07, QUA-06, QUA-07]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Submitting a repository that contains skill files results in every one of them being stored, up to the file cap, in one transaction"
    - "Submitting the same repository again changes nothing — same rows, no new versions"
    - "One unparseable file is stored as a failed artifact and the other seventeen are stored normally"
    - "A denylisted repository is refused before any network request is made"
    - "Each of the nine failure modes produces its own message, and none of them carries a stack trace, a hostname, a query, or a token"
    - "A URL written inside a skill body is stored as text and never becomes a request — proven by asserting every hostname the run contacted"
    - "Every ingest emits exactly one structured log line, carrying no secret and no response body"
  artifacts:
    - path: "src/ingest/errors.ts"
      provides: "The nine user-facing outcomes, their copy, and the mapping from every internal failure onto them"
      exports: ["IngestOutcome", "toIngestOutcome", "OUTCOME_MESSAGES"]
      min_lines: 70
    - path: "src/ingest/pipeline.ts"
      provides: "Denylist, two calls, path match, capped reads, per-artifact parse, one transaction, one log line"
      exports: ["ingestRepository", "IngestResult"]
      min_lines: 90
    - path: "src/log.ts"
      provides: "One structured line, with a fixed field set that cannot carry a body or a credential"
      exports: ["log"]
      min_lines: 20
    - path: "src/ingest/pipeline.test.ts"
      provides: "The full pipeline against frozen fixtures and a stubbed fetch, including the repeat-ingest no-op and the never-fetch-content-URLs assertion"
      min_lines: 100
  key_links:
    - from: "src/ingest/pipeline.ts"
      to: "src/github/scan.ts"
      via: "the only way this module reaches the network, so every cap applies without being restated"
      pattern: "fetchRepoScanInputs"
    - from: "src/ingest/pipeline.ts"
      to: "src/detect/index.ts"
      via: "iterates the detector registry rather than naming the skill detector, so Phase 3 adds a type without editing this file"
      pattern: "DETECTORS"
    - from: "src/ingest/pipeline.ts"
      to: "src/ingest/persist.ts"
      via: "hands over a fully assembled scan; the transaction is the only writer"
      pattern: "persistScan"
---

<objective>
Join the three halves: read a repository through the wall, detect and parse what
is inside it, and commit the result in one transaction — then decide what the
person who submitted it is told when any of that fails.

Purpose: the failure copy is the part that is always deferred and is never
improved afterwards, and in this domain one of the messages is a correctness
question rather than a wording question. GitHub returns byte-identical responses
for a repository that does not exist and one that is private, so the obvious
sentence is a false statement about roughly half the repositories that produce
it. Writing the nine outcomes down as a table, with a test, is what keeps that
from being rediscovered on the submit page.

Output: `src/ingest/pipeline.ts` orchestrating the whole path, `errors.ts`
carrying the nine outcomes, one structured log line per ingest, and a test suite
that runs the full pipeline against frozen fixtures with a stubbed fetch — no
network, no token.

Implements the CONTEXT.md hard constraints that one artifact's parse failure must
not fail the repository, that re-ingest at the same commit is a no-op, and that a
URL found in repository content is never fetched.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-01-walking-skeleton/CONTEXT.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-01-PLAN.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-02-PLAN.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-03-PLAN.md
@src/ingest/types.ts
@src/ingest/persist.ts
</context>

<decisions_made_while_planning>

**1. The outcome enum is the contract; the copy is data beside it.**

Nine outcomes, one message each, in one table. The pipeline returns an outcome
rather than throwing, and the caller never inspects an exception to decide what to
show. That is what makes it testable — a case per outcome asserting the message —
and it is what stops a stack trace from reaching the interface, because there is
no path along which one could.

**2. The message for an unreadable repository does not guess.**

The two indistinguishable cases are both named in the sentence, and the sentence
says AgentDock cannot tell which. The alternative reads better and is false. The
test asserts that no outcome message contains a phrase asserting non-existence,
so nobody can improve it back into a lie.

**3. Content hashing happens here, over the raw bytes, with only line endings
normalized.**

Hashing the parsed object would make version identity depend on key ordering and
on the loader's type coercion, so a dependency bump would mint a new version for
every row in the database. Hashing the raw bytes without normalizing line endings
would mint one for a whitespace-only commit. Normalize line endings, hash the
rest, and test both directions.

**4. The pipeline iterates the detector registry rather than calling the skill
detector.**

There is exactly one detector, so the loop runs once. It still costs one line
more than the direct call and it is the difference between Phase 3 adding a file
and Phase 3 editing this one. That is the only generalization this plan makes;
there is no base class, no configuration, and no dynamic loading.

**5. One log line per ingest, with a closed field set.**

The fields are fixed in the signature: owner, repository, commit, outcome,
artifact counts and duration. A free-form payload parameter is how a response body
or a header ends up in a log file six months later, so there is not one.

**6. The wall clock is a budget with a partial-result path, not a deadline that
throws.**

Whatever was read inside the budget is persisted and the remainder is recorded as
truncated. A repository that times out half way through should leave ninety
stored skills and an honest incompleteness flag, not nothing.

</decisions_made_while_planning>

<reference>

## Reference A — `src/log.ts`

```ts
type IngestLog = {
  event: 'ingest';
  owner: string;
  repo: string;
  commitSha: string | null;
  outcome: string;
  found: number;
  stored: number;
  failed: number;
  durationMs: number;
  rateRemaining: number | null;
};

/**
 * One line, one shape. The field set is closed on purpose: a free-form payload
 * parameter is how a response body, a header, or a connection string ends up in
 * a log file six months from now.
 */
export function log(entry: IngestLog): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
```

## Reference B — `src/ingest/errors.ts`

```ts
import { GitHubError } from '@/github/client';

export type IngestOutcome =
  | 'ok'
  | 'invalid_input'
  | 'denylisted'
  | 'unreadable'
  | 'rate_limited'
  | 'too_large'
  | 'no_artifacts'
  | 'unavailable'
  | 'storage_failed';

/**
 * The complete set of things a person can be told, and the only strings that
 * reach the interface. Nothing here interpolates an exception, a hostname, a
 * query, or a token — there is no code path along which one could.
 */
export const OUTCOME_MESSAGES: Record<Exclude<IngestOutcome, 'ok'>, string> = {
  invalid_input:
    'Enter a repository as owner/repo, for example anthropics/skills. ' +
    'AgentDock does not accept full URLs.',

  denylisted: 'This repository has been removed from AgentDock and will not be re-added.',

  // Both cases are named because they are genuinely indistinguishable: GitHub
  // returns a byte-identical response for a repository that does not exist and
  // one that is private, deliberately, so that a private repository's existence
  // is not leaked. Any sentence asserting non-existence is a false statement
  // about roughly half the repositories that produce this outcome.
  unreadable:
    'AgentDock could not read that repository. GitHub returns the same response ' +
    'for a repository that does not exist and one that is private, so AgentDock ' +
    'cannot tell which. Check the spelling; if it is private, AgentDock cannot index it.',

  rate_limited:
    'AgentDock has used its GitHub request budget for this hour. ' +
    'Without a token GitHub allows 60 requests an hour, and each repository costs two.',

  too_large:
    'That repository is larger than AgentDock will read in one pass. ' +
    'What was read has been stored, and the listing says it is incomplete.',

  no_artifacts:
    'AgentDock found no SKILL.md files in that repository. ' +
    'It currently indexes Agent Skills only.',

  unavailable: 'AgentDock could not reach GitHub. Try again shortly.',

  storage_failed: 'AgentDock read the repository but could not store the result. Nothing was saved.',
};

/** Adds the reset time when it is known, because "try later" without a when is not actionable. */
export function messageFor(outcome: IngestOutcome, resetEpochSeconds?: number): string {
  if (outcome === 'ok') return '';
  const base = OUTCOME_MESSAGES[outcome];
  if (outcome !== 'rate_limited' || !resetEpochSeconds) return base;
  const at = new Date(resetEpochSeconds * 1000);
  return `${base} The budget resets at ${at.toISOString().slice(11, 16)} UTC.`;
}

/** Maps every internal failure onto exactly one outcome. Unknowns are storage failures, never leaks. */
export function toIngestOutcome(error: unknown): IngestOutcome {
  if (error instanceof GitHubError) {
    switch (error.failure) {
      case 'invalid_repo':
        return 'invalid_input';
      case 'unreadable':
        return 'unreadable';
      case 'rate_limited':
        return 'rate_limited';
      case 'too_large':
        return 'too_large';
      default:
        return 'unavailable';
    }
  }
  return 'storage_failed';
}
```

## Reference C — `src/ingest/pipeline.ts`

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { repositoryDenylist } from '@/db/schema';
import { DETECTORS } from '@/detect';
import { GitHubError, normalizeRepo, rateLimitState } from '@/github/client';
import { fetchRepoScanInputs } from '@/github/scan';
import { log } from '@/log';
import { type IngestOutcome, messageFor, toIngestOutcome } from './errors';
import { persistScan } from './persist';
import type { RepoScan, ScannedPackage } from './types';

/** PRV-07: an excerpt with attribution, never a mirror. */
const MAX_BODY = 32 * 1024;

export type IngestResult =
  | {
      ok: true;
      owner: string;
      repo: string;
      fullName: string;
      commitSha: string;
      found: number;
      stored: number;
      failed: number;
      truncated: boolean;
    }
  | { ok: false; outcome: IngestOutcome; message: string };

/**
 * Version identity, defined once.
 *
 * The raw bytes, with only line endings normalized: a commit that changes nothing
 * but line endings must not mint a version, and anything else must. Hashing the
 * parsed object instead would make identity depend on key ordering and on the
 * YAML loader's type coercion, so a dependency bump would mint a new version for
 * every row in the database.
 */
export function contentHash(raw: string): string {
  return createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function ingestRepository(input: string): Promise<IngestResult> {
  const started = Date.now();

  const normalized = normalizeRepo(input);
  if (!normalized) {
    // Rejected before a socket opens. This is the trust boundary, not a form hint.
    return { ok: false, outcome: 'invalid_input', message: messageFor('invalid_input') };
  }
  const { owner, repo } = normalized;
  const fullName = `${owner}/${repo}`;

  const [blocked] = await db
    .select()
    .from(repositoryDenylist)
    .where(eq(repositoryDenylist.fullName, fullName.toLowerCase()))
    .limit(1);
  if (blocked) {
    log({
      event: 'ingest',
      owner,
      repo,
      commitSha: null,
      outcome: 'denylisted',
      found: 0,
      stored: 0,
      failed: 0,
      durationMs: Date.now() - started,
      rateRemaining: null,
    });
    return { ok: false, outcome: 'denylisted', message: messageFor('denylisted') };
  }

  try {
    // One place decides which paths are worth reading, and it reads paths only —
    // so a repository with no artifacts costs zero file fetches.
    const inputs = await fetchRepoScanInputs(owner, repo, (tree) =>
      DETECTORS.flatMap((d) => d.match(tree.entries)).flatMap((c) => c.needs),
    );

    const read = async (path: string) => {
      const body = inputs.files.get(path);
      if (body === undefined) throw new Error('not read');
      return body;
    };

    const packages: ScannedPackage[] = [];
    let failed = 0;

    for (const detector of DETECTORS) {
      for (const candidate of detector.match(inputs.tree.entries)) {
        const raw = inputs.files.get(candidate.sourcePath);
        if (raw === undefined) continue; // a cap was reached; already counted as skipped

        // Per candidate, never per repository. One bad file must not lose the
        // other seventeen.
        const result = await detector.parse(candidate, read);
        const blobSha =
          inputs.tree.entries.find((e) => e.path === candidate.sourcePath)?.sha ?? null;

        if (!result.ok) {
          failed += 1;
          packages.push({
            type: detector.type,
            sourcePath: candidate.sourcePath,
            name: result.artifact?.name ?? candidate.sourcePath,
            slug: result.artifact?.slug ?? candidate.sourcePath,
            summary: null,
            licenseText: null,
            meta: {},
            blobSha,
            contentHash: contentHash(raw),
            declaredVersion: null,
            body: raw.slice(0, MAX_BODY),
            frontmatter: {},
            parseStatus: 'failed',
            parseErrors: result.errors,
          });
          continue;
        }

        packages.push({
          type: detector.type,
          sourcePath: candidate.sourcePath,
          name: result.artifact.name,
          slug: result.artifact.slug,
          summary: result.artifact.summary,
          licenseText: result.artifact.licenseText,
          meta: result.artifact.meta,
          blobSha,
          contentHash: contentHash(raw),
          declaredVersion: result.artifact.declaredVersion,
          body: result.artifact.body.slice(0, MAX_BODY),
          frontmatter: result.artifact.frontmatter,
          parseStatus: result.status,
          parseErrors: result.warnings,
        });
      }
    }

    if (packages.length === 0) {
      log({
        event: 'ingest',
        owner,
        repo,
        commitSha: inputs.tree.commitSha,
        outcome: 'no_artifacts',
        found: 0,
        stored: 0,
        failed: 0,
        durationMs: Date.now() - started,
        rateRemaining: rateLimitState()?.remaining ?? null,
      });
      return { ok: false, outcome: 'no_artifacts', message: messageFor('no_artifacts') };
    }

    const scan: RepoScan = {
      ...inputs.metadata,
      scannedAt: new Date(),
      commitSha: inputs.tree.commitSha,
      // Either the tree itself was cut short, or a cap stopped some files being
      // read. Both mean the same thing to a reader: this listing is incomplete.
      treeTruncated: inputs.tree.truncated || inputs.artifactsTruncated,
      packages,
    };

    const persisted = await persistScan(scan);

    log({
      event: 'ingest',
      owner,
      repo,
      commitSha: scan.commitSha,
      outcome: 'ok',
      found: packages.length,
      stored: persisted.packageIds.length,
      failed,
      durationMs: Date.now() - started,
      rateRemaining: rateLimitState()?.remaining ?? null,
    });

    return {
      ok: true,
      owner,
      repo,
      fullName: scan.fullName,
      commitSha: scan.commitSha,
      found: packages.length,
      stored: persisted.packageIds.length,
      failed,
      truncated: scan.treeTruncated,
    };
  } catch (error) {
    const outcome = toIngestOutcome(error);
    const reset = error instanceof GitHubError ? error.rateLimit?.reset : undefined;
    log({
      event: 'ingest',
      owner,
      repo,
      commitSha: null,
      outcome,
      found: 0,
      stored: 0,
      failed: 0,
      durationMs: Date.now() - started,
      rateRemaining: rateLimitState()?.remaining ?? null,
    });
    // The exception itself never crosses this boundary.
    return { ok: false, outcome, message: messageFor(outcome, reset) };
  }
}
```

## Reference D — the pipeline test harness

The stub answers from the frozen fixture and records every hostname it was asked
for, so two claims become assertions rather than descriptions: exactly two
requests to the API host per ingest, and no request to any host named inside
repository content.

```ts
import { readFileSync } from 'node:fs';
import { afterEach, expect, vi } from 'vitest';

process.env.DATABASE_SCHEMA = 'agentdock_test';

const dir = 'fixtures/anthropics-skills';
const repoJson = readFileSync(`${dir}/repo.json`, 'utf8');
const treeJson = readFileSync(`${dir}/tree.json`, 'utf8');

export const contacted: string[] = [];

export function stubGitHub(overrides: { extraFiles?: Record<string, string> } = {}) {
  contacted.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      contacted.push(url.hostname);

      if (url.hostname === 'api.github.com' && url.pathname.includes('/git/trees/')) {
        return new Response(treeJson, { status: 200, headers: rateHeaders() });
      }
      if (url.hostname === 'api.github.com') {
        return new Response(repoJson, { status: 200, headers: rateHeaders() });
      }
      if (url.hostname === 'raw.githubusercontent.com') {
        const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
        const override = overrides.extraFiles?.[path];
        const body =
          override ?? readFileSync(`${dir}/files/${encodeURIComponent(path)}`, 'utf8');
        return new Response(body, { status: 200 });
      }
      // Reaching here means something contacted a host outside the allowlist.
      throw new Error(`unexpected host ${url.hostname}`);
    }),
  );
}

function rateHeaders() {
  return {
    'x-ratelimit-limit': '60',
    'x-ratelimit-remaining': '55',
    'x-ratelimit-reset': '1786347413',
  };
}

afterEach(() => vi.unstubAllGlobals());
```

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Nine outcomes, nine messages, and one that must not be improved into a lie</name>
  <files>src/log.ts, src/ingest/errors.ts, src/ingest/errors.test.ts</files>
  <behavior>
    - Every non-success outcome has a message, and no outcome is missing one.
    - No message contains a phrase asserting that a repository does not exist.
    - No message contains a stack frame marker, a file path, a hostname, a SQL keyword, or an environment variable name.
    - The exhausted-budget message includes a reset time when one is known, and remains a complete sentence when it is not.
    - Every failure shape the GitHub client can raise maps to exactly one outcome.
    - An unrecognised exception maps to the storage failure rather than being surfaced.
  </behavior>
  <action>
    Write `src/log.ts` and `src/ingest/errors.ts` exactly as References A and B,
    then the test covering every behaviour above.

    The unreadable message is the one that matters. GitHub returns byte-identical
    responses for a repository that does not exist and one that is private —
    identical message, identical documentation link, identical status — and it
    does that deliberately so a private repository's existence is not leaked.
    Unauthenticated there is no way to distinguish them and there will not be one.
    The message therefore names both possibilities and says AgentDock cannot tell
    which. Add the assertion that no message asserts non-existence, because the
    shorter sentence reads better and someone will eventually write it.

    The exhausted-budget message states the real numbers rather than saying to try
    later: sixty requests an hour, two per repository. A limit a person can
    predict is a limit they can work with.

    The log signature takes a fixed field set and no free-form payload. That is
    the whole mechanism by which a response body or a credential never reaches a
    log file — not a rule to remember, a parameter that does not exist.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>All nine outcomes carry a message; none asserts non-existence and none contains an internal detail. Every client failure maps to one outcome and unknown exceptions map to the storage failure. The log signature admits no free-form payload.</done>
</task>

<task type="auto">
  <name>Task 2: The pipeline — denylist, two calls, per-artifact isolation, one transaction</name>
  <files>src/ingest/pipeline.ts</files>
  <action>
    Write `src/ingest/pipeline.ts` exactly as Reference C.

    Read the order of operations as the requirement it is. The submitted string is
    reduced to two validated parts before anything else happens, so an invalid
    value never reaches URL construction. The denylist is checked next, against
    the database, before any request — a removal that only takes effect after the
    fetch is not a removal. Then the two rate-limited calls, then the free ones
    under the caps that already live in the client. Then parsing, per candidate,
    inside its own result rather than inside a shared exception. Then one
    transaction. Then one log line.

    Content hashing is defined in this file and nowhere else, over the raw bytes
    with only line endings normalized. Hashing the parsed object would tie version
    identity to key ordering and to the loader's type coercion, so a dependency
    bump would mint a new version for every row in the database; hashing raw bytes
    without normalizing would mint one for a whitespace-only commit.

    A failed parse still produces a row. It carries the failure status, the
    reasons, and the raw excerpt — a visible broken entry is strictly better than
    a silently missing one, and it is also how a detector bug gets noticed.

    The truncation flag is set when either the tree was cut short or a cap stopped
    some files being read. Those are different causes and the same fact for
    whoever reads the page: this listing is incomplete.

    Iterate the detector registry rather than calling the skill detector directly.
    There is one detector today and the loop runs once; the line it costs is the
    difference between the next phase adding a file and the next phase editing
    this one.

    Do not add a job table, a retry, a backoff scheduler, or a progress channel.
    Those are the next phase's requirements and building them here would be
    building them twice.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>The pipeline validates, checks the denylist before any request, scans under the client's caps, parses per candidate, assembles one scan, persists it in one transaction, and emits one log line on every path including every failure path.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The whole path, against frozen bytes and a recording stub</name>
  <files>src/ingest/pipeline.test.ts</files>
  <behavior>
    - Ingesting the reference fixture stores all 18 skills and reports the counts.
    - Ingesting it a second time returns the same repository and stores no new versions.
    - Exactly two of the requests go to the API host; every remaining request goes to the raw host.
    - A fixture whose body contains a link to another host produces no request to that host — asserted against the recorded hostname list, not by inspection.
    - Replacing one file's content with unparseable YAML stores seventeen normal artifacts and one failed one, and the run still succeeds.
    - A tree carrying the truncation flag produces a stored repository whose incompleteness is recorded.
    - A repository whose tree contains no skill files returns the no-artifacts outcome and writes nothing.
    - A denylisted full name returns the denylist outcome with zero fetch calls.
    - A stubbed exhausted-budget response returns the budget outcome carrying the reset time.
    - A line-ending-only change to a file does not mint a new version; a real content change does.
    - Exactly one structured log line is emitted per ingest, and it contains no body text and no credential.
  </behavior>
  <action>
    Write `src/ingest/pipeline.test.ts` using the harness in Reference D and
    covering every behaviour above.

    The stub answers from the frozen fixture captured in plan 01-01 and records
    every hostname it is asked for. That recording is what turns two of this
    phase's claims from descriptions into assertions: that one repository costs
    exactly two rate-limited calls, and that a URL written inside repository
    content is stored as text and never resolved. The second one cannot be
    demonstrated by reading the code — the allowlist makes it structurally
    impossible, and this test is what proves the structure holds.

    The repeat-ingest case is the idempotency proof and it must run against the
    real database rather than a double, because the property being tested belongs
    to the unique constraints and not to the application. Use the test schema, key
    every row on a sentinel that is removed before and after, and guard the whole
    suite on the database URL so it skips visibly where there is none.

    The line-ending case is small and worth having: it is the difference between a
    whitespace commit minting a version for every artifact in a repository and it
    minting none.

    For the exhausted-budget case, stub the response rather than provoking a real
    one. Reproducing it live would spend the entire hourly budget, and the header
    semantics are what the classification actually reads.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; CI=1 bun run test 2&gt;&amp;1 | grep -qi skip &amp;&amp; bun run check:boundaries &amp;&amp; bun run ci</automated>
  </verify>
  <done>All eleven pipeline behaviours pass against frozen fixtures with a recording stub. The two-call cost and the never-fetch-content-URLs property are both asserted from the recorded hostname list. The suite skips visibly with no database URL, and `bun run ci` passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| submitted string → the ingestion pipeline | The entry point is reachable by a direct request, not only through the interface, so its validation is the control rather than a hint. |
| repository content → outbound requests | Bodies contain URLs, and a pipeline that resolves anything it reads is an open proxy. |
| internal exception → the message a person sees | Every exception here carries a stack, and some carry a query or a hostname. |
| partial results → stored state | A run cut short by a cap or the clock must leave honest rows rather than a half-truth presented as complete. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-36 | Information Disclosure | server-side request forgery via content | critical | mitigate | Nothing in the pipeline constructs a request from repository content; every request is built from two validated parts by the client, and a test asserts the complete list of hostnames contacted during a full ingest of a real repository. |
| T-01-37 | Information Disclosure | exception text reaching the interface | high | mitigate | The pipeline returns an outcome and never rethrows; the message table is fixed data; a test asserts no message contains a stack marker, a path, a hostname, a SQL keyword or a variable name. |
| T-01-38 | Spoofing | the unreadable-repository message | medium | mitigate | Both indistinguishable cases are named and the uncertainty is stated; a test asserts no message claims non-existence. |
| T-01-39 | Denial of Service | one malformed artifact failing a repository | high | mitigate | Parsing is per candidate and returns a result on every path; a fixture replaces one file with unparseable content and asserts the other seventeen still store. |
| T-01-40 | Denial of Service | an oversized or slow repository | high | mitigate | Every cap lives in the client and applies here without restatement; the wall clock is a budget with a partial-result path, and incompleteness is recorded rather than hidden. |
| T-01-41 | Repudiation | a removed repository returning | medium | mitigate | The denylist is checked against the database before any request, and a test asserts zero fetch calls on that path. |
| T-01-42 | Information Disclosure | logs | medium | mitigate | One line per ingest with a closed field set and no free-form payload parameter; a test asserts no body text appears in the emitted line. |
| T-01-43 | Tampering | version identity drift | medium | mitigate | The hash is over raw bytes with only line endings normalized, defined in one place and covered in both directions, so neither a whitespace commit nor a dependency bump can mint versions. |
| T-01-44 | Elevation of Privilege | executing scanned content | critical | mitigate | No execution path exists anywhere in the module, enforced by the boundary rule added in plan 01-01 rather than by review. |
</threat_model>

<verification>
1. Ingesting the reference fixture stores all 18 skills; a second run stores no new versions and returns the same repository.
2. The recorded hostname list shows exactly two API-host requests and no host named inside repository content.
3. One unparseable file yields one failed artifact and seventeen normal ones, and the run still succeeds.
4. A truncated tree and a cap-limited read both record incompleteness on the repository.
5. A repository with no skill files writes nothing and returns the no-artifacts outcome.
6. A denylisted name returns its outcome with zero fetch calls.
7. A stubbed exhausted-budget response returns that outcome carrying a reset time.
8. A line-ending-only change mints no version; a content change mints one.
9. Every outcome has a message; none asserts non-existence and none carries an internal detail.
10. Exactly one structured log line per ingest, carrying no body and no credential.
11. `bun run ci` passes with no network access.
</verification>

<success_criteria>
- **ING-01** — a submitted repository is scanned and its artifacts are discovered and stored, proven end to end against a real repository's frozen bytes.
- **ING-05** — nothing is written to disk anywhere in the path, enforced by the boundary scanner.
- **ING-06** — every cap is applied through the client, and a run cut short persists what it read and records the rest.
- **ING-07** — truncation, from either cause, is stored as a visible state on the repository.
- **ING-10** — no execution path exists, enforced by the boundary scanner.
- **ING-11** — URLs inside repository content are stored as text; the recorded hostname list proves none was resolved.
- **DAT-06** — the denylist is consulted before any network request, proven by a zero-fetch assertion.
- **PRV-07** — bodies are stored as a capped excerpt, never mirrored.
- **QUA-06** — one structured line per ingest with a closed field set that cannot carry a secret or a body.
- **QUA-07** — nine distinct actionable messages, none of which leaks an internal or asserts something false.
</success_criteria>

<output>
Create `.planning/phases/AGD-01-walking-skeleton/01-05-SUMMARY.md` when done.
Record the artifact counts from the reference fixture ingest, the hostname list
the recording stub observed, and the exact wording of the unreadable-repository
message. Record no credential.
</output>
