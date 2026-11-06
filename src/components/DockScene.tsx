'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  type DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  IcosahedronGeometry,
  type InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  Object3D,
  type PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  type PointLight,
  Raycaster,
  Scene,
  Shape,
  type Sprite,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import {
  cablePath,
  DOCK_DEPTH,
  DOCK_WIDTH,
  DOCKS,
  type DockCounts,
  type DockKind,
  frontDock,
  isSoftwareRenderer,
  motes,
  nearestTurn,
  nextDock,
  PLATE_HEIGHT,
  plates,
  RING,
  spring,
} from '@/components/dockBoard';
import {
  BEAM_FRAGMENT,
  CABLE_FRAGMENT,
  CABLE_VERTEX,
  CORE_FRAGMENT,
  CORE_VERTEX,
  DUST_VERTEX,
  FLOOR_FRAGMENT,
  FLOOR_VERTEX,
  MOTE_VERTEX,
  POINT_FRAGMENT,
  TRAIL_FRAGMENT,
} from '@/components/dockShaders';

/**
 * The orbital dock in WebGL. Loaded only by DockBoard.tsx, and this file is the
 * one place three.js is imported.
 *
 * `frameloop="demand"`, still: nothing draws unless something below asks. What
 * asks is the entrance, the reader (pointer, scroll, focus, a key), and the
 * tour, which spins down after IDLE_SECONDS without input and at once off screen
 * or under Pause. At rest the loop is fully stopped, the same zero idle cost
 * Phase 79 measured, so the tour costs only what a reader is present for.
 *
 * The tour: the ring carries each dock to the front in turn and holds it for
 * DWELL_SECONDS. DockBoard holds which one, because its panel says what it is and
 * the same state serves the drawing, where nothing here runs. A reader who is doing
 * something outranks it: a dock under the pointer, a pick, a drag, the search field, a
 * step of the arrows, or the panel in use each hold it, the last two for RESUME_SECONDS
 * after they end. It only runs where the drift ran: Pause and reduced motion stop both.
 *
 * The canvas takes no input (`pointer-events: none`). The hero's listeners below
 * raycast instead, and only when the event did not land on a control or on the
 * words, so nothing in the scene can ever take a click from the search box.
 * Everything selectable here has its DOM path: the type chips, and the panel's link.
 */

const STAGE_FOV = 30;
const PITCH = 0.5; // radians above the ring's plane, at rest
const OUTER = RING + 1; // the deck's outer edge
const DECK_TOP = 0.22;
const HUB_Y = 1.5;
const ENTRANCE = 2.6; // seconds
const IDLE_SECONDS = 45; // one lap of the tour, and a little
const DWELL_SECONDS = 6; // travel included: about 2.5 s on the way and the rest to read
const RESUME_SECONDS = 8;
const TOUR_PACE = 1.7; // the spring's omega, an unhurried pass from one dock to the next
const PICK_PACE = 5; // a reader's own pick, which answers at once
const TOUR_ZOOM = 0.72; // how far in the camera comes for the tour, of a pick's 1
const DRAG_SLOP = 6; // px: under it a press is a click
const COAST = 0.35; // seconds of a release's speed counted when choosing where it lands
const SIGNAL = '#f0b44c';
const DRIFT = 0.05; // radians per second, where the tour is held and nothing is in focus
const PIXEL_BUDGET = 3_700_000; // about 2560×1440: past it the cost is pixels, not picture

/**
 * At the last quality step, below this for TOO_SLOW_WINDOWS measurements in a row (about
 * 4.5 s): the drawing is the better picture. Software rendering on twenty cores does 14-16
 * fps (Phase 91), and a real GPU on this scene does 60. Only a browser that hides its
 * renderer gets this far; the one that says "software" never loads the scene.
 */
const TOO_SLOW_FPS = 15;
const TOO_SLOW_WINDOWS = 3;

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const approach = (rate: number, delta: number) => 1 - Math.exp(-rate * delta);
const scratch = new Object3D();
type LutUniforms = { dfgLUT?: { value?: Texture | null } };

/** A flat rounded rectangle, lying on the board, its top at y = height. */
function plate(width: number, depth: number, radius: number, height: number) {
  const [w, d] = [width / 2, depth / 2];
  const shape = new Shape();
  shape.moveTo(-w + radius, -d);
  shape.lineTo(w - radius, -d);
  shape.quadraticCurveTo(w, -d, w, -d + radius);
  shape.lineTo(w, d - radius);
  shape.quadraticCurveTo(w, d, w - radius, d);
  shape.lineTo(-w + radius, d);
  shape.quadraticCurveTo(-w, d, -w, d - radius);
  shape.lineTo(-w, -d + radius);
  shape.quadraticCurveTo(-w, -d, -w + radius, -d);
  const geometry = new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    bevelSegments: 1,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height, 0);
  return geometry;
}

/** A solid turned from a profile of [radius, height] points. */
function turned(profile: [number, number][], segments: number) {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
}

/** A glow to stand behind something: one soft disc, shared by every halo. */
function haloTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.28, 'rgba(255,255,255,0.32)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

/**
 * What metal reflects: a dark room with one panel per kind and a strip overhead.
 * No HDR file to download and license; the hues on the ring are the page's own.
 */
