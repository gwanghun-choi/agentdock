/**
 * The hero's ground made into a picture: a network of read points around the
 * Latest read figure, with three signals running in along it to the lane. What
 * it stands for is the sentence the page opens with — many public
 * repositories, one index reading them — and it says nothing a reader needs:
 * `aria-hidden`, no text, no link, no focus stop.
 *
 * Inline SVG in a server component: the geometry is fixed, so it ships as
 * markup, with no client JavaScript and no client component. Shapes are not LCP
 * candidates (only an <image> inside an SVG is), so the headline stays the
 * largest contentful paint.
 *
 * The viewBox is the hero's box at 1280×800, one unit to the pixel, anchored
 * right and top (`xMaxYMin slice`). There the figure covers x 769–1102,
 * y 66–442, the copy ends near x 700, and the nodes sit in what is left: the
 * gap between the two, the band above, and the strip under the figure. The
 * cluster behind the figure shows through its 86% surface on a desktop and is
 * what a phone sees, where the figure is not displayed and the right-hand
 * 350 units are on screen.
 *
 * Two depths: a far dotted ring of small nodes, and a near network with three
 * hubs. Colour, opacity, the mask that keeps it off the copy, and every
 * animation are in globals.css.
 */

type Point = readonly [number, number];

const FAR: readonly Point[] = [
  [420, 22],
  [520, 44],
  [610, 18],
  [700, 40],
  [790, 14],
  [880, 34],
  [970, 16],
  [1060, 38],
  [1090, 150],
  [1080, 300],
  [1092, 440],
  [1060, 540],
  [950, 548],
  [840, 532],
];

const NEAR: readonly Point[] = [
  [735, 105],
  [712, 190],
  [742, 268],
  [690, 330],
  [730, 420],
  [810, 492],
  [930, 470],
  [1040, 500],
  [860, 140],
  [980, 112],
  [1030, 232],
  [900, 300],
  [1000, 372],
  [858, 400],
  [1068, 82],
];

/** Indices into NEAR drawn larger, with a halo. */
const HUBS = [1, 5, 14];

/** Pairs of NEAR indices; a negative index is FAR[-1 - i]. */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
  [0, -4],
  [0, 8],
  [8, 9],
  [9, 10],
  [10, 12],
  [12, 13],
  [13, 11],
  [11, 8],
  [11, 10],
  [2, 11],
  [13, 4],
  [7, 12],
  [9, -7],
  [9, 14],
  [14, -8],
  [14, 10],
];

/** In from the gap to the figure's left edge, at the heights of the lane's
 *  first, second and fourth nodes. */
const SIGNALS: readonly (readonly Point[])[] = [
  [FAR[3], NEAR[0], [772, 129]],
  [NEAR[3], NEAR[2], NEAR[1], [772, 166]],
  [NEAR[5], NEAR[4], [772, 237]],
];

/** A gentle bow, alternating sides, so the network does not read as drawn with
 *  a ruler: one quadratic control point, off the midpoint by 12% of the
 *  segment. */
function through(points: readonly Point[]): string {
  return points
    .map(([x, y], i) => {
      if (i === 0) return `M${x} ${y}`;
      const [px, py] = points[i - 1];
      const side = i % 2 ? 0.12 : -0.12;
      const cx = (px + x) / 2 - (y - py) * side;
      const cy = (py + y) / 2 + (x - px) * side;
      return `Q${Math.round(cx)} ${Math.round(cy)} ${x} ${y}`;
    })
    .join('');
}

const at = (i: number): Point => (i < 0 ? FAR[-1 - i] : NEAR[i]);

export function HeroSignal() {
  return (
    <svg
      aria-hidden="true"
      className="hero-signal"
      focusable="false"
      preserveAspectRatio="xMaxYMin slice"
      viewBox="0 0 1104 560"
    >
      <g className="sig-far">
        <path className="sig-ring" d={through(FAR)} pathLength={100} />
        {FAR.map(([x, y]) => (
          <circle cx={x} cy={y} key={`${x},${y}`} r={2} />
        ))}
      </g>
      <g className="sig-near">
        {EDGES.map(([a, b]) => (
          <path
            className="sig-edge"
            d={through([at(a), at(b)])}
            key={`${a}-${b}`}
            pathLength={100}
          />
        ))}
        {SIGNALS.map((points) => (
          <path className="sig-trace" d={through(points)} key={points[0].join()} />
        ))}
        {HUBS.map((i) => (
          <circle className="sig-halo" cx={NEAR[i][0]} cy={NEAR[i][1]} key={i} r={18} />
        ))}
        {NEAR.map(([x, y], i) => (
          <circle
            className={HUBS.includes(i) ? 'sig-node sig-hub' : 'sig-node'}
            cx={x}
            cy={y}
            key={`${x},${y}`}
            r={HUBS.includes(i) ? 5 : 3.5}
          />
        ))}
        {SIGNALS.map((points) => (
          <path className="sig-pulse" d={through(points)} key={points[0].join()} pathLength={100} />
        ))}
      </g>
    </svg>
  );
}
