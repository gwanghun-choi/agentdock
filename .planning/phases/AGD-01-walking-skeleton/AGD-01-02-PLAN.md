---
phase: AGD-01-walking-skeleton
plan: 02
type: execute
wave: 2
depends_on: ["01-01"]
files_modified:
  - src/env.ts
  - src/env.test.ts
  - .env.example
  - src/github/types.ts
  - src/github/client.ts
  - src/github/client.test.ts
  - src/github/repo.ts
  - src/github/tree.ts
  - src/github/raw.ts
  - src/github/scan.ts
  - src/github/scan.test.ts
  - src/github/permalink.test.ts
autonomous: true
requirements: [FND-06, FND-08, ING-02, ING-03, ING-04, ING-05, ING-06, ING-07, ING-10, QUA-05]

estimate:
  tokens: 65000
  raw_tokens: 65000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A submitted value that is not exactly owner/repo is rejected before any socket opens, proven by a fetch stub that fails the test if it is called at all"
    - "A redirect to a host outside the hardcoded allowlist is refused; a same-host redirect to the renamed-repository endpoint is followed, because otherwise every renamed repository fails to ingest"
    - "One repository costs two rate-limited API calls; file bodies cost none"
    - "A file that keeps growing is abandoned mid-stream at the byte cap, without ever having trusted the length the server declared"
    - "A truncated tree arrives as a state the caller must handle, not as a shorter list that reads as complete"
    - "Rate-limit exhaustion is recognised from headers rather than from a status code, because GitHub documents two different statuses for it"
    - "A token, when one exists, is attached to requests and appears in no log line, no thrown error, and no serialized error payload (CONTEXT.md resolved question 1 / D-01)"
  artifacts:
    - path: "src/github/client.ts"
      provides: "The single fetch wall: host allowlist, owner/repo normalization, manual redirects, streaming byte cap, timeout, rate-limit accounting, typed failures"
      exports: ["normalizeRepo", "githubFetch", "GitHubError", "rateLimitState"]
      min_lines: 120
    - path: "src/github/scan.ts"
      provides: "The two-call sequence plus capped, concurrency-limited raw reads, under one wall-clock budget"
      exports: ["fetchRepoScanInputs", "CAPS"]
      min_lines: 60
    - path: "src/github/client.test.ts"
      provides: "The SSRF fixture table and the redirect matrix as permanent regressions"
      min_lines: 90
    - path: "src/env.ts"
      provides: "GITHUB_TOKEN as an optional, never-echoed variable"
      exports: ["parseEnv", "Env"]
      min_lines: 40
  key_links:
    - from: "src/github/scan.ts"
      to: "src/github/client.ts"
      via: "every outbound request goes through the one wrapper that owns the allowlist and the caps"
      pattern: "githubFetch"
    - from: "src/github/client.ts"
      to: "src/env.ts"
      via: "reads the optional token and attaches it only when non-empty"
      pattern: "GITHUB_TOKEN"
---

<objective>
Build the wall. Every byte AgentDock ever reads from the internet passes through
one directory, and that directory decides what may be contacted, how far a
redirect may travel, how many bytes may arrive, how long the whole thing may
take, and what a failure means.

Purpose: SSRF, resource exhaustion and quota starvation are not features that get
added — they are properties of the first HTTP call, and every call written
afterwards inherits whatever that one established. Doing this before the parser
and before ingestion means there is no code path that predates the constraint.
The GitHub host names appear in exactly this directory, which the boundary
scanner from plan 01-01 already enforces, so `git grep` is a complete answer to
"what can this process contact".

Output: `src/github/` — a fetch wrapper carrying the allowlist and the caps, the
two-call repository sequence returning the commit SHA and the tree, a
concurrency-limited raw file reader, and the SSRF and redirect fixture suites as
permanent regressions.

Implements CONTEXT.md resolved question 1 (D-01, ship unauthenticated but read a
token when one appears) and the hard constraints on `owner/repo`-only input and
the hardcoded host allowlist.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-01-walking-skeleton/CONTEXT.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-01-PLAN.md
@src/env.ts
@src/env.test.ts
@.env.example
</context>

<decisions_made_while_planning>

