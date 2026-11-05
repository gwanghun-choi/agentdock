import type { CSSProperties } from 'react';
import {
  cablePath,
  DOCK_DEPTH,
  DOCK_WIDTH,
  DOCKS,
  type DockCounts,
  type DockKind,
  PLATE_HEIGHT,
  plates,
  RING,
} from '@/components/dockBoard';

/**
 * The board without WebGL: what a phone, a reader who asked for less motion, a
 * browser with no WebGL, a lost GPU context and JavaScript off all see, and what
 * everyone sees until the scene arrives. Server markup, so it costs no client
 * JavaScript, and it sits in the same box as the canvas, so nothing moves when
 * one replaces the other.
 *
 * The same ring, docks, cables and counts as DockScene.tsx, by a fixed projection:
 * turned YAW about the upright, then seen from PITCH above. The chips light their
 * dock from the stylesheet (`.hero:has(…)`).
 */

const SCALE = 42;
const PITCH = 0.5;
const YAW = 0.45;
const project = (x: number, y: number, z: number) => {
  const wx = x * Math.cos(YAW) + z * Math.sin(YAW);
  const wz = -x * Math.sin(YAW) + z * Math.cos(YAW);
  return [wx * SCALE, (wz * Math.sin(PITCH) - y * Math.cos(PITCH)) * SCALE] as const;
};
const pts = (...corners: (readonly [number, number])[]) =>
  corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function Box({
  x,
  z,
  w,
  d,
  y = 0,
  h,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  y?: number;
  h: number;
}) {
  const at = (sx: number, sy: number, sz: number) =>
    project(x + (sx * w) / 2, y + sy * h, z + (sz * d) / 2);
  return (
    <>
      <polygon
        className="dock-side"
        points={pts(at(-1, 0, 1), at(1, 0, 1), at(1, 1, 1), at(-1, 1, 1))}
      />
      <polygon
        className="dock-end"
        points={pts(at(-1, 0, -1), at(-1, 0, 1), at(-1, 1, 1), at(-1, 1, -1))}
      />
      <polygon
        className="dock-top"
        points={pts(at(-1, 1, -1), at(1, 1, -1), at(1, 1, 1), at(-1, 1, 1))}
      />
    </>
  );
}

/** A flat circle on the ring's plane, as the ellipse it projects to. */
function Circle({ radius, y = 0, className }: { radius: number; y?: number; className: string }) {
  const [, cy] = project(0, y, 0);
  return (
    <ellipse
      className={className}
      cx={0}
      cy={cy.toFixed(1)}
      rx={(radius * SCALE).toFixed(1)}
      ry={(radius * SCALE * Math.sin(PITCH)).toFixed(1)}
    />
  );
}

/**
 * One kind's stack on its own, for a Browse by type tile: the same box, projection
 * and plate count as its dock on the ring, one group per plate so the stylesheet
 * can lift them apart. No WebGL and no script. Zero plates is the empty socket
 * the ring draws for a kind with nothing listed.
 */
export function DockStack({ kind, count }: { kind: DockKind; count: number }) {
  const n = plates(count);
  return (
    <svg aria-hidden="true" className={`dock-stack dock dock-${kind}`} viewBox="-60 -75 120 115">
      <Box d={DOCK_DEPTH + 0.3} h={0.05} w={DOCK_WIDTH + 0.3} x={0} z={0} />
      {Array.from({ length: n }, (_, i) => `plate-${i}`).map((key, i) => (
        <g className="dock-plate" key={key} style={{ '--i': i } as CSSProperties}>
          <Box
            d={DOCK_DEPTH}
            h={PLATE_HEIGHT * 0.8}
            w={DOCK_WIDTH}
            x={0}
            y={0.05 + i * PLATE_HEIGHT}
            z={0}
          />
        </g>
      ))}
    </svg>
  );
}

export function DockBoardStatic({ counts }: { counts: DockCounts }) {
  // Back to front, so a nearer dock paints over a farther one.
  const docks = [...DOCKS].sort((a, b) => project(a.x, 0, a.z)[1] - project(b.x, 0, b.z)[1]);
  const [near, far] = [docks.filter((d) => project(d.x, 0, d.z)[1] > 0), docks];
  const [, hubY] = project(0, 0.4, 0);
  return (
    <svg aria-hidden="true" className="dock-still" viewBox="-310 -195 620 345">
      <Circle className="dock-orbit" radius={RING + 2.4} y={-1.2} />
      <Circle className="dock-orbit" radius={RING + 4.2} y={-1.2} />
      <Circle className="dock-deck-under" radius={RING + 1} y={-0.14} />
      <Circle className="dock-deck" radius={RING + 1} />
      <Circle className="dock-rail" radius={RING - 1} />
      <Circle className="dock-well" radius={RING - 1.05} y={0.02} />
      {DOCKS.map((dock) => (
        <polyline
          className={`dock-cable dock-${dock.id}`}
          fill="none"
          key={dock.id}
          points={pts(...cablePath(dock.x, dock.z).map(([x, z]) => project(x, 0.05, z)))}
        />
      ))}
      <circle className="dock-core-glow" cx={0} cy={hubY.toFixed(1)} r={78} />
      <g className="dock-hub">
        <Box d={1.5} h={0.5} w={1.5} x={0} z={0} />
      </g>
      <g className="dock-glyph" transform={`translate(0 ${(hubY - 26).toFixed(1)})`}>
        <rect height={10} rx={2} width={38} x={-19} y={-5} />
        <rect height={38} rx={2} width={10} x={-5} y={-19} />
      </g>
      {far
        .filter((dock) => !near.includes(dock))
        .concat(near)
        .map((dock) => {
          const n = plates(counts[dock.id]);
          const [lx, ly] = project(dock.x, 0.05 + n * PLATE_HEIGHT, dock.z);
          return (
            <g className={`dock dock-${dock.id}`} key={dock.id}>
              <Box d={DOCK_DEPTH + 0.3} h={0.05} w={DOCK_WIDTH + 0.3} x={dock.x} z={dock.z} />
              {n > 0 ? (
                <Box
                  d={DOCK_DEPTH}
                  h={n * PLATE_HEIGHT}
                  w={DOCK_WIDTH}
                  x={dock.x}
                  y={0.05}
                  z={dock.z}
                />
              ) : null}
              <text textAnchor="middle" x={lx.toFixed(1)} y={(ly - 15).toFixed(1)}>
                {dock.label}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
