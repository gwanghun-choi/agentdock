import { CopyButton } from '@/components/CopyButton';
import { ExternalIcon } from '@/components/Icon';
import { REDACTED, redactArgs, redactSecrets } from '@/components/redact';

/**
 * What THIS file declares that a reader needs to set it up — the per-artifact
 * half of the page's usage guidance; usageGuide.ts is the per-type half.
 *
 * Every value is one the detector already stored in package.meta (or, for a
 * command's argument hint, the version's frontmatter): no GitHub request, no
 * column, nothing composed that the file does not say. Two kinds of line, and
 * each block names which it is:
 *
 * - "From the file": a field as written, credential-shaped values blanked
 *   (redact.ts). The permalink beside it is the unblanked original.
 * - "Derived": a value computed from the file's own name and the convention
 *   the type's documentation states — a command's slash name.
 *
 * Nothing here is an install command. Where the file does not say how to set
 * itself up (a plugin's marketplace, a registry package's launcher), the block
 * says that, rather than composing one.
 */
export type SetupProps = {
  type: string;
  meta: Record<string, unknown>;
  slug: string;
  /** A command's `argument-hint` frontmatter value, as YAML parsed it. */
  argumentHint: unknown;
  sourcePath: string;
  /** The directory this artifact owns, at the commit read — a skill's or plugin's. */
  directoryHref: string | null;
};

type Server = {
  name: string;
  transport: string | null;
  command: string | null;
  args: unknown[] | null;
  url: string | null;
  envKeys: string[];
};

/**
 * An argument hint back in the form it was written. The documented example is
 * `argument-hint: [message]`, which YAML reads as a one-element list, not a
 * string — so a list of strings is put back in its brackets.
 */
export function hintText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) {
    return `[${value.join(', ')}]`;
  }
  return null;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const text = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '');

function servers(meta: Record<string, unknown>): Server[] {
  if (!Array.isArray(meta.servers)) return [];
  return meta.servers.flatMap((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (typeof s.name !== 'string') return [];
    return [
      {
        name: s.name,
        transport: typeof s.transport === 'string' ? s.transport : null,
        command: typeof s.command === 'string' ? redactSecrets(s.command) : null,
        args: Array.isArray(s.args) ? redactArgs(s.args) : null,
        url: typeof s.url === 'string' ? redactSecrets(s.url) : null,
        envKeys: strings(s.envKeys),
      },
    ];
  });
}

/**
 * The servers as an `mcpServers` object, from the stored fields only. `env` is
 * left out because its values were never stored; the page lists its names.
 */
export function mcpConfig(list: Server[]): string {
  const entries = Object.fromEntries(
    list.map((s) => [
      s.name,
      {
        ...(s.transport && s.transport !== 'stdio' ? { type: s.transport } : {}),
        ...(s.command ? { command: s.command } : {}),
        ...(s.args ? { args: s.args } : {}),
        ...(s.url ? { url: s.url } : {}),
      },
    ]),
  );
  return JSON.stringify({ mcpServers: entries }, null, 2);
}

function Provenance({ children }: { children: React.ReactNode }) {
  return <p className="muted provenance">{children}</p>;
}

function McpSetup({ meta, sourcePath }: { meta: Record<string, unknown>; sourcePath: string }) {
  const list = servers(meta);
  const packages = Array.isArray(meta.packages) ? (meta.packages as Record<string, unknown>[]) : [];
  const remotes = Array.isArray(meta.remotes) ? (meta.remotes as Record<string, unknown>[]) : [];
  if (list.length === 0 && packages.length === 0 && remotes.length === 0) return null;
  const blanked = mcpConfig(list).includes(REDACTED);
  return (
    <>
      <Provenance>
        From {sourcePath}, as written. Values that look like credentials show as {REDACTED}; the
        file at the linked commit has them.
      </Provenance>
      {list.map((s) => (
        <dl className="facts install" key={s.name}>
          <dt>Server</dt>
          <dd>
            <code>{s.name}</code>
          </dd>
          <dt>Transport</dt>
          <dd>{s.transport ?? 'not declared'}</dd>
          {s.command ? (
            <>
              <dt>Starts</dt>
              <dd className="fact-long">
                <code>{[s.command, ...(s.args ?? []).map(text)].join(' ')}</code>
              </dd>
            </>
          ) : null}
          {s.url ? (
            <>
              <dt>Connects to</dt>
              <dd className="fact-long">
                <code>{s.url}</code>
              </dd>
            </>
          ) : null}
          <dt>Environment variables</dt>
          <dd className="fact-long">
            {s.envKeys.length > 0
              ? `${s.envKeys.join(', ')} — names only; AgentDock does not store the values.`
              : 'none declared'}
          </dd>
        </dl>
      ))}
      {list.length > 0 ? (
        <dl className="facts install">
          <dt>As configuration</dt>
          <dd className="fact-long">
            <code>{mcpConfig(list)}</code> <CopyButton label="Copy JSON" value={mcpConfig(list)} />
            <span className="muted">
              {' '}
              Rebuilt from the fields above. Environment values are not in it
              {blanked ? `, and each ${REDACTED} has to be replaced` : ''}.
            </span>
          </dd>
        </dl>
      ) : null}
      {packages.length > 0 || remotes.length > 0 ? (
        <dl className="facts install">
          {packages.map((p) => (
            <div
              key={`${text(p.registryType)}:${text(p.identifier)}`}
              style={{ display: 'contents' }}
            >
              <dt>Package</dt>
              <dd>
                <code>{text(p.identifier)}</code> on {text(p.registryType)}
                {typeof p.version === 'string' ? `, version ${p.version}` : ''}
              </dd>
            </div>
          ))}
          {remotes.map((r) => (
            <div key={text(r.url)} style={{ display: 'contents' }}>
              <dt>Remote</dt>
              <dd>
                <code>{redactSecrets(text(r.url))}</code> {text(r.type)}
              </dd>
            </div>
          ))}
          <dt>Launch command</dt>
          <dd>
            Not stated by a registry manifest, and not composed here. The package&apos;s own
            documentation says how it starts.
          </dd>
        </dl>
      ) : null}
    </>
  );
}