**1. `redirect: 'manual'` with re-validation, not `redirect: 'error'`.**

Refusing all redirects is one line shorter and wrong. A renamed repository
legitimately answers with a 301 to `https://api.github.com/repositories/{id}` —
same host, still the API — and refusing it means every renamed repository fails
to ingest for a reason nobody will diagnose. Node's fetch, unlike a browser's,
returns a real readable 3xx under manual mode with the `location` header intact,
so following exactly the hops that stay on the allowlist is implementable
directly. Two hops, re-validated each time.

**2. The rate-limit branch reads headers, not the status code.**

GitHub documents both `403` and `429` for exhaustion, and a `403` with quota
remaining is a permissions response, not a wall. Branching on status alone
mislabels both directions. The rule is: a 403 or 429 that either carries
`retry-after` or reports zero remaining is exhaustion; anything else is not. The
exhaustion response body was never observed live — reproducing it would have cost
the whole hourly budget — so it is exercised with a stubbed response instead, and
the assumption is recorded here rather than hidden in the code.

**3. The byte cap is a streaming counter, and `Content-Length` is never consulted.**

A declared length is a claim by the party being defended against. The reader
counts what actually arrives and cancels the stream when the counter passes the
cap, so a server that lies about its length gains nothing.

**4. Raw file reads are near-serial on purpose.**

The largest sampled repository holds 180 skill files. Firing 180 concurrent
requests at the raw host is the natural instinct precisely because those requests
cost no quota, and it is also how undocumented abuse throttling gets discovered
in production. Concurrency two, a 200-file cap, and a shared wall-clock budget
with a partial-result path: whatever was read is kept, and the remainder is
recorded as truncated rather than silently dropped.

**5. There is no HTTP-client interface and no mock server.**

An interface with one production implementation, created so a test can exist, is
the abstraction to refuse; and a full request-interception layer is a lot of
machinery for two endpoints. Stubbing the global fetch tests the real code path,
including the real call, which is the thing that can be wrong.

**6. `GITHUB_TOKEN` is optional and stays empty.**

The environment has no token and the phase must work without one: sixty core
requests an hour, two per repository, thirty repositories an hour — far above a
manual submission rate. The client attaches an `Authorization` header only when
the variable is a non-empty string, so producing a token later is a change to
`.env` and nothing else. Conditional requests are deliberately not used to save
quota: a 304 was measured to consume quota when unauthenticated, because GitHub's
exemption applies only to authorized requests. The ETag is still stored, because
the column exists and Phase 2 will want it the moment a token appears.

</decisions_made_while_planning>

<reference>

## Reference A — `src/env.ts`, the token addition

Only the schema object changes; `parseEnv` and its error formatting stay exactly
as they are.

```ts
const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  DATABASE_SCHEMA: z.enum(['agentdock', 'agentdock_test']).default('agentdock'),
  // Optional on purpose. AgentDock runs unauthenticated at 60 core requests an
  // hour — two per repository, so about thirty repositories an hour — and must
  // degrade to that rather than depend on a token existing. An empty string is
  // normalized to undefined so a placeholder left in .env behaves as "absent"
  // rather than as a credential that fails on every call.
  GITHUB_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
```

## Reference B — `src/github/types.ts`

```ts
export type TreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
};

export type RepoMetadata = {
  githubNodeId: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  description: string | null;
  homepage: string | null;
  licenseSpdx: string | null;
  stars: number;
  isFork: boolean;
  isArchived: boolean;
  topics: string[];
  pushedAt: Date | null;
  etag: string | null;
};

export type RepoTree = {
  /** The COMMIT sha. Asserted 40-hex. Permalinks 404 on a tree sha. */
  commitSha: string;
  entries: TreeEntry[];
  truncated: boolean;
};

export type RateLimit = {
  limit: number;
  remaining: number;
  /** UTC epoch seconds. */
  reset: number;
};

/** Why a GitHub interaction failed, in terms the UI can act on. */
export type GitHubFailure =
  | 'invalid_repo'
  | 'unreadable'
  | 'rate_limited'
  | 'too_large'
  | 'unavailable';
```

## Reference C — `src/github/client.ts`

