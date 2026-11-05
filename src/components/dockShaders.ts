/**
 * The scene's GLSL programs, as text. Each one moves or lights what would
 * otherwise cost a JavaScript loop per frame: thousands of motes are one draw
 * call and no buffer upload, because a mote's whole path is a function of uTime.
 */

/** One mote per listed artifact, circling its dock. */
export const MOTE_VERTEX = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aSeed; // angle, radius, height, speed
  attribute float aKind;
  uniform float uTime;
  uniform float uPull;
  uniform float uPixel;
  uniform float uLit[6];
  uniform vec3 uHue[6];
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    int kind = int(aKind + 0.5);
    float lit = uLit[kind];
    float up = max(lit, 0.0);
    float angle = aSeed.x + uTime * aSeed.w * (1.0 + up * 1.2);
    float reach = aSeed.y * (1.0 + up * 0.4);
    vec3 at = aCenter + vec3(
      cos(angle) * reach,
      aSeed.z + sin(uTime * aSeed.w + aSeed.x) * 0.14,
      sin(angle) * reach
    );
    // With the search field in focus the swarm streams to the hub: every mote
    // spends part of its cycle on the way in.
    float leg = fract(uTime * 0.22 + aSeed.x * 0.159);
    at = mix(at, vec3(0.0, 1.5, 0.0), uPull * leg * leg);

    vec4 view = modelViewMatrix * vec4(at, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uPixel * (0.55 + aSeed.w * 0.5) * (1.0 + up * 0.7) / -view.z;
    vColor = uHue[kind] * (0.9 + up * 1.1);
    vAlpha = lit < 0.0 ? 0.75 + lit * 0.6 : 0.75 + up * 0.25;
  }
`;

/** Far dust, near dust: the same soft point at different depths. */
export const DUST_VERTEX = /* glsl */ `
  attribute float aSize;
  uniform float uPixel;
  uniform vec3 uTint;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uPixel * aSize / -view.z;
    vColor = uTint;
    vAlpha = 0.28 + aSize * 0.32;
  }
`;

export const POINT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, d);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vColor, a * a * vAlpha);
    #include <colorspace_fragment>
  }
`;

/** A cable, with a pulse running from the dock to the hub. uv.x is along it. */
export const CABLE_VERTEX = /* glsl */ `
  varying float vAlong;

  void main() {
    vAlong = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const CABLE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uLit;
  uniform float uBurst;
  uniform vec3 uHue;
  varying float vAlong;

  void main() {
    float up = max(uLit, 0.0);
    float gap = 1.0 / (2.0 + up * 3.0 + uBurst * 3.0);
    float phase = fract((vAlong - uTime * (0.16 + up * 0.5 + uBurst * 0.5) + uSeed) / gap);
    float pulse = smoothstep(0.82, 1.0, phase);
    vec3 line = mix(vec3(0.07, 0.085, 0.095), uHue * 0.55, up);
    vec3 color = line + uHue * pulse * (0.9 + up * 1.4 + uBurst);
    gl_FragColor = vec4(color * (uLit < 0.0 ? 1.0 + uLit * 0.55 : 1.0), 1.0);
    #include <colorspace_fragment>
  }
`;

/** The polar grid far under the ring, and the wave a selection sends across it. */
export const FLOOR_VERTEX = /* glsl */ `
  varying vec2 vAt;

  void main() {
    vAt = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const FLOOR_FRAGMENT = /* glsl */ `
  uniform float uWave;
  uniform vec3 uTint;
  uniform vec3 uFocus;
  uniform float uFocusing;
  varying vec2 vAt;

  float grid(float value, float step) {
    float scaled = value / step;
    float width = fwidth(scaled);
    float distance = abs(fract(scaled - 0.5) - 0.5);
    return 1.0 - smoothstep(width * 0.6, width * 1.6, distance);
  }

  void main() {
    float r = length(vAt);
    float angle = atan(vAt.y, vAt.x);
    // Spokes thin out toward the centre, where they would otherwise merge.
    float spokes = grid(angle, 3.14159265 / 6.0) * smoothstep(4.0, 9.0, r);
    float rings = grid(r, 3.0);
    float fade = smoothstep(36.0, 7.0, r) * smoothstep(1.0, 6.0, r);
    float wave = uWave > 0.0 ? exp(-abs(r - uWave * 34.0) * 1.1) * (1.0 - uWave) : 0.0;
    vec3 color = mix(uTint, uFocus, uFocusing * 0.8);
    float strength = max(rings, spokes * 0.55) * 0.5 + wave * 1.2;
    gl_FragColor = vec4(color, strength * fade);
    #include <colorspace_fragment>
  }
`;

/** The hub's core and its glass: a rim that faces away, bands that climb inside. */
export const CORE_VERTEX = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vToEye;
  varying vec2 vUv;

  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vToEye = normalize(-view.xyz);
    vUv = uv;
    gl_Position = projectionMatrix * view;
  }
`;

export const CORE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uRim;
  uniform float uFill;
  uniform float uBands;
  varying vec3 vNormalView;
  varying vec3 vToEye;
  varying vec2 vUv;

  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vToEye)));
    float rim = pow(1.0 - facing, 2.6) * uRim;
    float bands = smoothstep(0.72, 1.0, sin(vUv.y * 42.0 - uTime * 2.2)) * uBands * facing;
    float centre = pow(facing, 3.0) * uFill;
    gl_FragColor = vec4(uColor * (rim + centre + bands * 0.32), rim + centre + bands * 0.2);
    #include <colorspace_fragment>
  }
`;

/** A column of light: bright at its foot, soft at its edge, gone at its head. */
export const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormalView;
  varying vec3 vToEye;
  varying vec2 vUv;

  void main() {
    float facing = abs(dot(normalize(vNormalView), normalize(vToEye)));
    float along = vUv.y * vUv.y;
    gl_FragColor = vec4(uColor, pow(facing, 2.0) * along * uStrength);
    #include <colorspace_fragment>
  }
`;

/** A far orbit: a hairline with a comet on it. uv.x runs round the ring. */
export const TRAIL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uLaps;
  uniform vec3 uHue;
  varying float vAlong;

  void main() {
    float phase = fract(vAlong * uLaps - uTime * uSpeed);
    float comet = pow(phase, 14.0);
    gl_FragColor = vec4(uHue, 0.07 + comet * 0.85);
    #include <colorspace_fragment>
  }
`;
