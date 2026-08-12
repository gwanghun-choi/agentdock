import { REGISTRY_CAPS, type RegistryFailure } from './types';

// The complete list of hosts this module may contact, and the only place in the
// project where the MCP registry hostname may appear — check:boundaries rule 5
// registers src/registry/ for it and fails the build on a literal anywhere else.
// Hardcoded, not configurable, for src/github/client.ts:5-7's reason exactly: a
// configurable allowlist is one an operator can widen by accident.
export const ALLOWED_HOSTS = new Set(['registry.modelcontextprotocol.io']);

const REGISTRY_ORIGIN = 'https://registry.modelcontextprotocol.io';
const SERVERS_PATH = '/v0/servers';

export class RegistryError extends Error {
  constructor(
    readonly failure: RegistryFailure,
    message: string,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * No token is sent to this host, ever. It needs none, and a credential attached
 * to a request that does not require it is a credential disclosed for nothing.
 *
 * No rate-limit state either. src/github/client.ts keeps `lastRateLimit` because
 * the home page renders GitHub's remaining budget; inventing the same for headers
 * this host may not send would render a number that means nothing. Measured
 * live: the registry returns no x-ratelimit-* header at all.
 */
function assertAllowedHost(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RegistryError('unavailable', 'The registry returned a location that is not a URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new RegistryError('unavailable', `Refusing a non-HTTPS target (${parsed.protocol}).`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new RegistryError('unavailable', `Refusing to contact ${parsed.hostname}.`);
  }
  return parsed;
}

/**
 * One request, with the redirect chain re-validated at every hop.
 *
 * The registry is a friendlier host than GitHub and gets no discount for it: a
 * redirect is still an attacker-influenced hop, and `redirect: 'follow'` would
 * hand the allowlist decision to the runtime.
 */
export async function registryFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('user-agent', 'agentdock');
  headers.set('accept', 'application/json');

  let target = assertAllowedHost(url);

  for (let hop = 0; hop <= REGISTRY_CAPS.maxRedirects; hop += 1) {
    let res: Response;
    try {
      res = await fetch(target, {
        ...init,
        headers,
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(REGISTRY_CAPS.requestTimeoutMs),
      });
    } catch {
      // Nothing from the cause is propagated: some runtimes attach the request
      // headers to a fetch error.
      throw new RegistryError('unavailable', 'AgentDock could not reach the MCP registry.');
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new RegistryError('unavailable', 'The registry redirected without a location.');
      }
      if (hop === REGISTRY_CAPS.maxRedirects) {
        throw new RegistryError('unavailable', 'The registry redirected too many times.');
      }
      // Relative locations resolve against the current target, which is already
      // on the allowlist; absolute ones are re-validated from scratch.
      target = assertAllowedHost(new URL(location, target).toString());
      continue;
    }

    return res;
  }

  throw new RegistryError('unavailable', 'The registry redirected too many times.');
}

/**
 * Reads a body with a hard byte ceiling, counting what arrives.
 *
 * ponytail: a duplicate of src/github/client.ts:187's fifteen lines. Not shared,
 * because that one throws GitHubError('too_large'), and a registry adapter that
 * reports a registry failure as a GitHub failure has lied to messageFor — the
 * user would be told AgentDock could not read a file on GitHub. Extract to
 * src/net/ with a generic error when a third host needs it; two is not enough.
 *
 * Content-Length is never consulted: it is a claim by the party being defended
 * against. The reader cancels the stream the moment the counter passes the cap.
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
        throw new RegistryError('too_large', `Registry page exceeds the ${maxBytes}-byte cap.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8').decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

// C0 control characters other than tab, LF and CR. These bytes are illegal
// inside a JSON string and can appear legally nowhere else in the document, so
// removing them cannot change a valid value — that sentence is the entire
// justification for retrying a parse with them gone, and one publisher's
// description on the live registry contains one.
//
// The lint rule below assumes a control character in a pattern is a typo. Here
// it is the subject: a publisher put a real 0x01 in a description on the live
// registry, and this is the pattern that takes it back out.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the purpose
const RAW_CONTROL_BYTES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export type RegistryPage = {
  /**
   * Deliberately `unknown[]`: this module does no validation beyond JSON shape,
   * so nothing downstream can read a field zod has not approved.
   */
  rows: unknown[];
  /** Null means the sweep is exhausted — see the key check below. */
  nextCursor: string | null;
  /** True when the page only parsed after the control-byte strip. */
  sanitized: boolean;
};

/** One page of the server list. Throws RegistryError; sync.ts turns that into a
 * stop-with-cursor, never a crash. */
export async function fetchServerPage(
  options: { cursor?: string | null; updatedSince?: string | null } = {},
): Promise<RegistryPage> {
  const url = new URL(SERVERS_PATH, REGISTRY_ORIGIN);
  url.searchParams.set('limit', String(REGISTRY_CAPS.pageLimit));
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  if (options.updatedSince) url.searchParams.set('updated_since', options.updatedSince);

  const res = await registryFetch(url.toString());
  if (!res.ok) {
    throw new RegistryError('unavailable', `The registry answered ${res.status}.`);
  }

  const text = await readCapped(res, REGISTRY_CAPS.maxPageBytes);
  return parseServerPage(text);
}

/** Exported for the fixture tests, which own the four page shapes this must survive. */
export function parseServerPage(text: string): RegistryPage {
  let parsed: unknown;
  let sanitized = false;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(text.replace(RAW_CONTROL_BYTES, ''));
      sanitized = true;
    } catch {
      throw new RegistryError('invalid_response', 'The registry returned unparseable JSON.');
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new RegistryError('invalid_response', 'The registry returned a non-object page.');
  }
  const page = parsed as { servers?: unknown; metadata?: unknown };
  if (!Array.isArray(page.servers)) {
    throw new RegistryError('invalid_response', 'The registry page carries no servers array.');
  }

  const metadata =
    typeof page.metadata === 'object' && page.metadata !== null
      ? (page.metadata as Record<string, unknown>)
      : {};

  // End of pagination is the ABSENCE of the key, verified by paginating the live
  // registry to exhaustion: the final page's metadata was exactly {"count": 55}.
  // A truthiness check happens to work today and would break silently on an
  // empty-string cursor, ending every sweep one page early.
  let nextCursor: string | null = null;
  if ('nextCursor' in metadata) {
    const raw = metadata.nextCursor;
    if (typeof raw !== 'string') {
      throw new RegistryError('invalid_response', 'The registry returned a non-string cursor.');
    }
    nextCursor = raw;
  }

  return { rows: page.servers, nextCursor, sanitized };
}
