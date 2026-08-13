import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The stylesheet honours prefers-reduced-motion by redefining two custom
 * properties rather than by the usual `*, *::before, *::after { … !important }`
 * blanket. That is a smaller and quieter mechanism, and it works for exactly one
 * reason: every transition in the file reads its duration from `--dur-fast` or
 * `--dur`.
 *
 * Which makes it a mechanism one careless declaration can defeat in silence. A
 * `transition: background 200ms ease` added anywhere below keeps animating for a
 * reader who has asked the operating system for less motion, and nothing about
 * the page looks wrong to the person who wrote it. This suite is the check that
 * would have caught it — it fails on the literal, not on the symptom.
 *
 * It reads the stylesheet as text on purpose. The alternative is a browser and a
 * computed style, which is a large amount of machinery to assert a property that
 * is decidable from the source.
 */

const css = readFileSync('src/app/globals.css', 'utf8');

/** Comments carry prose about durations ("the 120–250 ms band") and would
 *  otherwise be read as declarations. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The `@media (prefers-reduced-motion: reduce)` block, and only it. Matched by
 *  brace balance from the at-rule rather than by a lazy `[\s\S]*?}`, which would
 *  stop at the first nested rule's closing brace and read as empty. */
function reducedMotionBlock(source: string): string {
  const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

describe('the reduced-motion contract', () => {
  it('declares a prefers-reduced-motion block that redefines both duration tokens', () => {
    const block = reducedMotionBlock(code);

    expect(block).not.toBe('');
    // Both, not either: --dur-fast alone would leave every glyph still sliding.
    expect(block).toMatch(/--dur-fast:\s*0\.01ms/);
    expect(block).toMatch(/--dur:\s*0\.01ms/);
  });

  it('switches off the one animation whose duration is a literal', () => {
    // The skeleton sweep is a keyframe animation, not a state transition, so it
    // is deliberately not on the duration tokens — which means the token
    // override cannot reach it and it needs its own line.
    expect(reducedMotionBlock(code)).toMatch(/\.skeleton::after\s*{\s*display:\s*none/);
  });
});

describe('every animated declaration is reachable by that block', () => {
  /** Each `transition` or `transition-duration` value, whole. The property may
   *  span several lines — the formatter breaks a multi-property transition onto
   *  one line each — so the value runs to the semicolon, not to the newline. */
  function transitionValues(source: string): string[] {
    return [...source.matchAll(/\btransition(?:-duration)?\s*:([^;}]*)[;}]/g)].map((m) =>
      m[1].trim(),
    );
  }

  it('has transitions to check', () => {
    // Guards the two assertions below against passing on an empty set, which is
    // how a regex that stops matching turns into a green suite.
    expect(transitionValues(code).length).toBeGreaterThan(5);
  });

  it('states no transition duration as a literal', () => {
    const literal = transitionValues(code).filter((value) =>
      /[0-9](\.[0-9]+)?\s*m?s\b/.test(value),
    );

    expect(literal).toEqual([]);
  });

  it('takes every transition duration from a token the block overrides', () => {
    const untokenized = transitionValues(code).filter(
      (value) => !/var\(--dur(-fast)?\)/.test(value),
    );

    expect(untokenized).toEqual([]);
  });
});
