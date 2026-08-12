/**
 * One row of the MCP registry, reduced to the four facts AgentDock stores.
 *
 * Nothing here is the registry's row verbatim. A named field per fact is what
 * bounds the jsonb hint the seed carries, and it is why a publisher cannot grow
 * AgentDock's storage by adding keys.
 */
export type RegistrySeed = {
  /** The registry's own namespaced id, e.g. "ac.tandem/docs-mcp". Provenance. */
  registryName: string;
  /**
   * Lowercased owner/repo, from githubRepoFromUrl. Null when the row names no
   * GitHub repository — 41% of the registry, and not an error.
   */
  githubFullName: string | null;
  version: string;
  /**
   * The registry's own updatedAt, not AgentDock's write time. The incremental
   * watermark is derived from this and would be wrong from the other.
   *
   * Nullable, because the registry's own envelope makes it optional: _meta and
   * every field under it can be absent, and a row that carries no timestamp is
   * still a row naming a repository worth ingesting. Absent costs the watermark,
   * not the seed.
   */
  updatedAt: string | null;
  /** The publisher's description, stored as a hint. Never rendered as markup. */
  description: string | null;
};

export type RegistryFailure = 'invalid_response' | 'unavailable' | 'too_large';

/**
 * Every number carries the measurement it came from and what it does NOT bound,
 * the doctrine src/github/scan.ts:11-29 already sets for CAPS.
 */
export const REGISTRY_CAPS = {
  /**
   * The registry's own maximum page size. 3,000 rows were sampled at this value
   * with no error. Does not bound the sweep — maxPages does.
   */
  pageLimit: 100,
  /**
   * 40 x 100 = 4,000 rows per invocation, against a measured total of 21,055.
   * Bounds one run's wall clock and memory. Does NOT bound total seeds:
   * re-running walks further, and a run that stops here prints the cursor it
   * stopped at so the next one resumes rather than restarts.
   */
  maxPages: 40,
  /**
   * The largest observed page at limit=100 is well under this. Bounds a hostile
   * or misconfigured response; does NOT bound the number of pages, and is never
   * checked against Content-Length, which is a claim by the party being
   * defended against.
   */
  maxPageBytes: 2 * 1024 * 1024,
  /** Identical to src/github/client.ts:16, for the same reason. */
  requestTimeoutMs: 10_000,
  /** Identical to src/github/client.ts:17, for the same reason. */
  maxRedirects: 2,
} as const;