function environmentScene() {
  const room = new Scene();
  const shell = new Mesh(
    new BoxGeometry(40, 40, 40),
    new MeshBasicMaterial({ color: '#07090a', side: BackSide }),
  );
  room.add(shell);
  const panel = new PlaneGeometry(1, 1);
  const add = (color: Color | string, x: number, y: number, z: number, w: number, h: number) => {
    const mesh = new Mesh(panel, new MeshBasicMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, 1);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  add(new Color('#ffffff').multiplyScalar(5), 0, 18, 0, 26, 6);
  add(new Color(SIGNAL).multiplyScalar(4), 0, -18, 0, 10, 10);
  // A cool edge from behind. In the room rather than a light: a sixth light cost every
  // metal pixel on the ring, 4.6 fps against 7 with no GPU and two cores (2026-11-06).
  add(new Color('#a9c7ff').multiplyScalar(3), 0, 5, -19, 34, 7);
  for (const dock of DOCKS) {
    add(new Color(dock.hue).multiplyScalar(2.6), dock.x * 3.4, 3, dock.z * 3.4, 7, 10);
  }
  return room;
}

/**
 * One plate of a kind's figure. The plates are still the count (dockBoard.ts,
 * plates()): one and one per doubling, in every figure. What differs is what a
 * plate is, so six kinds read as six things by outline alone, with the colour off:
 * a skill's plates are the leaves of a fanned book, a plugin's the hex modules of a
 * connector, a server's the units of a rack, a command's the steps up to a terminal,
 * a hook's the turns of a coil, a subagent's the nodes of a cluster.
 */
function plateGeometry(kind: DockKind) {
  switch (kind) {
    case 'skill': {
      const leaf = new BoxGeometry(0.03, 1.12, 1.02);
      leaf.translate(0, 0.56, 0);
      return leaf;
    }
    case 'plugin':
      return new CylinderGeometry(0.58, 0.58, PLATE_HEIGHT * 0.72, 6);
    case 'mcp_server':
      return plate(0.98, 0.72, 0.04, PLATE_HEIGHT * 0.72);
    case 'command':
      return plate(1.3, 0.22, 0.03, 0.06);
    case 'hook': {
      const turn = new TorusGeometry(0.46, 0.042, 8, 36);
      turn.rotateX(Math.PI / 2);
      return turn;
    }
    case 'agent':
      return new IcosahedronGeometry(0.13, 1);
  }
}

const FIGURE_FLOOR = DECK_TOP + 0.05;
const AGENT_CENTRE = 1.05;
const COMMAND_STEP = 0.075;
/** Figures stand a size over their sockets, so a figure and not the deck is what is seen. */
const FIGURE_SCALE = 1.2;

/** A cluster's nodes on a sphere, evenly, at any count: the golden-angle spiral. */
function agentNode(i: number, n: number, reach: number) {
  const rise = 1 - (2 * (i + 0.5)) / n;
  const round = Math.sqrt(1 - rise * rise);
  const turn = i * 2.399963;
  return [Math.cos(turn) * round * reach, rise * reach, Math.sin(turn) * round * reach] as const;
}

/**
 * Where plate i of n stands, into `scratch`. `open` is the dock's answer to a reader
 * (0 to 1): the fan spreads, the modules part, the steps rise, the coil stretches,
 * the cluster opens. `drop` is its height above that during the entrance.
 */
function placePlate(kind: DockKind, i: number, n: number, open: number, drop: number) {
  const along = n > 1 ? i / (n - 1) : 0.5;
  scratch.rotation.set(0, 0, 0);
  scratch.scale.setScalar(1);
  switch (kind) {
    case 'skill':
      scratch.position.set(0, FIGURE_FLOOR + drop, 0);
      scratch.rotation.z = (along - 0.5) * (2.1 + open * 0.7);
      break;
    case 'plugin': {
      const narrow = i % 2 ? 0.8 : 1;
      scratch.position.set(0, FIGURE_FLOOR + 0.04 + i * PLATE_HEIGHT * (1 + open * 0.5) + drop, 0);
      scratch.rotation.y = (i * Math.PI) / 6;
      scratch.scale.set(narrow, 1, narrow);
      break;
    }
    case 'mcp_server':
      scratch.position.set(0, FIGURE_FLOOR + i * PLATE_HEIGHT + drop, 0);
      break;
    case 'command':
      scratch.position.set(
        0,
        FIGURE_FLOOR + i * COMMAND_STEP * (1 + open * 0.3) + drop,
        0.52 - along,
      );
      break;
    case 'hook':
      scratch.position.set(
        Math.sin(i * 0.9) * 0.03,
        FIGURE_FLOOR + 0.05 + i * PLATE_HEIGHT * (1 + open * 0.6) + drop,
        0,
      );
      scratch.rotation.x = i % 2 ? 0.09 : -0.09;
      break;
    case 'agent': {
      const [x, y, z] = agentNode(i, n, 0.78 + open * 0.22);
      scratch.position.set(x, AGENT_CENTRE + y + drop, z);
      break;
    }
  }
}

/** The height the fixed parts of a figure stand on, given how far it has opened. */
function crownBase(kind: DockKind, n: number, open: number) {
  switch (kind) {
    case 'plugin':
      return FIGURE_FLOOR + 0.04 + n * PLATE_HEIGHT * (1 + open * 0.5);
    case 'mcp_server':
      return FIGURE_FLOOR + n * PLATE_HEIGHT;
    case 'command':
      return FIGURE_FLOOR + n * COMMAND_STEP * (1 + open * 0.3);
    case 'hook':
      return FIGURE_FLOOR + 0.05 + n * PLATE_HEIGHT * (1 + open * 0.6);
    default:
      return FIGURE_FLOOR;
  }
}

/** The figure's highest point above its crown base: where its label stands. */
const CROWN_REACH: Record<DockKind, number> = {
  skill: 1.75,
  plugin: 0.62,
  mcp_server: 0.55,
  command: 0.95,
  hook: 1.02,
  agent: 2.15,
};

/** The fixed parts each kind stands on or wears, with what turns in `spin`. */
function Crown({
  kind,
  count,
  paint,
  glow,
  spin,
}: {
  kind: DockKind;
  count: number;
  paint: (material: MeshStandardMaterial | null) => void;
  glow: (material: MeshStandardMaterial | null) => void;
  spin: (group: Group | null) => void;
}) {
  const metal = (
    <meshStandardMaterial
      color="#ffffff"
      emissiveIntensity={0}
      metalness={0.6}
      ref={paint}
      roughness={0.3}
    />
  );
  const light = <meshStandardMaterial color="#14181b" metalness={0.2} ref={glow} roughness={0.4} />;
  // A cluster's spokes, at the same spiral as its nodes: one draw for all of them.
  const spokes = useMemo(() => {
    const ends = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const [x, y, z] = agentNode(i, count, 0.8);
      ends.set([0, 0, 0, x, y, z], i * 6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(ends, 3));
    return geometry;
  }, [count]);
  useEffect(() => () => spokes.dispose(), [spokes]);

  const parts: Record<DockKind, ReactNode> = {
    // The fan's spine, and what it holds turning above it.
    skill: (
      <>
        <mesh castShadow position-y={0.05}>
          <boxGeometry args={[0.13, 0.1, 1.14]} />
          {metal}
        </mesh>
        <group position-y={1.5} ref={spin}>
          <mesh rotation={[0.5, 0, 0.3]}>
            <octahedronGeometry args={[0.17, 0]} />
            {light}
          </mesh>
        </group>
      </>
    ),
    // The connector's two pins, and a socket on either side of the column.
    plugin: (
      <>
        {[-0.15, 0.15].map((x) => (
          <mesh castShadow key={x} position={[x, 0.24, 0]}>
            <boxGeometry args={[0.11, 0.44, 0.11]} />
            {metal}
          </mesh>
        ))}
        {[-0.66, 0.66].map((x) => (
          <group key={x} position={[x, -count * PLATE_HEIGHT * 0.45, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.28, 0.34, 0.36]} />
              {metal}
            </mesh>
            <mesh position-x={Math.sign(x) * 0.15}>
              <boxGeometry args={[0.02, 0.2, 0.2]} />
              {light}
            </mesh>
          </group>
        ))}
      </>
    ),
    // The rack's lit edges, and what it serves: three nodes on arms, turning overhead.
    mcp_server: (
      <>
        {[-0.38, 0.38].map((x) => (
          <mesh key={x} position={[x, (-count * PLATE_HEIGHT) / 2, 0.37]}>
            <boxGeometry args={[0.05, Math.max(0.1, count * PLATE_HEIGHT - 0.04), 0.02]} />
            {light}
          </mesh>
        ))}
        <group position-y={0.26} ref={spin}>
          <mesh castShadow>
            <cylinderGeometry args={[0.05, 0.08, 0.5, 8]} />
            {metal}
          </mesh>
          {[0, 1, 2].map((i) => {
            const angle = (i * Math.PI * 2) / 3;
            return (
              <group key={i} rotation-y={angle}>
                <mesh position={[0.36, 0.2, 0]} rotation-z={Math.PI / 2}>
                  <cylinderGeometry args={[0.014, 0.014, 0.72, 5]} />
                  {metal}
                </mesh>
                <mesh position={[0.74, 0.2, 0]}>
                  <sphereGeometry args={[0.09, 12, 8]} />
                  {light}
                </mesh>
              </group>
            );
          })}
        </group>
      </>
    ),
    // What the steps lead up to: a screen, leaning back, showing a prompt.
    command: (
      <group position={[0, 0.42, -0.5]} rotation-x={-0.14}>
        <mesh castShadow>
          <boxGeometry args={[1.28, 0.86, 0.06]} />
          {metal}
        </mesh>
        <mesh position-z={0.035}>
          <boxGeometry args={[1.16, 0.74, 0.01]} />
          <meshStandardMaterial color="#0c0f11" metalness={0.1} roughness={0.25} />
        </mesh>
        <mesh position={[-0.3, 0.1, 0.05]} rotation-z={-0.72}>
          <boxGeometry args={[0.3, 0.07, 0.015]} />
          {light}
        </mesh>
        <mesh position={[-0.3, -0.08, 0.05]} rotation-z={0.72}>
          <boxGeometry args={[0.3, 0.07, 0.015]} />
          {light}
        </mesh>
        <mesh position={[0.08, -0.2, 0.05]}>
          <boxGeometry args={[0.3, 0.07, 0.015]} />
          {light}
        </mesh>
      </group>
    ),
    // The hook itself, over the coil, and an event ring running up through it.
    hook: (
      <>
        <mesh castShadow position={[0, 0.4, 0]} rotation-z={Math.PI * 0.95}>
          <torusGeometry args={[0.28, 0.075, 10, 28, Math.PI * 1.35]} />
          {metal}
        </mesh>
        <mesh castShadow position={[0.28, 0.72, 0]}>
          <boxGeometry args={[0.14, 0.56, 0.14]} />
          {metal}
        </mesh>
        <group ref={spin}>
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.56, 0.016, 6, 40]} />
            {light}
          </mesh>
        </group>
      </>
    ),
    // The cluster's core, the spokes to its nodes, and one orbit round all of them.
    agent: (
      <group position-y={AGENT_CENTRE - FIGURE_FLOOR} ref={spin}>
        <mesh castShadow>
          <icosahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial
            color="#ffffff"
            flatShading
            metalness={0.55}
            ref={paint}
            roughness={0.3}
          />
        </mesh>
        <lineSegments geometry={spokes}>
          <lineBasicMaterial color="#8f9ba1" />
        </lineSegments>
        <mesh rotation-x={1.25}>
          <torusGeometry args={[0.98, 0.016, 6, 56]} />
          {light}
        </mesh>
      </group>
    ),
  };
  return <>{parts[kind]}</>;
}

type Want = {
  lit: DockKind | null;
  flown: DockKind | null;
  tour: DockKind | null;
  paused: boolean;
  onTour: (kind: DockKind) => void;
  onHover: (kind: DockKind | null) => void;
  onSelect: (kind: DockKind | null) => void;
  onDrawn: () => void;
  onLost: () => void;
  onTooSlow: () => void;
  lowerDpr: () => void;
};

