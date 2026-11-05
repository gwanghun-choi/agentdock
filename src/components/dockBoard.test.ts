import { describe, expect, it } from 'vitest';
import { cablePath, DOCKS, plates } from '@/components/dockBoard';

describe('the stack a count draws', () => {
  it('is an empty socket at zero, and never empty above it', () => {
    expect(plates(0)).toBe(0);
    expect(plates(undefined)).toBe(0);
    expect(plates(1)).toBe(1);
  });

  it('grows by doubling, and stops at the board', () => {
    expect(plates(194)).toBe(8);
    expect(plates(19_113)).toBe(15);
    expect(plates(10_000_000)).toBe(16);
    expect(plates(3)).toBeLessThan(plates(4));
  });
});

describe('the board', () => {
  it('has one dock per kind, each with a cable ending at the hub', () => {
    expect(DOCKS.map((d) => d.id)).toEqual([
      'skill',
      'plugin',
      'mcp_server',
      'command',
      'hook',
      'agent',
    ]);
    for (const { x, z } of DOCKS) {
      const path = cablePath(x, z);
      expect(path[0]).toEqual([x, z]);
      expect(Math.hypot(...(path.at(-1) as [number, number]))).toBeCloseTo(0.55);
    }
  });
});