```ts
import { parseEnv } from '@/env';
import type { GitHubFailure, RateLimit } from './types';

// The complete list of hosts this process may contact. Hardcoded, not
// configurable: a configurable allowlist is an allowlist an operator can widen
// by accident, and there is no reason for this list to differ per deployment.
const ALLOWED_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);

// Anchored, length-bounded, and applied before any string reaches URL
// construction. GitHub's own limits are 39 characters for an owner and 100 for a
// repository. Without the anchors this accepts traversal segments, a trailing
// newline, and a userinfo prefix — each of which becomes a different host once
// interpolated into a URL.
const OWNER_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 2;

export class GitHubError extends Error {
  constructor(
    readonly failure: GitHubFailure,
    message: string,
    readonly rateLimit?: RateLimit,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** The most recent rate-limit headers seen, for the UI to surface honestly. */
let lastRateLimit: RateLimit | null = null;
export function rateLimitState(): RateLimit | null {
  return lastRateLimit;
}

/**
 * The only entry point for a repository reference.
 *
 * Returns the two validated parts, never the original string. Everything
 * downstream builds URLs from these, so a value that looks like a URL, a path,
 * or a host can never become one.
 */
export function normalizeRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (!OWNER_REPO.test(trimmed)) return null;
  const [owner, repo] = trimmed.split('/');
  // A trailing .git is the one form worth normalizing: it is what a clone URL
  // ends with and it names the same repository.
  return { owner, repo: repo.replace(/\.git$/, '') };
}

function assertAllowedHost(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GitHubError('unavailable', 'GitHub returned a location that is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new GitHubError('unavailable', `Refusing a non-HTTPS target (${parsed.protocol}).`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new GitHubError('unavailable', `Refusing to contact ${parsed.hostname}.`);
  }
  return parsed;
}

function readRateLimit(res: Response): RateLimit | undefined {
  const limit = Number(res.headers.get('x-ratelimit-limit'));
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return undefined;
  const state = { limit, remaining, reset };
  lastRateLimit = state;
  return state;
}

/**
 * Exhaustion is a header fact, not a status fact. GitHub documents both 403 and
 * 429 for it, and a 403 with quota left is a permissions response. Branching on
 * the status alone mislabels both directions.
 */
function isRateLimited(res: Response, rl: RateLimit | undefined): boolean {
  if (res.status !== 403 && res.status !== 429) return false;
  return res.headers.has('retry-after') || rl?.remaining === 0;
}

/**
 * One request, with the redirect chain re-validated at every hop.
 *
 * Never follows automatically: a renamed repository legitimately redirects
 * within the API, and that hop must be taken, but the decision has to be made
 * against the allowlist rather than by the runtime.
 */
export async function githubFetch(
  url: string,
  init: RequestInit = {},
): Promise<{ response: Response; rateLimit: RateLimit | undefined }> {
  const env = parseEnv();
  const headers = new Headers(init.headers);
  headers.set('user-agent', 'agentdock');
  if (env.GITHUB_TOKEN) headers.set('authorization', `Bearer ${env.GITHUB_TOKEN}`);

  let target = assertAllowedHost(url);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(target, {
        ...init,
        headers,
        redirect: 'manual',
        cache: 'no-store',
        signal,
      });
    } catch (cause) {
      // The token lives in `headers`, which some runtimes attach to a fetch
      // error. Nothing from `cause` is propagated for that reason.
      throw new GitHubError('unavailable', 'AgentDock could not reach GitHub.');
    }

    const rateLimit = readRateLimit(res);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new GitHubError('unavailable', 'GitHub redirected without a location.');
      if (hop === MAX_REDIRECTS) {
        throw new GitHubError('unavailable', 'GitHub redirected too many times.');
      }
      // Relative locations resolve against the current target, which is already
      // on the allowlist; absolute ones are re-validated from scratch.
      target = assertAllowedHost(new URL(location, target).toString());
      continue;
    }

    if (isRateLimited(res, rateLimit)) {
      throw new GitHubError('rate_limited', 'GitHub rate limit reached.', rateLimit);
    }
    return { response: res, rateLimit };
  }

  throw new GitHubError('unavailable', 'GitHub redirected too many times.');
}

/**
 * Reads a body with a hard byte ceiling, counting what arrives.
 *
 * Content-Length is a claim by the party being defended against, so it is never
 * consulted. The reader cancels the stream the moment the counter passes the
 * cap, so an endless response costs the cap and not the disk.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GitHubError('too_large', `File exceeds the ${maxBytes}-byte cap.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8').decode(await new Blob(chunks).arrayBuffer());
}
```

## Reference D — `src/github/repo.ts`, `tree.ts`, `raw.ts`

```ts
// src/github/repo.ts
import { GitHubError, githubFetch, readCapped } from './client';
import type { RepoMetadata } from './types';

