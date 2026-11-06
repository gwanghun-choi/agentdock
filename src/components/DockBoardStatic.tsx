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
 * The same ring, figures, cables and counts as DockScene.tsx, by a fixed projection:
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

/** One kind's figure, drawn at the origin: the 3D scene's six outlines, in projection. */
function Figure({ kind, count }: { kind: DockKind; count: number }) {
  const n = plates(count);
  const floor = 0.05;
  const along = (i: number) => (n > 1 ? i / (n - 1) : 0.5);
  const plateProps = (i: number) => ({
    className: 'dock-plate',
    style: { '--i': i, '--mid': (n - 1) / 2 } as CSSProperties,
  });
  const plateKeys = Array.from({ length: n }, (_, i) => `plate-${i}`);
  const socket = <Box d={DOCK_DEPTH + 0.3} h={0.05} w={DOCK_WIDTH + 0.3} x={0} z={0} />;

  if (kind === 'skill') {
    // A book fanned open, a leaf per plate.
    const leaves = plateKeys.map((_, i) => {
      const angle = (along(i) - 0.5) * 2.1;
      const [dx, dy] = [Math.sin(angle) * 1.12, Math.cos(angle) * 1.12];
      return (
        <g key={plateKeys[i]} {...plateProps(i)}>
          <polygon
            className={i % 2 ? 'dock-side' : 'dock-top'}
            points={pts(
              project(0, floor, -0.5),
              project(0, floor, 0.5),
              project(dx, floor + dy, 0.5),
              project(dx, floor + dy, -0.5),
            )}
          />
        </g>
      );
    });
    return (
      <>
        {socket}
        {leaves}
        <Box d={1.14} h={0.1} w={0.13} x={0} y={floor} z={0} />
      </>
    );
  }

  if (kind === 'plugin') {
    // A connector: hex modules, alternately narrow, two pins and a socket either side.
    const hex = (radius: number, y: number, turn: number) =>
      Array.from({ length: 6 }, (_, k) => {
        const angle = turn + (k * Math.PI) / 3;
        return project(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      });
    const top = floor + n * PLATE_HEIGHT;
    return (
      <>
        {socket}
        <Box d={0.36} h={0.34} w={0.28} x={-0.66} y={floor + top * 0.4} z={0} />
        <Box d={0.36} h={0.34} w={0.28} x={0.66} y={floor + top * 0.4} z={0} />
        {plateKeys.map((_, i) => {
          const radius = i % 2 ? 0.46 : 0.58;
          const turn = (i * Math.PI) / 6;
          const y = floor + i * PLATE_HEIGHT;
          return (
            <g key={plateKeys[i]} {...plateProps(i)}>
              <polygon className="dock-side" points={pts(...hex(radius, y, turn))} />
              <polygon
                className="dock-top"
                points={pts(...hex(radius, y + PLATE_HEIGHT * 0.72, turn))}
              />
            </g>
          );
        })}
        <Box d={0.11} h={0.44} w={0.11} x={-0.15} y={top} z={0} />
        <Box d={0.11} h={0.44} w={0.11} x={0.15} y={top} z={0} />
      </>
    );
  }

  if (kind === 'mcp_server') {
    // A rack, a lit unit per plate, serving three nodes overhead.
    const top = floor + n * PLATE_HEIGHT;
    const [hx, hy] = project(0, top + 0.46, 0);
    return (
      <>
        {socket}
        {plateKeys.map((_, i) => {
          const y = floor + i * PLATE_HEIGHT;
          const [lx, ly] = project(-0.36, y + 0.035, 0.36);
          return (
            <g key={plateKeys[i]} {...plateProps(i)}>
              <Box d={0.72} h={PLATE_HEIGHT * 0.72} w={0.98} x={0} y={y} z={0} />
              <rect
                className="dock-led"
                height={1.6}
                width={8}
                x={lx.toFixed(1)}
                y={ly.toFixed(1)}
              />
            </g>
          );
        })}
        <line
          className="dock-line"
          x1={hx.toFixed(1)}
          x2={project(0, top, 0)[0].toFixed(1)}
          y1={hy.toFixed(1)}
          y2={project(0, top, 0)[1].toFixed(1)}
        />
        {[0, 1, 2].map((k) => {
          const angle = 0.5 + (k * Math.PI * 2) / 3;
          const [x, y] = project(Math.cos(angle) * 0.82, top + 0.46, Math.sin(angle) * 0.82);
          return (
            <g key={k}>
              <line
                className="dock-line"
                x1={hx.toFixed(1)}
                x2={x.toFixed(1)}
                y1={hy.toFixed(1)}
                y2={y.toFixed(1)}
              />
              <circle className="dock-node" cx={x.toFixed(1)} cy={y.toFixed(1)} r={4.5} />
            </g>
          );
        })}
      </>
    );
  }

  if (kind === 'command') {
    // Steps, one per plate, up to a screen with a prompt on it.
    const top = floor + n * 0.075;
    const screen = (x: number, y: number) => project(x, top + y, -0.5 - y * 0.14);
    const [px, py] = screen(-0.34, 0.42);
    const [qx, qy] = screen(-0.14, 0.3);
    const [rx, ry] = screen(-0.34, 0.18);
    const [cx, cy] = screen(-0.04, 0.16);
    const [ex, ey] = screen(0.26, 0.16);
    return (
      <>
        {socket}
        <polygon
          className="dock-top"
          points={pts(screen(-0.64, 0), screen(0.64, 0), screen(0.64, 0.86), screen(-0.64, 0.86))}
        />
        <polygon
          className="dock-screen"
          points={pts(
            screen(-0.57, 0.06),
            screen(0.57, 0.06),
            screen(0.57, 0.8),
            screen(-0.57, 0.8),
          )}
        />
        <polyline
          className="dock-prompt"
          fill="none"
          points={`${px.toFixed(1)},${py.toFixed(1)} ${qx.toFixed(1)},${qy.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)}`}
        />
        <line
          className="dock-prompt dock-cursor"
          x1={cx.toFixed(1)}
          x2={ex.toFixed(1)}
          y1={cy.toFixed(1)}
          y2={ey.toFixed(1)}
        />
        {plateKeys
          .map((_, k) => n - 1 - k)
          .map((i) => (
            <g key={plateKeys[i]} {...plateProps(i)}>
              <Box d={0.22} h={0.06} w={1.3} x={0} y={floor + i * 0.075} z={0.52 - along(i)} />
            </g>
          ))}
      </>
    );
  }

  if (kind === 'hook') {
    // A coil, a turn per plate, and the hook it ends in.
    const top = floor + 0.05 + n * PLATE_HEIGHT;
    const ground = project(0, 0, 0)[0];
    const [sx, sy] = project(0.28, top + 1, 0);
    const [ax, ay] = project(0.28, top + 0.4, 0);
    const [bx, by] = project(-0.28, top + 0.4, 0);
    return (
      <>
        {socket}
        {plateKeys.map((_, i) => {
          const [x, y] = project(Math.sin(i * 0.9) * 0.03, floor + 0.05 + i * PLATE_HEIGHT, 0);
          return (
            <g key={plateKeys[i]} {...plateProps(i)}>
              <ellipse
                className="dock-turn"
                cx={(x + ground).toFixed(1)}
                cy={y.toFixed(1)}
                fill="none"
                rx={(0.46 * SCALE).toFixed(1)}
                ry={(0.46 * SCALE * Math.sin(PITCH)).toFixed(1)}
              />
            </g>
          );
        })}
        <path
          className="dock-hook-shape"
          d={`M${sx.toFixed(1)} ${sy.toFixed(1)} L${ax.toFixed(1)} ${ay.toFixed(1)} A${(0.28 * SCALE).toFixed(1)} ${(0.28 * SCALE).toFixed(1)} 0 1 1 ${bx.toFixed(1)} ${by.toFixed(1)}`}
          fill="none"
        />
      </>
    );
  }

  // A cluster: a node per plate, spoked to one core, inside one orbit. The same
  // golden-angle spiral as the scene.
  const [ox, oy] = project(0, 1.05, 0);
  const nodes = Array.from({ length: n }, (_, i) => {
    const rise = 1 - (2 * (i + 0.5)) / n;
    const round = Math.sqrt(1 - rise * rise);
    const turn = i * 2.399963;
    return project(Math.cos(turn) * round * 0.8, 1.05 + rise * 0.8, Math.sin(turn) * round * 0.8);
  });
  return (
    <>
      {socket}
      <g className="dock-orbit-group" style={{ transformOrigin: `${ox}px ${oy}px` }}>
        <ellipse
          className="dock-turn dock-thin"
          cx={ox.toFixed(1)}
          cy={oy.toFixed(1)}
          fill="none"
          rx={(0.98 * SCALE).toFixed(1)}
          ry={(0.98 * SCALE * 0.42).toFixed(1)}
        />
      </g>
      {nodes.map(([x, y], i) => (
        <line
          className="dock-line"
          key={`spoke-${i.toString()}`}
          x1={ox.toFixed(1)}
          x2={x.toFixed(1)}
          y1={oy.toFixed(1)}
          y2={y.toFixed(1)}
        />
      ))}
      <polygon
        className="dock-top"
        points={pts(
          ...Array.from({ length: 6 }, (_, k) => {
            const angle = (k * Math.PI) / 3 + 0.26;
            return [ox + Math.cos(angle) * 12.5, oy + Math.sin(angle) * 12.5] as const;
          }),
        )}
      />
      {nodes.map(([x, y], i) => (
        <g key={plateKeys[i]} {...plateProps(i)}>
          <circle className="dock-node" cx={x.toFixed(1)} cy={y.toFixed(1)} r={5} />
        </g>
      ))}
    </>
  );
}

/** How high a figure stands, in scene units: where the drawing's label goes. */
function figureHeight(kind: DockKind, n: number) {
  switch (kind) {
    case 'skill':
      return 1.3;
    case 'plugin':
      return n * PLATE_HEIGHT + 0.6;
    case 'mcp_server':
      return n * PLATE_HEIGHT + 0.7;
    case 'command':
      return n * 0.075 + 1;
    case 'hook':
      return n * PLATE_HEIGHT + 1.1;
    case 'agent':
      return 2;
  }
}

export function DockBoardStatic({ counts }: { counts: DockCounts }) {
  // Back to front, so a nearer dock paints over a farther one.
  const docks = [...DOCKS].sort((a, b) => project(a.x, 0, a.z)[1] - project(b.x, 0, b.z)[1]);
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
      {docks.map((dock) => {
        const [x, y] = project(dock.x, 0, dock.z);
        const scale = 0.72;
        const high = figureHeight(dock.id, plates(counts[dock.id]));
        return (
          <g className={`dock dock-${dock.id}`} key={dock.id}>
            <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale})`}>
              <Figure count={counts[dock.id] ?? 0} kind={dock.id} />
            </g>
            <text
              textAnchor="middle"
              x={x.toFixed(1)}
              y={(y - high * Math.cos(PITCH) * SCALE * scale - 8).toFixed(1)}
            >
              {dock.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
