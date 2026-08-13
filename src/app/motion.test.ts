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

/** One at-rule's body, by brace balance from the at-rule rather than by a lazy
 *  `[\s\S]*?}`, which would stop at the first nested rule's closing brace and
 *  read as empty. */
function atRuleBody(source: string, atRule: string): string {
  const start = source.indexOf(atRule);
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

const REDUCE = '@media (prefers-reduced-motion: reduce)';
const NO_PREFERENCE = '@media (prefers-reduced-motion: no-preference)';

function reducedMotionBlock(source: string): string {
  return atRuleBody(source, REDUCE);
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

/**
 * The stylesheet's second motion mechanism, and the one the token override
 * cannot reach.
 *
 * A transition is a state change and has a quieter form — a shorter one — which
 * is why redefining two durations is enough for all of them. An animation does
 * not: a spine drawing itself and a number counting up are either present or
 * absent, and a 0.01ms version of either is a flicker rather than a courtesy.
 * So they are not declared-then-suppressed. Every `animation` and every
 * `@keyframes` in this file sits inside a single
 * `@media (prefers-reduced-motion: no-preference)` block, and under the
 * preference there is nothing in the stylesheet to switch off.
 *
 * That is a structural guarantee exactly as long as it is true of every rule,
 * which is what this suite checks. One `animation: fade 400ms` written outside
 * the block keeps running for a reader who asked the operating system for less
 * motion, and it looks completely correct to whoever wrote it.
 */
describe('every keyframe animation is inside the no-preference block', () => {
  const block = atRuleBody(code, NO_PREFERENCE);

  /** Every `animation` / `animation-name` declaration, and every `@keyframes`
   *  at-rule name. `animation-delay` and `animation-duration` are deliberately
   *  not matched: they are inert on an element with no `animation-name`, so
   *  they cannot start anything on their own. */
  function motionSites(source: string): string[] {
    return [
      ...[...source.matchAll(/\banimation(?:-name)?\s*:([^;}]*)[;}]/g)].map((m) => m[1].trim()),
      ...[...source.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => `@keyframes ${m[1]}`),
    ];
  }

  it('declares the block, and the block declares animations', () => {
    expect(block).not.toBe('');
    // Guards the assertion below against passing on an empty set — the way a
    // regex that stops matching turns into a green suite.
    expect(motionSites(block).length).toBeGreaterThan(10);
  });

  it('declares no animation anywhere else in the file', () => {
    const outside = motionSites(code.replace(block, ' '));

    expect(outside).toEqual([]);
  });

  it('keeps the two blocks distinct, so neither is matched by the other', () => {
    // `indexOf` finds the first occurrence, and `no-preference` and `reduce`
    // share a prefix up to the colon. If a rename ever made one a substring of
    // the other, both helpers above would silently read the same block and
    // every assertion here would pass against the wrong text.
    expect(NO_PREFERENCE.includes(REDUCE)).toBe(false);
    expect(REDUCE.includes(NO_PREFERENCE)).toBe(false);
    expect(atRuleBody(code, REDUCE)).not.toBe(atRuleBody(code, NO_PREFERENCE));
  });
});

/**
 * The count-up reads a value the browser interpolates, and it reads it from a
 * pseudo-element. A pseudo-element inherits from its originating element rather
 * than sharing its declarations, so `inherits: false` — the registration a
 * reader reaches for first, and the one this file had — leaves `--count` at its
 * initial value on every frame and the page renders a permanent 0. Measured
 * exactly that way in Chromium before the fix.
 */
describe('the animated count', () => {
  it('registers --count as inheriting', () => {
    const rule = atRuleBody(code, '@property --count');

    expect(rule).not.toBe('');
    expect(rule).toMatch(/inherits:\s*true/);
    expect(rule).toMatch(/syntax:\s*"<integer>"/);
  });

  it('takes the number it counts to from the element, not from the stylesheet', () => {
    // --target is set by IndexFlow.tsx from countPackages(). A literal here
    // would be a hardcoded corpus size that rots the moment the corpus grows —
    // the exact failure the scope sentence on /artifacts was rewritten to avoid.
    expect(code).toMatch(/--count:\s*var\(--target\)/);
  });
});
