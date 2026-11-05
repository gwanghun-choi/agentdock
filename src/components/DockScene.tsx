'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ExtrudeGeometry,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
  Shape,
  Vector3,
} from 'three';
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
 * The board in WebGL. Loaded only by DockBoard.tsx, which is why this file is the
 * one place three.js is imported.
 *
 * `frameloop="demand"`: a frame is drawn only for the entrance and for a settling
 * response to the reader (the pointer tilting the board, a chip lighting its
 * dock). At rest it draws nothing, so it needs no pause control under WCAG 2.2.2
 * and costs an idle GPU nothing, where the Canvas 2D before it drew 30 frames a second.
 * The pointer goes through refs, so React never re-renders for it. The canvas
 * takes no input (`pointer-events: none`); the chips are the controls.
 */

const SLAB = '#191e21';
const SOCKET = '#252b2f';
const CABLE = '#3b4449';
const PLATE = new Color('#59646b');
const DIM = new Color('#3a4348');
const SIGNAL = '#f0b44c';
const ENTRANCE = 1.5; // seconds, and it ends inside WCAG 2.2.2's five
const CAMERA = new Vector3(4.6, 10.5, 11).normalize();

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
  const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, height, 0);
  return geometry;
}

/** The kind's name, printed on the board in the page's own face. */
function labelTexture(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.font = `600 84px ${getComputedStyle(document.body).fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.fillText(text, 256, 68);
  }
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 8;
  return texture;
}

/** Just above the top plate, or the empty socket. */
const labelHeight = (count: number) =>
  count > 0 ? 0.05 + (count - 1) * PLATE_HEIGHT + PLATE_HEIGHT * 0.72 + 0.004 : 0.054;

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
const scratch = new Object3D();

function Board({ counts }: { counts: DockCounts }) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  const shapes = useMemo(
    () => ({
      slab: plate(9.8, 6.2, 0.22, 0.2),
      socket: plate(DOCK_WIDTH + 0.3, DOCK_DEPTH + 0.3, 0.1, 0.05),
      stack: plate(DOCK_WIDTH, DOCK_DEPTH, 0.08, PLATE_HEIGHT * 0.72),
      hub: plate(1.1, 1.1, 0.14, 0.34),
    }),
    [],
  );
  const cables = useMemo(
    () =>
      DOCKS.map(({ x, z }) => {
        const points = cablePath(x, z).map(([px, pz]) => new Vector3(px, 0.03, pz));
        return new CatmullRomCurve3(points, false, 'catmullrom', 0.08);
      }),
    [],
  );
  const labels = useMemo(() => DOCKS.map((dock) => labelTexture(dock.label)), []);

  const root = useRef<Group>(null);
  const docks = useRef<(Group | null)[]>([]);
  const stacks = useRef<(InstancedMesh | null)[]>([]);
  const stackPaint = useRef<(MeshStandardMaterial | null)[]>([]);
  const cablePaint = useRef<(MeshStandardMaterial | null)[]>([]);
  const labelMeshes = useRef<(Mesh | null)[]>([]);
  // What the reader is doing, written by the listeners below and read per frame.
  const input = useRef({ lit: -1, x: 0, y: 0 });
  const now = useRef({ time: 0, x: 0, y: 0, lit: DOCKS.map(() => 0) });

  useEffect(() => {
    const hero = gl.domElement.closest('.hero');
    if (!hero) return;
    const onMove = (event: Event) => {
      const { clientX, clientY } = event as PointerEvent;
      input.current.x = (clientX / innerWidth) * 2 - 1;
      input.current.y = (clientY / innerHeight) * 2 - 1;
      invalidate();
    };
    /** A type chip under the pointer or the focus lights its dock. */
    const onChip = (event: Event) => {
      // Leaving focus, what matters is where it went, not the chip it left.
      const target = event.type === 'focusout' ? (event as FocusEvent).relatedTarget : event.target;
      const chip = (target as Element | null)?.closest?.<HTMLAnchorElement>('.hero-types a');
      const kind = chip ? new URL(chip.href).searchParams.get('type') : null;
      input.current.lit = DOCKS.findIndex((dock) => dock.id === kind);
      invalidate();
    };
    hero.addEventListener('pointermove', onMove, { passive: true });
    for (const type of ['pointerover', 'pointerleave', 'focusin', 'focusout'])
      hero.addEventListener(type, onChip);
    return () => {
      hero.removeEventListener('pointermove', onMove);
      for (const type of ['pointerover', 'pointerleave', 'focusin', 'focusout'])
        hero.removeEventListener(type, onChip);
    };
  }, [gl, invalidate]);

  // The whole board in whatever box the stylesheet gave it: the camera backs off
  // until the width fits.
  useEffect(() => {
    const distance = Math.max(15, 27 / (size.width / size.height));
    camera.position.copy(CAMERA).multiplyScalar(distance);
    camera.lookAt(0.2, 0, 0.1);
    invalidate();
  }, [camera, invalidate, size]);

  useLayoutEffect(() => {
    // Nothing on the first frame: the plates drop in from the entrance below.
    scratch.scale.setScalar(0);
    scratch.updateMatrix();
    for (const stack of stacks.current) {
      if (!stack) continue;
      for (let i = 0; i < stack.count; i++) stack.setMatrixAt(i, scratch.matrix);
    }
    scratch.scale.setScalar(1);
  }, []);

  const hue = useMemo(() => DOCKS.map((dock) => new Color(dock.hue)), []);
  const quiet = useMemo(
    () => DOCKS.map((dock) => PLATE.clone().lerp(new Color(dock.hue), 0.35)),
    [],
  );
  const wire = useMemo(() => new Color(CABLE), []);
  const goal = useMemo(() => new Color(), []);

  useFrame((_, rawDelta) => {
    // A demand loop's first frame after a rest would otherwise step the whole rest.
    const delta = Math.min(rawDelta, 1 / 30);
    const state = now.current;
    const entering = state.time < ENTRANCE;
    state.time += delta;

    DOCKS.forEach((_dock, i) => {
      const stack = stacks.current[i];
      if (entering && stack) {
        for (let p = 0; p < stack.count; p++) {
          const t = ease((state.time - i * 0.07 - p * 0.05) / 0.5);
          scratch.position.set(0, 0.05 + p * PLATE_HEIGHT + (1 - t) * 0.5, 0);
          scratch.scale.setScalar(t > 0 ? 1 : 0);
          scratch.updateMatrix();
          stack.setMatrixAt(p, scratch.matrix);
        }
        stack.instanceMatrix.needsUpdate = true;
        // The kind's name rides in on the top plate.
        const label = labelMeshes.current[i];
        if (label) {
          const t = ease((state.time - i * 0.07 - (stack.count - 1) * 0.05) / 0.5);
          label.position.y = labelHeight(stack.count) + (1 - t) * 0.5;
          label.visible = t > 0;
        }
      }
      const target = input.current.lit === i ? 1 : input.current.lit < 0 ? 0 : -1;
      state.lit[i] += (target - state.lit[i]) * Math.min(1, delta * 12);
      const lit = state.lit[i];
      const lift = docks.current[i];
      if (lift) lift.position.y = Math.max(0, lit) * 0.14;
      const paint = stackPaint.current[i];
      if (paint) {
        goal.copy(quiet[i]);
        if (lit > 0) goal.lerp(hue[i], lit);
        else goal.lerp(DIM, -lit);
        paint.color.copy(goal);
      }
      const line = cablePaint.current[i];
      if (line) line.color.copy(wire).lerp(hue[i], Math.max(0, lit));
    });

    state.x += (input.current.x - state.x) * Math.min(1, delta * 4);
    state.y += (input.current.y - state.y) * Math.min(1, delta * 4);
    if (root.current) {
      root.current.rotation.y = state.x * 0.07;
      root.current.rotation.x = state.y * 0.03;
    }

    const litSettled = state.lit.every((value, i) => {
      const target = input.current.lit === i ? 1 : input.current.lit < 0 ? 0 : -1;
      return Math.abs(value - target) < 0.004;
    });
    const tiltSettled =
      Math.abs(state.x - input.current.x) < 0.002 && Math.abs(state.y - input.current.y) < 0.002;
    if (entering || !litSettled || !tiltSettled) invalidate();
  });

  return (
    <group ref={root}>
      <hemisphereLight args={['#dfe6e8', '#0a0c0d', 1.05]} />
      <directionalLight
        castShadow
        intensity={2.1}
        position={[-3.5, 9, 4]}
        shadow-bias={-0.0006}
        shadow-camera-bottom={-5}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={5}
        shadow-mapSize={[1024, 1024]}
      />
      <mesh geometry={shapes.slab} position-y={-0.2} receiveShadow>
        <meshStandardMaterial color={SLAB} metalness={0.1} roughness={0.85} />
      </mesh>

      {cables.map((curve, i) => (
        <mesh key={DOCKS[i].id} receiveShadow>
          <tubeGeometry args={[curve, 48, 0.035, 6, false]} />
          <meshStandardMaterial
            color={CABLE}
            ref={(material) => {
              cablePaint.current[i] = material;
            }}
            roughness={0.6}
          />
        </mesh>
      ))}

      <mesh castShadow geometry={shapes.hub} receiveShadow>
        <meshStandardMaterial color="#2c3338" metalness={0.15} roughness={0.55} />
      </mesh>
      {/* The brand's glyph: AgentDock's own plus, the one thing always in the signal colour. */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.52, 0.02, 0.1]} />
        <meshBasicMaterial color={SIGNAL} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.1, 0.02, 0.52]} />
        <meshBasicMaterial color={SIGNAL} />
      </mesh>

      {DOCKS.map((dock, i) => {
        const count = plates(counts[dock.id]);
        return (
          <group key={dock.id} position={[dock.x, 0, dock.z]}>
            <mesh geometry={shapes.socket} receiveShadow>
              <meshStandardMaterial color={SOCKET} roughness={0.8} />
            </mesh>
            <group
              ref={(group) => {
                docks.current[i] = group;
              }}
            >
              {count > 0 ? (
                <instancedMesh
                  args={[shapes.stack, undefined, count]}
                  castShadow
                  ref={(mesh) => {
                    stacks.current[i] = mesh;
                  }}
                  receiveShadow
                >
                  <meshStandardMaterial
                    color={quiet[i]}
                    metalness={0.2}
                    ref={(material) => {
                      stackPaint.current[i] = material;
                    }}
                    roughness={0.5}
                  />
                </instancedMesh>
              ) : null}
              <mesh
                position-y={labelHeight(count)}
                ref={(mesh) => {
                  labelMeshes.current[i] = mesh;
                }}
                rotation-x={-Math.PI / 2}
              >
                <planeGeometry args={[1.44, 0.36]} />
                <meshBasicMaterial
                  color={count > 0 ? '#0c0f11' : '#a8afae'}
                  map={labels[i]}
                  transparent
                />
              </mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}

export default function DockScene({
  counts,
  onReady,
  onLost,
}: {
  counts: DockCounts;
  onReady: () => void;
  onLost: () => void;
}) {
  return (
    <Canvas
      // A ratio of 1.5 at most: past it the cost is pixels and the picture is not type.
      camera={{ fov: 26 }}
      dpr={[1, 1.5]}
      flat
      frameloop="demand"
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', onLost);
        onReady();
      }}
      shadows
      // Inline, because Canvas writes `pointer-events: auto` on its own wrapper and
      // the stylesheet's `none` on the parent does not reach through it.
      style={{ pointerEvents: 'none' }}
    >
      <Board counts={counts} />
    </Canvas>
  );
}
