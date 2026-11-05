import { TYPE_FILTER_IDS } from '@/components/typeFilters';

/**
 * The hero's picture, as numbers: one dock per artifact kind around one hub, the
 * index. The 3D scene (DockScene.tsx) and its still drawing (DockBoardStatic.tsx)
 * both draw this, so what a reader sees does not depend on which one they got.
 *
 * What is data and what is not. The stack on each dock is the kind's real listed
 * count, the same number its chip prints. The cables are decoration: every kind
 * reaches the index, but no cable stands for a relation between two artifacts,
 * and nothing here is a live status.
 */

export type DockCounts = Partial<Record<(typeof TYPE_FILTER_IDS)[number], number>>;

const AT: Record<(typeof TYPE_FILTER_IDS)[number], { label: string; x: number; z: number }> = {
  skill: { label: 'Skills', x: -3.3, z: -1.45 },
  plugin: { label: 'Plugins', x: 0, z: -2.05 },
  mcp_server: { label: 'MCP servers', x: 3.3, z: -1.45 },
  command: { label: 'Commands', x: -3.3, z: 1.45 },
  hook: { label: 'Hooks', x: 0, z: 2.05 },
  agent: { label: 'Subagents', x: 3.3, z: 1.45 },
};

// The badges' dark hues (globals.css): the hero is the dark stage in either scheme.
const HUES: Record<(typeof TYPE_FILTER_IDS)[number], string> = {
  skill: '#90b8f5',
  plugin: '#c9a2f0',
  mcp_server: '#6ed4b8',
  command: '#f0b678',
  hook: '#f293ad',
  agent: '#a8b6f2',
};

export const DOCKS = TYPE_FILTER_IDS.map((id) => ({ id, hue: HUES[id], ...AT[id] }));

export const PLATE_HEIGHT = 0.1;
export const DOCK_WIDTH = 1.5;
export const DOCK_DEPTH = 1.1;

/**
 * Plates for a count: one, plus one per doubling. A linear stack would draw 194
 * skills beside one MCP server as a tower beside a coin, and production's 19,000
 * rows would not fit the board. Zero is an empty socket, a different fact from
 * one. Capped at 16 plates (65,536 rows).
 */
export function plates(count = 0): number {
  return count < 1 ? 0 : Math.min(16, 1 + Math.floor(Math.log2(count)));
}

/** A cable's way from a dock to the hub: out of the dock, along the board, in. */
export function cablePath(x: number, z: number): [number, number][] {
  if (x === 0)
    return [
      [0, z],
      [0, Math.sign(z) * 0.55],
    ];
  const side = Math.sign(x);
  return [
    [x, z],
    [x, 0],
    [side * 0.55, 0],
  ];
}
