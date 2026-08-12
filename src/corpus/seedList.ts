import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { SeedRow } from '@/db/queries/seeds';
import { normalizeRepo } from '@/github/client';

/** The one file, and the value written into every row's discoveredPath. */
export const SEED_LIST_PATH = 'config/seeds.json';

/**
 * A plain name, never a hostname (05-CONTEXT D-12). A hostname written as a data
 * value is a hostname literal in whatever file writes it, and rule 5 would then
 * require this module to live in src/github/ — a provenance tag must not decide
 * where code can live.
 */
export const SEED_LIST_SOURCE = 'operator-seed-list';

const entry = z.object({
  fullName: z.string().min(1),
  note: z.string().optional(),
});

const linkListEntry = entry.extend({
  /** Read from the raw host at HEAD. Never a URL — an owner/repo and a path. */
  path: z.string().min(1),
});

/**
 * The operator file's shape.
 *
 * Non-strict on purpose: `rejected` is in the committed file and is read by
 * nothing. Zod strips it, so a rejected candidate cannot quietly become live
 * input by being in the same document — seedList.test.ts asserts that, because
 * a candidate already known to hold nothing would cost two core requests to
 * re-learn it.
 */
const seedListFile = z.object({
  seeds: z.array(entry),
  linkLists: z.array(linkListEntry).default([]),
});

export type SeedListFile = z.infer<typeof seedListFile>;

/**
 * Reads and validates the committed seed list, failing loudly and naming the
 * offending entry.
 *
 * Every fullName goes through normalizeRepo. The file is committed by a human
 * and is the one place in this project where a typo becomes a URL AgentDock
 * constructs, so it is trusted-ish rather than trusted — the same posture
 * src/env.ts takes at the process boundary.
 *
 * File order is preserved and is load-bearing: it is measured artifact density
 * order, it becomes insertion order, and unenqueuedSeeds' (created_at, id) pair
 * turns that into fan-out order. Sorting here would make the cold-start
 * front-loading imaginary.
 */
export function loadSeedList(path: string = SEED_LIST_PATH): SeedListFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`${path}: could not be read (${(error as Error).message})`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path}: is not valid JSON (${(error as Error).message})`);
  }

  const parsed = seedListFile.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`${path}: does not match the seed list schema\n${problems}`);
  }

  const normalize = (list: { fullName: string }[], key: string) => {
    for (const item of list) {
      const repo = normalizeRepo(item.fullName);
      if (!repo) throw new Error(`${path}: ${key} entry "${item.fullName}" is not an owner/repo`);
      item.fullName = `${repo.owner}/${repo.repo}`.toLowerCase();
    }
  };
  normalize(parsed.data.seeds, 'seeds');
  normalize(parsed.data.linkLists, 'linkLists');

  return parsed.data;
}

/** The operator file's entries as seed rows, in the file's own order. */
export function seedListRows(file: SeedListFile): SeedRow[] {
  return file.seeds.map((e) => ({
    fullName: e.fullName,
    sourceKind: 'github',
    discoveredFrom: SEED_LIST_SOURCE,
    discoveredPath: SEED_LIST_PATH,
    hint: e.note ? { note: e.note } : {},
  }));
}