const MAX_METADATA_BYTES = 1024 * 1024;

export async function fetchRepoMetadata(owner: string, repo: string): Promise<RepoMetadata> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const { response } = await githubFetch(url, {
    headers: { accept: 'application/vnd.github+json' },
  });

  if (response.status === 404) {
    // GitHub returns a byte-identical 404 for a repository that does not exist
    // and one that is private — verified. There is no way to tell them apart
    // unauthenticated, so this failure must never be reported as "not found".
    throw new GitHubError('unreadable', `AgentDock could not read ${owner}/${repo}.`);
  }
  if (!response.ok) {
    throw new GitHubError('unavailable', `GitHub returned ${response.status}.`);
  }

  const json = JSON.parse(await readCapped(response, MAX_METADATA_BYTES));
  return {
    githubNodeId: String(json.node_id),
    fullName: String(json.full_name),
    owner: String(json.owner?.login ?? owner),
    defaultBranch: String(json.default_branch ?? 'main'),
    description: json.description ?? null,
    // The API returns an empty string, not null, for an unset homepage.
    homepage: json.homepage ? String(json.homepage) : null,
    // The only SPDX-shaped source there is, and it is null on a 167k-star
    // repository — so "unknown" is the common path, not the edge case.
    licenseSpdx: json.license?.spdx_id ?? null,
    stars: Number(json.stargazers_count ?? 0),
    isFork: Boolean(json.fork),
    isArchived: Boolean(json.archived),
    topics: Array.isArray(json.topics) ? json.topics.map(String) : [],
    // pushed_at is when the repository last changed. updated_at moves on
    // metadata edits like a star-count refresh and is not that.
    pushedAt: json.pushed_at ? new Date(json.pushed_at) : null,
    etag: response.headers.get('etag'),
  };
}
```

```ts
// src/github/tree.ts
import { GitHubError, githubFetch, readCapped } from './client';
import type { RepoTree, TreeEntry } from './types';

// GitHub's own documented ceiling for a recursive tree is 7 MB.
const MAX_TREE_BYTES = 8 * 1024 * 1024;
const SHA40 = /^[0-9a-f]{40}$/;

/**
 * One recursive call, using HEAD so it does not have to wait for the metadata
 * call to learn the default branch.
 *
 * The `sha` in the response is the COMMIT sha when a ref name is passed —
 * verified on two repositories — which is the value every permalink needs. The
 * adjacent `commit.tree.sha` is a valid-looking 40-hex string that returns 404
 * from every blob URL, and the raw host accepts both, so the assertion below is
 * the only cheap guard against silently picking the wrong one.
 */
export async function fetchRepoTree(owner: string, repo: string): Promise<RepoTree> {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    '/git/trees/HEAD?recursive=1';
  const { response } = await githubFetch(url, {
    headers: { accept: 'application/vnd.github+json' },
  });

  if (response.status === 404) {
    throw new GitHubError('unreadable', `AgentDock could not read ${owner}/${repo}.`);
  }
  if (!response.ok) throw new GitHubError('unavailable', `GitHub returned ${response.status}.`);

  const json = JSON.parse(await readCapped(response, MAX_TREE_BYTES));
  const commitSha = String(json.sha ?? '');
  if (!SHA40.test(commitSha)) {
    throw new GitHubError('unavailable', 'GitHub returned a tree without a usable commit SHA.');
  }

  const entries: TreeEntry[] = (Array.isArray(json.tree) ? json.tree : []).map(
    (e: Record<string, unknown>) => ({
      path: String(e.path),
      type: e.type as TreeEntry['type'],
      sha: String(e.sha),
      size: typeof e.size === 'number' ? e.size : undefined,
    }),
  );

  return { commitSha, entries, truncated: json.truncated === true };
}
```

```ts
// src/github/raw.ts
import { githubFetch, readCapped } from './client';

