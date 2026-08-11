import { parseJsonManifest } from './json';
import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

export const HOOK_CAPS = {
  /**
   * A hook config is a small event map. This is far below the shared JSON
   * input cap (json.ts's 256 KB) and exists so a hooks.json cannot become the
   * one oversized manifest the generic cap still allows.
   */
  inputBytes: 64 * 1024,
  /** Beyond this many handlers the file is a generated artifact, not a config. */
  maxHandlers: 500,
} as const;

const HOOKS_JSON = 'hooks.json';
const SETTINGS_FILENAME = '.claude/settings.json';

/** <anything>/hooks/<name>.json — a plugin's own hook declaration. */
function isPluginHooksFile(path: string): boolean {
  const segments = path.split('/');
  return segments[segments.length - 1] === HOOKS_JSON && segments[segments.length - 2] === 'hooks';
}

/** <anything>/.claude/settings.json, and the root one — a project's own config. */
function isSettingsJson(path: string): boolean {
  return path === SETTINGS_FILENAME || path.endsWith(`/${SETTINGS_FILENAME}`);
}

function basenameNoExt(path: string): string {
  const base = path.split('/').pop() as string;
  return base.replace(/\.json$/, '');
}

type Handler = { event: string; matcher: unknown; type: unknown; command: unknown };

export const hook: Detector = {
  type: 'hook',

  // Two locations, one detector. A plugin declares hooks in a JSON file
  // directly inside a hooks/ directory; a project declares them under
  // .claude/settings.json's top-level "hooks" key, alongside unrelated
  // settings. Path-only match() cannot tell a settings.json with hooks from
  // one without, so it returns both and parse() decides.
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => e.type === 'blob' && (isPluginHooksFile(e.path) || isSettingsJson(e.path)))
      .map((e) => ({ type: 'hook', sourcePath: e.path, needs: [e.path] }));
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

    // Tighter than the generic JSON_CAPS.inputBytes, checked before parsing —
    // input byte cap before parse, as always. A hook config is small and a
    // large one is not a config.
    const size = Buffer.byteLength(source, 'utf8');
    if (size > HOOK_CAPS.inputBytes) {
      return {
        ok: false,
        status: 'failed',
        errors: [
          `${c.sourcePath} is ${size} bytes, over the hook input cap of ${HOOK_CAPS.inputBytes}`,
        ],
      };
    }

    const parsed = parseJsonManifest(source, c.sourcePath);
    if (!parsed.ok) return { ok: false, status: 'failed', errors: parsed.errors };

    const rawHooks = parsed.data.hooks;
    // No hooks key, or hooks is not an object, or it has no keys: this is not
    // a malformed hook artifact, it is not a hook artifact. A
    // .claude/settings.json carrying only enabledPlugins is common, and
    // silence here is what stops every such repository from showing a
    // phantom hook row.
    if (typeof rawHooks !== 'object' || rawHooks === null || Array.isArray(rawHooks)) {
      return { ok: true, status: 'none', reason: `${c.sourcePath} declares no hooks` };
    }
    const events = Object.keys(rawHooks as Record<string, unknown>);
    if (events.length === 0) {
      return { ok: true, status: 'none', reason: `${c.sourcePath} declares an empty hooks object` };
    }

    // Read from the file, never from a hardcoded list. Claude Code's lifecycle
    // vocabulary spans thirty-plus events and grows between releases; an
    // allowlist here would silently start dropping real hooks on a release
    // nobody here noticed. Tolerant of whatever inner shape arrives (03-
    // RESEARCH.md A1: the project-scope wrapping is CITED but not verbatim-
    // verified) — an event whose value isn't the documented matcher-array
    // shape simply contributes no handlers, not a failure.
    const handlers: Handler[] = [];
    for (const event of events) {
      const matcherEntries = (rawHooks as Record<string, unknown>)[event];
      if (!Array.isArray(matcherEntries)) continue;
      for (const matcherEntry of matcherEntries) {
        const me = (matcherEntry ?? {}) as Record<string, unknown>;
        const inner = Array.isArray(me.hooks) ? me.hooks : [];
        for (const h of inner) {
          const hh = (h ?? {}) as Record<string, unknown>;
          handlers.push({
            event,
            matcher: me.matcher ?? null,
            type: hh.type ?? null,
            // Verbatim. Whether this reaches the network or installs a
            // package is CAP-05, Phase 4. Stored, never interpreted: no
            // splitting on shell metacharacters, no URL extraction, no flag.
            command: hh.command ?? null,
          });
        }
      }
    }

    if (handlers.length > HOOK_CAPS.maxHandlers) {
      return {
        ok: false,
        status: 'failed',
        errors: [
          `${c.sourcePath} declares ${handlers.length} handlers, over the cap of ${HOOK_CAPS.maxHandlers}`,
        ],
      };
    }

    // A hook has no name, no description, and no meaning outside the file it
    // sits in — an event handler is not something a user searches for. The
    // file's basename is the only honest identity, and source_path is the
    // identity key anyway, so two hook files in one repository never collide.
    const name = basenameNoExt(c.sourcePath);
    const scope = isSettingsJson(c.sourcePath) ? 'project' : 'plugin';

    return {
      ok: true,
      status: 'ok',
      warnings: [],
      artifact: {
        name,
        slug: name,
        summary: null,
        licenseText: null,
        declaredVersion: null,
        body: '',
        frontmatter: {},
        meta: { scope, events, hookCount: handlers.length, handlers },
      },
    };
  },
};
