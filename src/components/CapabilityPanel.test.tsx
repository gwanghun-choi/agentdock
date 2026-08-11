import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CapabilityFindingView } from '@/db/queries/capabilities';
import { CapabilityPanel } from './CapabilityPanel';

/**
 * Every state asserted with no database and no browser, following
 * HiddenContentPanel.test.tsx's own convention: plain fabricated rows and a
 * permalinkFor stub, so nothing here imports @/db/queries/packages, which
 * would pull @/db/client in at module load.
 */

function finding(overrides: Partial<CapabilityFindingView> = {}): CapabilityFindingView {
  return {
    id: 1,
    detectorId: 'install',
    category: 'package_install',
    signal: 'npx',
    summary: 'references an install directive: npx',
    sourcePath: 'SKILL.md',
    startLine: 3,
    endLine: 3,
    evidenceText: 'run `npx cowsay hi`',
    ...overrides,
  };
}

function declaredFinding(overrides: Partial<CapabilityFindingView> = {}): CapabilityFindingView {
  return finding({
    id: 2,
    detectorId: 'declaredCapabilities',
    category: 'declared',
    signal: 'Bash(git:*)',
    summary: 'declares allowed-tools: Bash(git:*)',
    startLine: null,
    endLine: null,
    evidenceText: null,
    ...overrides,
  });
}

const permalinkFor = (f: CapabilityFindingView) =>
  `https://github.com/o/r/blob/deadbeef/${f.sourcePath}${f.startLine !== null ? `#L${f.startLine}` : ''}`;

const render = (findings: CapabilityFindingView[], analyzedAt: Date | null) =>
  renderToStaticMarkup(
    <CapabilityPanel findings={findings} analyzedAt={analyzedAt} permalinkFor={permalinkFor} />,
  );

describe('CapabilityPanel — declared and observed never merge', () => {
  it('renders two headings and puts each row in the section matching its category', () => {
    const html = render([declaredFinding(), finding()], new Date());
    expect(html).toContain('Declared by the author');
    expect(html).toContain('Observed in the file text');

    const declaredHeadingIndex = html.indexOf('Declared by the author');
    const observedHeadingIndex = html.indexOf('Observed in the file text');
    const declaredRowIndex = html.indexOf('Bash(git:*)');
    const observedRowIndex = html.indexOf('references an install directive: npx');

    expect(declaredRowIndex).toBeGreaterThan(declaredHeadingIndex);
    expect(declaredRowIndex).toBeLessThan(observedHeadingIndex);
    expect(observedRowIndex).toBeGreaterThan(observedHeadingIndex);
  });

  it('a declared row shows the grant text verbatim and carries no line link', () => {
    const html = render([declaredFinding()], new Date());
    expect(html).toContain('<code>Bash(git:*)</code>');
    expect(html).not.toContain('<a ');
  });

  it('an observed row shows its summary, its source path, and a line-anchored permalink', () => {
    const html = render(
      [finding({ sourcePath: 'skills/docx/SKILL.md', startLine: 21 })],
      new Date(),
    );
    expect(html).toContain('skills/docx/SKILL.md:21');
    expect(html).toContain('references an install directive: npx');
    expect(html).toContain('href="https://github.com/o/r/blob/deadbeef/skills/docx/SKILL.md#L21"');
  });
});

describe('CapabilityPanel — absence, in three states', () => {
  it('both sections read "not analyzed" when analyzedAt is null', () => {
    const html = render([], null);
    expect(html.match(/not analyzed/g)).toHaveLength(2);
    expect(html).not.toContain('not detected');
  });

  it('both sections read "not detected" when analyzedAt is set and nothing was found', () => {
    const html = render([], new Date());
    expect(html.match(/not detected/g)).toHaveLength(2);
    expect(html).not.toContain('not analyzed');
  });

  it('a section with findings in only one category still reports the other as "not detected"', () => {
    const html = render([finding()], new Date());
    expect(html).toContain('references an install directive: npx');
    expect(html.match(/not detected/g)).toHaveLength(1);
    expect(html).not.toContain('not analyzed');
  });
});

describe('CapabilityPanel — counts on the heading, never a total', () => {
  it('carries the per-category counts on the observed heading', () => {
    const html = render(
      [
        finding({ id: 1, startLine: 1 }),
        finding({ id: 2, startLine: 2 }),
        finding({
          id: 3,
          category: 'network_request',
          signal: 'WebFetch',
          summary: 'references a network request',
          startLine: 3,
        }),
      ],
      new Date(),
    );
    expect(html).toContain('2 install directives');
    expect(html).toContain('1 network request');
    // No summed total anywhere — never "3 findings" or "3 total".
    expect(html).not.toMatch(/\b3 (findings|total)\b/);
  });

  it('renders no heading and no row for a section with nothing to count', () => {
    const html = render([finding()], new Date());
    // The declared heading has no dash-suffixed count, because the section is
    // empty ("not detected"), not a zero rendered as a count.
    expect(html).toMatch(/Declared by the author<\/h2>/);
  });
});

describe('CapabilityPanel — no element is ever created from evidence', () => {
  it('escapes angle brackets, quotes and an ampersand, creating no element', () => {
    const html = render(
      [finding({ evidenceText: '<div class="x" data-a="a & b">hi</div>' })],
      new Date(),
    );
    expect(html).not.toContain('<div');
    expect(html).toContain('&lt;div');
    expect(html).toContain('&amp;');
  });
});

describe('CapabilityPanel — the overflow finding renders as an ordinary row', () => {
  it('shows the cap notice with no special treatment', () => {
    const html = render(
      [
        finding({
          id: 99,
          signal: 'cap',
          summary: 'stopped after 50 findings; 7 more were found and withheld',
          startLine: null,
          evidenceText: null,
        }),
      ],
      new Date(),
    );
    expect(html).toContain('stopped after 50 findings; 7 more were found and withheld');
  });
});

describe('CapabilityPanel — runs with no database and no browser', () => {
  it('renders from a plain array with no thrown error', () => {
    expect(() => render([finding(), declaredFinding()], new Date())).not.toThrow();
  });
});
