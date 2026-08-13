/**
 * The five filterable artifact types, as plural labels, in one place that does
 * not touch the database.
 *
 * This exists for a specific reason. `ARTIFACT_TYPE_IDS` lives in
 * `@/db/queries/search`, which imports `@/db/client` at module scope — a module
 * that parses the environment as it loads. Anything the root layout renders,
 * `SearchLauncher` included, is in the module graph of every route, including
 * the ones `next build` prerenders with no DATABASE_URL. So the launcher cannot
 * import the ids from where they are defined, and hardcoding them inside the
 * launcher would put a second copy somewhere nothing would ever check.
 *
 * This module is the one copy. It is presentation only — ids and the words for
 * them, no predicate, no query, no semantics. The route that *can* see
 * `ARTIFACT_TYPE_IDS` assigns this to a `Record` keyed by them, so adding a type
 * to the search layer without adding it here fails to compile there rather than
 * shipping a filter chip that silently does nothing.
 *
 * The labels are plural because they name a set to filter to ("Agent Skills"),
 * which is a different grammatical job from `ArtifactBadge`'s singular labels
 * that name one row ("Agent Skill"). Both sets are verbatim from what the
 * artifacts route has always rendered.
 *
 * `catalog` is deliberately absent: it is a real artifact type with a badge, but
 * it is not one of the ids the search route accepts, and a chip that submits a
 * value `parseTypeFilter` drops would look like a filter and behave like no
 * filter at all.
 */
export const TYPE_FILTER_LABELS = {
  skill: 'Agent Skills',
  plugin: 'Claude Code Plugins',
  mcp_server: 'MCP Servers',
  command: 'Slash Commands',
  hook: 'Hook Configurations',
} as const;

export const TYPE_FILTER_IDS = Object.keys(
  TYPE_FILTER_LABELS,
) as (keyof typeof TYPE_FILTER_LABELS)[];