/**
 * File bodies, pinned to the commit SHA. Verified to consume no rate-limit
 * quota, which is the entire reason the design reads bodies from this host
 * rather than from the contents endpoint.
 */
export async function fetchRawFile(
  owner: string,
  repo: string,
  commitSha: string,
  path: string,
  maxBytes: number,
): Promise<string> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url =
    `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repo)}/${encodeURIComponent(commitSha)}/${encoded}`;
  const { response } = await githubFetch(url);
  if (!response.ok) throw new Error(`raw ${response.status}`);
  return readCapped(response, maxBytes);
}
```

## Reference E — `src/github/scan.ts`

```ts
import { fetchRepoMetadata } from './repo';
import { fetchRawFile } from './raw';
import { fetchRepoTree } from './tree';
import type { RepoMetadata, RepoTree } from './types';

/**
 * Every number here is grounded in the measured corpus, not invented. The
 * largest sampled repository holds 180 skill files and 1,992 tree entries; the
 * largest sampled skill file is 72 KB.
 */
export const CAPS = {
  maxFiles: 200,
  maxFileBytes: 512 * 1024,
  maxTreeEntries: 100_000,
  maxDepth: 10,
  wallClockMs: 120_000,
  concurrency: 2,
} as const;

export type ScanInputs = {
  metadata: RepoMetadata;
  tree: RepoTree;
  files: Map<string, string>;
  /** Paths that matched but were not read, because a cap was reached. */
  skipped: string[];
  artifactsTruncated: boolean;
};

/**
 * The two rate-limited calls, then the free ones.
 *
 * Concurrency is two on purpose. Raw reads cost no quota, which makes firing all
 * 180 of them at once feel free; it is instead how undocumented abuse throttling
 * gets discovered in production. Whatever is read within the budget is kept, and
 * the remainder is reported rather than dropped.
 */
export async function fetchRepoScanInputs(
  owner: string,
  repo: string,
  selectPaths: (tree: RepoTree) => string[],
): Promise<ScanInputs> {
  const deadline = Date.now() + CAPS.wallClockMs;

  const [metadata, tree] = await Promise.all([
    fetchRepoMetadata(owner, repo),
    fetchRepoTree(owner, repo),
  ]);

  const bounded = {
    ...tree,
    entries: tree.entries
      .slice(0, CAPS.maxTreeEntries)
      .filter((e) => e.path.split('/').length <= CAPS.maxDepth),
  };

  const wanted = selectPaths(bounded);
  const taken = wanted.slice(0, CAPS.maxFiles);
  const skipped = wanted.slice(CAPS.maxFiles);

  const files = new Map<string, string>();
  const queue = [...taken];

  async function worker() {
    for (;;) {
      const path = queue.shift();
      if (path === undefined) return;
      if (Date.now() > deadline) {
        skipped.push(path);
        continue;
      }
      try {
        files.set(path, await fetchRawFile(owner, repo, tree.commitSha, path, CAPS.maxFileBytes));
      } catch {
        // One unreadable file must not lose the other 179. It is recorded as
        // skipped and the repository is reported as incomplete.
        skipped.push(path);
      }
    }
  }

  await Promise.all(Array.from({ length: CAPS.concurrency }, worker));

  return {
    metadata,
    tree: bounded,
    files,
    skipped,
    artifactsTruncated: skipped.length > 0,
  };
}
```

## Reference F — the SSRF fixture table

Table-driven, and every case must be rejected **before** a socket opens. The stub
fails the test if it is called at all.

```ts
const REJECTED = [
  'https://github.com/anthropics/skills',
  'anthropics/skills/../../etc/passwd',
  'anthropics/skills?x=1',
  'anthropics/skills#frag',
  'anthropics/skills/tree/main',
  'http://169.254.169.254/latest/meta-data',
  'localhost:5432/x',
  'anthropics@evil.tld/skills',
  '../../anthropics/skills',
  `${'a'.repeat(500)}/b`,
  'anthropics/skills\n',
  '-leading-hyphen/skills',
  '',
  '   ',
];

