import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkVerdictVocabulary } from '../../scripts/check-boundaries.mjs';
import { META_DESCRIPTION_MAX, metaDescription } from './metadata';

/**
 * Hostile frontmatter values are inert at the three sinks the escaping
 * requirement names.
 *
 * These sinks are all plain text rendered by the framework, which escapes text
 * children and attribute values — the metadata API renders titles and meta
 * content through that same path. So this suite documents the guarantee rather
 * than adding machinery.
 *
 * The point of writing it down is the negative: the ONE sink the framework does
 * not escape requires raw-markup construction, and this phase must not add one.
 * The `no-raw-html` rule in scripts/check-boundaries.mjs fails the build on that
 * construction, so this suite and that rule together are the whole control.
 */

// What a hostile `name` in frontmatter looks like: it tries to close the title
// element and open a script.
const TITLE_BREAKER = '</title><script>alert("xss-marker")</script>';
const ATTR_BREAKER = 'a "quoted" & <angled> \'value\'';

describe('the heading sink', () => {
  it('escapes a title-closing payload rendered as a heading', () => {
    const html = renderToStaticMarkup(<h1>{TITLE_BREAKER}</h1>);

    expect(html).not.toContain('<script');
    expect(html).not.toContain('</title>');
    expect(html).toContain('&lt;/title&gt;');
    expect(html).toBe(
      '<h1>&lt;/title&gt;&lt;script&gt;alert(&quot;xss-marker&quot;)&lt;/script&gt;</h1>',
    );
  });
});

describe('the page title sink', () => {
  it('produces escaped output, not markup', () => {
    const html = renderToStaticMarkup(<title>{TITLE_BREAKER}</title>);

    expect(html).not.toContain('<script');
    // Exactly one opening and one closing title element: the payload did not
    // create a second one.
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<\/title>/g)).toHaveLength(1);
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the meta description sink', () => {
  it('escapes a title-closing payload in the content attribute', () => {
    const html = renderToStaticMarkup(<meta name="description" content={TITLE_BREAKER} />);

    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    // The attribute is not broken out of.
    expect(html.match(/content="/g)).toHaveLength(1);
  });

  it('round-trips quotes, angle brackets and an ampersand as text', () => {
    const html = renderToStaticMarkup(<meta name="description" content={ATTR_BREAKER} />);

    expect(html).toBe(
      '<meta name="description" content="a &quot;quoted&quot; &amp; &lt;angled&gt; &#x27;value&#x27;"/>',
    );
    // Text in, text out: nothing became markup.
    expect(html).not.toContain('<angled>');
  });
});

describe('metaDescription', () => {
  it('truncates a description over the cap before it reaches the sink', () => {
    // The longest real description measured is 1,077 characters.
    const long = 'd'.repeat(1077);
    const out = metaDescription(long);

    expect([...out]).toHaveLength(META_DESCRIPTION_MAX);
    expect(out.endsWith('…')).toBe(true);
    expect(renderToStaticMarkup(<meta name="description" content={out} />).length).toBeLessThan(
      long.length,
    );
  });

  it('leaves a short description alone and normalizes an absent one', () => {
    expect(metaDescription('  short  ')).toBe('short');
    expect(metaDescription(null)).toBe('');
    expect(metaDescription(undefined)).toBe('');
  });

  it('does not split a multi-code-unit character in half', () => {
    const emoji = '🚀'.repeat(400);
    const out = metaDescription(emoji);

    expect([...out]).toHaveLength(META_DESCRIPTION_MAX);
    expect(out).not.toContain('�');
    // Every retained character is still a whole rocket.
    expect([...out].slice(0, -1).every((c) => c === '🚀')).toBe(true);
  });

  it('truncates without escaping, leaving that to the framework', () => {
    const out = metaDescription(TITLE_BREAKER);
    expect(out).toBe(TITLE_BREAKER);
    expect(renderToStaticMarkup(<meta name="description" content={out} />)).toContain(
      '&lt;script&gt;',
    );
  });
});

/**
 * The exclusion copy added for COR-07, checked against the two rules that
 * govern it rather than against a reviewer's memory.
 *
 * Rule 6 (no-verdict-vocabulary) runs over whole UI files in CI. This runs over
 * the sentences alone, so the failure a future editor sees names the sentence
 * and not the file.
 */
describe('the not-in-listings copy', () => {
  // Verbatim from src/app/r/[owner]/[repo]/page.tsx. Duplicated on purpose: a
  // test that imported the page would drag in the database client, and the
  // point here is the wording, which a reviewer should be able to read without
  // opening the page.
  const COPY = [
    'A fork on GitHub',
    'is in a fork of another repository',
    'are in a fork of another repository',
    'is byte-identical to an artifact AgentDock already lists',
    'are byte-identical to an artifact AgentDock already lists',
    'has a file whose frontmatter AgentDock could not read',
    'have a file whose frontmatter AgentDock could not read',
    "of these is on this page and not in AgentDock's listings elsewhere",
    "of these are on this page and not in AgentDock's listings elsewhere",
    'Each one is still readable here.',
  ];

  it('uses no verdict vocabulary', () => {
    for (const line of COPY) {
      // Wrapped as a string literal, which is one of the two spans rule 6 scans.
      expect(checkVerdictVocabulary(`const copy = ${JSON.stringify(line)};`)).toEqual([]);
    }
  });

  it('says where an artifact is or what AgentDock did, never what it is worth', () => {
    // The mechanical half of the intent CAP-10 states and rule 6 cannot check:
    // no comparative, no ranking, no worth. Rule 6's own list is separate and
    // asserted above; these are the words that would pass it and still read as
    // a verdict.
    const RANKING =
      /\b(better|worse|lower quality|low.quality|poor|inferior|spam|junk|official)\b/i;
    for (const line of COPY) expect(line).not.toMatch(RANKING);
  });

  it('escapes a hostile repository name rendered beside the count', () => {
    // The sentence itself interpolates only integers, but the page around it
    // renders repository-controlled text, and that is the sink this file exists
    // to pin.
    const html = renderToStaticMarkup(
      <p className="muted">
        {3} of these are on this page and not in AgentDock&apos;s listings elsewhere.{' '}
        {TITLE_BREAKER}
      </p>,
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });
});
