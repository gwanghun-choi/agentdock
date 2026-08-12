import { githubRepoFromUrl, normalizeRepo } from '@/github/client';
import { parseJsonManifest } from './json';
import type { Candidate, DetectedSeed, Detector, ParseResult, TreeEntry } from './types';

export const CATALOG_CAPS = {
  /**
   * Same file name JSON_CAPS.maxArrayLength already bounds — this constant
   * documents which array the cap protects here, it does not add a second
   * limit. A marketplace with more entries than this fails at the JSON layer
   * before catalog.ts ever sees the plugins array.
   */
  maxPlugins: 1000,
} as const;

const MARKETPLACE_FILENAME = '.claude-plugin/marketplace.json';

/**
 * Which marketplace source shapes name a repository this project could ingest.
 *
 * A relative source points inside the marketplace's OWN repository, which the
 * plugin detector already walked in this same scan — seeding it would enqueue
 * the repository that is being ingested right now. npm and archive sources name
 * no repository at all, and an archive URL is precisely the arbitrary-URL fetch
 * ING-02 forbids, so it is recorded nowhere: the seed is simply not produced.
 *
 * Only github/url/git-subdir are GitHub-ingestible, and url/git-subdir only
 * when the URL's host is github.com — anything else has no owner/repo to
 * normalize, and this project fetches nothing else.
 */
function seedFor(entry: Record<string, unknown>): DetectedSeed | null {
  const source = entry.source;

  // Relative path source: a bare string. Always inside this repository.
  if (typeof source === 'string') return null;
  if (typeof source !== 'object' || source === null) return null;
  const s = source as Record<string, unknown>;

  if (s.source === 'github' && typeof s.repo === 'string') {
    const repo = normalizeRepo(s.repo);
    if (!repo) return null;
    return {
      fullName: `${repo.owner}/${repo.repo}`.toLowerCase(),
      sourceKind: 'github',
      hint: entry,
    };
  }

  if ((s.source === 'url' || s.source === 'git-subdir') && typeof s.url === 'string') {
    let url: URL;
    try {
      url = new URL(s.url);
    } catch {
      return null;
    }
    const repo = githubRepoFromUrl(url);
    if (!repo) return null;
    return {
      fullName: `${repo.owner}/${repo.repo}`.toLowerCase(),
      sourceKind: s.source,
      hint: entry,
    };
  }

  // npm, archive, or anything else this project does not recognize: no
  // repository to seed.
  return null;
}

export const catalog: Detector = {
  type: 'catalog',

  // Path-only, so a repository with no catalog costs zero file reads. The
  // marketplace root directory (containing .claude-plugin/) may be nested, the
  // same way a plugin can be nested under plugins/*/.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter(
        (e) =>
          e.type === 'blob' &&
          (e.path === MARKETPLACE_FILENAME || e.path.endsWith(`/${MARKETPLACE_FILENAME}`)),
      )
      .map((e) => ({ type: 'catalog', sourcePath: e.path, needs: [e.path] }));
  },

  async parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult> {
    let source: string;
    try {
      source = await read(c.sourcePath);
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        errors: [`could not read: ${(error as Error).message}`],
      };
    }

    const parsed = parseJsonManifest(source, c.sourcePath);
    if (!parsed.ok) return { ok: false, status: 'failed', errors: parsed.errors };

    const plugins = parsed.data.plugins;
    if (!Array.isArray(plugins)) {
      return { ok: false, status: 'failed', errors: ['marketplace.json has no plugins array'] };
    }

    const warnings: string[] = [];
    const seeds: DetectedSeed[] = [];
    let notSeedable = 0;

    for (const entry of plugins) {
      if (typeof entry !== 'object' || entry === null) {
        notSeedable += 1;
        continue;
      }
      const seed = seedFor(entry as Record<string, unknown>);
      if (seed) seeds.push(seed);
      else notSeedable += 1;
    }

    if (notSeedable > 0) {
      warnings.push(
        `${notSeedable} of ${plugins.length} entries are not GitHub-reachable and produced no seed`,
      );
    }

    // The warning stays for the artifact branch's convention; the number is what
    // travels. The pipeline's seeds branch never reads warnings, so until this
    // field existed the count was computed here and discarded one function later.
    return { ok: true, status: 'seeds', seeds, warnings, skipped: notSeedable };
  },
};