const ACCEPTED: [string, string, string][] = [
  ['anthropics/skills', 'anthropics', 'skills'],
  ['ANTHROPICS/Skills', 'ANTHROPICS', 'Skills'],
  ['  anthropics/skills  ', 'anthropics', 'skills'],
  ['anthropics/skills.git', 'anthropics', 'skills'],
  ['user/dot.name_x-1', 'user', 'dot.name_x-1'],
];
```

The redirect matrix, driven through a stubbed fetch:

| Location returned | Expected |
|---|---|
| `https://evil.tld/x` | refused |
| `http://api.github.com/repos/a/b` | refused — scheme downgrade |
| `https://api.github.com.evil.tld/x` | refused — suffix, not the host |
| `https://api.github.com/repositories/123` | followed — this is the rename case |
| three consecutive same-host hops | refused at the third |

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The fetch wall — allowlist, owner/repo, manual redirects, streaming cap</name>
  <files>src/env.ts, src/env.test.ts, .env.example, src/github/types.ts, src/github/client.ts, src/github/client.test.ts</files>
  <behavior>
    - Every value in the rejection table returns null from normalization, and the stubbed fetch is never called for any of them.
    - Every value in the acceptance table yields the expected owner and repository, including the case-preserving and `.git`-stripping forms.
    - A redirect off the allowlist, a scheme downgrade, and a lookalike host suffix are each refused; a same-host redirect to the numeric repository endpoint is followed.
    - A fourth hop is refused.
    - A response body that exceeds the cap raises the oversize failure and the stream is cancelled rather than drained.
    - A 403 carrying zero remaining, and a 429 carrying a retry-after, are both classified as exhaustion; a 403 with quota remaining is not.
    - With no token in the environment, no authorization header is sent; with one, it is sent and it appears in no thrown error message.
  </behavior>
  <action>
    Extend the environment schema exactly as Reference A, keeping `parseEnv` and
    its error formatting untouched — the existing sentinel test already proves
    those errors carry no value, and adding the token to the schema extends that
    guarantee to it for free. Add one case to `src/env.test.ts` asserting that a
    whitespace-only token is read as absent, and one asserting a sentinel token
    value never appears in a validation error message.

    Update `.env.example` with one line under the GitHub section stating what the
    empty-token mode actually costs: roughly thirty repositories an hour, because
    a repository costs two of the sixty hourly requests. The placeholder stays a
    placeholder.

    Then write `src/github/types.ts` and `src/github/client.ts` exactly as
    References B and C.

    Three things in that file are load-bearing and must not be simplified. The
    repository pattern is anchored and length-bounded because this is a trust
    boundary rather than a form check — the submit action it will sit behind is
    reachable by direct POST, which the framework documents explicitly. Redirects
    are read and re-validated rather than followed or refused wholesale, because
    a renamed repository answers with a legitimate same-host hop that must be
    taken. And the byte counter counts what arrives, because the declared length
    is a claim by the party being defended against.

    Then write `src/github/client.test.ts` driving the tables in Reference F. The
    rejection cases must assert not only the null result but that the stubbed
    fetch was never invoked — a validator that rejects after the request has left
    has already failed. Use the global stub rather than an injected client
    interface, and unstub after every case.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>Every rejection case is refused with zero fetch calls; every acceptance case normalizes correctly. The redirect matrix behaves as tabulated, including the followed rename hop. The oversize body cancels the stream. Both exhaustion shapes are classified from headers. No token value reaches an error message.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Two rate-limited calls, free bodies, and every cap enforced together</name>
  <files>src/github/repo.ts, src/github/tree.ts, src/github/raw.ts, src/github/scan.ts, src/github/scan.test.ts</files>
  <behavior>
    - Scanning one repository issues exactly two requests to the API host; every file body request goes to the raw host.
    - A tree response whose `sha` is not forty lowercase hex characters is refused rather than stored.
    - A response carrying `truncated: true` yields a scan whose truncated flag is set and whose entry list is not silently presented as complete.
    - A repository with more matching files than the file cap reads exactly the cap and reports the remainder as skipped.
    - An entry nested deeper than the depth cap is not selected.
    - One file that fails to read does not fail the scan; it is reported as skipped.
    - A 404 from either API call produces the unreadable failure, never a message asserting the repository does not exist.
  </behavior>
  <action>
    Write `src/github/repo.ts`, `src/github/tree.ts`, `src/github/raw.ts` and
    `src/github/scan.ts` exactly as References D and E.

    Two details in the metadata mapping are measured facts rather than
    preferences. An unset homepage arrives as an empty string, not null, so it is
    normalized on the way in or the interface renders an empty link. And the
    upstream-change timestamp is the push timestamp: the update timestamp moves
    when a star count refreshes, and on the reference repository the two differ by
    three days — using the wrong one makes the freshness claim quietly false.

    The 404 handling is a correctness requirement, not a copy preference. A
    missing repository and a private one return byte-identical responses, verified
    down to the documentation URL, and unauthenticated there will never be a way
    to tell them apart. Any message asserting non-existence is a false statement
    about roughly half the repositories that produce it.

    The tree call passes HEAD rather than a branch name, so it does not have to
    wait for the metadata call to learn the default branch and the two can run
    concurrently. The forty-hex assertion on the returned SHA is cheap insurance
    against the one undocumented behaviour this phase depends on.

    Do not build a subtree-walk fallback for a truncated tree. The documented
    ceiling is around 25,000 entries and the largest real skills repository
    sampled has 1,992; the requirement asks for the state to be visible, not for
    it to be worked around. Leave a `ponytail:` comment naming the trigger that
    would justify building the walk.

    Then write `src/github/scan.test.ts` covering every behaviour above with a
    stubbed fetch that records the hostname of each call, so the two-call claim
    and the zero-quota-body claim are both asserted rather than described.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>A scan issues exactly two API-host requests. Bodies come from the raw host. The commit SHA is validated, truncation is surfaced, and the file-count, depth and per-file byte caps are each proven by a test. A single unreadable file is reported, not fatal.</done>