function HookSetup({ meta, sourcePath }: { meta: Record<string, unknown>; sourcePath: string }) {
  const handlers = Array.isArray(meta.handlers) ? (meta.handlers as Record<string, unknown>[]) : [];
  if (handlers.length === 0) {
    return (
      <Provenance>
        {sourcePath} names the events {strings(meta.events).join(', ')}, but none holds a handler in
        the documented shape, so there is no command to show.
      </Provenance>
    );
  }
  return (
    <>
      <Provenance>
        From {sourcePath}, as written —{' '}
        {meta.scope === 'project' ? "a project's settings file" : "a plugin's hooks file"}. Each
        command runs when its event fires; it is shown as text and nothing here runs it. Values that
        look like credentials show as {REDACTED}.
      </Provenance>
      {/* One block per handler, the same shape as an MCP server's: a four-column
          table broke words mid-letter at 320px. Command is the long value, so
          it takes the full row (globals.css, .fact-long) and Type follows it. */}
      {handlers.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: handlers repeat freely; position is their identity
        <dl className="facts install handler" key={i}>
          <dt>Event</dt>
          <dd>{text(h.event)}</dd>
          <dt>Matcher</dt>
          <dd className="path">
            {h.matcher == null || h.matcher === '' ? 'every' : text(h.matcher)}
          </dd>
          <dt>Command</dt>
          <dd className="fact-long">
            {h.command == null ? 'not declared' : <code>{redactSecrets(text(h.command))}</code>}
          </dd>
          <dt>Type</dt>
          <dd>{h.type == null ? 'not declared' : text(h.type)}</dd>
        </dl>
      ))}
    </>
  );
}

export function SetupPanel({
  type,
  meta,
  slug,
  argumentHint,
  sourcePath,
  directoryHref,
}: SetupProps) {
  let body: React.ReactNode = null;
  if (type === 'mcp_server') body = <McpSetup meta={meta} sourcePath={sourcePath} />;
  else if (type === 'hook') body = <HookSetup meta={meta} sourcePath={sourcePath} />;
  else if (type === 'command') {
    const hint = hintText(argumentHint);
    const invocation = hint ? `/${slug} ${hint}` : `/${slug}`;
    body = (
      <>
        <Provenance>
          Derived: the documentation names a command after its file, so a copy at one of the paths
          below is typed as this.
          {hint ? ' The arguments are its argument-hint, as written.' : ''}
        </Provenance>
        <dl className="facts install">
          <dt>Typed as</dt>
          <dd>
            <code>{invocation}</code> <CopyButton label="Copy command" value={`/${slug}`} />
          </dd>
        </dl>
      </>
    );
  } else if (type === 'agent') {
    const disallowed = strings(meta.disallowedTools);
    const mcp = strings(meta.mcpServers);
    body = (
      <>
        <Provenance>From the file&apos;s frontmatter, as written.</Provenance>
        <dl className="facts install">
          <dt>Model</dt>
          <dd>{typeof meta.model === 'string' ? meta.model : 'not declared'}</dd>
          <dt>Tools withheld</dt>
          <dd>{disallowed.length > 0 ? disallowed.join(', ') : 'none declared'}</dd>
          <dt>MCP servers named</dt>
          <dd>{mcp.length > 0 ? mcp.join(', ') : 'none declared'}</dd>
        </dl>
      </>
    );
  } else if (type === 'plugin') {
    const declared = meta.declaredComponents as Record<string, unknown> | undefined;
    const declaredKeys = declared ? Object.keys(declared) : [];
    const inlineMcp = strings(meta.mcpServers);
    const shape = strings(meta.components);
    body = (
      <>
        <Provenance>
          {meta.detectionConfidence === 'shape-only'
            ? 'This directory has no plugin.json; it was recognised by its component directories.'
            : 'From plugin.json, as written.'}
        </Provenance>
        <dl className="facts install">
          {shape.length > 0 ? (
            <>
              <dt>Component directories</dt>
              <dd>{shape.join(', ')}</dd>
            </>
          ) : null}
          {declaredKeys.map((key) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt>Declares {key} at</dt>
              <dd className="path">{text(declared?.[key])}</dd>
            </div>
          ))}
          {inlineMcp.length > 0 ? (
            <>
              <dt>Inline MCP servers</dt>
              <dd>{inlineMcp.join(', ')} — names only; AgentDock does not store their settings.</dd>
            </>
          ) : null}
          <dt>Install command</dt>
          <dd>
            Not shown. Plugins install through a marketplace, and AgentDock does not record which
            marketplace lists this one, so any command here would be a guess.
          </dd>
        </dl>
      </>
    );
  }
  if (body === null && !directoryHref) return null;
  return (
    <>
      <h2 id="setup">Setting up this file</h2>
      {body}
      {directoryHref ? (
        <p className="muted">
          A {type === 'skill' ? 'skill' : 'plugin'} is its whole directory, not one file.{' '}
          <a href={directoryHref} rel="noopener noreferrer" target="_blank">
            <ExternalIcon /> Browse the directory at this commit
          </a>
          .
        </p>
      ) : null}
    </>
  );
}
