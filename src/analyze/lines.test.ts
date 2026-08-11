import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineAt, scanLines } from './lines';
import { ANALYZE_CAPS } from './types';

function adversarial(name: string): string {
  return readFileSync(join('fixtures', 'adversarial', name), 'utf8');
}

/** Every line scanLines produced, in order — the shape most assertions want. */
function allLines(body: string): { lineNumber: number; text: string }[] {
  const out: { lineNumber: number; text: string }[] = [];
  scanLines(body, (line) => out.push(line));
  return out;
}

describe('scanLines — LF, CRLF and BOM report identical numbers', () => {
  it('the same content numbers identically whether the file uses LF or CRLF endings', () => {
    const lf = 'first\nsecond\ntarget line\nfourth';
    const crlf = lf.replace(/\n/g, '\r\n');

    const lfMatch = allLines(lf).find((l) => l.text === 'target line');
    const crlfMatch = allLines(crlf).find((l) => l.text === 'target line');

    expect(lfMatch?.lineNumber).toBe(3);
    expect(crlfMatch?.lineNumber).toBe(3);
  });

  it('a leading BOM does not shift any line number, against the real bom.md fixture', () => {
    const withBom = adversarial('bom.md');
    const withoutBom = withBom.slice(1); // strip only the BOM character itself

    const bomLines = allLines(withBom);
    const plainLines = allLines(withoutBom);

    expect(bomLines).toHaveLength(plainLines.length);
    // Line 1 keeps the BOM verbatim; every other line is untouched by it.
    expect(bomLines[0].text).toBe(`﻿---`);
    expect(bomLines.slice(1)).toEqual(plainLines.slice(1));
    // The last real line ("Body.") lands on the same number either way.
    const bomBody = bomLines.find((l) => l.text === 'Body.');
    const plainBody = plainLines.find((l) => l.text === 'Body.');
    expect(bomBody?.lineNumber).toBe(plainBody?.lineNumber);
  });

  it('the real crlf.md fixture numbers its content the same as an LF-normalized copy', () => {
    const crlf = adversarial('crlf.md');
    const lf = crlf.replace(/\r\n/g, '\n');

    const crlfLines = allLines(crlf);
    const lfLines = allLines(lf);

    expect(crlfLines.map((l) => l.text)).toEqual(lfLines.map((l) => l.text));
    expect(crlfLines.map((l) => l.lineNumber)).toEqual(lfLines.map((l) => l.lineNumber));
  });
});

describe('lineAt — the inverse of scanLines', () => {
  it('returns the line a finding names, and the matched text is a substring of it', () => {
    const body = adversarial('crlf.md');
    const lines = allLines(body);
    const found = lines.find((l) => l.text.includes('identically'));
    expect(found).toBeDefined();

    const line = lineAt(body, found?.lineNumber as number);
    expect(line).not.toBeNull();
    expect(line as string).toContain('identically');
  });

  it('returns null past the last line', () => {
    const body = 'only\nline';
    expect(lineAt(body, 3)).toBeNull();
  });

  it('strips a trailing carriage return, same as scanLines', () => {
    const body = 'a\r\nb\r\n';
    expect(lineAt(body, 1)).toBe('a');
    expect(lineAt(body, 2)).toBe('b');
  });
});

describe('scanLines — the per-line cap', () => {
  it('caps a line to maxLineChars before it reaches onLine, and reports a non-zero skip count', () => {
    const longLine = 'x'.repeat(ANALYZE_CAPS.maxLineChars + 100);
    const body = `short\n${longLine}\nshort again`;

    const lines = allLines(body);
    const skipped = scanLines(body, () => {});

    expect(lines[1].text).toHaveLength(ANALYZE_CAPS.maxLineChars);
    expect(skipped).toBe(1);
  });

  it('reports zero skips when every line is under the cap', () => {
    const skipped = scanLines('a\nb\nc', () => {});
    expect(skipped).toBe(0);
  });
});
