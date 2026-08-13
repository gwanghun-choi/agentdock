import type { ReactElement, SVGProps } from 'react';
import {
  CatalogIcon,
  CommandIcon,
  HookIcon,
  PluginIcon,
  ServerIcon,
  SkillIcon,
} from '@/components/Icon';

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

/**
 * The third channel.
 *
 * Hue and word carried type identity between them, and hue is the channel a
 * reader may not have — several of the six badge pairs are not distinguishable
 * to a deuteranope, which is why the word was always spelled out. The glyph adds
 * shape, so any one of the three is enough on its own and none of them is doing
 * the work alone.
 *
 * Keyed off the same map as the labels rather than a second list. A type in one
 * and not the other is the way a badge ends up with a plugin's icon over a
 * hook's word; there is one set of ids here, and an unknown one renders as
 * itself with no glyph rather than disappearing.
 */
const ARTIFACT_TYPE_ICONS: Record<string, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  skill: SkillIcon,
  plugin: PluginIcon,
  catalog: CatalogIcon,
  mcp_server: ServerIcon,
  command: CommandIcon,
  hook: HookIcon,
};

export function artifactTypeLabel(type: string): string {
  return ARTIFACT_TYPE_LABELS[type] ?? type;
}

export function ArtifactBadge({ type }: { type: string }) {
  // Only the six known ids get a hue class; anything else falls back to the
  // neutral base badge styling.
  const known = type in ARTIFACT_TYPE_LABELS;
  const Glyph = ARTIFACT_TYPE_ICONS[type];
  return (
    <span className={known ? `badge badge-${type}` : 'badge'}>
      {/* aria-hidden by construction — every icon in Icon.tsx is — because the
          label is right here. Announcing both would read the type twice. */}
      {Glyph ? <Glyph /> : null}
      {artifactTypeLabel(type)}
    </span>
  );
}
