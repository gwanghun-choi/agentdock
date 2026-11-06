import { describe, expect, it } from 'vitest';
import {
  cablePath,
  DOCKS,
  frontDock,
  isSoftwareRenderer,
  MOTE_CAP,
  motes,
  nearestTurn,
  nextDock,
  plates,
  spring,
  TOUR_ORDER,
} from '@/components/dockBoard';

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

describe('isSoftwareRenderer', () => {
  it.each([
    [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    ],
    ['llvmpipe (LLVM 19.1.7, 256 bits)'],
    ['softpipe'],
    ['Mesa Software Rasterizer'],
    ['Microsoft Basic Render Driver'],
  ])('has no GPU behind it: %s', (name) => {
    expect(isSoftwareRenderer(name)).toBe(true);
  });

  it.each([
    [
      'ANGLE (Intel, Vulkan 1.4.335 (Intel(R) Graphics (RPL-S) (0x0000A780)), Intel open-source Mesa driver)',
    ],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Apple GPU'],
    ['Intel(R) HD Graphics, or similar'],
    [''],
  ])('says nothing against this one: %s', (name) => {
    expect(isSoftwareRenderer(name)).toBe(false);
  });
});

describe('the tour round the ring', () => {
  it('visits every dock once a lap, and goes back the way it came', () => {
    let at = TOUR_ORDER[0];
    const seen = new Set<string>();
    for (let i = 0; i < TOUR_ORDER.length; i++) {
      seen.add(at);
      at = nextDock(at);
    }
    expect(seen.size).toBe(DOCKS.length);
    expect(at).toBe(TOUR_ORDER[0]);
    expect(nextDock(nextDock('skill'), -1)).toBe('skill');
  });

  it('steps to the dock the ring brings round next', () => {
    const dock = (id: string) => DOCKS.find((d) => d.id === id) as (typeof DOCKS)[number];
    const front = nearestTurn(0, dock('skill').angle);
    expect(frontDock(front)).toBe('skill');
    // A step's worth of turn in the direction the ring drifts.
    expect(frontDock(front + Math.PI / 3)).toBe(nextDock('skill'));
    // Many revolutions along, as a long visit leaves it.
    expect(frontDock(front + Math.PI * 2 * 40)).toBe('skill');
  });
});

describe('the spring that turns the ring', () => {
  const run = (velocity: number, omega: number, delta: number, seconds: number) => {
    let state: [number, number] = [0, velocity];
    let furthest = 0;
    // Counted, not summed: a float sum runs one step over at some rates.
    for (let step = 0; step < Math.round(seconds / delta); step++) {
      state = spring(state[0], state[1], 1, omega, delta);
      furthest = Math.max(furthest, state[0]);
    }
    return { at: state[0], speed: state[1], furthest };
  };

  it('arrives and stops, with no overshoot from rest', () => {
    const { at, speed, furthest } = run(0, 5, 1 / 60, 4);
    expect(at).toBeCloseTo(1, 3);
    expect(Math.abs(speed)).toBeLessThan(0.01);
    expect(furthest).toBeLessThanOrEqual(1);
  });

  it('is stable at the longest frame the scene allows', () => {
    expect(run(8, 5, 1 / 20, 6).at).toBeCloseTo(1, 2);
  });

  it('lands at the same place at any frame rate', () => {
    expect(run(0, 3, 1 / 120, 1).at).toBeCloseTo(run(0, 3, 1 / 30, 1).at, 6);
  });
});
