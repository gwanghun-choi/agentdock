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
  // U+0000 is valid UTF-8 that a PostgreSQL text or jsonb value cannot hold
  // (22021), so one NUL in one body failed the whole repository's write as
  // storage_failed, every attempt. Measured 2026-10-26: both repositories that
  // exhausted their retries that way (Sync 39853119505–40083909354) carried NULs
  // in SKILL.md bodies. U+FFFD is what TextDecoder already writes for bytes it
  // cannot decode; blob_sha still names the exact bytes.
  return (await readCapped(response, maxBytes)).replaceAll('\u0000', '\uFFFD');
}
