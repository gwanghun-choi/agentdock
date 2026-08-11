import { describe, expect, it } from 'vitest';
import { JSON_CAPS, parseJsonManifest } from './json';

describe('parseJsonManifest — the input byte cap', () => {
  it('fails before JSON.parse runs, naming the cap', () => {
    // Valid JSON, but oversized: a huge string value rather than a huge array,
    // so this exercises the byte cap and nothing else.
    const oversized = `{"padding":"${'x'.repeat(JSON_CAPS.inputBytes)}"}`;

    const result = parseJsonManifest(oversized, 'manifest.json');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(/over the input cap/);
    expect(result.ok === false && result.errors[0]).toContain('manifest.json');
  });
});

describe('parseJsonManifest — the array-length cap', () => {
  it('fails naming the array length, not the byte size', () => {
    const wide = JSON.stringify({ plugins: Array(JSON_CAPS.maxArrayLength + 1).fill('x') });

    const result = parseJsonManifest(wide, 'marketplace.json');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(
      new RegExp(`${JSON_CAPS.maxArrayLength + 1} entries`),
    );
    expect(result.ok === false && result.errors[0]).toMatch(/array-length cap/);
    expect(result.ok === false && result.errors[0]).not.toMatch(/byte/);
  });

  it('applies to any array at any depth, not only a top-level field', () => {
    const nested = JSON.stringify({
      outer: { inner: Array(JSON_CAPS.maxArrayLength + 1).fill(1) },
    });

    const result = parseJsonManifest(nested, 'manifest.json');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(/array-length cap/);
  });

  it('accepts an array at exactly the cap', () => {
    const atCap = JSON.stringify({ plugins: Array(JSON_CAPS.maxArrayLength).fill('x') });
    expect(parseJsonManifest(atCap, 'marketplace.json').ok).toBe(true);
  });
});

describe('parseJsonManifest — the depth cap', () => {
  function nest(depth: number): unknown {
    let value: unknown = 'leaf';
    for (let i = 0; i < depth; i += 1) value = { child: value };
    return value;
  }

  it('fails without a stack overflow', () => {
    const deep = JSON.stringify(nest(JSON_CAPS.maxDepth + 10));

    const result = parseJsonManifest(deep, 'manifest.json');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(/nested deeper than the depth cap/);
  });

  it('accepts nesting at exactly the cap', () => {
    const atCap = JSON.stringify(nest(JSON_CAPS.maxDepth));
    expect(parseJsonManifest(atCap, 'manifest.json').ok).toBe(true);
  });
});

describe('parseJsonManifest — the mapping rule', () => {
  it('rejects a top-level array with "not a JSON object", the same posture as frontmatter', () => {
    const result = parseJsonManifest('[1,2,3]', 'manifest.json');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(/manifest is not a JSON object/);
  });

  it('rejects a top-level scalar the same way', () => {
    const result = parseJsonManifest('"just a string"', 'manifest.json');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(/manifest is not a JSON object/);
  });

  it('rejects a top-level null the same way', () => {
    const result = parseJsonManifest('null', 'manifest.json');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(/manifest is not a JSON object/);
  });
});

describe('parseJsonManifest — malformed JSON', () => {
  it('fails with a readable error rather than throwing', () => {
    const result = parseJsonManifest('{not: valid}', 'manifest.json');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toMatch(/not valid JSON/);
  });
});

describe('parseJsonManifest — tolerance', () => {
  it('parses valid JSON with unknown top-level fields successfully', () => {
    const result = parseJsonManifest(
      JSON.stringify({ name: 'x', someFieldNobodyDocumented: 42 }),
      'manifest.json',
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.someFieldNobodyDocumented).toBe(42);
  });
});
