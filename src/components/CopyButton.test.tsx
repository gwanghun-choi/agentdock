import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyButton, copyText } from '@/components/CopyButton';

describe('CopyButton', () => {
  it('renders nothing on the server: no button until the browser shows it can copy', () => {
    expect(renderToStaticMarkup(<CopyButton label="Copy path" value="a/SKILL.md" />)).toBe('');
  });

  it('reports a refused write as a failure, never as copied', async () => {
    const written: string[] = [];
    expect(await copyText('a/b', { writeText: async (v) => void written.push(v) })).toBe('copied');
    expect(written).toEqual(['a/b']);
    expect(
      await copyText('a/b', {
        writeText: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      }),
    ).toBe('failed');
  });
});
