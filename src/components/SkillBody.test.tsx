import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkillBody } from './SkillBody';

const DIR = 'fixtures/xss';

function fixture(name: string): string {
  return readFileSync(join(DIR, name), 'utf8');
}

/**
 * Renders to a markup string and asserts on that string.
 *
 * The assertion is that a payload marker does not appear in the output, which
 * needs no browser environment and no testing library — static markup rendering
 * is already available from the installed framework packages.
 */
function render(markdown: string): string {
  return renderToStaticMarkup(<SkillBody markdown={markdown} />);
}

describe('SkillBody — the injection corpus', () => {
  it('renders a script element as inert text with the alert gone', () => {
    const html = render(fixture('script-tag.md'));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(');
    expect(html).not.toContain('xss-marker');
    expect(html).toContain('Prose after.');
  });

  it('drops an image element and its error handler', () => {
    const html = render(fixture('img-onerror.md'));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('xss-marker');
  });

  it('refuses a javascript-scheme link target', () => {
    const html = render(fixture('js-url-link.md'));
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).toContain('click me');
  });

  it('refuses a data-URL image', () => {
    const html = render(fixture('data-url-img.md'));
    expect(html).not.toContain('data:');
    expect(html).not.toContain('<img');
  });

  // This assertion and the U+202E one below (`KEEPS a right-to-left
  // override`) now carry a second load, beyond XSS itself: together they
  // prove that src/components/HiddenContentPanel.tsx (04-03) is the ONLY
  // place a reader can see this content. The comment is dropped HERE, at the
  // render sink, and shown THERE, from the same raw storage
  // (package_version.body) a different component reads. Editing either
  // assertion has, by definition, reopened Pitfall 3 — see 04-CONTEXT.md's
  // Binding decision 7 and 04-PATTERNS.md's "apparent conflict is not a
  // conflict" section. Change neither this assertion nor SkillBody.tsx.
  it('drops an HTML comment carrying instruction-shaped text', () => {
    const html = render(fixture('html-comment.md'));
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('IGNORE PREVIOUS INSTRUCTIONS');
  });

  it('drops an inline style attribute', () => {
    const html = render(fixture('style-attr.md'));
    expect(html).not.toContain('style=');
    expect(html).not.toContain('position:fixed');
  });

  it('drops a frame element', () => {
    const html = render(fixture('iframe.md'));
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('evil.tld');
  });

  it('drops a vector element and its load handler', () => {
    const html = render(fixture('svg-onload.md'));
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('onload');
  });

  it('produces no executable element from entity-encoded, case-varied markup', () => {
    const html = render(fixture('nested-encoded.md'));

    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html.toLowerCase()).not.toContain('href=');

    // The entity-encoded copy is expected to survive — as ESCAPED TEXT, which is
    // what the author literally wrote and is inert. It is the escaped form that
    // proves it: if this ever renders as `<ScRiPt>` something decoded before
    // sanitizing.
    expect(html).toContain('&lt;ScRiPt&gt;');
    // The raw uppercase copy is gone, text and all. One marker left, not two.
    expect(html.match(/xss-marker/g)).toHaveLength(1);
  });

  // See the comment above `drops an HTML comment carrying instruction-shaped
  // text` — this assertion is that test's other half of the same proof.
  // "Surfaced later" is now built: src/components/HiddenContentPanel.tsx
  // (04-03), reading the same package_version.body this component also
  // reads. This assertion stays exactly as it was; only the panel is new.
  it('KEEPS a right-to-left override — it is surfaced later, never stripped', () => {
    const html = render(fixture('bidi-override.md'));
    expect(html).toContain('‮');
  });

  it('renders a real skill body from the frozen corpus with its prose intact', () => {
    // Read in place from the plan 01-01 capture rather than copied, so the two
    // can never drift apart. Six of the hundred sampled real files contain
    // HTML-ish content; this is one of them.
    const source = readFileSync(
      'fixtures/anthropics-skills/files/skills%2Falgorithmic-art%2FSKILL.md',
      'utf8',
    );
    expect(source).toContain('<script src=');

    const html = render(source);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
    // The prose survives, and so does the code fence the markup lived in.
    expect(html).toContain('algorithmic art');
    expect(html).toContain('<code');
  });
});

describe('SkillBody — ordinary Markdown still works', () => {
  const source = [
    '# Heading one',
    '',
    '## Heading two',
    '',
    '- first',
    '- second',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    'Some *emphasis* and **strong** text and `inline code`.',
    '',
    '[a link](https://example.test/page)',
    '',
    '~~struck~~',
    '',
  ].join('\n');

  it('renders headings, lists, extended tables, fenced code and emphasis', () => {
    const html = render(source);
    expect(html).toContain('<h1>Heading one</h1>');
    expect(html).toContain('<h2>Heading two</h2>');
    expect(html).toContain('<li>first</li>');
    // remark-gfm: tables and strikethrough are the extended syntax.
    expect(html).toContain('<table>');
    expect(html).toContain('<del>struck</del>');
    expect(html).toContain('<code');
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<strong>strong</strong>');
  });

  it('gives every link the no-opener relationship set', () => {
    const html = render(source);
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="https://example.test/page"');
  });

  /**
   * `.body pre` scrolls horizontally, so a code fence wider than the column is
   * a scrollable region — and one with no focusable content is unreachable by
   * keyboard, which is WCAG 2.1.1. axe-core reported exactly this on the
   * reference artifact's own code blocks, at mobile width, in both themes.
   *
   * The fix is a `tabIndex` on the rendered element, which is why the assertion
   * is here and not on the stylesheet: the attribute comes from this
   * component's `components` override, and removing that override is the way it
   * would silently come back.
   */
  it('makes a fenced code block reachable by keyboard', () => {
    const html = render(source);
    expect(html).toMatch(/<pre[^>]*tabindex="0"/i);
  });

  /**
   * The override runs after rehype-sanitize, on React's side. It must not have
   * become a way for an author to put a tabindex — or anything else — on some
   * other element by writing it in a body.
   */
  it('still strips an author-written tabindex from the source', () => {
    const html = render('<div tabindex="5">reachable</div>\n\nplain paragraph\n');
    expect(html).not.toContain('tabindex="5"');
    expect(html).not.toContain('<div');
  });

  it('renders a hundred thousand characters without error', () => {
    const big = `# Big\n\n${'word '.repeat(20_000)}`;
    expect(big.length).toBeGreaterThan(100_000);
    expect(() => render(big)).not.toThrow();
  });
});
