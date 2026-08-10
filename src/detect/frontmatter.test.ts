import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRONTMATTER_CAPS, parseFrontmatter, splitFrontmatter } from './frontmatter';

const DIR = 'fixtures/adversarial';

/** Reads a frozen fixture. No network, no token, no database. */
function fixture(name: string): string {
  return readFileSync(join(DIR, name), 'utf8');
}

function parse(name: string) {
  return parseFrontmatter(fixture(name), `fixtures/${name}`);
}

describe('splitFrontmatter', () => {
  it('does not let a horizontal rule in the body end the block', () => {
    const split = splitFrontmatter(fixture('body-hr.md'));
    expect(split?.frontmatter).toContain('name: body-hr');
    expect(split?.frontmatter).not.toContain('Intro paragraph');
    expect(split?.body).toContain('Text after the rule');
  });

  it('matches through a leading byte order mark', () => {
    expect(splitFrontmatter(fixture('bom.md'))?.frontmatter).toContain('name: bom');
  });

  it('treats Windows line endings identically to Unix ones', () => {
    expect(splitFrontmatter(fixture('crlf.md'))?.frontmatter).toContain('name: crlf');
  });

  it('returns null when there is no fence at position zero', () => {
    expect(splitFrontmatter(fixture('no-fence.md'))).toBeNull();
    expect(splitFrontmatter(fixture('unterminated.md'))).toBeNull();
  });
});

describe('parseFrontmatter — the failures, none of which throw', () => {
  const FAILING: [string, RegExp][] = [
    ['no-fence.md', /no frontmatter fence/],
    ['unterminated.md', /no frontmatter fence/],
    ['bad-yaml.md', /not valid YAML/],
    ['duplicate-keys.md', /not valid YAML/],
    ['not-a-mapping.md', /not a mapping/],
    ['js-function.md', /not valid YAML/],
    ['huge-frontmatter.md', /over the input cap/],
    ['alias-bomb.md', /serialized size cap/],
  ];

  it.each(FAILING)('%s fails with a named reason and returns rather than throws', (name, why) => {
    expect(() => parse(name)).not.toThrow();
    const parsed = parse(name);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.errors.join(' ')).toMatch(why);
  });
});

describe('parseFrontmatter — both caps are required', () => {
  it('refuses the alias bomb on the serialized cap, not the input cap', () => {
    const source = fixture('alias-bomb.md');
    const split = splitFrontmatter(source);

    // Sub-kilobyte on disk: an input cap can never fire on this file. That is
    // the whole point of the fixture.
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThan(1024);
    expect(Buffer.byteLength(split?.frontmatter ?? '', 'utf8')).toBeLessThan(
      FRONTMATTER_CAPS.inputBytes,
    );

    const parsed = parse('alias-bomb.md');
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.errors[0]).toMatch(/serialized size cap/);
  });

  it('refuses a 100 KB block on the input cap before the loader ever runs', () => {
    const split = splitFrontmatter(fixture('huge-frontmatter.md'));
    expect(Buffer.byteLength(split?.frontmatter ?? '', 'utf8')).toBeGreaterThan(
      FRONTMATTER_CAPS.inputBytes,
    );
    const parsed = parse('huge-frontmatter.md');
    expect(parsed.ok === false && parsed.errors[0]).toMatch(/over the input cap/);
  });
});

describe('parseFrontmatter — the loader schema', () => {
  it('refuses a tag that would construct a function', () => {
    const parsed = parse('js-function.md');
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.errors[0]).toMatch(/unknown tag|not valid YAML/);
  });

  it('returns a timestamp-shaped value as a string, not a Date', () => {
    const parsed = parse('timestamp.md');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.released).toBe('2026-08-10');
    expect(parsed.data.released).not.toBeInstanceOf(Date);
  });

  it('refuses a merge key, which the core schema does not define', () => {
    const parsed = parseFrontmatter(
      '---\nbase: &b {a: 1}\nchild:\n  <<: *b\n---\n\nBody.\n',
      'merge.md',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Not merged — the key survives verbatim rather than expanding the alias.
    expect(parsed.data.child).toEqual({ '<<': { a: 1 } });
  });
});

describe('parseFrontmatter — invisible characters survive', () => {
  it('keeps CJK and emoji byte for byte', () => {
    const parsed = parse('unicode.md');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.description).toBe('한국어 설명과 이모지 🚀 그리고 中文字符');
  });

  it('keeps a right-to-left override rather than stripping the evidence', () => {
    const parsed = parse('bidi.md');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(String(parsed.data.description)).toContain('‮');
  });
});

describe('parseFrontmatter — the accepted shapes', () => {
  it.each(['bom.md', 'crlf.md', 'body-hr.md', 'tools-list.md', 'nested-metadata.md'])(
    '%s parses',
    (name) => {
      const parsed = parse(name);
      expect(parsed.ok).toBe(true);
    },
  );

  it('treats an empty document as an empty mapping', () => {
    const parsed = parseFrontmatter('---\n\n---\n\nBody.\n', 'empty.md');
    expect(parsed.ok && parsed.data).toEqual({});
  });
});
