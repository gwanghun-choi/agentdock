import { TYPE_FILTER_IDS } from '@/components/typeFilters';

/** A WebGL renderer with no GPU behind it: what a browser falls back to on such a machine. */
export const isSoftwareRenderer = (name: string) =>
  /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);

/**
 * The hero's picture, as numbers: one dock per artifact kind on a ring around one
 * hub, the index. The 3D scene (DockScene.tsx) and its still drawing
 * (DockBoardStatic.tsx) both draw this, so what a reader sees does not depend on
 * which one they got.
 *
 * What is data and what is not. The plates of each figure (leaves, modules, rack
 * units, steps, coil turns, nodes) and the motes around it are the kind's real
 * listed count, the same number its chip prints. The cables
 * and what travels along them are decoration: every kind reaches the index, but
 * no cable stands for a relation between two artifacts, and nothing here is a
 * live status. A pulse is not a sync running.
 */

export type DockKind = (typeof TYPE_FILTER_IDS)[number];
export type DockCounts = Partial<Record<DockKind, number>>;

/** The ring's centre line, in the scene's units. */
export const RING = 5.2;

/** Degrees round the ring, with 90 nearest the camera. */
const AT: Record<DockKind, { label: string; degrees: number }> = {
  skill: { label: 'Skills', degrees: 210 },
  plugin: { label: 'Plugins', degrees: 270 },
  mcp_server: { label: 'MCP servers', degrees: 330 },
  agent: { label: 'Subagents', degrees: 30 },
  hook: { label: 'Hooks', degrees: 90 },
  command: { label: 'Commands', degrees: 150 },
};

// The badges' dark hues (globals.css): the hero is the dark stage in either scheme.
const HUES: Record<DockKind, string> = {
  skill: '#90b8f5',
  plugin: '#c9a2f0',
  mcp_server: '#6ed4b8',
  command: '#f0b678',
  hook: '#f293ad',
  agent: '#a8b6f2',
};

export const DOCKS = TYPE_FILTER_IDS.map((id) => {
  const angle = (AT[id].degrees * Math.PI) / 180;
  return {
    id,
    hue: HUES[id],
    label: AT[id].label,
    angle,
    x: RING * Math.cos(angle),
    z: RING * Math.sin(angle),
  };
});

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

/**
 * Motes round a dock: one per listed artifact, up to the point where they stop
 * reading as separate things. Above the cap the swarm stops growing; the exact
 * count is on the chip, on the panel and on the dock's label, so the picture
 * never has to carry it alone.
 */
export const MOTE_CAP = 900;
export function motes(count = 0): number {
  return Math.min(MOTE_CAP, Math.max(0, Math.floor(count)));
}

/** A cable's way from a dock to the hub. Decoration: see the top of this file. */
export function cablePath(x: number, z: number): [number, number][] {
  const reach = Math.hypot(x, z);
  return [
    [x, z],
    [(x / reach) * 0.55, (z / reach) * 0.55],
  ];
}

/**
 * The turn of the ring that brings a dock to the front, nearest to where the ring
 * is now. A turn of θ moves a dock from `angle` to `angle − θ`, and the shortest
 * way matters: the ring has been drifting, so θ can be many revolutions along.
 */
export function nearestTurn(current: number, angle: number, front = Math.PI / 2): number {
  const tau = Math.PI * 2;
  const goal = angle - front;
  return current + ((((goal - current + Math.PI) % tau) + tau) % tau) - Math.PI;
}