function Station({
  counts,
  want,
  changed,
  touched,
  tags,
}: {
  counts: DockCounts;
  want: RefObject<Want>;
  changed: string;
  /** Counts the reader's own steps of the tour, from the arrows. */
  touched: number;
  tags: RefObject<(HTMLElement | null)[]>;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  const parts = useMemo(() => {
    const motesTotal = DOCKS.reduce((sum, dock) => sum + motes(counts[dock.id]), 0);
    const centers = new Float32Array(motesTotal * 3);
    const seeds = new Float32Array(motesTotal * 4);
    const kinds = new Float32Array(motesTotal);
    let m = 0;
    DOCKS.forEach((dock, kind) => {
      const n = motes(counts[dock.id]);
      for (let i = 0; i < n; i++, m++) {
        centers.set([dock.x, DECK_TOP, dock.z], m * 3);
        seeds.set(
          [
            Math.random() * Math.PI * 2,
            1 + Math.random() * 0.95,
            0.15 + Math.random() * 1.7,
            0.14 + Math.random() * 0.5,
          ],
          m * 4,
        );
        kinds[m] = kind;
      }
    });
    const swarm = new BufferGeometry();
    swarm.setAttribute('position', new BufferAttribute(centers, 3));
    swarm.setAttribute('aCenter', new BufferAttribute(centers, 3));
    swarm.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    swarm.setAttribute('aKind', new BufferAttribute(kinds, 1));
    // The vertex shader moves them; a box round all that can be seen stops culling.
    swarm.boundingSphere = null;

    const dustCloud = (count: number, near: number, far: number, large: number) => {
      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const reach = near + Math.random() * (far - near);
        positions.set(
          [Math.cos(angle) * reach, -5 + Math.random() * 20, Math.sin(angle) * reach],
          i * 3,
        );
        sizes[i] = 0.3 + Math.random() ** 3 * large;
      }
      const cloud = new BufferGeometry();
      cloud.setAttribute('position', new BufferAttribute(positions, 3));
      cloud.setAttribute('aSize', new BufferAttribute(sizes, 1));
      return cloud;
    };

    const cables = DOCKS.map(({ x, z }) => {
      const [[fromX, fromZ], [toX, toZ]] = cablePath(x, z);
      const curve = new CatmullRomCurve3([
        new Vector3(fromX, DECK_TOP + 0.04, fromZ),
        new Vector3(fromX * 0.55, 0.85, fromZ * 0.55),
        new Vector3(toX, 0.42, toZ),
      ]);
      return new TubeGeometry(curve, 36, 0.042, 6, false);
    });

    return {
      socket: plate(DOCK_WIDTH + 0.3, DOCK_DEPTH + 0.3, 0.1, 0.05),
      figures: DOCKS.map((dock) => plateGeometry(dock.id)),
      deck: turned(
        [
          [OUTER - 2, -0.12],
          [OUTER - 2.04, 0.1],
          [OUTER - 1.92, DECK_TOP],
          [OUTER - 0.08, DECK_TOP],
          [OUTER, 0.1],
          [OUTER + 0.02, -0.12],
          [OUTER - 2, -0.12],
        ],
        128,
      ),
      hub: turned(
        [
          [0.01, -0.5],
          [1.05, -0.5],
          [1.28, -0.16],
          [1.28, 0.08],
          [0.96, 0.2],
          [0.82, 0.62],
          [0.42, 0.74],
          [0.01, 0.74],
        ],
        48,
      ),
      plusBar: plate(1.3, 0.34, 0.05, 0.3),
      lattice: new IcosahedronGeometry(0.84, 1),
      swarm,
      dust: dustCloud(1000, 8, 42, 2.6),
      near: dustCloud(42, 2, 12, 3.8),
      cables,
      halo: haloTexture(),
    };
  }, [counts]);

  const moteUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPull: { value: 0 },
      uPixel: { value: 1 },
      uLit: { value: DOCKS.map(() => 0) },
      uHue: { value: DOCKS.map((dock) => new Color(dock.hue)) },
    }),
    [],
  );
  const dustUniforms = useMemo(
    () => ({ uPixel: { value: 1 }, uTint: { value: new Color('#9fb2bd') } }),
    [],
  );
  const nearUniforms = useMemo(
    () => ({ uPixel: { value: 1 }, uTint: { value: new Color(SIGNAL) } }),
    [],
  );
  const floorUniforms = useMemo(
    () => ({
      uWave: { value: 0 },
      uTint: { value: new Color('#6f7f88') },
      uFocus: { value: new Color(SIGNAL) },
      uFocusing: { value: 0 },
    }),
    [],
  );
  const cableUniforms = useMemo(
    () =>
      DOCKS.map((dock, i) => ({
        uTime: { value: 0 },
        uSeed: { value: i * 0.37 },
        uLit: { value: 0 },
        uBurst: { value: 0 },
        uHue: { value: new Color(dock.hue) },
      })),
    [],
  );
  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new Color(SIGNAL) },
      uRim: { value: 0.9 },
      uFill: { value: 0.45 },
      uBands: { value: 0.9 },
    }),
    [],
  );
  const shellUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new Color(SIGNAL) },
      uRim: { value: 0.7 },
      uFill: { value: 0 },
      uBands: { value: 0 },
    }),
    [],
  );
  const beamUniforms = useMemo(
    () => ({ uColor: { value: new Color(SIGNAL) }, uStrength: { value: 0 } }),
    [],
  );
  const pickUniforms = useMemo(
    () => ({ uColor: { value: new Color(SIGNAL) }, uStrength: { value: 0 } }),
    [],
  );
  const trailUniforms = useMemo(
    () =>
      [
        { hue: '#8fa3ad', speed: 0.05, laps: 1 },
        { hue: SIGNAL, speed: -0.035, laps: 2 },
        { hue: '#6ed4b8', speed: 0.028, laps: 1 },
      ].map(({ hue, speed, laps }) => ({
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uLaps: { value: laps },
        uHue: { value: new Color(hue) },
      })),
    [],
  );
  const quiet = useMemo(
    () => DOCKS.map((dock) => new Color('#454f55').lerp(new Color(dock.hue), 0.5)),
    [],
  );
  const hue = useMemo(() => DOCKS.map((dock) => new Color(dock.hue)), []);
  const dim = useMemo(() => new Color('#262c30'), []);
  const goal = useMemo(() => new Color(), []);
  const signal = useMemo(() => new Color(SIGNAL), []);
  const tint = useMemo(() => new Color(SIGNAL), []);
  const anchor = useMemo(() => new Vector3(), []);
  const shade = useMemo(() => new Color(), []);
  const ray = useMemo(() => new Raycaster(), []);
  const lightPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), -2), []);

  const ring = useRef<Group>(null);
  const plus = useRef<Group>(null);
  const gyroA = useRef<Mesh>(null);
  const gyroB = useRef<Mesh>(null);
  const gyroC = useRef<Group>(null);
  const lattice = useRef<Group>(null);
  const pick = useRef<Mesh>(null);
  const far = useRef<Group>(null);
  const nearDust = useRef<Group>(null);
  const key = useRef<DirectionalLight>(null);
  const pointerLight = useRef<PointLight>(null);
  const focusLight = useRef<PointLight>(null);
  const coreLight = useRef<PointLight>(null);
  const coreHalo = useRef<Sprite>(null);
  const docks = useRef<(Group | null)[]>([]);
  const crowns = useRef<(Group | null)[]>([]);
  const stacks = useRef<(InstancedMesh | null)[]>([]);
  const stackPaint = useRef<(MeshStandardMaterial | null)[]>([]);
  const crownPaint = useRef<MeshStandardMaterial[][]>(DOCKS.map(() => []));
  const crownGlow = useRef<MeshStandardMaterial[][]>(DOCKS.map(() => []));
  const spins = useRef<(Group | null)[]>([]);
  const tagSizes = useRef<{ width: number; height: number }[]>([]);
  const litTags = useRef<boolean[]>([]);
  const halos = useRef<(Sprite | null)[]>([]);
  const hit = useRef<(Mesh | null)[]>([]);

  // What the reader is doing, written by the listeners and read per frame.
  const input = useRef({
    x: 0,
    y: 0,
    scroll: 0,
    searching: 0,
    burst: 0,
    wave: 0,
    lastInput: performance.now(),
    // When the reader last steered the tour: it waits RESUME_SECONDS from here.
    held: 0,
    dragging: false,
    dragTheta: 0,
    inView: true,
    light: new Vector3(3, 2, 3),
  });
  const now = useRef({
    enter: 0,
    time: 0,
    drift: 0,
    theta: 0.45,
    turning: 0,
    dwell: 0,
    x: 0,
    y: 0,
    scroll: 0,
    searching: 0,
    burst: 0,
    zoom: 0,
    focusLit: 0,
    lit: DOCKS.map(() => 0),
    opened: DOCKS.map(() => -1),
    shift: 0,
    light: new Vector3(3, 2, 3),
    frames: 0,
    frameSum: 0,
    slowWindows: 0,
    tier: 0,
    placed: false,
    looping: false,
    drawn: 0,
  });
  const frame = useRef({
    distance: 30,
    shift: 0,
    pickedShift: 0,
    closeIn: 0,
    edge: 0,
    radius: 300,
  });

  // Removed on unmount, because R3F then forces a context loss of its own, and a
  // scene closed by narrowing the window must be able to come back when it widens.
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = () => want.current.onLost();
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, want]);

  // A pick or a Pause by keyboard moves no pointer, and the loop may be at rest.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `changed` is the trigger.
  useEffect(() => {
    input.current.lastInput = performance.now();
    invalidate();
  }, [changed, invalidate]);

  // A step of the arrows: the turn is DockBoard's to say and the wait starts here.
  useEffect(() => {
    if (touched === 0) return;
    input.current.held = performance.now();
    input.current.lastInput = input.current.held;
    invalidate();
  }, [touched, invalidate]);

  // Built here, so freed here. R3F also frees a geometry it was handed as a prop, and
  // a second dispose() does nothing; the textures and unmounted ones it never saw.
  useEffect(
    () => () => {
      for (const value of Object.values(parts)) {
        if (Array.isArray(value)) for (const item of value) item.dispose();
        else value.dispose();
      }
    },
    [parts],
  );

  // Two things in three are one object per page, not per renderer: the geometry every
  // Sprite shares, and the lookup table every standard material samples. Each renderer
  // that uses one hangs a `dispose` listener on it holding its GL context, and nothing
  // disposes either, so each visit to this page kept its renderer for good: 31 live WebGL
  // contexts and 8 MB more heap after 30 returns (measured 2026-11-06, heap snapshot).
  // The next scene uploads them again, and there is only ever one canvas.
  useEffect(() => {
    const sprites = coreHalo.current?.geometry;
    const metal = gyroA.current?.material;
    return () => {
      sprites?.dispose();
      const compiled = metal && (gl.properties.get(metal) as { uniforms?: LutUniforms });
      compiled?.uniforms?.dfgLUT?.value?.dispose();
    };
  }, [gl]);

  // No GPU: start where the steps below would end, before anything compiles, rather than
  // spending the entrance finding out. A two-core machine drew 3.6 fps at full quality
  // and the steps took seconds each (2026-11-06).
  useLayoutEffect(() => {
    const context = gl.getContext();
    const info = context.getExtension('WEBGL_debug_renderer_info');
    if (!info || !isSoftwareRenderer(String(context.getParameter(info.UNMASKED_RENDERER_WEBGL))))
      return;
    if (key.current) key.current.castShadow = false;
    now.current.tier = 3;
    gl.domElement.dataset.tier = '3';
    want.current.lowerDpr();
    want.current.lowerDpr();
  }, [gl, want]);

  // A paused or returning reader skips the entrance: it is motion they refused.
  useLayoutEffect(() => {
    if (want.current.paused) now.current.enter = ENTRANCE;
    scratch.scale.setScalar(0);
    scratch.updateMatrix();
    for (const stack of stacks.current) {
      if (!stack) continue;
      for (let i = 0; i < stack.count; i++) {
        stack.setMatrixAt(i, scratch.matrix);
        // Each plate a step apart in tone, or a fan of them reads as one solid block.
        shade.setScalar(0.62 + (0.38 * (i + 1)) / stack.count);
        stack.setColorAt(i, shade);
      }
    }
    scratch.scale.setScalar(1);
  }, [want, shade]);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = environmentScene();
    const target = pmrem.fromScene(room, 0.03);
    scene.environment = target.texture;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          object.material.dispose();
        }
      });
    };
  }, [gl, scene, invalidate]);

  useEffect(() => {
    const hero = gl.domElement.closest<HTMLElement>('.hero');
    if (!hero) return;
    const wake = () => {
      input.current.lastInput = performance.now();
      invalidate();
    };
    /** Which dock is under the pointer, or null. */
    const under = (event: PointerEvent | MouseEvent) => {
      const box = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new Vector2(
          ((event.clientX - box.left) / box.width) * 2 - 1,
          -((event.clientY - box.top) / box.height) * 2 + 1,
        ),
        camera,
      );
      const [first] = ray.intersectObjects(hit.current.filter((mesh): mesh is Mesh => !!mesh));
      return first ? (first.object.userData.kind as DockKind) : null;
    };
    /** Controls and words keep their events; the scene gets what lands on neither. */
    const onScene = (event: Event) =>
      !(event.target as Element).closest('a, button, form, nav, h1, p, li, .dock-panel');

    let lit: DockKind | null = null;
    // A press on the stage, until it is a click or a drag.
    let press: { id: number; x: number; theta: number; moved: boolean } | null = null;
    let dragged = false;
    const onDown = (event: Event) => {
      const pointer = event as PointerEvent;
      // A second finger is not a second drag: it would take the press from the first, whose
      // lift would then end nothing and leave the ring held for good.
      if (!pointer.isPrimary) return;
      dragged = false;
      if (pointer.button !== 0 || !onScene(event) || pointer.clientX < frame.current.edge) return;
      press = {
        id: pointer.pointerId,
        x: pointer.clientX,
        theta: now.current.theta,
        moved: false,
      };
    };
    /** A drag ends where the ring would coast to, on a dock: there is no stopping between two. */
    const endDrag = (event?: Event) => {
      if (press && event && (event as PointerEvent).pointerId !== press.id) return;
      if (press?.moved) {
        dragged = true;
        input.current.dragging = false;
        input.current.held = performance.now();
        delete hero.dataset.dragging;
        if (hero.hasPointerCapture(press.id)) hero.releasePointerCapture(press.id);
        const { theta, turning } = now.current;
        want.current.onTour(frontDock(theta + turning * COAST));
        wake();
      }
      press = null;
    };
    const onMove = (event: Event) => {
      const pointer = event as PointerEvent;
      // Let go where this never heard it: outside the hero before it was a drag, or a window
      // switch in the middle of one. A pointer with no button down holds nothing.
      if (press && pointer.pointerId === press.id && !(pointer.buttons & 1)) endDrag();
      if (press && pointer.pointerId === press.id) {
        const dx = pointer.clientX - press.x;
        if (!press.moved && Math.abs(dx) > DRAG_SLOP) {
          press.moved = true;
          input.current.dragging = true;
          hero.dataset.dragging = '';
          hero.setPointerCapture(pointer.pointerId);
          want.current.onSelect(null);
          want.current.onHover(null);
        }
        if (press.moved) {
          // The near side of the ring follows the pointer, at the ring's own radius on screen.
          input.current.dragTheta = press.theta + dx / frame.current.radius;
          wake();
          return;
        }
      }
      input.current.x = (pointer.clientX / innerWidth) * 2 - 1;
      input.current.y = (pointer.clientY / innerHeight) * 2 - 1;
      wake();
      const found = under(pointer);
      const over = onScene(event) ? found : null;
      lit = over;
      if (over) hero.dataset.over = '';
      else delete hero.dataset.over;
      if (onScene(event) && pointer.clientX >= frame.current.edge) hero.dataset.stage = '';
      else delete hero.dataset.stage;
      want.current.onHover(over);
      // The reader's light, where the pointer's ray meets a plane just over the ring.
      ray.ray.intersectPlane(lightPlane, input.current.light);
    };
    const onClick = (event: Event) => {
      if (dragged) {
        dragged = false;
        return;
      }
      if (!onScene(event) || getSelection()?.toString()) return;
      // What is lit is what a click means: the ring may have drifted out from under a
      // pointer that has not moved. `under` is for a tap, which never hovered.
      const kind = lit ?? under(event as MouseEvent);
      if (kind) input.current.wave = 0.0001;
      want.current.onSelect(kind);
      wake();
    };
    const onLeave = () => {
      input.current.x = 0;
      input.current.y = 0;
      lit = null;
      delete hero.dataset.over;
      delete hero.dataset.stage;
      want.current.onHover(null);
      wake();
    };
    const onScroll = () => {
      const box = hero.getBoundingClientRect();
      const scroll = Math.min(1, Math.max(0, -box.top / box.height));
      // Reading below the stage: nothing here has changed, so nothing draws.
      if (scroll === input.current.scroll && !input.current.inView) return;
      input.current.scroll = scroll;
      wake();
    };
    const field = hero.querySelector('#q');
    const onFocus = () => {
      input.current.searching = 1;
      wake();
    };
    const onBlur = () => {
      input.current.searching = 0;
      wake();
    };
    // A keystroke is answered in the scene: the cables carry a burst to the hub.
    const onType = () => {
      input.current.burst = 1;
      wake();
    };
    const seen = new IntersectionObserver(([entry]) => {
      input.current.inView = entry.isIntersecting;
      wake();
    });
    seen.observe(hero);

    hero.addEventListener('pointerdown', onDown);
    hero.addEventListener('pointerup', endDrag);
    hero.addEventListener('pointercancel', endDrag);
    hero.addEventListener('lostpointercapture', endDrag);
    hero.addEventListener('pointermove', onMove, { passive: true });
    hero.addEventListener('pointerleave', onLeave);
    hero.addEventListener('click', onClick);
    addEventListener('scroll', onScroll, { passive: true });
    field?.addEventListener('focus', onFocus);
    field?.addEventListener('blur', onBlur);
    field?.addEventListener('input', onType);
    onScroll();
    if (document.activeElement === field) onFocus();
    return () => {
      seen.disconnect();
      hero.removeEventListener('pointerdown', onDown);
      hero.removeEventListener('pointerup', endDrag);
      hero.removeEventListener('pointercancel', endDrag);
      hero.removeEventListener('lostpointercapture', endDrag);
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
      hero.removeEventListener('click', onClick);
      removeEventListener('scroll', onScroll);
      field?.removeEventListener('focus', onFocus);
      field?.removeEventListener('blur', onBlur);
      field?.removeEventListener('input', onType);
      delete hero.dataset.over;
      delete hero.dataset.stage;
      delete hero.dataset.dragging;
    };
  }, [gl, camera, invalidate, ray, lightPlane, want]);

  // The composition: the ring fills what the words leave, and runs off the edge.
  useEffect(() => {
    const hero = gl.domElement.closest('.hero');
    const edge = hero?.querySelector('.hero-copy')?.getBoundingClientRect().right ?? size.width / 2;
    const free = size.width - edge;
    // 0.44 of the free width, not half: perspective draws the near side wider than the
    // ring's radius, and at 0.5 the dock turning past the right edge was cut in half.
    const radiusPixels = Math.min(free * 0.44, size.height * 0.56);
    const tangent = Math.tan((STAGE_FOV * Math.PI) / 360);
    // Picked, the dock stands between the words and the panel, and comes only as
    // close as that gap allows: the panel must never cover what it describes.
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const panelLeft =
      (hero?.getBoundingClientRect().right ?? size.width) - Math.min(21 * rem, size.width * 0.26);
    const gap = Math.max(0, panelLeft - edge);
    frame.current = {
      distance: (OUTER * size.height) / (2 * radiusPixels * tangent),
      shift: edge + free * 0.5 - size.width / 2,
      pickedShift: panelLeft - 8.5 * rem - size.width / 2,
      closeIn: 0.34 * Math.min(1, gap / (14 * rem)),
      edge,
      radius: radiusPixels,
    };
    camera.fov = STAGE_FOV;
    tagSizes.current = tags.current.map((tag) => ({
      width: tag?.offsetWidth ?? 0,
      height: tag?.offsetHeight ?? 0,
    }));
    invalidate();
  }, [camera, gl, invalidate, size, tags]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const state = now.current;
    const reader = input.current;
    const { flown, lit, paused, tour } = want.current;
    const frameNow = frame.current;

    const litIndex = DOCKS.findIndex((dock) => dock.id === lit);
    const flownIndex = DOCKS.findIndex((dock) => dock.id === flown);
    const tourIndex = DOCKS.findIndex((dock) => dock.id === tour);
    // What is lit here: the reader's, or failing that the tour's, with the rest stepping back
    // less far for the tour than for a pick. The hub's colour and the beam go with it.
    const focusIndex = litIndex >= 0 ? litIndex : tourIndex;
    const standBack = litIndex >= 0 ? -1 : -0.4;
    const dockGoal = (i: number) => (focusIndex === i ? 1 : focusIndex < 0 ? 0 : standBack);

    // `placed`: a reader who paused skips the entrance, but the plates start at scale
    // 0 and still need this one pass to land.
    const entering = state.enter < ENTRANCE || !state.placed;
    state.placed = true;
    state.enter += delta;
    const arrival = ease(state.enter / ENTRANCE);

    // The drift: alive while someone is here, and it winds down rather than stops.
    const active =
      !paused &&
      reader.inView &&
      (entering || performance.now() - reader.lastInput < IDLE_SECONDS * 1000);
    // Under Pause in about a second: the button has to feel like it did something.
    state.drift += ((active ? 1 : 0) - state.drift) * approach(paused ? 6 : 1.6, delta);
    if (state.drift < 0.002 && !active) state.drift = 0;
    state.time += delta * state.drift;

    state.x += (reader.x - state.x) * approach(3.4, delta);
    state.y += (reader.y - state.y) * approach(3.4, delta);
    state.scroll += (reader.scroll - state.scroll) * approach(7, delta);
    state.searching += (reader.searching - state.searching) * approach(3.2, delta);
    reader.burst *= 1 - approach(2.8, delta);
    if (reader.burst < 0.004) reader.burst = 0;
    const zoomGoal = flownIndex >= 0 ? 1 : tourIndex >= 0 ? TOUR_ZOOM : 0;
    state.zoom += (zoomGoal - state.zoom) * approach(flownIndex >= 0 ? 3 : 1.6, delta);
    state.light.lerp(reader.light, approach(5, delta));

    // The ring: the pointer's while it is held, then on a spring to a dock, which is what
    // keeps a release's speed instead of dropping it. The search field turns it as it did.
    const carried = flownIndex >= 0 ? flownIndex : reader.searching ? -1 : tourIndex;
    if (reader.dragging) {
      const before = state.theta;
      state.theta += (reader.dragTheta - state.theta) * approach(22, delta);
      state.turning = delta > 0 ? (state.theta - before) / delta : 0;
      const front = frontDock(state.theta);
      if (front !== tour) want.current.onTour(front);
    } else if (carried >= 0) {
      [state.theta, state.turning] = spring(
        state.theta,
        state.turning,
        nearestTurn(state.theta, DOCKS[carried].angle),
        flownIndex >= 0 ? PICK_PACE : TOUR_PACE,
        delta,
      );
    } else {
      state.turning *= 1 - approach(4, delta);
      if (Math.abs(state.turning) < 0.001) state.turning = 0;
      state.theta += (DRIFT * state.drift * (1 + state.searching * 3) + state.turning) * delta;
    }

    // The tour's clock, read here so a hidden tab, which draws no frames, stops it as well.
    const held =
      flownIndex >= 0 ||
      litIndex >= 0 ||
      reader.dragging ||
      reader.searching > 0 ||
      performance.now() - reader.held < RESUME_SECONDS * 1000;
    if (held || !active) {
      state.dwell = 0;
    } else if (state.enter >= ENTRANCE) {
      state.dwell += delta;
      if (tourIndex < 0) {
        want.current.onTour(frontDock(state.theta));
        state.dwell = 0;
      } else if (state.dwell >= DWELL_SECONDS) {
        state.dwell = 0;
        // Never out from under a reader: the panel moves its links and its focus with its kind.
        const hero = gl.domElement.closest('.hero');
        if (
          !hero?.querySelector(
            '.dock-panel:hover, .dock-panel:focus-within, .dock-step:focus-within',
          )
        ) {
          want.current.onTour(nextDock(tour as DockKind));
        }
      }
    }
    if (reader.wave > 0) {
      reader.wave += delta / 1.5;
      if (reader.wave >= 1) reader.wave = 0;
    }

    // The camera.
    const zoom = state.zoom;
    const distance =
      frameNow.distance *
      (1 + (1 - arrival) * 0.75) *
      (1 + state.scroll * 0.2) *
      (1 - state.searching * 0.12) *
      (1 - zoom * frameNow.closeIn);
    const pitch =
      PITCH + state.y * 0.05 + state.scroll * 0.42 - state.searching * 0.06 - zoom * 0.08;
    const yaw = state.x * 0.11 + (1 - arrival) * -0.75;
    const lookY = 0.5 + zoom * 0.3 - state.scroll * 1.1;
    const lookZ = zoom * (RING * 0.82);
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      lookY + Math.sin(pitch) * distance,
      lookZ + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    camera.lookAt(0, lookY, lookZ);
    const shiftGoal = frameNow.shift + zoom * (frameNow.pickedShift - frameNow.shift);
    if (Math.abs(shiftGoal - state.shift) > 0.2 || camera.view === null) {
      state.shift += (shiftGoal - state.shift) * (camera.view ? approach(5, delta) : 1);
      camera.setViewOffset(size.width, size.height, -state.shift, 0, size.width, size.height);
    }

    if (ring.current) {
      ring.current.rotation.y = state.theta;
      ring.current.scale.setScalar(0.72 + 0.28 * arrival);
    }
    if (far.current) {
      far.current.rotation.y = state.time * 0.008 + state.x * 0.03;
      far.current.rotation.x = state.y * 0.015;
    }
    if (nearDust.current) {
      nearDust.current.position.x = -state.x * 1.3;
      nearDust.current.position.y = state.y * 0.7;
      nearDust.current.rotation.y = state.time * 0.02;
    }
    for (const uniforms of trailUniforms) uniforms.uTime.value = state.time;

    // The hub: the one thing always in the signal colour.
    const glow = arrival * (1 + state.searching * 0.8 + reader.burst * 0.7);
    if (plus.current) {
      plus.current.rotation.y = state.time * 0.35 + (1 - arrival) * 2.6;
      plus.current.position.y = HUB_Y + Math.sin(state.time * 0.8) * 0.06;
      plus.current.scale.setScalar(0.7 * arrival * (1 + state.searching * 0.12));
    }
    if (gyroA.current) {
      gyroA.current.rotation.x = 1.15 + state.time * 0.3;
      gyroA.current.rotation.y = state.time * 0.17 + reader.burst;
    }
    if (gyroB.current) {
      gyroB.current.rotation.x = -0.6 - state.time * 0.22;
      gyroB.current.rotation.z = state.time * 0.26;
    }
    if (gyroC.current) {
      gyroC.current.rotation.y = -state.time * 0.14 - reader.burst * 0.5;
      gyroC.current.rotation.x = 0.16 + state.y * 0.04;
    }
    if (lattice.current) {
      lattice.current.rotation.y = state.time * 0.22;
      lattice.current.rotation.x = state.time * 0.11;
    }
    // The core takes the colour of whatever the reader has lit, and gives it back.
    const tinted = flownIndex >= 0 ? flownIndex : focusIndex;
    tint.lerp(tinted >= 0 ? hue[tinted] : signal, approach(4, delta));
    coreUniforms.uColor.value.copy(tint);
    shellUniforms.uColor.value.copy(tint);
    beamUniforms.uColor.value.copy(tint);
    coreUniforms.uTime.value = state.time;
    shellUniforms.uTime.value = state.time;
    coreUniforms.uFill.value = 0.4 + reader.burst * 0.7 + state.searching * 0.35;
    beamUniforms.uStrength.value = arrival * (0.1 + state.searching * 0.42 + reader.burst * 0.6);
    if (coreHalo.current) coreHalo.current.material.color.copy(tint);
    if (coreLight.current) coreLight.current.color.copy(tint);
    if (coreHalo.current) {
      coreHalo.current.scale.setScalar(5.5 + glow * 3.4);
      coreHalo.current.material.opacity = 0.46 * glow;
    }
    if (coreLight.current) coreLight.current.intensity = 26 * glow;
    if (pointerLight.current) {
      pointerLight.current.position.copy(state.light);
      pointerLight.current.intensity = 11 * arrival;
    }

    // The docks.
    let litMax = 0;
    DOCKS.forEach((dock, i) => {
      const stack = stacks.current[i];
      const delay = i * 0.1 + 0.5;
      const arrived = ease((state.enter - delay - 0.5) / 0.6);
      const target = dockGoal(i);
      // A pick answers at once; the tour's light changes at the pace the ring is turning.
      state.lit[i] += (target - state.lit[i]) * approach(litIndex >= 0 ? 9 : 2.6, delta);
      const value = state.lit[i];
      litMax = Math.max(litMax, value);
      const up = Math.max(0, value);
      const n = plates(counts[dock.id]);

      // The plates move only while they arrive or answer: at most 16 matrices, and none
      // at all on a frame where nothing about this figure changed.
      if (stack && (entering || Math.abs(state.opened[i] - up) > 0.001)) {
        for (let p = 0; p < stack.count; p++) {
          const t = ease((state.enter - delay - p * 0.04) / 0.6);
          placePlate(dock.id, p, stack.count, up, (1 - t) * 1.6);
          if (t <= 0) scratch.scale.setScalar(0);
          scratch.updateMatrix();
          stack.setMatrixAt(p, scratch.matrix);
        }
        stack.instanceMatrix.needsUpdate = true;
        state.opened[i] = up;
      }

      const lift = docks.current[i];
      // Scaled about the deck's level, so a figure's foot stays on its socket. The one in
      // focus stands forward a little and the rest step back, which reads as depth with no
      // glow to pay for.
      if (lift) {
        const stands = FIGURE_SCALE * (1 + up * 0.07 + Math.min(0, value) * 0.06);
        lift.scale.setScalar(stands);
        lift.position.y = DECK_TOP * (1 - stands) + up * 0.12;
      }
      const crown = crowns.current[i];
      const base = crownBase(dock.id, n, up);
      if (crown) {
        crown.position.y = base + (1 - arrived) * 1.6;
        crown.scale.setScalar(arrived);
      }
      const spin = spins.current[i];
      if (spin) {
        if (dock.id === 'hook') {
          // Up through the coil, from the socket to the hook, on the drift's clock.
          spin.position.y = (((state.time * 0.3 + i * 0.2) % 1) - 1) * (base - FIGURE_FLOOR);
        } else {
          spin.rotation.y = state.time * 0.45 + i + up * 1.1;
        }
        if (dock.id === 'agent' && stack) stack.rotation.y = spin.rotation.y;
      }
      goal.copy(quiet[i]);
      if (value > 0) goal.lerp(hue[i], value);
      else goal.lerp(dim, -value);
      const paint = stackPaint.current[i];
      if (paint) {
        paint.color.copy(goal);
        paint.emissive.copy(hue[i]);
        paint.emissiveIntensity = up * 0.1;
      }
      for (const material of crownPaint.current[i]) {
        material.color.copy(goal).lerp(hue[i], 0.55 + up * 0.45);
        if (value < 0) material.color.lerp(dim, -value * 0.7);
        material.emissive.copy(hue[i]);
        material.emissiveIntensity = 0.06 + up * 0.28;
      }
      for (const material of crownGlow.current[i]) {
        material.emissive.copy(hue[i]);
        material.emissiveIntensity = value < 0 ? 0.5 + value * 0.42 : 0.9 + up * 0.9;
      }
      const halo = halos.current[i];
      if (halo) {
        halo.scale.setScalar(2.6 + up * 2.6);
        halo.material.opacity = arrived * (0.08 + up * 0.42) * (value < 0 ? 1 + value * 0.8 : 1);
      }
      // The name stands over the figure in the page's own type, always in front of the
      // scene and never off the side of the stage: as a sprite it went behind whatever
      // turned past it (measured 2026-11-06: "Hooks 495" under its own hook, "Subagents
      // 4,79" cut by the window at 1920).
      const tag = tags.current[i];
      if (tag) {
        const c = Math.cos(state.theta);
        const s = Math.sin(state.theta);
        const reach = 0.72 + 0.28 * arrival;
        anchor
          .set(
            (dock.x * c + dock.z * s) * reach,
            ((base + CROWN_REACH[dock.id]) * FIGURE_SCALE + up * 0.12) * reach,
            (-dock.x * s + dock.z * c) * reach,
          )
          .project(camera);
        // Measured once per stage size, in the framing effect above. Read here, after the
        // previous tag's writes, each of these forced a style pass: twelve a frame.
        const { width, height } = tagSizes.current[i] ?? { width: 0, height: 0 };
        const half = width / 2;
        const x = Math.min(
          size.width - half - 8,
          Math.max(frameNow.edge + half + 8, ((anchor.x + 1) / 2) * size.width),
        );
        const y = Math.max(height + 8, ((1 - anchor.y) / 2) * size.height);
        tag.style.transform = `translate3d(${x - half}px, ${y - height - 6}px, 0)`;
        tag.style.opacity = String(arrived * (value < 0 ? 1 + value * 0.68 : 1));
        const isLit = up > 0.5;
        // An attribute a selector reads: only when it changes.
        if (litTags.current[i] !== isLit) {
          litTags.current[i] = isLit;
          tag.dataset.lit = String(isLit);
        }
      }
      moteUniforms.uLit.value[i] = value;
      const cable = cableUniforms[i];
      cable.uTime.value = state.time;
      cable.uLit.value = value;
      cable.uBurst.value = reader.burst + state.searching * 0.45;
    });
    if (focusLight.current) {
      if (tinted >= 0) focusLight.current.color.copy(hue[tinted]);
      state.focusLit += (litMax - state.focusLit) * approach(6, delta);
      const dock = DOCKS[tinted] ?? DOCKS[0];
      focusLight.current.position.set(dock.x, 2.2, dock.z);
      focusLight.current.intensity = state.focusLit * 5;
    }

    // One beam, on whichever dock the reader has: in the ring, so it turns with it.
    if (pick.current) {
      const at = DOCKS[tinted];
      if (at) {
        pick.current.position.set(at.x, DECK_TOP + 2.2, at.z);
        pickUniforms.uColor.value.copy(hue[tinted]);
      }
      pickUniforms.uStrength.value = state.focusLit * 0.5;
      pick.current.visible = state.focusLit > 0.01;
    }

    moteUniforms.uTime.value = state.time;
    moteUniforms.uPull.value = state.searching;
    const pixel = size.height * dpr * 0.15;
    moteUniforms.uPixel.value = pixel;
    dustUniforms.uPixel.value = pixel * 0.7;
    nearUniforms.uPixel.value = pixel * 0.6;
    floorUniforms.uWave.value = reader.wave;
    floorUniforms.uFocusing.value = state.searching;

    // A machine that cannot keep up gives up shadows, then pixels, and stays there:
    // going back up would only make it oscillate.
    // Only frames that followed a frame: the gap before one woken by a scroll event is
    // the event's cadence and says nothing about the machine.
    if (state.looping) {
      state.frames++;
      state.frameSum += rawDelta;
      // 45 frames, or 1.5 s if that comes first: at 45 frames alone a machine doing 4 fps
      // waited 11 s for each step down, so the slowest machine answered last.
      if (state.frames >= 45 || (state.frames >= 4 && state.frameSum >= 1.5)) {
        const mean = state.frameSum / state.frames;
        if (state.tier < 4 && mean > 1 / 34) {
          state.tier++;
          gl.domElement.dataset.tier = String(state.tier);
          if (state.tier === 1 && key.current) key.current.castShadow = false;
          else want.current.lowerDpr();
        } else if (state.tier === 4) {
          state.slowWindows = mean > 1 / TOO_SLOW_FPS ? state.slowWindows + 1 : 0;
          if (state.slowWindows === TOO_SLOW_WINDOWS) want.current.onTooSlow();
        }
        state.frames = 0;
        state.frameSum = 0;
      }
    }

    const settled =
      !entering &&
      state.drift === 0 &&
      reader.burst === 0 &&
      reader.wave === 0 &&
      Math.abs(reader.x - state.x) < 0.002 &&
      Math.abs(reader.y - state.y) < 0.002 &&
      Math.abs(reader.scroll - state.scroll) < 0.002 &&
      Math.abs(reader.searching - state.searching) < 0.004 &&
      Math.abs(zoomGoal - zoom) < 0.003 &&
      !reader.dragging &&
      Math.abs(state.turning) < 0.003 &&
      state.light.distanceToSquared(reader.light) < 0.001 &&
      Math.abs(shiftGoal - state.shift) <= 0.2 &&
      (carried < 0 ||
        Math.abs(nearestTurn(state.theta, DOCKS[carried].angle) - state.theta) < 0.002) &&
      state.lit.every((value, i) => Math.abs(value - dockGoal(i)) < 0.004);
    // The still drawing fades out on `live`, so `live` waits for a frame that exists:
    // this call runs before the render, so the second call follows a finished one.
    if (state.drawn < 2 && ++state.drawn === 2) want.current.onDrawn();
    state.looping = !settled || active || state.drawn < 2;
    if (state.looping) invalidate();
  });

  return (
    <>
      {/* Depth: the far side of the ring falls a step back into the stage's own ground. */}
      <fogExp2 args={['#0c0f11', 0.0135]} attach="fog" />
      <hemisphereLight args={['#c9d6dc', '#0a0c0d', 0.55]} />
      <directionalLight
        castShadow
        intensity={1.7}
        position={[-6, 16, 9]}
        ref={key}
        shadow-bias={-0.0006}
        shadow-camera-bottom={-9}
        shadow-camera-far={40}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight color="#ffe9c9" decay={1.6} distance={18} ref={pointerLight} />
      <pointLight color="#ffffff" decay={1.6} distance={14} ref={focusLight} />
      <pointLight
        color={SIGNAL}
        decay={1.5}
        distance={16}
        position={[0, HUB_Y, 0]}
        ref={coreLight}
      />

      <group ref={far}>
        <points geometry={parts.dust} renderOrder={-1}>
          <shaderMaterial
            fragmentShader={POINT_FRAGMENT}
            uniforms={dustUniforms}
            vertexShader={DUST_VERTEX}
            blending={AdditiveBlending}
            depthWrite={false}
            transparent
          />
        </points>
        {/* Three orbits a long way out, each with a light on it. */}
        {trailUniforms.map((uniforms, i) => (
          <mesh
            key={uniforms.uSpeed.value}
            rotation={[Math.PI / 2 + [0.1, -0.26, 0.34][i], [0, 0.2, -0.3][i], 0]}
          >
            <torusGeometry args={[OUTER + 3.4 + i * 2.6, 0.018, 6, 180]} />
            <shaderMaterial
              blending={AdditiveBlending}
              depthWrite={false}
              fragmentShader={TRAIL_FRAGMENT}
              transparent
              uniforms={uniforms}
              vertexShader={CABLE_VERTEX}
            />
          </mesh>
        ))}
      </group>
      <mesh position-y={-3} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[38, 64]} />
        <shaderMaterial
          fragmentShader={FLOOR_FRAGMENT}
          uniforms={floorUniforms}
          vertexShader={FLOOR_VERTEX}
          blending={AdditiveBlending}
          depthWrite={false}
          transparent
        />
      </mesh>

      <group>
        <mesh castShadow geometry={parts.hub} receiveShadow>
          <meshStandardMaterial color="#39434a" metalness={0.92} roughness={0.28} />
        </mesh>
        {/* The index, as a machine: the sign inside a lit core, inside a glass shell,
            inside a lattice and three gimbals, over a column of light. Geometry and two
            small shaders, nothing downloaded. */}
        <group ref={plus}>
          <mesh geometry={parts.plusBar} position-y={-0.15}>
            <meshStandardMaterial
              color={SIGNAL}
              emissive={SIGNAL}
              emissiveIntensity={0.42}
              metalness={0.2}
              roughness={0.35}
              toneMapped={false}
            />
          </mesh>
          <mesh geometry={parts.plusBar} position-y={-0.15} rotation-y={Math.PI / 2}>
            <meshStandardMaterial
              color={SIGNAL}
              emissive={SIGNAL}
              emissiveIntensity={0.42}
              metalness={0.2}
              roughness={0.35}
              toneMapped={false}
            />
          </mesh>
        </group>
        <mesh position-y={HUB_Y} renderOrder={1}>
          <sphereGeometry args={[0.62, 32, 20]} />
          <shaderMaterial
            blending={AdditiveBlending}
            depthWrite={false}
            fragmentShader={CORE_FRAGMENT}
            transparent
            uniforms={coreUniforms}
            vertexShader={CORE_VERTEX}
          />
        </mesh>
        <mesh position-y={HUB_Y} renderOrder={2}>
          <sphereGeometry args={[1.02, 40, 24]} />
          <shaderMaterial
            blending={AdditiveBlending}
            depthWrite={false}
            fragmentShader={CORE_FRAGMENT}
            transparent
            uniforms={shellUniforms}
            vertexShader={CORE_VERTEX}
          />
        </mesh>
        <group position-y={HUB_Y} ref={lattice}>
          <lineSegments>
            <edgesGeometry args={[parts.lattice]} />
            <lineBasicMaterial color="#c9b58c" opacity={0.42} transparent />
          </lineSegments>
        </group>
        <mesh position-y={HUB_Y} ref={gyroA}>
          <torusGeometry args={[1.32, 0.024, 8, 96]} />
          <meshStandardMaterial color="#d8dee0" metalness={1} roughness={0.2} />
        </mesh>
        <mesh position-y={HUB_Y} ref={gyroB}>
          <torusGeometry args={[1.62, 0.016, 8, 96]} />
          <meshStandardMaterial color="#8d979c" metalness={1} roughness={0.25} />
        </mesh>
        <group position-y={HUB_Y} ref={gyroC}>
          <Teeth count={60} radius={1.92} />
        </group>
        <mesh position-y={HUB_Y + 3.4} renderOrder={3}>
          <cylinderGeometry args={[0.22, 0.5, 6.8, 24, 1, true]} />
          <shaderMaterial
            blending={AdditiveBlending}
            depthWrite={false}
            fragmentShader={BEAM_FRAGMENT}
            side={DoubleSide}
            transparent
            uniforms={beamUniforms}
            vertexShader={CORE_VERTEX}
          />
        </mesh>
        <sprite position-y={HUB_Y} ref={coreHalo}>
          <spriteMaterial
            blending={AdditiveBlending}
            color={SIGNAL}
            depthWrite={false}
            map={parts.halo}
            opacity={0}
            transparent
          />
        </sprite>
      </group>

      <group ref={ring}>
        <mesh castShadow geometry={parts.deck} receiveShadow>
          <meshStandardMaterial color="#59656d" metalness={0.62} roughness={0.42} />
        </mesh>
        <mesh position-y={DECK_TOP + 0.005} rotation-x={Math.PI / 2}>
          <torusGeometry args={[OUTER - 1.97, 0.022, 6, 180]} />
          <meshBasicMaterial color={SIGNAL} />
        </mesh>
        <Ribs />
        {DOCKS.map((dock) => (
          <mesh
            key={`spoke-${dock.id}`}
            position={[dock.x * 0.57, -0.05, dock.z * 0.57]}
            rotation-y={-dock.angle}
          >
            <boxGeometry args={[RING * 0.86, 0.12, 0.2]} />
            <meshStandardMaterial color="#2a3238" metalness={0.8} roughness={0.45} />
          </mesh>
        ))}
        {DOCKS.map((dock, i) => (
          <mesh geometry={parts.cables[i]} key={`cable-${dock.id}`}>
            <shaderMaterial
              fragmentShader={CABLE_FRAGMENT}
              uniforms={cableUniforms[i]}
              vertexShader={CABLE_VERTEX}
            />
          </mesh>
        ))}
        <mesh ref={pick} renderOrder={3} visible={false}>
          <cylinderGeometry args={[0.5, 1, 4.4, 24, 1, true]} />
          <shaderMaterial
            blending={AdditiveBlending}
            depthWrite={false}
            fragmentShader={BEAM_FRAGMENT}
            side={DoubleSide}
            transparent
            uniforms={pickUniforms}
            vertexShader={CORE_VERTEX}
          />
        </mesh>
        <points frustumCulled={false} geometry={parts.swarm}>
          <shaderMaterial
            fragmentShader={POINT_FRAGMENT}
            uniforms={moteUniforms}
            vertexShader={MOTE_VERTEX}
            blending={AdditiveBlending}
            depthWrite={false}
            transparent
          />
        </points>
        {DOCKS.map((dock, i) => {
          const count = plates(counts[dock.id]);
          return (
            <group
              key={dock.id}
              position={[dock.x, 0, dock.z]}
              rotation-y={Math.PI / 2 - dock.angle}
            >
              <mesh geometry={parts.socket} position-y={DECK_TOP} receiveShadow>
                <meshStandardMaterial color="#1b2024" metalness={0.75} roughness={0.5} />
              </mesh>
              <group
                ref={(group) => {
                  docks.current[i] = group;
                }}
                scale={FIGURE_SCALE}
              >
                {count > 0 ? (
                  <instancedMesh
                    args={[parts.figures[i], undefined, count]}
                    // Three sizes an instanced mesh once, here at scale 0, for the entrance.
                    frustumCulled={false}
                    castShadow
                    ref={(mesh) => {
                      stacks.current[i] = mesh;
                    }}
                    receiveShadow
                  >
                    <meshStandardMaterial
                      color={quiet[i]}
                      metalness={0.45}
                      ref={(material) => {
                        stackPaint.current[i] = material;
                      }}
                      roughness={0.38}
                    />
                  </instancedMesh>
                ) : null}
                <group
                  ref={(group) => {
                    crowns.current[i] = group;
                  }}
                >
                  <Crown
                    count={count}
                    glow={(material) => {
                      if (material && !crownGlow.current[i].includes(material)) {
                        crownGlow.current[i].push(material);
                      }
                    }}
                    kind={dock.id}
                    paint={(material) => {
                      if (material && !crownPaint.current[i].includes(material)) {
                        crownPaint.current[i].push(material);
                      }
                    }}
                    spin={(group) => {
                      spins.current[i] = group;
                    }}
                  />
                </group>
                <sprite
                  position-y={1.6}
                  ref={(sprite) => {
                    halos.current[i] = sprite;
                  }}
                >
                  <spriteMaterial
                    blending={AdditiveBlending}
                    color={dock.hue}
                    depthWrite={false}
                    map={parts.halo}
                    opacity={0}
                    transparent
                  />
                </sprite>
              </group>
              {/* What a pointer hits. Bigger than the dock on purpose, invisible,
                  and three's raycaster does not ask whether a mesh is visible. */}
              <mesh
                position-y={1.1}
                ref={(mesh) => {
                  hit.current[i] = mesh;
                }}
                userData={{ kind: dock.id }}
                visible={false}
              >
                <sphereGeometry args={[1.45, 12, 8]} />
              </mesh>
            </group>
          );
        })}
      </group>

      <group ref={nearDust}>
        <points geometry={parts.near}>
          <shaderMaterial
            fragmentShader={POINT_FRAGMENT}
            uniforms={nearUniforms}
            vertexShader={DUST_VERTEX}
            blending={AdditiveBlending}
            depthWrite={false}
            transparent
          />
        </points>
      </group>
    </>
  );
}

