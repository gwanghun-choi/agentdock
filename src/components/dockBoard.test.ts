import { describe, expect, it } from 'vitest';
import { cablePath, DOCKS, MOTE_CAP, motes, nearestTurn, plates } from '@/components/dockBoard';

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

describe('the swarm a count draws', () => {
  it('is one mote per artifact, and stops at the cap', () => {
    expect(motes(undefined)).toBe(0);
    expect(motes(194)).toBe(194);
    expect(motes(19_113)).toBe(MOTE_CAP);
  });
});

describe('turning a dock to the front', () => {
  const front = Math.PI / 2;
  const place = (angle: number, turn: number) => {
    const at = angle - turn - front;
    return Math.atan2(Math.sin(at), Math.cos(at));
  };

  it('ends with the dock at the front, by the short way, from any drift', () => {
    for (const dock of DOCKS) {
      for (const drift of [0, 1, -2.5, 3.1, 40, -400]) {
        const turn = nearestTurn(drift, dock.angle);
        expect(place(dock.angle, turn)).toBeCloseTo(0);
        expect(Math.abs(turn - drift)).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
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