</task>

<task type="auto">
  <name>Task 3: The undocumented assumption, checked against the live API and quarantined from CI</name>
  <files>src/github/permalink.test.ts</files>
  <precondition>`api.github.com` and `github.com` are reachable from this machine, and at least four of the sixty hourly unauthenticated core requests remain.</precondition>
  <action>
    Write `src/github/permalink.test.ts`: one suite, skipped whenever the CI
    environment variable is set, that calls the real tree function against
    `anthropics/skills`, asserts the returned SHA is forty hex characters, and
    then fetches `github.com/anthropics/skills/blob/{that sha}/{a real skill
    path}` and asserts a 200.

    This is the only test in the project that touches the network, and it exists
    for one reason. The behaviour it checks — that the Trees endpoint returns the
    commit SHA when handed a ref name — is verified but not documented, and every
    permalink on every detail page depends on it. The raw host accepts both the
    commit SHA and the tree SHA, so a raw-only check cannot catch a regression
    here; only the blob URL can.

    Guard it on the CI variable rather than on a network probe, so the skip is
    deterministic and visible in the output. If it ever fails, the fallback is one
    additional core call to the commits endpoint per ingest — record that in the
    summary so whoever hits it does not have to rediscover the remedy.

    Add a short note in the same file stating the cost: two core requests per run,
    out of sixty an hour.
  </action>
  <verify>
    <automated>bun run test &amp;&amp; CI=1 bun run test 2&gt;&amp;1 | grep -qi skip &amp;&amp; bun run ci</automated>
  </verify>
  <done>The live assumption check passes against GitHub and is skipped visibly under CI. `bun run ci` passes with no network access.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user-submitted text → URL construction | The submitted value decides which host is contacted unless it is reduced to two validated parts first. |
