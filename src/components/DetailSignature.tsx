import Link from 'next/link';
import { ArtifactBadge } from '@/components/ArtifactBadge';
import { highlight } from '@/components/highlight';
import { detailHref } from '@/components/hrefs';
import { redactSecrets } from '@/components/redact';
import { hintText, servers, strings, text } from '@/components/SetupPanel';
import type { RelatedPackage } from '@/db/queries/packages';

const SHOWN = 6;

function More({ total, shown, word }: { total: number; shown: number; word: string }) {
  return total > shown ? (
    <p className="sig-more">
      and {(total - shown).toLocaleString('en-US')} more {word}, listed below
    </p>
  ) : null;
}

/**
 * The part of an artifact's opening that only its kind has, from what its own file declares:
 * what a command is typed as, what an MCP declaration connects, which events a hook waits on,
 * what a subagent names, what a skill's directory holds, what a plugin carries. The same fields
 * the Setup section prints, through the same redaction (a value here that had skipped it would be
 * the one place a credential-shaped string showed). A kind's file that declares none of it gets
 * no band: an empty one would read as a statement about the file.
 */
export function DetailSignature({
  type,
  meta,
  slug,
  argumentHint,
  files,
  components,
  fullName,
}: {
  type: string;
  meta: Record<string, unknown>;
  slug: string;
  argumentHint: unknown;
  files: { path: string; kind: string }[];
  components: RelatedPackage[];
  fullName: string;
}) {
  if (type === 'command') {
    const hint = hintText(argumentHint);
    return (
      <div className="sig sig-command">
        <p className="sig-label">Typed as</p>
        <p className="sig-prompt">
          <span className="sig-slash">/{slug}</span>
          {hint ? <span className="sig-args"> {hint}</span> : null}
          <span aria-hidden="true" className="sig-caret" />
        </p>
      </div>
    );
  }
  if (type === 'mcp_server') {
    const list = servers(meta);
    if (list.length === 0) return null;
    return (
      <div className="sig sig-wires">
        <p className="sig-label">What it connects</p>
        <ul>
          {list.slice(0, SHOWN).map((server) => (
            <li key={server.name}>
              <span className="sig-end">client</span>
              <span className="sig-wire">
                <span>{server.transport ?? 'transport not declared'}</span>
              </span>
              <span className="sig-end sig-far">{server.name}</span>
              {server.command || server.url ? (
                <code className="sig-run">
                  {server.command
                    ? highlight(
                        [server.command, ...(server.args ?? []).map(text)].join(' '),
                        'shell',
                      )
                    : server.url}
                </code>
              ) : null}
            </li>
          ))}
        </ul>
        <More shown={SHOWN} total={list.length} word="servers" />
      </div>
    );
  }
  if (type === 'hook') {
    const handlers = Array.isArray(meta.handlers)
      ? (meta.handlers as Record<string, unknown>[])
      : [];
    if (handlers.length === 0) return null;
    return (
      <div className="sig sig-rail">
        <p className="sig-label">What it waits for</p>
        <ol>
          {handlers.slice(0, SHOWN).map((handler, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: handlers repeat freely; position is their identity
            <li key={i}>
              <span className="sig-event">{text(handler.event)}</span>
              <span className="sig-matcher">
                {handler.matcher == null || handler.matcher === ''
                  ? 'every match'
                  : text(handler.matcher)}
              </span>
              {handler.command == null ? null : (
                <code className="sig-run">
                  {highlight(redactSecrets(text(handler.command)), 'shell')}
                </code>
              )}
            </li>
          ))}
        </ol>
        <More shown={SHOWN} total={handlers.length} word="handlers" />
      </div>
    );
  }
  if (type === 'agent') {
    const facts: [string, string][] = [
      ['Model', typeof meta.model === 'string' ? meta.model : 'not declared'],
      ['Tools withheld', strings(meta.disallowedTools).join(', ') || 'none declared'],
      ['MCP servers named', strings(meta.mcpServers).join(', ') || 'none declared'],
    ];
    return (
      <div className="sig sig-orbit">
        <p className="sig-label">What it declares for itself</p>
        <dl>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (type === 'skill') {
    if (files.length === 0) return null;
    return (
      <div className="sig sig-tree">
        <p className="sig-label">What its directory holds</p>
        <ul>
          {files.slice(0, SHOWN).map((file) => (
            <li key={file.path}>
              <code>{file.path.slice(file.path.lastIndexOf('/') + 1)}</code>
            </li>
          ))}
        </ul>
        <More shown={SHOWN} total={files.length} word="files" />
      </div>
    );
  }
  if (type === 'plugin') {
    const dirs = strings(meta.components);
    if (components.length === 0 && dirs.length === 0) return null;
    return (
      <div className="sig sig-modules">
        <p className="sig-label">What it carries</p>
        {components.length > 0 ? (
          <ul>
            {components.slice(0, SHOWN).map((component) => (
              <li
                className={`hue-${component.type}`}
                key={`${component.type}:${component.sourcePath}`}
              >
                <ArtifactBadge type={component.type} />
                <Link href={detailHref(fullName, component.sourcePath, component.type)}>
                  {component.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul>
            {dirs.map((dir) => (
              <li key={dir}>
                <code>{dir}/</code>
              </li>
            ))}
          </ul>
        )}
        <More shown={SHOWN} total={components.length} word="components" />
      </div>
    );
  }
  return null;
}
