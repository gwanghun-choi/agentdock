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
