import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommitPrint, commitBars } from './CommitPrint';

const SHA = '3a633c080083f05ea4352f5f057380bec39144ea';

describe('CommitPrint', () => {
  it('has one bar per digit, its height the value of the digit', () => {
    expect(commitBars('0af')).toEqual([0, 10, 15]);
    expect(commitBars(SHA)).toHaveLength(40);
  });

  it('draws different commits differently and one commit the same', () => {
    const draw = (sha: string) => renderToStaticMarkup(<CommitPrint sha={sha} />);
    expect(draw(SHA)).toBe(draw(SHA));
    expect(draw(SHA)).not.toBe(draw(`${SHA.slice(0, 39)}0`));
  });

  it('is hidden from a screen reader, which gets the sha in words beside it', () => {
    expect(renderToStaticMarkup(<CommitPrint sha={SHA} />)).toContain('aria-hidden="true"');
  });
});
