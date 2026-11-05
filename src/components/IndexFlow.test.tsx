import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IndexFlow } from './IndexFlow';

/**
 * The pipeline diagram is the one place on the site where a picture carries the
 * product's claim about itself, which makes it the one place a picture could
 * quietly start saying something the code does not do. These check that what it
 * draws is what is true.
 */
describe('IndexFlow', () => {
  const html = renderToStaticMarkup(<IndexFlow total={822} />);

  it('renders as an ordered list of four steps', () => {
    // Not a decorative div stack: the order is real, and a screen reader that
    // gets "list of 4 items" gets the shape of the content.
    expect(html).toMatch(/^<ol class="flow">/);
    expect(html.match(/<li>/g)?.length).toBe(4 + 9); // four steps, nine filenames
  });

  it('is legible with no CSS and no JavaScript at all', () => {
    // Every claim the drawing makes is also a sentence. The connectors and the
    // stage numbers are ::before/::after in the stylesheet, so a reader with
    // styles off loses the picture and keeps all of the meaning.
    for (const sentence of [
      'A public repository',
      'The files that declare an artifact',
      'AgentDock reads each one',
      'Filed against the commit it read',
    ]) {
      expect(html).toContain(sentence);
    }
  });

  it('names the files the detectors actually match', () => {
    // A plausible-looking set here would be a diagram claiming AgentDock reads
    // something it never opens. Each of these is a literal in src/detect/.
    const detectors = [
      ['SKILL.md', 'src/detect/skill.ts'],
      ['plugin.json', 'src/detect/plugin.ts'],
      ['marketplace.json', 'src/detect/catalog.ts'],
      ['.mcp.json', 'src/detect/mcp.ts'],
      ['server.json', 'src/detect/mcp.ts'],
      ['settings.json', 'src/detect/hook.ts'],
      ['hooks.json', 'src/detect/hook.ts'],
    ] as const;

    for (const [filename, source] of detectors) {
      expect(html).toContain(filename);
      expect(readFileSync(source, 'utf8')).toContain(filename);
    }
    // command.ts matches by directory rather than by filename, so the chip says
    // so with a glob instead of naming a file that does not exist.
    expect(html).toContain('commands/*.md');
    expect(readFileSync('src/detect/command.ts', 'utf8')).toContain('commands/');
  });

  it('renders no verdict about anything it read', () => {
    // The same vocabulary check-boundaries.mjs rule six runs over src/app and
    // src/components. Stated here as well because this component is the one that
    // narrates the pipeline, and "reads" is the whole point of the sentence.
    expect(html).toContain('It never runs the file');
    for (const word of ['safe', 'clean', 'verified', 'trusted', 'malicious']) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });

  it('states the count as grouped text, the one thing anything reads', () => {
    // No custom property and no pseudo-element since Phase 86: a screen reader and a
    // screen get the same digits, grouped like every other count on the page.
    const large = renderToStaticMarkup(<IndexFlow total={1234567} />);
    expect(large).toContain('>1,234,567</span>');
    expect(large).not.toContain('--target');
  });

  it('is a Server Component', () => {
    expect(readFileSync('src/components/IndexFlow.tsx', 'utf8')).not.toContain("'use client'");
  });
});
