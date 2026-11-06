import type { DockKind } from '@/components/dockBoard';

/**
 * What each kind does, drawn as what it does: a skill opens, a plugin's parts go into one
 * box, an MCP client connects to a server, a command is typed, a hook waits on a line of
 * events, a subagent takes a task away and brings it back. Each statement is the type's own
 * documentation (usageGuide.ts) and none is about any one artifact. Every label is a file name
 * the detectors match or a word from that documentation, and the event is one the hook
 * documentation names.
 *
 * Moved by the stylesheet, tied to scrolling, and finished at rest (globals.css, motion): with
 * no scroll timeline or under reduced motion this is the drawing's last frame.
 */
function Skill() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <g className="ka-page" key={i} style={{ '--i': i } as React.CSSProperties}>
          <rect height="190" rx="6" width="140" x="170" y="100" />
          <path d="M188 128h104M188 150h104M188 172h70" />
        </g>
      ))}
      <g className="ka-top">
        <rect height="190" rx="6" width="140" x="170" y="100" />
        <text x="188" y="134">
          SKILL.md
        </text>
        <path d="M188 156h104M188 178h104M188 200h78M188 222h92" />
      </g>
    </>
  );
}

const PLUGIN_PARTS = [
  ['skills', 88, 80, -46, -40],
  ['commands', 250, 80, 46, -40],
  ['agents', 88, 188, -46, 40],
  ['hooks', 250, 188, 46, 40],
] as const;

function Plugin() {
  return (
    <>
      <rect className="ka-frame" height="240" rx="10" width="340" x="70" y="60" />
      <text className="ka-label" textAnchor="middle" x="240" y="46">
        plugin.json
      </text>
      {PLUGIN_PARTS.map(([name, x, y, dx, dy]) => (
        <g
          className="ka-part"
          key={name}
          style={{ '--dx': `${dx}px`, '--dy': `${dy}px` } as React.CSSProperties}
        >
          <rect height="92" rx="6" width="142" x={x} y={y} />
          <text textAnchor="middle" x={x + 71} y={y + 52}>
            {name}
          </text>
        </g>
      ))}
    </>
  );
}

function Mcp() {
  const wires = [
    'M150 180C230 180 230 80 330 80',
    'M150 180H330',
    'M150 180C230 180 230 280 330 280',
  ];
  return (
    <>
      {wires.map((d, i) => (
        <g key={d} style={{ '--i': i } as React.CSSProperties}>
          <path className="ka-wire-track" d={d} />
          <path className="ka-wire" d={d} pathLength="1" />
        </g>
      ))}
      <rect className="ka-node" height="84" rx="8" width="110" x="40" y="138" />
      <text textAnchor="middle" x="95" y="186">
        client
      </text>
      {[
        [80, 'tools'],
        [180, 'server'],
        [280, 'data'],
      ].map(([y, word], i) => (
        <g className="ka-port" key={word} style={{ '--i': i } as React.CSSProperties}>
          <rect className="ka-node" height="64" rx="8" width="110" x="330" y={Number(y) - 32} />
          <text textAnchor="middle" x="385" y={Number(y) + 6}>
            {word}
          </text>
        </g>
      ))}
    </>
  );
}

function Command() {
  return (
    <>
      <rect className="ka-frame" height="220" rx="10" width="400" x="40" y="70" />
      <path className="ka-dim" d="M40 106H440" />
      <circle className="ka-fill" cx="62" cy="88" r="5" />
      <circle className="ka-dim-fill" cx="82" cy="88" r="5" />
      <circle className="ka-dim-fill" cx="102" cy="88" r="5" />
      <text className="ka-file" x="64" y="146">
        commands/*.md
      </text>
      <g className="ka-typed">
        <text className="ka-big" x="64" y="214">
          /its-name
        </text>
      </g>
      <rect className="ka-caret ka-fill" height="42" width="14" x="290" y="180" />
      <path className="ka-dim" d="M64 250H300" />
    </>
  );
}

function Hook() {
  return (
    <>
      <path className="ka-track" d="M10 130H470" />
      {[50, 130, 210, 370, 430].map((x, i) => (
        <circle
          className="ka-event ka-dim-fill"
          cx={x}
          cy="130"
          key={x}
          r="7"
          style={{ '--i': i } as React.CSSProperties}
        />
      ))}
      <circle className="ka-pulse ka-fill" cx="10" cy="130" r="11" />
      <path className="ka-hook" d="M290 130V226a44 44 0 0 0 88 0v-14" pathLength="1" />
      <circle className="ka-trip" cx="290" cy="130" r="17" />
      <text className="ka-label" textAnchor="middle" x="290" y="96">
        PreToolUse
      </text>
      <text className="ka-file" x="60" y="244">
        runs a command
      </text>
    </>
  );
}

function Agent() {
  return (
    <>
      <circle className="ka-orbit-path" cx="170" cy="180" r="210" />
      <circle className="ka-frame" cx="170" cy="180" r="100" />
      <text textAnchor="middle" x="170" y="176">
        the main
      </text>
      <text textAnchor="middle" x="170" y="200">
        conversation
      </text>
      <g className="ka-orbit">
        <circle className="ka-sub-disc" cx="380" cy="180" r="64" />
        <text textAnchor="middle" x="380" y="176">
          own tools,
        </text>
        <text textAnchor="middle" x="380" y="198">
          own prompt
        </text>
      </g>
      <path className="ka-hand" d="M270 160C286 150 300 150 316 160" pathLength="1" />
      <path className="ka-hand ka-back" d="M316 200C300 210 286 210 270 200" pathLength="1" />
    </>
  );
}

const ART: Record<DockKind, () => React.ReactNode> = {
  skill: Skill,
  plugin: Plugin,
  mcp_server: Mcp,
  command: Command,
  hook: Hook,
  agent: Agent,
};

export function KindArt({ kind }: { kind: DockKind }) {
  const Art = ART[kind];
  return (
    <svg aria-hidden="true" className={`kind-art kind-art-${kind}`} viewBox="0 0 480 360">
      <Art />
    </svg>
  );
}
