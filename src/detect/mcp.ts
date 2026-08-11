import { parseJsonManifest } from './json';
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

const MCP_FILENAME = '.mcp.json';
const REGISTRY_FILENAME = 'server.json';

function dirOf(sourcePath: string): string {
  const parts = sourcePath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

function isMcpJson(path: string): boolean {
  return path === MCP_FILENAME || path.endsWith(`/${MCP_FILENAME}`);
}

function isServerJson(path: string): boolean {
  return path === REGISTRY_FILENAME || path.endsWith(`/${REGISTRY_FILENAME}`);
}

type ServerEntry = {
  type?: unknown;
  command?: unknown;
  args?: unknown;
  url?: unknown;
  env?: unknown;
};

/**
 * `.mcp.json`'s project/plugin-scope map: `{ mcpServers: { name: {...} } }`.
 *
 * Absent, non-object or empty mcpServers is not a malformed declaration — it is
 * simply not one, the same way a repository with no SKILL.md produces no skill
 * rows.
 */
function parseMcpJson(c: Candidate, data: Record<string, unknown>): ParseResult {
  const rawServers = data.mcpServers;
  if (typeof rawServers !== 'object' || rawServers === null || Array.isArray(rawServers)) {
    return { ok: true, status: 'none', reason: `${c.sourcePath} declares no mcpServers` };
  }
  const keys = Object.keys(rawServers);
  if (keys.length === 0) {
    return { ok: true, status: 'none', reason: `${c.sourcePath} declares an empty mcpServers` };
  }

  const servers = keys.map((name) => {
    const srv = (rawServers as Record<string, unknown>)[name] as ServerEntry | undefined;
    const command = typeof srv?.command === 'string' ? srv.command : null;
    const envKeys =
      srv?.env && typeof srv.env === 'object' && !Array.isArray(srv.env)
        ? Object.keys(srv.env as Record<string, unknown>)
        : [];
    return {
      name,
      // stdio is the documented default when a command is present.
      transport: typeof srv?.type === 'string' ? srv.type : command ? 'stdio' : null,
      // Stored verbatim, never interpreted: whether this reaches the network
      // or installs a package is CAP-05 (Phase 4), not this detector.
      command,
      args: Array.isArray(srv?.args) ? srv.args : null,
      url: typeof srv?.url === 'string' ? srv.url : null,
      // KEY NAMES ONLY. A committed .mcp.json can carry a credential in a
      // value; it is already public, and AgentDock must not become the second
      // place it lives (FND-08, QUA-06).
      envKeys,
    };
  });

  return {
    ok: true,
    status: 'ok',
    warnings: [],
    artifact: {
      // A file declaring exactly one server takes its name — the common case,
      // and the only one where a filename would be a worse name than what is
      // inside. Otherwise the containing directory, with the count in meta.
      name: keys.length === 1 ? keys[0] : dirOf(c.sourcePath) || 'mcp-servers',
      slug: dirOf(c.sourcePath) || (keys.length === 1 ? keys[0] : 'mcp-servers'),
      summary: null,
      licenseText: null,
      declaredVersion: null,
      body: '',
      // Never the raw parsed object: it is the exact thing envKeys exists to
      // keep out of storage. meta.servers is the sanitized, queryable surface.
      frontmatter: {},
      meta: { serverCount: keys.length, servers },
    },
  };
}

/**
 * `server.json`, the MCP registry publishing manifest — a different schema
 * entirely (Pitfall 1). Documented as "in preview" by its own maintainers, so
 * tolerance is the mitigation: schema drift degrades to no row, never to a
 * failed repository.
 */
function parseServerJson(c: Candidate, data: Record<string, unknown>): ParseResult {
  const hasName = typeof data.name === 'string' && data.name.trim().length > 0;
  const hasDescription = typeof data.description === 'string' && data.description.trim().length > 0;
  const hasPackages = Array.isArray(data.packages) && data.packages.length > 0;
  const hasRemotes = Array.isArray(data.remotes) && data.remotes.length > 0;

  if (!hasName && !hasDescription && !hasPackages && !hasRemotes) {
    // A file named server.json in a Node repository is usually not an MCP
    // manifest at all.
    return {
      ok: true,
      status: 'none',
      reason: `${c.sourcePath} carries none of name, description, packages or remotes`,
    };
  }

  if (!hasName) {
    return {
      ok: false,
      status: 'failed',
      errors: ['server.json has no name'],
      artifact: { name: dirOf(c.sourcePath) || 'mcp-server' },
    };
  }

  const packages = (Array.isArray(data.packages) ? data.packages : []).map((p) => {
    const pkg = (p ?? {}) as Record<string, unknown>;
    return {
      registryType: typeof pkg.registryType === 'string' ? pkg.registryType : null,
      identifier: typeof pkg.identifier === 'string' ? pkg.identifier : null,
      version: typeof pkg.version === 'string' ? pkg.version : null,
      transport: pkg.transport ?? null,
    };
  });

  const name = (data.name as string).trim();
  return {
    ok: true,
    status: 'ok',
    warnings: [],
    artifact: {
      name,
      slug: dirOf(c.sourcePath) || name,
      summary: hasDescription ? (data.description as string).trim() : null,
      licenseText: null,
      declaredVersion: typeof data.version === 'string' ? data.version : null,
      body: '',
      frontmatter: data,
      meta: { packages, remotes: Array.isArray(data.remotes) ? data.remotes : [] },
    },
  };
}

export const mcp: Detector = {
  // Matches the artifact_type row this project seeded in 0003, not the file
  // basename — the registry canary in skill.test.ts asserts this literally.
  type: 'mcp_server',

  // Path-only, two rules under one detector: .mcp.json's project/plugin-scope
  // map, and server.json's registry manifest. Reference: 03-RESEARCH.md
  // Pitfall 1 — the two schemas share the word MCP and both live at a
  // repository root, which invites one regex that gets both wrong.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => e.type === 'blob' && (isMcpJson(e.path) || isServerJson(e.path)))
      .map((e) => ({ type: 'mcp_server', sourcePath: e.path, needs: [e.path] }));
  },

  async parse(c: Candidate, read: (path: string) => Promise<string>): Promise<ParseResult> {
    let source: string;
    try {
      source = await read(c.sourcePath);
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        errors: [`could not read: ${(error as Error).message}`],
      };
    }

    const parsed = parseJsonManifest(source, c.sourcePath);
    if (!parsed.ok) return { ok: false, status: 'failed', errors: parsed.errors };

    return isMcpJson(c.sourcePath) ? parseMcpJson(c, parsed.data) : parseServerJson(c, parsed.data);
  },
};
