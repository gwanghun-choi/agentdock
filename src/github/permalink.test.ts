import { describe, expect, it } from 'vitest';
import { fetchRepoTree } from './tree';

/**
 * The only test in this project that touches the network.
 *
 * It exists for one reason: the Trees endpoint returning the COMMIT sha when
 * handed a ref name is verified but undocumented, and every permalink on every
 * detail page depends on it. `raw.githubusercontent.com` accepts both the commit
 * sha and the tree sha, so a raw-only check cannot catch a regression here —
 * only the blob URL can.
 *
 * COST: one unauthenticated core request per run, out of sixty an hour. The blob
 * probe goes to github.com, which is not the core-quota host.
 *
 * IF THIS EVER FAILS: the remedy is one additional core call per ingest, to
 * `/repos/{owner}/{repo}/commits/{ref}`, reading `.sha` from it instead. That
 * takes an ingest from two core calls to three — about twenty repositories an
 * hour unauthenticated rather than thirty.
 *
 * Guarded on CI rather than on a network probe, so the skip is deterministic and
 * visible in the output.
 */
describe.skipIf(process.env.CI)('the Trees API returns a commit SHA (live)', () => {
  it('returns a sha that resolves as a blob permalink on github.com', async () => {
    const tree = await fetchRepoTree('anthropics', 'skills');

    expect(tree.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const skill = tree.entries.find((e) => e.type === 'blob' && e.path.endsWith('SKILL.md'));
    expect(skill).toBeDefined();

    const permalink = `https://github.com/anthropics/skills/blob/${tree.commitSha}/${skill?.path}`;
    const probe = await fetch(permalink, { redirect: 'manual' });

    expect({ permalink, status: probe.status }).toEqual({ permalink, status: 200 });
  }, 30_000);
});
