/**
 * What each artifact type is and where its documentation lives, written once and
 * rendered on every detail page of that type.
 *
 * Static on purpose. Every line is a statement about the TYPE, taken from the
 * linked documentation (each URL answered 200 on 2026-10-21), never about the
 * artifact on the page: AgentDock does not run what it lists, so it cannot say
 * whether one works in a given client, and it never repeats a command an
 * artifact's own README suggests. A type with no entry renders no section.
 */
export type UsageGuide = {
  what: string;
  /** The client whose documentation defines the format. Not a compatibility claim. */
  documentedFor: string;
  docs: string;
  /** Where the documentation says a copy goes, as text. Nothing here is run. */
  places?: { scope: string; path: (slug: string) => string }[];
  note: string;
};

export const USAGE_GUIDES: Record<string, UsageGuide> = {
  skill: {
    what: 'A directory of instructions and supporting files that Claude Code loads when a task matches its description.',
    documentedFor: 'Claude Code',
    docs: 'https://code.claude.com/docs/en/skills',
    places: [
      { scope: 'Project', path: (slug) => `.claude/skills/${slug}/` },
      { scope: 'Personal', path: (slug) => `~/.claude/skills/${slug}/` },
    ],
    note: 'A skill directory can bundle scripts. The Files section names them; read each one before copying the directory.',
  },
  plugin: {
    what: 'A bundle of skills, commands, subagents, hooks or MCP servers that Claude Code installs as one unit.',
    documentedFor: 'Claude Code',
    docs: 'https://code.claude.com/docs/en/plugins',
    note: 'Plugins are added through a marketplace from inside Claude Code. Installing one enables every component it contains, hooks and MCP servers included.',
  },
  mcp_server: {
    what: 'A declaration of a Model Context Protocol server: a program a client starts, or a URL it connects to, for tools and data.',
    documentedFor: 'Claude Code and other MCP clients',
    docs: 'https://code.claude.com/docs/en/mcp',
    note: 'Adding a local server runs its command on your machine with your permissions. Read the command and the source it starts.',
  },
  command: {
    what: 'A prompt file that runs when you type its name after a slash.',
    documentedFor: 'Claude Code',
    docs: 'https://code.claude.com/docs/en/slash-commands',
    places: [
      { scope: 'Project', path: (slug) => `.claude/commands/${slug}.md` },
      { scope: 'Personal', path: (slug) => `~/.claude/commands/${slug}.md` },
    ],
    note: 'A command can grant tools through allowed-tools. The capability section lists every grant this file declares.',
  },
  hook: {
    what: 'Configuration that runs a command when a Claude Code event fires, such as before a tool call.',
    documentedFor: 'Claude Code',
    docs: 'https://code.claude.com/docs/en/hooks',
    note: 'A hook runs on every matching event without asking each time. Read every command it names before copying the configuration.',
  },
  agent: {
    what: 'A separate assistant with its own system prompt and tool access that Claude Code can hand a task to.',
    documentedFor: 'Claude Code',
    docs: 'https://code.claude.com/docs/en/sub-agents',
    places: [
      { scope: 'Project', path: (slug) => `.claude/agents/${slug}.md` },
      { scope: 'Personal', path: (slug) => `~/.claude/agents/${slug}.md` },
    ],
    note: 'A subagent with no tools field inherits every tool the main conversation has. The file body is its system prompt.',
  },
};
