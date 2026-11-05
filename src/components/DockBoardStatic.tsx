import {
  cablePath,
  DOCK_DEPTH,
  DOCK_WIDTH,
  DOCKS,
  type DockCounts,
  PLATE_HEIGHT,
  plates,
} from '@/components/dockBoard';

/**
 * The board without WebGL: what a phone, a reader who asked for less motion, a
 * browser with no WebGL, a lost GPU context and JavaScript off all see, and what
 * everyone sees until the scene arrives. Server markup, so it costs no client
 * JavaScript, and it sits in the same box as the canvas, so nothing moves when
 * one replaces the other.
 *
 * The same docks, cables and counts as DockScene.tsx, by a fixed axonometric
 * projection. The chips light their dock from the stylesheet (`.hero:has(…)`).
 */

const SCALE = 46;
const project = (x: number, y: number, z: number) =>
  [(x * 0.84 - z * 0.58) * SCALE, (x * 0.26 + z * 0.46 - y * 0.92) * SCALE] as const;
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
        points={pts(at(1, 0, 1), at(1, 0, -1), at(1, 1, -1), at(1, 1, 1))}
      />
      <polygon
        className="dock-top"
        points={pts(at(-1, 1, -1), at(1, 1, -1), at(1, 1, 1), at(-1, 1, 1))}
      />
    </>
  );
}

export function DockBoardStatic({ counts }: { counts: DockCounts }) {
  // Back to front, so a nearer dock paints over a farther one.
  const docks = [...DOCKS].sort((a, b) => project(a.x, 0, a.z)[1] - project(b.x, 0, b.z)[1]);
  const slab = (x: number, z: number) => project(x, 0, z);
  return (
    <svg aria-hidden="true" className="dock-still" viewBox="-285 -160 570 305">
      <polygon
        className="dock-slab"
        points={pts(slab(-4.9, -3.1), slab(4.9, -3.1), slab(4.9, 3.1), slab(-4.9, 3.1))}
      />
      {DOCKS.map((dock) => (
        <polyline
          className={`dock-cable dock-${dock.id}`}
          fill="none"
          key={dock.id}
          points={pts(...cablePath(dock.x, dock.z).map(([x, z]) => project(x, 0, z)))}
        />
      ))}
      <g className="dock-hub">
        <Box d={1.1} h={0.34} w={1.1} x={0} z={0} />
        <polyline
          className="dock-glyph"
          points={pts(project(-0.26, 0.34, 0), project(0.26, 0.34, 0))}
        />
        <polyline
          className="dock-glyph"
          points={pts(project(0, 0.34, -0.26), project(0, 0.34, 0.26))}
        />
      </g>
      {docks.map((dock) => {
        const n = plates(counts[dock.id]);
        // Printed on the top face: x along the board's x axis, y along its z axis.
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
            <text
              dominantBaseline="middle"
              textAnchor="middle"
              transform={`matrix(0.84 0.26 -0.58 0.46 ${lx.toFixed(1)} ${ly.toFixed(1)})`}
            >
              {dock.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
