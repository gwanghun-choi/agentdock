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
  type DirectionalLight,
  ExtrudeGeometry,
  type Group,
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
  motes,
  nearestTurn,
  PLATE_HEIGHT,
  plates,
  RING,
} from '@/components/dockBoard';
import {
  CABLE_FRAGMENT,
  CABLE_VERTEX,
  DUST_VERTEX,
  FLOOR_FRAGMENT,
  FLOOR_VERTEX,
  MOTE_VERTEX,
  POINT_FRAGMENT,
} from '@/components/dockShaders';

/**
 * The orbital dock in WebGL. Loaded only by DockBoard.tsx, and this file is the
 * one place three.js is imported.
 *
 * `frameloop="demand"`, still: nothing draws unless something below asks. What
 * asks is the entrance, the reader (pointer, scroll, focus, a key), and the
 * ambient drift, which spins down after IDLE_SECONDS without input and at once
 * off screen or under Pause. At rest the loop is fully stopped, the same zero
 * idle cost Phase 79 measured, so the drift costs only what a reader is present for.
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
const IDLE_SECONDS = 20;
const SIGNAL = '#f0b44c';
const DRIFT = 0.05; // radians per second
const PIXEL_BUDGET = 3_700_000; // about 2560×1440: past it the cost is pixels, not picture

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const approach = (rate: number, delta: number) => 1 - Math.exp(-rate * delta);
const scratch = new Object3D();

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

/** The kind's name and real count, in the page's own face. */
function labelTexture(text: string, count: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (context) {
    const face = getComputedStyle(document.body).fontFamily;
    const number = count.toLocaleString('en-US');
    context.textBaseline = 'middle';
    context.font = `600 84px ${face}`;
    const nameWidth = context.measureText(text).width;
    context.font = `400 84px ${face}`;
    const numberWidth = context.measureText(number).width;
    const start = 384 - (nameWidth + 30 + numberWidth) / 2;
    context.shadowColor = 'rgba(0,0,0,0.9)';
    context.shadowBlur = 16;
    context.fillStyle = '#ffffff';
    context.font = `600 84px ${face}`;
    context.fillText(text, start, 98);
    context.fillStyle = 'rgba(255,255,255,0.72)';
    context.font = `400 84px ${face}`;
    context.fillText(number, start + nameWidth + 30, 98);
  }
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
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
  for (const dock of DOCKS) {
    add(new Color(dock.hue).multiplyScalar(2.6), dock.x * 3.4, 3, dock.z * 3.4, 7, 10);
  }
  return room;
}

/** Each kind's own silhouette, on top of its stack, so six docks read as six things. */
function Crown({
  kind,
  paint,
}: {
  kind: DockKind;
  paint: (material: MeshStandardMaterial | null) => void;
}) {
  const material = (
    <meshStandardMaterial
      color="#ffffff"
      emissiveIntensity={0}
      metalness={0.55}
      ref={paint}
      roughness={0.32}
    />
  );
  const parts: Record<DockKind, ReactNode> = {
    // An open book.
    skill: (
      <>
        <mesh castShadow position={[-0.27, 0.13, 0]} rotation-z={0.42}>
          <boxGeometry args={[0.58, 0.05, 0.72]} />
          {material}
        </mesh>
        <mesh castShadow position={[0.27, 0.13, 0]} rotation-z={-0.42}>
          <boxGeometry args={[0.58, 0.05, 0.72]} />
          {material}
        </mesh>
      </>
    ),
    // A connector: a hex body and two pins.
    plugin: (
      <>
        <mesh castShadow position-y={0.14}>
          <cylinderGeometry args={[0.36, 0.36, 0.28, 6]} />
          {material}
        </mesh>
        <mesh castShadow position={[-0.14, 0.42, 0]}>
          <boxGeometry args={[0.09, 0.3, 0.09]} />
          {material}
        </mesh>
        <mesh castShadow position={[0.14, 0.42, 0]}>
          <boxGeometry args={[0.09, 0.3, 0.09]} />
          {material}
        </mesh>
      </>
    ),
    // A rack of three units.
    mcp_server: (
      <>
        {[0.08, 0.27, 0.46].map((y) => (
          <mesh castShadow key={y} position-y={y}>
            <boxGeometry args={[0.72, 0.14, 0.48]} />
            {material}
          </mesh>
        ))}
      </>
    ),
    // A prompt: a chevron and its cursor, standing up.
    command: (
      <>
        <mesh castShadow position={[-0.14, 0.42, 0]} rotation-z={-0.72}>
          <boxGeometry args={[0.42, 0.1, 0.14]} />
          {material}
        </mesh>
        <mesh castShadow position={[-0.14, 0.17, 0]} rotation-z={0.72}>
          <boxGeometry args={[0.42, 0.1, 0.14]} />
          {material}
        </mesh>
        <mesh castShadow position={[0.27, 0.08, 0]}>
          <boxGeometry args={[0.36, 0.1, 0.14]} />
          {material}
        </mesh>
      </>
    ),
    // A hook on its shank.
    hook: (
      <>
        <mesh castShadow position-y={0.33} rotation-z={Math.PI * 0.95}>
          <torusGeometry args={[0.26, 0.07, 10, 28, Math.PI * 1.35]} />
          {material}
        </mesh>
        <mesh castShadow position={[0.26, 0.58, 0]}>
          <boxGeometry args={[0.13, 0.5, 0.13]} />
          {material}
        </mesh>
      </>
    ),
    // A body of its own, with its own orbit.
    agent: (
      <>
        <mesh castShadow position-y={0.32}>
          <icosahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial
            color="#ffffff"
            flatShading
            metalness={0.55}
            ref={paint}
            roughness={0.3}
          />
        </mesh>
        <mesh position-y={0.32} rotation-x={1.25}>
          <torusGeometry args={[0.45, 0.022, 8, 48]} />
          {material}
        </mesh>
      </>
    ),
  };
  return <>{parts[kind]}</>;
}

