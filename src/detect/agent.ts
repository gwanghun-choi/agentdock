import { parseFrontmatter, splitFrontmatter } from './frontmatter';
import { plugin } from './plugin';
import { toolTokens } from './skill';
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

/**
 * The complete Claude Code subagent frontmatter field set, verbatim from
 * code.claude.com/docs/en/sub-agents (read 2026-10-21). Claude Code ignores
 * anything else without an error, so a key outside it is a note, not a failure.
 */
export const AGENT_SPEC_KEYS = [
  'name',
  'description',
  'tools',
  'disallowedTools',
  'model',
  'permissionMode',
  'maxTurns',
  'autoCompactWindow',
  'skills',
  'mcpServers',
  'hooks',
  'memory',
  'background',
  'omitClaudeMd',
  'effort',
  'isolation',
  'color',
  'initialPrompt',
  'experimental',
] as const;

/** Same documentation: at most 256 characters, no ':', no leading '-'. */
const MAX_NAME = 256;
/** Same excerpt rule as skills and commands. */
const MAX_BODY = 32 * 1024;

const PROJECT_AGENTS = /(^|\/)\.claude\/agents\//;

/**
 * The directory an `agents/` segment must sit in for Claude Code to load what is
 * under it: a project's `.claude/`, or a plugin root. Anywhere else an
 * `agents/` directory is somebody's prompt files — measured on fixtures/,
 * anthropics/skills keeps three under skills/skill-creator/agents/, which no
 * Claude Code scan reads.
 *
 * Plugin roots come from plugin.match() over the same tree, so this detector
 * and the plugin detector cannot disagree about what a plugin is. A plugin.json
 * `agents` path override is not followed — plugin.ts records it as observed
 * and follows nothing, and this matches that.
 */
function agentRoot(segments: string[], pluginRoots: Set<string>): boolean {
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] !== 'agents') continue;
    if (segments[i - 1] === '.claude') return true;
    if (pluginRoots.has(segments.slice(0, i).join('/'))) return true;
  }
  return false;
}

export const agent: Detector = {
  type: 'agent',

  // Recursive under both roots: Claude Code scans `.claude/agents/` and a
  // plugin's `agents/` with subfolders (same page). A path with a `commands`
  // segment is the command detector's, so one file never becomes two rows.
  match(tree: TreeEntry[]): Candidate[] {
    const pluginRoots = new Set(plugin.match(tree).map((c) => c.containerRoot ?? ''));
    return tree
      .filter((e) => {
        if (e.type !== 'blob' || !e.path.endsWith('.md')) return false;
        const segments = e.path.split('/');
        if (segments[segments.length - 1].toUpperCase() === 'README.MD') return false;
        if (segments.slice(0, -1).includes('commands')) return false;
        return agentRoot(segments, pluginRoots);
      })
      .map((e) => ({ type: 'agent', sourcePath: e.path, needs: [e.path] }));
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

    const segments = c.sourcePath.split('/');
    const fileName = segments[segments.length - 1].replace(/\.md$/, '');
    // The documentation draws exactly one line between the two scopes: a plugin
    // agent with no name, or whose frontmatter does not parse, still loads under
    // its filename. A project agent needs both required fields.
    const project = PROJECT_AGENTS.test(c.sourcePath);
    const warnings: string[] = [];

    const parsed = parseFrontmatter(source, c.sourcePath);
    let fm: Record<string, unknown> = {};
    if (!parsed.ok) {
      // A Markdown file with no frontmatter at all under .claude/agents/ is not
      // a subagent, it is a note someone kept there. Not a failed artifact.
      if (project && splitFrontmatter(source) === null) {
        return { ok: true, status: 'none', reason: 'no frontmatter block' };
      }
      if (project) return { ok: false, status: 'failed', errors: parsed.errors };
      warnings.push(...parsed.errors, 'a plugin agent loads under its filename without one');
    } else {
      fm = parsed.data;
    }

    const declaredName = typeof fm.name === 'string' ? fm.name.trim() : '';
    const description = typeof fm.description === 'string' ? fm.description.trim() : '';
    const name = declaredName || fileName;

    if (parsed.ok) {
      if (!declaredName) warnings.push('name is missing or empty');
      if (description.length === 0) warnings.push('description is missing or empty');
    }
    if ([...name].length > MAX_NAME) warnings.push(`name is over ${MAX_NAME} characters`);
    if (name.includes(':') || name.startsWith('-')) {
      warnings.push('name contains ":" or starts with "-"');
    }

    const keys = Object.keys(fm);
    const extraKeys = keys.filter(
      (k) => !AGENT_SPEC_KEYS.includes(k as (typeof AGENT_SPEC_KEYS)[number]),
    );
    if (extraKeys.length > 0) {
      warnings.push(`keys outside the specification: ${extraKeys.join(', ')}`);
    }

    const tools = toolTokens(fm.tools);
    if (fm.tools !== undefined && tools === null) {
      warnings.push('tools is neither a string nor a list');
    }

    // mcpServers can carry an inline server definition, env values included.
    // Names only, never a value — the rule mcp.ts and plugin.ts already follow.
    const { mcpServers, ...frontmatterSafe } = fm;
    const serverNames = Array.isArray(mcpServers)
      ? mcpServers.flatMap((s) =>
          typeof s === 'string' ? [s] : s && typeof s === 'object' ? Object.keys(s) : [],
        )
      : mcpServers && typeof mcpServers === 'object'
        ? Object.keys(mcpServers)
        : [];

    return {
      ok: true,
      status: warnings.length > 0 ? 'partial' : 'ok',
      warnings,
      artifact: {
        name,
        slug: fileName,
        summary: description.length > 0 ? description : null,
        licenseText: null,
        declaredVersion: null,
        body: source.slice(0, MAX_BODY),
        frontmatter: frontmatterSafe,
        meta: {
          frontmatterKeys: keys,
          specPure: extraKeys.length === 0,
          scope: project ? 'project' : 'plugin',
          // Verbatim. Absent means Claude Code's default — every tool the main
          // conversation has — so no absence is ever claimed from it.
          declaredTools: tools,
          disallowedTools: toolTokens(fm.disallowedTools),
          model: typeof fm.model === 'string' ? fm.model : null,
          mcpServers: serverNames,
        },
      },
    };
  },
};
