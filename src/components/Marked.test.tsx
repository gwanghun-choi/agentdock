import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MARK_CLOSE as C, Marked, markedSegments, markSubstring, MARK_OPEN as O } from './Marked';

describe('markedSegments', () => {
  it('splits ts_headline output into plain and marked runs', () => {
    expect(markedSegments(`${O}Debugging${C} bugs; ${O}debugged${C}`)).toEqual([
      { text: 'Debugging', marked: true },
      { text: ' bugs; ', marked: false },
      { text: 'debugged', marked: true },
    ]);
    expect(markedSegments('no marks')).toEqual([{ text: 'no marks', marked: false }]);
  });

  it('returns the bare text, unmarked, for anything ts_headline does not write', () => {
    for (const bad of [`${O}a${O}b${C}`, `a${C}b`, `${O}open`]) {
      expect(markedSegments(bad)).toEqual([
        { text: bad.replaceAll(O, '').replaceAll(C, ''), marked: false },
      ]);
    }
  });
});

describe('markSubstring', () => {
  it('delimits every case-insensitive occurrence, keeping the original case', () => {
    expect(markSubstring('Skills/PDF/skills/pdf.md', 'skills/pdf')).toBe(
      `${O}Skills/PDF${C}/${O}skills/pdf${C}.md`,
    );
    expect(markSubstring('a/b', 'x/y')).toBe('a/b');
  });

  it('treats LIKE metacharacters as the literals search.ts escapes them to', () => {
    expect(markSubstring('a/100%_done', '%_')).toBe(`a/100${O}%_${C}done`);
  });

  it('leaves a string whose lowercase changes length unmarked', () => {
    expect(markSubstring('İstanbul/x', 'x')).toBe('İstanbul/x');
  });
});

describe('Marked', () => {
  it('renders marks as <mark> and every character of the text as text', () => {
    const html = renderToStaticMarkup(
      <Marked plain="ignored" value={`<b>x</b> & ${O}"q"${C} <script>`} />,
    );
    expect(html).toBe('&lt;b&gt;x&lt;/b&gt; &amp; <mark>&quot;q&quot;</mark> &lt;script&gt;');
  });

  it('renders the plain value when there is nothing delimited', () => {
    expect(renderToStaticMarkup(<Marked plain="a<b" value={null} />)).toBe('a&lt;b');
  });
});