/** The ring's outer panels, one draw call. They are what gives it a scale. */
function Ribs() {
  const count = 144;
  const ribs = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ribs.current;
    if (!mesh) return;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      scratch.position.set(
        Math.cos(angle) * (OUTER + 0.07),
        0.03,
        Math.sin(angle) * (OUTER + 0.07),
      );
      scratch.rotation.set(0, -angle, 0);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    scratch.rotation.set(0, 0, 0);
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh args={[undefined, undefined, count]} ref={ribs}>
      <boxGeometry args={[0.1, 0.16, 0.11]} />
      <meshStandardMaterial color="#aab4b9" metalness={0.5} roughness={0.4} />
    </instancedMesh>
  );
}

/** The outer gimbal: a ring of teeth, one draw call, that reads as machined. */
function Teeth({ count, radius }: { count: number; radius: number }) {
  const teeth = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = teeth.current;
    if (!mesh) return;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      scratch.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      scratch.rotation.set(0, -angle, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    scratch.rotation.set(0, 0, 0);
    mesh.instanceMatrix.needsUpdate = true;
  }, [count, radius]);
  return (
    <instancedMesh args={[undefined, undefined, count]} ref={teeth}>
      <boxGeometry args={[0.1, 0.035, 0.07]} />
      <meshStandardMaterial color="#b9c2c6" metalness={0.85} roughness={0.3} />
    </instancedMesh>
  );
}

