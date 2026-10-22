import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { REDACTED } from './redact';
import { hintText, mcpConfig, SetupPanel, type SetupProps } from './SetupPanel';

// No database and no browser: meta shaped exactly as each detector writes it
// (src/detect/*.ts), rendered to a string. Every credential-looking value here
// is invented.
const render = (props: Partial<SetupProps>) =>
  renderToStaticMarkup(
    <SetupPanel
      type="skill"
      meta={{}}
      slug="x"
      argumentHint={null}
      sourcePath="x"
      directoryHref={null}
      {...props}
    />,
  );

const escaped = (s: string) => s.replaceAll('<', '&lt;').replaceAll('>', '&gt;');

describe('SetupPanel', () => {
  const servers = [
    {
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'docs-server', '--api-key', 'abc123'],
      url: null,
      envKeys: ['DOCS_TOKEN'],
    },
    {
      name: 'remote',
      transport: 'http',
      command: null,
      args: null,
      url: 'https://mcp.example.invalid/x?token=zzz',
      envKeys: [],
    },
  ];

  it('MCP: shows each server as written, credentials blanked, env names without values', () => {
    const html = render({ type: 'mcp_server', meta: { servers }, sourcePath: '.mcp.json' });
    expect(html).toContain('npx -y docs-server --api-key &lt;redacted&gt;');
    expect(html).toContain(escaped(`https://mcp.example.invalid/x?token=${REDACTED}`));
    expect(html).toContain('DOCS_TOKEN — names only');
    expect(html).not.toContain('abc123');
    expect(html).not.toContain('zzz');
    expect(html).toContain('Rebuilt from the fields above');
  });

  it('MCP: the copyable JSON is valid, keeps the stored fields and has no env', () => {
    const json = JSON.parse(
      mcpConfig(
        servers.map((s) => ({ ...s, args: s.args ? ['-y', 'docs-server'] : null, url: s.url })),
      ),
    );
    expect(json.mcpServers.docs).toEqual({ command: 'npx', args: ['-y', 'docs-server'] });
    expect(json.mcpServers.remote.type).toBe('http');
    expect(json.mcpServers.docs.env).toBeUndefined();
  });

  it('MCP registry manifest: lists packages and composes no launch command', () => {
    const html = render({
      type: 'mcp_server',
      meta: {
        packages: [{ registryType: 'npm', identifier: '@x/server', version: '1.0.0' }],
        remotes: [],
      },
    });
    expect(html).toContain('@x/server</code> on npm, version 1.0.0');
    expect(html).toContain('not composed here');
    expect(html).not.toContain('npx @x/server');
  });

  it('hook: one row per handler, command as escaped text with credentials blanked', () => {
    const html = render({
      type: 'hook',
      meta: {
        scope: 'project',
        events: ['PreToolUse'],
        handlers: [
          {
            event: 'PreToolUse',
            matcher: 'Bash',
            type: 'command',
            command: 'API_KEY=s3cret ./guard.sh "<b>"',
          },
          { event: 'Stop', matcher: null, type: null, command: null },
        ],
      },
    });
    expect(html).toContain(
      '<dt>Event</dt><dd>PreToolUse</dd><dt>Matcher</dt><dd class="path">Bash</dd>',
    );
    expect(html).toContain('API_KEY=&lt;redacted&gt; ./guard.sh &quot;&lt;b&gt;&quot;');
    expect(html).not.toContain('<b>');
    expect(html).toContain(
      '<dd class="path">every</dd><dt>Command</dt><dd class="fact-long">not declared</dd><dt>Type</dt><dd>not declared</dd>',
    );
  });

  it('hook: events with no handler in the documented shape say so', () => {
    expect(render({ type: 'hook', meta: { events: ['Odd'], handlers: [] } })).toContain(
      'names the events Odd, but none holds a handler',
    );
  });

  it('command: the slash name comes from the file name, with its argument hint', () => {
    const html = render({ type: 'command', slug: 'fix-issue', argumentHint: '[issue-number]' });
    expect(html).toContain('<code>/fix-issue [issue-number]</code>');
    expect(html).toContain('Derived');
  });

  it('plugin: never an install command, and says why', () => {
    const html = render({
      type: 'plugin',
      meta: { detectionConfidence: 'manifest', mcpServers: ['db'], declaredComponents: {} },
    });
    expect(html).toContain('Not shown. Plugins install through a marketplace');
    expect(html).not.toMatch(/\/plugin install/);
    expect(html).toContain('db — names only');
  });

  it('skill: links the whole directory at the commit', () => {
    const html = render({
      type: 'skill',
      directoryHref: 'https://github.com/o/r/tree/abc/skills/x',
    });
    expect(html).toContain('href="https://github.com/o/r/tree/abc/skills/x"');
    expect(html).toContain('is its whole directory');
  });

  it('agent: frontmatter facts, and absence said as absence', () => {
    const html = render({ type: 'agent', meta: { model: 'sonnet', disallowedTools: [] } });
    expect(html).toContain('<dd>sonnet</dd>');
    expect(html).toContain('<dt>Tools withheld</dt><dd>none declared</dd>');
  });

  it('renders nothing for a type it does not know and no directory', () => {
    expect(render({ type: 'catalog' })).toBe('');
  });

  // Regression: `argument-hint: [file]`, the documented form, is a YAML list.
  it('argument hint: a string as written, a parsed list back in brackets', () => {
    expect(hintText('[pr-number] [priority]')).toBe('[pr-number] [priority]');
    expect(hintText(['file'])).toBe('[file]');
    expect(hintText(['a', 'b'])).toBe('[a, b]');
    expect(hintText({ x: 1 })).toBeNull();
    expect(hintText(null)).toBeNull();
  });
});
