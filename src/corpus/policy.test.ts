import { describe, expect, it } from 'vitest';
import { discoveryRejection, MIN_REPOSITORY_STARS } from './policy';

/**
 * The gate, proved with no clock, no network and no database — so this suite is
 * visible in CI rather than skipping there.
 */

const ELIGIBLE = { stars: MIN_REPOSITORY_STARS, isFork: false, isArchived: false };

describe('the star floor', () => {
  // The boundary written three ways, because an off-by-one here silently
  // changes what the whole index contains and nothing else would catch it.
  it.each([
    [MIN_REPOSITORY_STARS - 1, 'below_star_floor' as const],
    [MIN_REPOSITORY_STARS, null],
    [MIN_REPOSITORY_STARS + 1, null],
  ])('at %i stars the answer is %s', (stars, expected) => {
    expect(discoveryRejection({ ...ELIGIBLE, stars })).toBe(expected);
  });

  it('is inclusive, so exactly the floor is admitted rather than excluded', () => {
    expect(discoveryRejection({ ...ELIGIBLE, stars: MIN_REPOSITORY_STARS })).toBeNull();
    expect(discoveryRejection({ ...ELIGIBLE, stars: MIN_REPOSITORY_STARS - 1 })).not.toBeNull();
  });

  it('turns away a repository with no stars at all', () => {
    expect(discoveryRejection({ ...ELIGIBLE, stars: 0 })).toBe('below_star_floor');
  });
});

describe('the structural conditions', () => {
  // Popularity does not buy past either of these, and that is the whole point of
  // asking with a large star count: a rule that only fired on unpopular
  // repositories would be the star floor wearing a second hat.
  it('turns away an archived repository however popular it is', () => {
    expect(discoveryRejection({ stars: 1_000_000, isFork: false, isArchived: true })).toBe(
      'archived',
    );
  });

  it('turns away a fork however popular it is', () => {
    expect(discoveryRejection({ stars: 1_000_000, isFork: true, isArchived: false })).toBe(
      'forked',
    );
  });

  // Which reason a repository failing several tests reports is fixed rather
  // than incidental: the scheduled sync prints a count per reason, and a
  // reordering would move repositories between those lines without changing
  // what was actually indexed.
  it('reports the structural reason first when several apply', () => {
    expect(discoveryRejection({ stars: 0, isFork: true, isArchived: true })).toBe('forked');
    expect(discoveryRejection({ stars: 0, isFork: false, isArchived: true })).toBe('archived');
  });
});

describe('what the floor must not become', () => {
  /**
   * The floor is an ENTRY gate. If any listing, ranking or suppression path
   * consulted it, an artifact AgentDock had already read and shown would
   * disappear when its repository's star count drifted — which is the trust
   * score 05-CONTEXT D-03 refuses, arriving through a different door.
   *
   * Asserted structurally rather than by review: this is the complete set of
   * modules allowed to import it, so adding a seventh caller fails here and
   * whoever adds it has to say why.
   */
  it('is imported only by ingestion, discovery and the copy that explains it', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
          continue;
        }
        if (
          /from '(@\/corpus\/policy|\.\/policy|\.\.\/corpus\/policy)'/.test(
            readFileSync(full, 'utf8'),
          )
        ) {
          importers.push(full.replaceAll('\\', '/'));
        }
      }
    };
    walk('src');

    expect(importers.sort()).toEqual(
      [
        // The gate itself, and the sweep floor that keeps discovery from naming
        // what the gate will refuse.
        'src/corpus/caps.ts',
        'src/ingest/errors.ts',
        'src/ingest/pipeline.ts',
        // Copy that states the policy to a reader. Both interpolate the constant
        // rather than retyping it.
        'src/app/artifacts/page.tsx',
        'src/app/page.tsx',
      ].sort(),
    );

    // Named explicitly, because this is the import that would turn a scheduling
    // rule into a ranking signal without anyone noticing.
    expect(importers).not.toContain('src/db/queries/search.ts');
    expect(importers).not.toContain('src/db/queries/packages.ts');
  });
});