type Want = {
  lit: DockKind | null;
  flown: DockKind | null;
  paused: boolean;
  onHover: (kind: DockKind | null) => void;
  onSelect: (kind: DockKind | null) => void;
  onDrawn: () => void;
  onLost: () => void;
  lowerDpr: () => void;
};

function Station({
  counts,
  want,
  changed,
}: {
  counts: DockCounts;
  want: RefObject<Want>;
  changed: string;
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
      stack: plate(DOCK_WIDTH, DOCK_DEPTH, 0.08, PLATE_HEIGHT * 0.72),
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
      swarm,
      dust: dustCloud(1000, 8, 42, 2.6),
      near: dustCloud(42, 2, 12, 3.8),
      cables,
      halo: haloTexture(),
      labels: DOCKS.map((dock) => labelTexture(dock.label, counts[dock.id] ?? 0)),
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
  const quiet = useMemo(
    () => DOCKS.map((dock) => new Color('#454f55').lerp(new Color(dock.hue), 0.5)),
    [],
  );
  const hue = useMemo(() => DOCKS.map((dock) => new Color(dock.hue)), []);
  const dim = useMemo(() => new Color('#262c30'), []);
  const goal = useMemo(() => new Color(), []);
  const ray = useMemo(() => new Raycaster(), []);
  const lightPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), -2), []);

  const ring = useRef<Group>(null);
  const plus = useRef<Group>(null);
  const gyroA = useRef<Mesh>(null);
  const gyroB = useRef<Mesh>(null);
  const farRing = useRef<Mesh>(null);
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
  const halos = useRef<(Sprite | null)[]>([]);
  const labels = useRef<(Sprite | null)[]>([]);
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
    inView: true,
    light: new Vector3(3, 2, 3),
  });
  const now = useRef({
    enter: 0,
    time: 0,
    drift: 0,
    theta: 0.45,
    x: 0,
    y: 0,
    scroll: 0,
    searching: 0,
    burst: 0,
    zoom: 0,
    focusLit: 0,
    lit: DOCKS.map(() => 0),
    shift: 0,
    light: new Vector3(3, 2, 3),
    frames: 0,
    frameSum: 0,
    tier: 0,
    placed: false,
    looping: false,
    drawn: 0,
  });
  const frame = useRef({ distance: 30, shift: 0, pickedShift: 0, closeIn: 0 });

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

  // A paused or returning reader skips the entrance: it is motion they refused.
  useLayoutEffect(() => {
    if (want.current.paused) now.current.enter = ENTRANCE;
    scratch.scale.setScalar(0);
    scratch.updateMatrix();
    for (const stack of stacks.current) {
      if (!stack) continue;
      for (let i = 0; i < stack.count; i++) stack.setMatrixAt(i, scratch.matrix);
    }
    scratch.scale.setScalar(1);
  }, [want]);

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
    const onMove = (event: Event) => {
      const pointer = event as PointerEvent;
      input.current.x = (pointer.clientX / innerWidth) * 2 - 1;
      input.current.y = (pointer.clientY / innerHeight) * 2 - 1;
      wake();
      const found = under(pointer);
      const over = onScene(event) ? found : null;
      lit = over;
      if (over) hero.dataset.over = '';
      else delete hero.dataset.over;
      want.current.onHover(over);
      // The reader's light, where the pointer's ray meets a plane just over the ring.
      ray.ray.intersectPlane(lightPlane, input.current.light);
    };
    const onClick = (event: Event) => {
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
      hero.removeEventListener('pointermove', onMove);
      hero.removeEventListener('pointerleave', onLeave);
      hero.removeEventListener('click', onClick);
      removeEventListener('scroll', onScroll);
      field?.removeEventListener('focus', onFocus);
      field?.removeEventListener('blur', onBlur);
      field?.removeEventListener('input', onType);
      delete hero.dataset.over;
    };
  }, [gl, camera, invalidate, ray, lightPlane, want]);

  // The composition: the ring fills what the words leave, and runs off the edge.
  useEffect(() => {
    const hero = gl.domElement.closest('.hero');
    const edge = hero?.querySelector('.hero-copy')?.getBoundingClientRect().right ?? size.width / 2;
    const free = size.width - edge;
    const radiusPixels = Math.min(free * 0.5, size.height * 0.62);
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
    };
    camera.fov = STAGE_FOV;
    invalidate();
  }, [camera, gl, invalidate, size]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
    const state = now.current;
    const reader = input.current;
    const { flown, lit, paused } = want.current;
    const frameNow = frame.current;

    const litIndex = DOCKS.findIndex((dock) => dock.id === lit);
    const flownIndex = DOCKS.findIndex((dock) => dock.id === flown);

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
    state.zoom += ((flownIndex >= 0 ? 1 : 0) - state.zoom) * approach(3, delta);
    state.light.lerp(reader.light, approach(5, delta));

    if (flownIndex >= 0) {
      const target = nearestTurn(state.theta, DOCKS[flownIndex].angle);
      state.theta += (target - state.theta) * approach(3, delta);
    } else {
      state.theta += DRIFT * delta * state.drift * (1 + state.searching * 3);
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
    if (farRing.current) {
      farRing.current.rotation.z = state.time * -0.06;
      farRing.current.rotation.x = Math.PI / 2 + 0.1 + state.y * 0.02;
    }

    // The hub: the one thing always in the signal colour.
    const glow = arrival * (1 + state.searching * 0.8 + reader.burst * 0.7);
    if (plus.current) {
      plus.current.rotation.y = state.time * 0.35 + (1 - arrival) * 2.6;
      plus.current.position.y = HUB_Y + Math.sin(state.time * 0.8) * 0.06;
      plus.current.scale.setScalar(arrival * (1 + state.searching * 0.12));
    }
    if (gyroA.current) {
      gyroA.current.rotation.x = 1.15 + state.time * 0.3;
      gyroA.current.rotation.y = state.time * 0.17 + reader.burst;
    }
    if (gyroB.current) {
      gyroB.current.rotation.x = -0.6 - state.time * 0.22;
      gyroB.current.rotation.z = state.time * 0.26;
    }
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
      if (entering && stack) {
        for (let p = 0; p < stack.count; p++) {
          const t = ease((state.enter - delay - p * 0.04) / 0.6);
          scratch.position.set(0, DECK_TOP + 0.05 + p * PLATE_HEIGHT + (1 - t) * 1.6, 0);
          scratch.scale.setScalar(t > 0 ? 1 : 0);
          scratch.updateMatrix();
          stack.setMatrixAt(p, scratch.matrix);
        }
        stack.instanceMatrix.needsUpdate = true;
      }
      const arrived = ease((state.enter - delay - 0.5) / 0.6);
      const target = litIndex === i ? 1 : litIndex < 0 ? 0 : -1;
      state.lit[i] += (target - state.lit[i]) * approach(9, delta);
      const value = state.lit[i];
      litMax = Math.max(litMax, value);
      const up = Math.max(0, value);

      const lift = docks.current[i];
      if (lift) lift.position.y = up * 0.16;
      const crown = crowns.current[i];
      if (crown) {
        crown.rotation.y = state.time * 0.3 + i + up * 0.7;
        crown.position.y =
          DECK_TOP +
          0.05 +
          plates(counts[dock.id]) * PLATE_HEIGHT +
          0.1 +
          Math.sin(state.time * 0.9 + i) * 0.04 +
          (1 - arrived) * 1.6;
        crown.scale.setScalar(arrived * (1 + up * 0.28));
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
      const halo = halos.current[i];
      if (halo) {
        halo.scale.setScalar(2.6 + up * 2.6);
        halo.material.opacity = arrived * (0.08 + up * 0.42) * (value < 0 ? 1 + value * 0.8 : 1);
      }
      const label = labels.current[i];
      if (label) {
        const high = DECK_TOP + plates(counts[dock.id]) * PLATE_HEIGHT + 1.32;
        label.position.y = high + up * 0.28;
        label.material.opacity = arrived * (value < 0 ? 1 + value * 0.68 : 1);
      }
      moteUniforms.uLit.value[i] = value;
      const cable = cableUniforms[i];
      cable.uTime.value = state.time;
      cable.uLit.value = value;
      cable.uBurst.value = reader.burst + state.searching * 0.45;
    });
    if (focusLight.current) {
      if (flownIndex >= 0) focusLight.current.color.copy(hue[flownIndex]);
      else if (litIndex >= 0) focusLight.current.color.copy(hue[litIndex]);
      state.focusLit += (litMax - state.focusLit) * approach(6, delta);
      const dock = DOCKS[Math.max(flownIndex, litIndex)] ?? DOCKS[0];
      focusLight.current.position.set(dock.x, 2.2, dock.z);
      focusLight.current.intensity = state.focusLit * 9;
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
    if (state.looping && state.tier < 4) {
      state.frames++;
      state.frameSum += rawDelta;
      if (state.frames >= 45) {
        if (state.frameSum / state.frames > 1 / 34) {
          state.tier++;
          gl.domElement.dataset.tier = String(state.tier);
          if (state.tier === 1 && key.current) key.current.castShadow = false;
          else want.current.lowerDpr();
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
      Math.abs((flownIndex >= 0 ? 1 : 0) - zoom) < 0.003 &&
      state.light.distanceToSquared(reader.light) < 0.001 &&
      Math.abs(shiftGoal - state.shift) <= 0.2 &&
      (flownIndex < 0 ||
        Math.abs(nearestTurn(state.theta, DOCKS[flownIndex].angle) - state.theta) < 0.002) &&
      state.lit.every((value, i) => {
        const target = litIndex === i ? 1 : litIndex < 0 ? 0 : -1;
        return Math.abs(value - target) < 0.004;
      });
    // The still drawing fades out on `live`, so `live` waits for a frame that exists:
    // this call runs before the render, so the second call follows a finished one.
    if (state.drawn < 2 && ++state.drawn === 2) want.current.onDrawn();
    state.looping = !settled || active || state.drawn < 2;
    if (state.looping) invalidate();
  });

  return (
    <>
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
        <mesh ref={farRing}>
          <torusGeometry args={[OUTER + 3.4, 0.014, 6, 180]} />
          <meshBasicMaterial color="#59646b" />
        </mesh>
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
        <mesh position-y={HUB_Y} ref={gyroA}>
          <torusGeometry args={[1.32, 0.024, 8, 96]} />
          <meshStandardMaterial color="#d8dee0" metalness={1} roughness={0.2} />
        </mesh>
        <mesh position-y={HUB_Y} ref={gyroB}>
          <torusGeometry args={[1.62, 0.016, 8, 96]} />
          <meshStandardMaterial color="#8d979c" metalness={1} roughness={0.25} />
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
              >
                {count > 0 ? (
                  <instancedMesh
                    args={[parts.stack, undefined, count]}
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
                    kind={dock.id}
                    paint={(material) => {
                      if (material && !crownPaint.current[i].includes(material)) {
                        crownPaint.current[i].push(material);
                      }
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
              <sprite
                ref={(sprite) => {
                  labels.current[i] = sprite;
                }}
                scale={[2.08, 0.52, 1]}
              >
                <spriteMaterial depthWrite={false} map={parts.labels[i]} opacity={0} transparent />
              </sprite>
              {/* What a pointer hits. Bigger than the dock on purpose, invisible,
                  and three's raycaster does not ask whether a mesh is visible. */}
              <mesh
                position-y={0.9}
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

export default function DockScene({
  counts,
  lit,
  flown,
  paused,
  onHover,
  onSelect,
  onReady,
  onLost,
}: {
  counts: DockCounts;
  lit: DockKind | null;
  flown: DockKind | null;
  paused: boolean;
  onHover: (kind: DockKind | null) => void;
  onSelect: (kind: DockKind | null) => void;
  onReady: () => void;
  onLost: () => void;
}) {
  // In state, not `setDpr` from inside: Canvas re-applies its prop on every render,
  // and a hover or a Pause renders it, which silently undid each step down.
  const [dpr, setDpr] = useState(() =>
    Math.min(window.devicePixelRatio, 1.5, Math.sqrt(PIXEL_BUDGET / (innerWidth * innerHeight))),
  );
  const handlers = {
    lit,
    flown,
    paused,
    onHover,
    onSelect,
    onDrawn: onReady,
    onLost,
    lowerDpr: () => setDpr((now) => Math.max(0.65, now * 0.8)),
  };
  const want = useRef<Want>(handlers);
  want.current = handlers;
  return (
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
      <Station changed={`${lit} ${flown} ${paused}`} counts={counts} want={want} />
    </Canvas>
  );
}
