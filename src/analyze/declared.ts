import { toolTokens } from '@/detect/skill';
import type { AnalyzeInput, Finding } from './types';

/**
 * Bumped when the rule changes, so a precision row names a specific version.
 *
 * 2 (05-05): no edit in this file. toolTokens, which this analyzer reuses from
 * skill.ts rather than re-implementing, stopped splitting a grant on the spaces
 * inside its own parentheses. What this analyzer emits therefore changed —
 * `Bash(git add:*)` is now one finding where it was two fragments — so a rate
 * recorded against version 1 is not a rate about version 2, and the record's
 * Version column has to say which one it means.
 */
export const DECLARED_VERSION = '2';

type ServerMeta = { name?: unknown; command?: unknown };
type HandlerMeta = { event?: unknown; command?: unknown };

/**
 * The declared channel (Reference A). Two shapes, both reading already-parsed
 * structured data — never scanning text, never sharing a category with the
 * observed-capability analyzers (CONTEXT.md decision 2).
 *
 * Shape 1 — frontmatter['allowed-tools'] (skill.ts, command.ts). One finding
 * per token, the token stored VERBATIM. This is where the temptation lives:
 * a coarse `Bash(*)` grant is one finding, itself, and never three derived
 * ones. AgentDock never executes, so it cannot know what a shell grant is
 * used for at run time — decomposing "Bash(*)" into inferred network,
 * filesystem and install claims converts an observed fact about the file
 * into a judgment about behaviour, which is the exact move CAP-11/CAP-12
 * forbid. toolTokens() is reused from skill.ts rather than re-implemented,
 * so the string-or-list tolerance cannot drift between the two call sites.
 *
 * Shape 2 — the per-type `meta` fields Phase 3 already stored verbatim and
 * explicitly deferred to this phase: meta.servers[].command (mcp.ts) and
 * meta.handlers[].command (hook.ts). hook.ts:112-116 says so in its own
 * words: "Whether this reaches the network or installs a package is CAP-05,
 * Phase 4. Stored, never interpreted." Surfaced here as a declared fact,
 * still not interpreted — no splitting on shell metacharacters, no URL
 * extraction, no flag parsing.
 *
 * meta.servers[].envKeys is NEVER read here. Phase 3 dropped the env values
 * at parse for FND-08 and kept only the key names; re-surfacing the key
 * names as a "credentials" finding would reintroduce, through a side door,
 * the category CONTEXT.md's measurement already deleted.
 *
 * No supports(type) predicate. Each shape is a small function over the meta
 * key it knows; a type carrying neither (or an unrecognised shape) produces
 * nothing — the same way mcp.ts and hook.ts each define their own meta shape
 * independently and no detector anywhere asks "am I a skill".
 */
export function declaredCapabilities(input: AnalyzeInput): Finding[] {
  const findings: Finding[] = [];

  const tokens = toolTokens(input.frontmatter['allowed-tools']);
  if (tokens) {
    for (const token of tokens) {
      findings.push({
        detectorId: declaredCapabilities.name,
        detectorVersion: DECLARED_VERSION,
        category: 'declared',
        // The grant text itself, verbatim — never split on ':', '(' or '*'.
        signal: token,
        summary: `declares allowed-tools: ${token}`,
        sourcePath: input.sourcePath,
        // A multi-token field has no single useful line; inventing one would
        // produce a permalink that points at the right file, wrong claim.
        startLine: null,
        endLine: null,
        evidenceText: null,
        metadata: {},
      });
    }
  }

  const servers = Array.isArray(input.meta.servers) ? (input.meta.servers as ServerMeta[]) : [];
  for (const server of servers) {
    if (typeof server.command !== 'string') continue;
    findings.push({
      detectorId: declaredCapabilities.name,
      detectorVersion: DECLARED_VERSION,
      category: 'declared',
      signal: 'mcp_server.command',
      summary: `declares an MCP server command: ${server.command}`,
      sourcePath: input.sourcePath,
      startLine: null,
      endLine: null,
      evidenceText: null,
      metadata: {},
    });
  }

  const handlers = Array.isArray(input.meta.handlers) ? (input.meta.handlers as HandlerMeta[]) : [];
  for (const handler of handlers) {
    if (typeof handler.command !== 'string') continue;
    findings.push({
      detectorId: declaredCapabilities.name,
      detectorVersion: DECLARED_VERSION,
      category: 'declared',
      signal: 'hook.command',
      summary: `declares a hook command: ${handler.command}`,
      sourcePath: input.sourcePath,
      startLine: null,
      endLine: null,
      evidenceText: null,
      metadata: {},
    });
  }

  return findings;
}