export default function DockScene({
  counts,
  lit,
  flown,
  tour,
  touched,
  paused,
  onTour,
  onHover,
  onSelect,
  onReady,
  onLost,
  onTooSlow,
}: {
  counts: DockCounts;
  lit: DockKind | null;
  flown: DockKind | null;
  tour: DockKind | null;
  touched: number;
  paused: boolean;
  onTour: (kind: DockKind) => void;
  onHover: (kind: DockKind | null) => void;
  onSelect: (kind: DockKind | null) => void;
  onReady: () => void;
  onLost: () => void;
  onTooSlow: () => void;
}) {
  // In state, not `setDpr` from inside: Canvas re-applies its prop on every render,
  // and a hover or a Pause renders it, which silently undid each step down.
  const [dpr, setDpr] = useState(() =>
    Math.min(window.devicePixelRatio, 1.5, Math.sqrt(PIXEL_BUDGET / (innerWidth * innerHeight))),
  );
  const handlers = {
    lit,
    flown,
    tour,
    paused,
    onTour,
    onHover,
    onSelect,
    onDrawn: onReady,
    onLost,
    onTooSlow,
    lowerDpr: () => setDpr((now) => Math.max(0.65, now * 0.8)),
  };
  const want = useRef<Want>(handlers);
  want.current = handlers;
  const tags = useRef<(HTMLElement | null)[]>([]);
  return (
    <>
      <Canvas
        camera={{ fov: STAGE_FOV, near: 0.5, far: 140 }}
        dpr={dpr}
        frameloop="demand"
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        onCreated={({ gl }) => {
          // three only logs a shader that will not link, and draws nothing with it. A
          // blank stage with the drawing already faded is the one failure a reader
          // could not recover from, so this one ends at the drawing as well.
          gl.debug.onShaderError = (context, program) => {
            console.error('DockScene: a shader did not link', context.getProgramInfoLog(program));
            onLost();
          };
        }}
        // Not the bare `shadows`: R3F reads that as PCFSoftShadowMap, which three
        // r182 removed and warns about on every load. "percentage" is PCFShadowMap,
        // what three was already substituting.
        shadows="percentage"
        // Inline, because Canvas writes `pointer-events: auto` on its own wrapper and
        // the stylesheet's `none` on the parent does not reach through it.
        style={{ pointerEvents: 'none' }}
      >
        <Station
          changed={`${lit} ${flown} ${paused}`}
          counts={counts}
          tags={tags}
          touched={touched}
          want={want}
        />
      </Canvas>
      <div className="dock-tags">
        {DOCKS.map((dock, i) => (
          <span
            className={`dock-tag dock-${dock.id}`}
            key={dock.id}
            ref={(tag) => {
              tags.current[i] = tag;
            }}
          >
            {dock.label} <b>{(counts[dock.id] ?? 0).toLocaleString('en-US')}</b>
          </span>
        ))}
      </div>
    </>
  );
}