| GitHub response → the next request | A redirect location is attacker-influenceable when the repository is attacker-controlled, and following it blindly moves the request off the reviewed surface. |
| GitHub response body → process memory | Response size is declared by the remote and is unbounded in fact. |
| environment → outbound headers | The token is a credential that travels on every request and lands in every error path that serializes a request. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-12 | Information Disclosure | `normalizeRepo` | critical | mitigate | Anchored, length-bounded pattern applied before URL construction; URLs are built from the two captured parts with per-segment encoding, never from the original string; a table of fourteen bypass shapes asserts rejection with zero fetch calls. |
| T-01-13 | Information Disclosure | redirect handling | critical | mitigate | `redirect: 'manual'`, the location re-validated against the hardcoded host set and an HTTPS scheme check at every hop, capped at two hops; the matrix includes the lookalike-suffix and scheme-downgrade cases. |
| T-01-14 | Denial of Service | `readCapped` | high | mitigate | Streaming byte counter with stream cancellation at the cap; `Content-Length` never consulted; separate caps for metadata, tree and file bodies. |
| T-01-15 | Denial of Service | `fetchRepoScanInputs` | high | mitigate | 200-file cap, 10-level depth cap, 100,000-entry cap, 120-second wall clock, concurrency two, and a partial-result path that keeps what was read and reports the rest. |
| T-01-16 | Information Disclosure | token in errors and logs | high | mitigate | The token is attached to a `Headers` object that is never serialized; fetch rejections are replaced with a fixed message rather than propagated; the environment error formatter already refuses to echo values and a sentinel test extends that to the token. |
| T-01-17 | Spoofing | the 404 message | medium | mitigate | Missing and private are byte-identical and are reported as one honest outcome; no code path asserts non-existence. |
| T-01-18 | Tampering | tree SHA selection | high | mitigate | Forty-hex assertion on the returned SHA plus a live, CI-skipped blob-permalink check; the fallback call is documented in the summary. |
| T-01-19 | Denial of Service | rate-limit exhaustion | medium | mitigate | Classified from `x-ratelimit-remaining` and `retry-after` rather than from the status code; the reset epoch is carried on the error so the interface can say when the window reopens. The exhaustion body shape was never observed live and is exercised with a stub — recorded as an assumption. |
| T-01-20 | Information Disclosure | host sprawl | medium | mitigate | Both hostnames appear only in `src/github/`, enforced by the boundary rule added in plan 01-01, so the reachable surface is answerable by grep. |
</threat_model>

<verification>
1. The fourteen-case rejection table passes with zero fetch calls; the five-case acceptance table normalizes as tabulated.
2. The redirect matrix behaves as tabulated, including following the same-host rename hop and refusing the lookalike suffix.
3. An oversize body raises the oversize failure and cancels the stream.
4. Both exhaustion shapes are classified from headers; a 403 with quota remaining is not.
5. A scan issues exactly two requests to the API host; bodies come from the raw host.
6. Truncation, the file cap, the depth cap and a single unreadable file are each covered by a test.
7. The live permalink assumption check passes locally and skips visibly under CI.
8. `bun run check:boundaries` still passes, confirming both hostnames remain inside `src/github/`.
9. `bun run ci` passes with no network access.
</verification>

<success_criteria>
- **ING-02** — `owner/repo` only, hosts hardcoded; proven by a rejection table asserting no socket opened.
- **ING-03** — redirects read manually and re-validated per hop; off-allowlist, scheme-downgrade and lookalike-suffix targets refused, the legitimate rename hop followed.
- **ING-04** — one recursive tree call plus one metadata call; every body from the zero-quota raw host, asserted by hostname.
- **ING-05** — no filesystem write exists anywhere in `src/github/`, enforced by the boundary scanner.
- **ING-06** — per-file bytes, file count, tree depth, entry count and wall clock all enforced, with a streaming abort rather than a declared length.
- **ING-07** — truncation is returned as state the caller must handle; no subtree walk hides it.
- **ING-10** — no execution path exists in this directory, enforced by the boundary scanner.
- **FND-06** — `GITHUB_TOKEN` validated as optional, whitespace normalized to absent.
- **FND-08** — the token appears in no error message, no log line and no serialized payload, extended from the existing sentinel test.
- **QUA-05** — the SSRF table and the redirect matrix are permanent regressions running with no database and no network.
</success_criteria>

<output>
Create `.planning/phases/AGD-01-walking-skeleton/01-02-SUMMARY.md` when done.
Record the number of core requests the live assumption check spends per run, the
fallback if that check ever fails, and the fact that conditional requests save no
quota while unauthenticated. Record no credential.
</output>
