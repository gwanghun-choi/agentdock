import { normalizeGithubToken } from '@/env';
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
  // Checked before trimming, and deliberately not folded into the pattern below.
  // JavaScript's `$` matches BEFORE a trailing newline unless the `m` flag is
  // set, so an anchored pattern alone accepts "owner/repo\n" — the classic
  // header- and URL-injection shape. Rejecting the character outright keeps that
  // hole closed even if the trim below is ever removed.
  if (/[\r\n]/.test(input)) return null;

  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (!OWNER_REPO.test(trimmed)) return null;
  const [owner, repo] = trimmed.split('/');
  // A trailing .git is the one form worth normalizing: it is what a clone URL
  // ends with and it names the same repository.
  const stripped = repo.replace(/\.git$/, '');
  if (stripped.length === 0) return null;
  return { owner, repo: stripped };
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
  const rawLimit = res.headers.get('x-ratelimit-limit');
  const rawRemaining = res.headers.get('x-ratelimit-remaining');
  if (rawLimit === null || rawRemaining === null) return undefined;
  const limit = Number(rawLimit);
  const remaining = Number(rawRemaining);
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return undefined;
  const state: RateLimit = { limit, remaining, reset: Number.isFinite(reset) ? reset : 0 };
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
  const headers = new Headers(init.headers);
  headers.set('user-agent', 'agentdock');
  // Read straight from the process environment rather than through the full
  // environment parse, so this path needs no DATABASE_URL. GITHUB_TOKEN is
  // optional and absent by default.
  const token = normalizeGithubToken(process.env.GITHUB_TOKEN);
  if (token) headers.set('authorization', `Bearer ${token}`);

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
    } catch {
      // The token lives in `headers`, which some runtimes attach to a fetch
      // error. Nothing from the cause is propagated for that reason.
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
  return new TextDecoder('utf-8').decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}
