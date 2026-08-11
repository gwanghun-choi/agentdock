import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CapabilityFindingView } from '@/db/queries/capabilities';
import { HiddenContentPanel } from './HiddenContentPanel';

/**
 * Every state asserted with no database and no browser, following
 * JobPanel.test.tsx's own convention: plain fabricated rows, no fixture that
 * has to be ingested first, and a permalinkFor stub rather than the real
 * permalinkAtLine — so nothing here imports @/db/queries/packages, which
 * would pull @/db/client in at module load.
 */

function finding(overrides: Partial<CapabilityFindingView> = {}): CapabilityFindingView {
  return {
    id: 1,
    detectorId: 'observedHiddenContent',
    category: 'hidden_content',
    signal: 'U+202E',
    summary: 'contains a Unicode bidirectional control character (U+202E)',
    sourcePath: 'SKILL.md',
    startLine: 3,
    endLine: 3,
    evidenceText: '[U+202E RIGHT-TO-LEFT OVERRIDE]',
    ...overrides,
  };
}

const permalinkFor = (f: CapabilityFindingView) =>
  `https://github.com/o/r/blob/deadbeef/${f.sourcePath}${f.startLine !== null ? `#L${f.startLine}` : ''}`;

const render = (findings: CapabilityFindingView[]) =>
  renderToStaticMarkup(<HiddenContentPanel findings={findings} permalinkFor={permalinkFor} />);

describe('HiddenContentPanel — no findings', () => {
  it('renders nothing at all', () => {
    expect(render([])).toBe('');
  });
});

describe('HiddenContentPanel — one row per finding', () => {
  it('renders the class label, the line number, and the sentinel-substituted evidence', () => {
    const html = render([finding()]);
    expect(html).toContain('SKILL.md:3');
    expect(html).toContain('contains a Unicode bidirectional control character (U+202E)');
    expect(html).toContain('[U+202E RIGHT-TO-LEFT OVERRIDE]');
  });

  it('links each row to a permalink ending in that finding&#39;s line fragment', () => {
    const html = render([finding({ startLine: 21, sourcePath: 'skills/docx/SKILL.md' })]);
    expect(html).toContain('href="https://github.com/o/r/blob/deadbeef/skills/docx/SKILL.md#L21"');
  });

  it('renders one list item per finding, in the order given', () => {
    const html = render([
      finding({ id: 1, sourcePath: 'a.md', startLine: 1 }),
      finding({ id: 2, sourcePath: 'b.md', startLine: 2 }),
    ]);
    const firstIndex = html.indexOf('a.md');
    const secondIndex = html.indexOf('b.md');
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });
});

describe('HiddenContentPanel — no element is ever created from evidence', () => {
  it('escapes angle brackets, quotes and an ampersand, creating no element', () => {
    const html = render([finding({ evidenceText: '<div class="x" data-a="a & b">hi</div>' })]);
    expect(html).not.toContain('<div');
    expect(html).toContain('&lt;div');
    expect(html).toContain('&amp;');
  });

  it('renders a script tag as inert text, with no script element in the markup', () => {
    const html = render([
      finding({ evidenceText: '<script>alert("hidden-content-marker")</script>' }),
    ]);
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('hidden-content-marker');
  });
});
