import { describe, expect, it } from 'vitest';
import { detailHref, historyHref, permalink, sourcePathCandidates, treeHref } from './hrefs';

const SHA = 'a'.repeat(40);

describe('GitHub links', () => {
  it('leave an ordinary path byte-identical', () => {
    expect(permalink('o/r', SHA, 'skills/pdf/SKILL.md')).toBe(
      `https://github.com/o/r/blob/${SHA}/skills/pdf/SKILL.md`,
    );
  });

  // Regression: the raw join sent `#` and `?` through as a fragment and a query.
  it('encode each segment, so # ? and spaces stay part of the path', () => {
    expect(permalink('o/r', SHA, '.claude/commands/c#-review?.md')).toBe(
      `https://github.com/o/r/blob/${SHA}/.claude/commands/c%23-review%3F.md`,
    );
    expect(historyHref('o/r', SHA, 'a b/x.md')).toBe(
      `https://github.com/o/r/commits/${SHA}/a%20b/x.md`,
    );
  });

  it('point a directory at the commit, and the root at the bare tree', () => {
    expect(treeHref('o/r', SHA, 'skills/pdf')).toBe(
      `https://github.com/o/r/tree/${SHA}/skills/pdf`,
    );
    expect(treeHref('o/r', SHA, '')).toBe(`https://github.com/o/r/tree/${SHA}`);
  });

  it('keep the detail route as it was', () => {
    expect(detailHref('o/r', 'skills/pdf/SKILL.md', 'skill')).toBe('/r/o/r/skills/pdf');
    expect(detailHref('o/r', '.claude/commands/c#.md', 'command')).toBe(
      '/r/o/r/.claude/commands/c%23.md',
    );
  });
});

// Regression: the route passes segments percent-encoded, and the lookup
// compared them to the stored path as they came.
describe('sourcePathCandidates', () => {
  it('decodes each segment back to the stored path', () => {
    expect(sourcePathCandidates(['.claude', 'commands', 'c%23-review.md'])[0]).toBe(
      '.claude/commands/c#-review.md',
    );
    expect(sourcePathCandidates(['a%20b', 'x.md'])[0]).toBe('a b/x.md');
  });

  it('keeps a malformed escape as typed instead of throwing', () => {
    expect(sourcePathCandidates(['100%', 'x.md'])[0]).toBe('100%/x.md');
  });
});
