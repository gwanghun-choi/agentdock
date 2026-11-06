import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { highlight, languageFamily } from './highlight';

const html = (text: string, language?: string) =>
  renderToStaticMarkup(<code>{highlight(text, language)}</code>);
const plain = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&');

describe('highlight', () => {
  it('changes no character of the text, in any family', () => {
    const text =
      'npx --yes "a b" # note\n{"k": 1, "s": "x"}\nkey: value # c\nconst a = `b`; // c\n';
    for (const language of ['bash', 'json', 'yaml', 'ts', 'unknown', undefined]) {
      expect(plain(html(text, language))).toBe(text);
    }
  });

  it('marks the command a shell line runs, its flags and its comment', () => {
    const out = html('uvx --from pkg tool # run it', 'bash');
    expect(out).toContain('<span class="tk-cmd">uvx</span>');
    expect(out).toContain('<span class="tk-flag">--from</span>');
    expect(out).toContain('<span class="tk-comment"># run it</span>');
  });

  it('tells a JSON key from a JSON value', () => {
    const out = html('{"command": "uvx"}', 'json');
    expect(out).toContain('<span class="tk-key">&quot;command&quot;</span>');
    expect(out).toContain('<span class="tk-string">&quot;uvx&quot;</span>');
  });

  it('leaves a language it does not know as plain text', () => {
    expect(languageFamily('cobol')).toBeNull();
    expect(languageFamily('constructor')).toBeNull();
    expect(languageFamily('__proto__')).toBeNull();
    expect(html('MOVE A TO B', 'cobol')).toBe('<code>MOVE A TO B</code>');
  });

  it('never turns a body into markup', () => {
    const out = html('<script>alert(1)</script> "<img src=x>"', 'js');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
  });

  it('holds up on a file written to slow it down, at the 32 KB excerpt cap', () => {
    const hostile = ['"\'', '\\"', '/*', '# ', '$', '-'].flatMap((piece) => [
      piece.repeat(Math.ceil(32_000 / piece.length)),
      // Just under the line limit, as many times as the cap holds: the costliest that is scanned.
      `${piece.repeat(Math.floor(1_990 / piece.length))}\n`.repeat(16),
    ]);
    for (const body of hostile) {
      for (const language of ['bash', 'json', 'yaml', 'ts']) {
        const start = performance.now();
        highlight(body, language);
        expect(performance.now() - start).toBeLessThan(500);
      }
    }
  });
});
