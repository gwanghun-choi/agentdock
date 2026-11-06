import { describe, expect, it } from 'vitest';
import { type YardRow, yardBerths, yardCounts } from './yard';

const row = (id: number, fullName: string, type = 'skill'): YardRow => ({
  id,
  name: `n${id}`,
  type,
  fullName,
  href: `/r/${fullName}/${id}`,
  summary: null,
  commitSha: null,
});

describe('yard', () => {
  it('groups by repository and keeps the order the listing met each', () => {
    const berths = yardBerths([row(1, 'b/b'), row(2, 'a/a'), row(3, 'b/b')]);
    expect(berths.map((b) => b.fullName)).toEqual(['b/b', 'a/a']);
    expect(berths[0].rows.map((r) => r.id)).toEqual([1, 3]);
  });

  it('never places a row under a repository it did not come from', () => {
    for (const berth of yardBerths([row(1, 'a/a'), row(2, 'b/b'), row(3, 'a/a')])) {
      expect(berth.rows.every((r) => r.fullName === berth.fullName)).toBe(true);
    }
  });

  it('counts what it holds, per kind', () => {
    expect(yardCounts([row(1, 'a/a'), row(2, 'a/a', 'hook'), row(3, 'b/b')])).toEqual({
      skill: 2,
      hook: 1,
    });
  });
});
