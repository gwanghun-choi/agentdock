import { describe, expect, it } from 'vitest';
import { isInCode, markupRegions } from './markup';

describe('markupRegions — purity', () => {
  it('has arity 1, so it structurally cannot reach a database', () => {
    expect(markupRegions).toHaveLength(1);
  });
});

describe('markupRegions / isInCode — fenced blocks', () => {
  it('a line inside a fence is in code, including both delimiter lines themselves', () => {
    const body = ['prose before', '```html', 'fenced content', '```', 'prose after'].join('\n');
    const regions = markupRegions(body);
    expect(isInCode(regions, 1, 0)).toBe(false); // prose before
    expect(isInCode(regions, 2, 0)).toBe(true); // the opening ``` line itself
    expect(isInCode(regions, 3, 0)).toBe(true); // fenced content
    expect(isInCode(regions, 4, 0)).toBe(true); // the closing ``` line itself
    expect(isInCode(regions, 5, 0)).toBe(false); // prose after
  });

  it('a tilde fence toggles the same way a backtick fence does', () => {
    const body = ['~~~', 'inside', '~~~', 'outside'].join('\n');
    const regions = markupRegions(body);
    expect(isInCode(regions, 2, 0)).toBe(true);
    expect(isInCode(regions, 4, 0)).toBe(false);
  });

  it('up to three leading spaces before the fence marker still opens it', () => {
    const body = ['   ```', 'inside', '```'].join('\n');
    const regions = markupRegions(body);
    expect(isInCode(regions, 2, 0)).toBe(true);
  });

  it('four or more leading spaces do not open a fence', () => {
    const body = ['    ```', 'still prose'].join('\n');
    const regions = markupRegions(body);
    expect(isInCode(regions, 1, 0)).toBe(false);
    expect(isInCode(regions, 2, 0)).toBe(false);
  });

  it('an unclosed fence leaves every line after it in code', () => {
    const body = ['```', 'one', 'two', 'three'].join('\n');
    const regions = markupRegions(body);
    expect(isInCode(regions, 4, 0)).toBe(true);
  });
});

describe('markupRegions / isInCode — inline code spans', () => {
  it('an offset inside a single-backtick span is in code; the surrounding text is not', () => {
    const line = 'before `code here` after';
    const body = line;
    const regions = markupRegions(body);
    const codeOffset = line.indexOf('code here');
    const beforeOffset = line.indexOf('before');
    const afterOffset = line.indexOf('after');
    expect(isInCode(regions, 1, codeOffset)).toBe(true);
    expect(isInCode(regions, 1, beforeOffset)).toBe(false);
    expect(isInCode(regions, 1, afterOffset)).toBe(false);
  });

  it('two spans on one line are each tracked independently', () => {
    const line = '`one` prose `two`';
    const regions = markupRegions(line);
    expect(isInCode(regions, 1, line.indexOf('one'))).toBe(true);
    expect(isInCode(regions, 1, line.indexOf('prose'))).toBe(false);
    expect(isInCode(regions, 1, line.indexOf('two'))).toBe(true);
  });

  it('an unterminated trailing backtick run closes no span', () => {
    const line = 'prose `unterminated';
    const regions = markupRegions(line);
    expect(isInCode(regions, 1, line.indexOf('unterminated'))).toBe(false);
  });

  it('a fenced line reports no inline code spans of its own — the fence already answers the whole line', () => {
    const body = ['```', 'has `backticks` too', '```'].join('\n');
    const regions = markupRegions(body);
    expect(regions[1].codeSpans).toEqual([]);
    expect(regions[1].inFence).toBe(true);
  });
});

describe('isInCode — a line with no computed region', () => {
  it('returns false rather than throwing on an out-of-range line number', () => {
    const regions = markupRegions('one line');
    expect(isInCode(regions, 99, 0)).toBe(false);
  });
});
