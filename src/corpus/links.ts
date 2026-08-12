import { CORPUS_CAPS } from '@/corpus/caps';
import type { SeedRow } from '@/db/queries/seeds';
import { githubRepoFromUrl, normalizeRepo } from '@/github/client';
import { fetchRawFile } from '@/github/raw';

/**
 * No hostname appears in this file, and the omission is deliberate rather than
 * accidental.
 *
 * check:boundaries rule 5 polices `api.github.com` and `raw.githubusercontent.com`
 * — the hosts this project FETCHES. The plain web host a curated list links to is
 * outside that pattern (src/db/queries/packages.ts builds permalinks to it from
 * outside src/github/ and CI passes), so a literal here would not fail the build.
 * It is still not written: the extractor pulls generic URL tokens and hands each
 * to githubRepoFromUrl, which owns the host check, reuses normalizeRepo's length
 * caps and character rules, and is already tested. One host predicate, one place.
 */

/**
 * One fixed pattern, run once over the largest untrusted text this project
 * processes.
 *
 * No alternation and no nested quantifier: a single negated character class with
 * a bounded quantifier has exactly one way to match at any start position, so
 * there is nothing for the engine to backtrack over and the scan is linear in the
 * input regardless of what the input contains. The delimiters excluded from the
 * class are the ones Markdown wraps a link in — whitespace, angle brackets,
 * parentheses, square brackets and quotes — so `<url>`, `[text](url)` and a bare
 * url all yield the same token. The 300-character ceiling is inside the class
 * rather than applied afterwards, so an unterminated run costs 300 steps and not
 * the length of the file.
 */
const URL_TOKEN = /https:\/\/[^\s<>()[\]"'`]{1,300}/g;

/** Sentence-ending punctuation a link is followed by in prose. Trimmed by a
 * loop rather than a quantified anchored pattern, which is the one shape in this
 * file that could have gone quadratic on a run of dots. */
const TRAILING = '.,;:!?*_\\';

function trimTrailing(token: string): string {
  let end = token.length;
  while (end > 0 && TRAILING.includes(token[end - 1])) end -= 1;
  return token.slice(0, end);
}

export type LinkExtraction = {
  /** Distinct lowercased owner/repo, in first-seen order. */
  repos: string[];
  /**
   * Link occurrences past maxLinksPerList — occurrences, not distinct
   * repositories. Counting distinct overflow would need a second unbounded set,
   * which is the memory the cap exists to bound. A number, always printed: a cap
   * that reports nothing reads as "we covered everything".
   */
  overflow: number;
};

/**
 * Every GitHub repository a curated Markdown list names.
 *
 * Nothing extracted is fetched. Each token becomes an owner/repo and then travels
 * the ordinary ingest path through the two hosts that path already uses — this is
 * src/detect/catalog.ts's existing posture applied to a second source, not a new
 * rule.
 */
export function extractRepoLinks(markdown: string): LinkExtraction {
  const seen = new Set<string>();
  let overflow = 0;

  for (const match of markdown.matchAll(URL_TOKEN)) {
    const token = trimTrailing(match[0]);
    let url: URL;
    try {
      url = new URL(token);
    } catch {
      continue;
    }
    const repo = githubRepoFromUrl(url);
    if (!repo) continue;
    const fullName = `${repo.owner}/${repo.repo}`.toLowerCase();
    if (seen.has(fullName)) continue;
    if (seen.size >= CORPUS_CAPS.maxLinksPerList) {
      overflow += 1;
      continue;
    }
    seen.add(fullName);
  }

  return { repos: [...seen], overflow };
}

export type LinkListSpec = {
  /** The list's own repository, as owner/repo. */
  fullName: string;
  /** The file to read inside it, e.g. README.md. */
  path: string;
};

export type LinkExpansion = {
  rows: SeedRow[];
  listsRead: number;
  /** Lists that could not be read. Skipped and counted, never thrown. */
  listsFailed: number;
  /** Summed overflow across every list. */
  overflow: number;
};

/**
 * Reads each curated list and turns it into seed rows, at zero GitHub core cost.
 *
 * Read at HEAD from the raw host, not at a pinned commit. Pinning would cost one
 * core request per list to learn the sha, and the output of reading a link list
 * is a set of owner/repo strings — no byte of a list is ever stored or shown, so
 * PRV-01's pinning requirement, which is about what AgentDock displays, does not
 * reach here. The unpinned read is written into discoveredPath as an explicit
 * `@HEAD` suffix, so the fact is queryable rather than tribal.
 *
 * `discoveredFrom` is the list's own owner/repo — the column's original meaning,
 * used literally, and not a hostname (05-CONTEXT D-12).
 *
 * A list that cannot be read is counted and skipped, and the next one is still
 * read: the per-candidate posture src/ingest/pipeline.ts already applies to
 * detectors.
 */
export async function expandLinkLists(lists: LinkListSpec[]): Promise<LinkExpansion> {
  const rows: SeedRow[] = [];
  let listsRead = 0;
  let listsFailed = 0;
  let overflow = 0;

  for (const list of lists) {
    const repo = normalizeRepo(list.fullName);
    if (!repo) {
      listsFailed += 1;
      continue;
    }

    let markdown: string;
    try {
      markdown = await fetchRawFile(
        repo.owner,
        repo.repo,
        'HEAD',
        list.path,
        CORPUS_CAPS.maxLinkListBytes,
      );
    } catch {
      // The message is not carried: it can hold a URL and, on some runtimes, the
      // request headers a token would live in.
      listsFailed += 1;
      continue;
    }

    listsRead += 1;
    const extracted = extractRepoLinks(markdown);
    overflow += extracted.overflow;

    const from = `${repo.owner}/${repo.repo}`.toLowerCase();
    for (const fullName of extracted.repos) {
      // A list that links to itself is not a discovery.
      if (fullName === from) continue;
      rows.push({
        fullName,
        sourceKind: 'github',
        discoveredFrom: from,
        discoveredPath: `${list.path}@HEAD`,
        hint: {},
      });
    }
  }

  return { rows, listsRead, listsFailed, overflow };
}
