/**
 * The one place an artifact type becomes a visible label.
 *
 * The labels are verbatim from the seeded `artifact_type.label` rows
 * (drizzle/0001, drizzle/0003), the same strings the detail page has always
 * printed — so a type reads identically in a list, on a filter and on a detail
 * page. The artifacts route keeps its own plural set for the filter dropdown
 * ("Agent Skills"), which is a different grammatical job from labelling one row.
 *
 * The colour is identity, not judgement. A hue here groups a scanning eye by
 * kind; it never means an artifact is safe, trusted or risky, and there is no
 * ordering among the six. That distinction is the same one Phase 4's vocabulary
 * invariant draws, and check-boundaries.mjs rule six enforces on the copy.
 *
 * An unknown id renders as itself rather than disappearing: a type added to the
 * database before this map is updated should look unstyled, not invisible.
 */
export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  skill: 'Agent Skill',
  plugin: 'Claude Code Plugin',
  catalog: 'Plugin Marketplace',
  mcp_server: 'MCP Server',
  command: 'Slash Command',
  hook: 'Hook Configuration',
};

export function artifactTypeLabel(type: string): string {
  return ARTIFACT_TYPE_LABELS[type] ?? type;
}

export function ArtifactBadge({ type }: { type: string }) {
  // Only the six known ids get a hue class; anything else falls back to the
  // neutral base badge styling.
  const known = type in ARTIFACT_TYPE_LABELS;
  return <span className={known ? `badge badge-${type}` : 'badge'}>{artifactTypeLabel(type)}</span>;
}
