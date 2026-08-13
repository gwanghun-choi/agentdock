import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PackageListItem } from '@/db/queries/packages';
import { ArtifactRail } from './ArtifactRail';

const item = (over: Partial<PackageListItem> = {}): PackageListItem => ({
  id: 1,
  name: 'canvas-design',
  summary: 'Draw things',
  type: 'skill',
  sourcePath: 'skills/canvas-design/SKILL.md',
  fullName: 'anthropics/skills',
  stars: 167_306,
  commitSha: 'f'.repeat(40),
  scannedAt: new Date('2026-08-12T00:00:00Z'),
  notListedBecause: null,
  ...over,
});

const three = [item(), item({ id: 2, name: 'pdf' }), item({ id: 3, name: 'docx' })];

describe('ArtifactRail', () => {
  const html = renderToStaticMarkup(<ArtifactRail items={three} />);

  it('renders the feed twice — once to read, once to close the loop', () => {
    // The loop is `translateX(-50%)` over a track of two identical halves. If
    // the halves ever stop being identical the animation lands mid-card and
    // drifts a little further every cycle, which looks like a rendering bug
    // rather than a CSS one.
    expect(html.match(/class="rail-set"/g)?.length).toBe(1);
    expect(html.match(/rail-set rail-set-dup/g)?.length).toBe(1);
    expect(html.match(/class="rail-card"/g)?.length).toBe(three.length * 2);
  });

  it('puts the duplicate half beyond the reach of a keyboard or a screen reader', () => {
    // `inert` AND `aria-hidden`. aria-hidden alone would leave the duplicate's
    // links in the tab order — a hidden node a keyboard can reach, which is
    // what axe reports as aria-hidden-focus and what a reader experiences as
    // tabbing into nothing. Measured in Chromium after this: 18 tabbable links
    // in the rail, 0 of them inside the duplicate.
    expect(html).toMatch(/<ul aria-hidden="true" class="rail-set rail-set-dup" inert/);
  });

  it('names the readable half, since the rail has no visible heading', () => {
    expect(html).toMatch(/<ul aria-label="Recently indexed artifacts" class="rail-set"/);
  });

  it('carries the item count so the stylesheet can hold the speed constant', () => {
    // Duration is items × seconds-per-card, not a fixed total: a fixed total
    // would crawl at eighteen cards and sprint at forty.
    expect(html).toContain('--rail-items:3');
  });

  it('links each card at the route the listing row links', () => {
    expect(html).toContain('href="/r/anthropics/skills/skills/canvas-design"');
  });

  it('never truncates a source path, because it does not show one', () => {
    // PackageRows has never clamped a path — a truncated path is a useless
    // path — and a 17rem card is not a reason to start. The card closes on the
    // read date instead, which fits at any width.
    expect(html).not.toContain('skills/canvas-design/SKILL.md');
    expect(html).toContain('read 2026-08-12');
  });

  it('omits a summary that is absent rather than rendering a blank line', () => {
    const bare = renderToStaticMarkup(<ArtifactRail items={[item({ summary: null })]} />);

    expect(bare).not.toContain('rail-card-desc');
  });

  it('renders nothing at all when there is nothing to show', () => {
    // An empty rail is an empty animated frame. The page's own empty state says
    // what happened instead.
    expect(renderToStaticMarkup(<ArtifactRail items={[]} />)).toBe('');
  });

  it('is a Server Component', () => {
    expect(readFileSync('src/components/ArtifactRail.tsx', 'utf8')).not.toContain("'use client'");
  });
});

/**
 * The rail moves by itself, which puts it under WCAG 2.2.2 (Pause, Stop, Hide):
 * content that starts moving automatically and lasts more than five seconds
 * needs a mechanism to stop it. Hover and focus both pause it, but neither is
 * available to every reader — someone using a magnifier, or a pointing device
 * that never hovers, gets neither. The checkbox is the mechanism, and these
 * assert the wiring that makes it work with no JavaScript.
 */
describe('the pause mechanism', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const page = readFileSync('src/app/page.tsx', 'utf8');

  it('renders an explicit control inside the board', () => {
    expect(page).toContain('className="rail-pause"');
    expect(page).toContain('<input type="checkbox" />');
  });

  it('stops the rail from that control, from hover, and from focus', () => {
    expect(css).toMatch(/\.board:has\(\.rail-pause input:checked\) \.rail-track\s*{\s*[^}]*paused/);
    expect(css).toMatch(/\.rail:hover \.rail-track\s*{\s*[^}]*paused/);
    // Focus cancels rather than pauses: a paused track sits mid-translate,
    // where the scroll container cannot bring a focused card into view.
    expect(css).toMatch(/\.rail:focus-within \.rail-track\s*{\s*animation:\s*none/);
  });

  it('keeps the rail a scroll container at all times', () => {
    // This is what makes the focus behaviour above work, and what makes the
    // touch and reduced-motion versions usable at all.
    expect(css).toMatch(/\.rail\s*{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.rail\s*{[^}]*overscroll-behavior-x:\s*contain/);
  });
});
