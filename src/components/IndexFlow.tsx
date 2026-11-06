import { artifactTypeLabel } from '@/components/ArtifactBadge';
import { CommitIcon, DockIcon, FileIcon, RepoIcon } from '@/components/Icon';

/** Each declaring file and the kind it declares, in the kind's own hue: the same
 * colours as the hero's docks, so what is read here is what stands on the ring.
 * A catalog has a hue but no dock: the ring's six are the filterable kinds. */
export const DECLARING_FILES = [
  ['SKILL.md', 'skill'],
  ['plugin.json', 'plugin'],
  ['marketplace.json', 'catalog'],
  ['.mcp.json', 'mcp_server'],
  ['server.json', 'mcp_server'],
  ['commands/*.md', 'command'],
  ['agents/*.md', 'agent'],
  ['settings.json', 'hook'],
  ['hooks.json', 'hook'],
] as const;

/**
 * The home page's signature element: what AgentDock actually does, drawn as the
 * four steps it actually performs, in the vernacular of the thing it reads.
 *
 * ## It runs across, not down
 *
 * It was a git graph — a 2px spine down the left with a node per step — sitting
 * in the hero's right-hand column beside the headline. That worked and it read
 * as what it looked like: an explanatory panel in a sidebar. Two columns of
 * roughly equal weight also meant the page opened with two things competing to
 * be looked at first, and the diagram lost every time.
 *
 * It is now a section of its own under the feed, one horizontal run wider than the
 * shell: repository → declaring files → AgentDock reads → filed against a
 * commit. A pipeline is a left-to-right object in every tool that draws one, and
 * at this width the four stages are the widest thing on the page rather than the
 * narrowest, which is the right relative size for the one picture that states
 * what the product is. Under 64rem the line turns and runs down.
 *
 * <ol>, because the order is real and load-bearing. A screen reader gets "list
 * of 4 items", which is the correct shape of this content; nothing here depends
 * on the animation to be understood, and with CSS off it degrades to a numbered
 * list of four short sentences that still reads correctly. The line and its
 * numbered stops are ::before/::after in the stylesheet, so they cost the markup nothing and
 * vanish cleanly when styles do.
 *
 * ## The prose left
 *
 * Each stage carries a label and at most one short line. The sentences that used
 * to run three lines deep inside the diagram — where a repository is found, that
 * nothing is added by request — are facts about policy rather than about the
 * flow, and they now sit in the hero's trust strip, the lede above this diagram
 * and the discovery conditions below it. A pipeline stage that needs a paragraph is not a
 * pipeline stage.
 *
 * Drawn in HTML and CSS, not SVG. An SVG would need its own text metrics, its
 * own font sizes and a second set of breakpoints, and its labels would not
 * reflow — at 390px a 460-unit viewBox renders 10px type at 7.8px, which is the
 * width where a diagram stops being read and starts being decoration. Every
 * label here is real text at the same tokens as the rest of the page.
 *
 * The filenames are the ones the detectors actually match, not a plausible set:
 * src/detect/skill.ts matches SKILL.md, plugin.ts .claude-plugin/plugin.json,
 * catalog.ts .claude-plugin/marketplace.json, mcp.ts .mcp.json and server.json,
 * hook.ts .claude/settings.json and hooks/hooks.json, command.ts commands/*.md and agent.ts
 * agents/*.md. They are shown
 * as leaf names because that is what a reader recognises; the full paths are on
 * every artifact's own row.
 */
export function IndexFlow({ total }: { total: number | null }) {
  return (
    <ol className="flow">
      <li>
        <p className="flow-title">
          <RepoIcon /> A public repository
        </p>
        <p className="flow-note">A registry, a curated seed list, GitHub&apos;s topic search.</p>
      </li>
      <li>
        <p className="flow-title">
          <FileIcon /> The files that declare an artifact
        </p>
        <ul className="flow-files">
          {DECLARING_FILES.map(([file, kind]) => (
            <li key={file}>
              <span className={`flow-file hue-${kind}`}>
                <code>{file}</code> {artifactTypeLabel(kind)}
              </span>
            </li>
          ))}
        </ul>
      </li>
      <li>
        <p className="flow-title">
          <DockIcon /> AgentDock reads each one
        </p>
        {/* "It never runs the file" stays in full. It is the product's central
            claim about itself and IndexFlow.test.tsx asserts this exact
            sentence — of everything the diagram used to say, this is the line
            that is not shortening. */}
        <p className="flow-note">
          What it declares about itself. It never runs the file, and never writes it to disk.
        </p>
      </li>
      <li>
        <p className="flow-title">
          <CommitIcon /> Filed against the commit it read
        </p>
        <p className="flow-count">
          {/* Every indexed artifact the listing predicate admits, the languages the
              listings leave out by default included (page.tsx, `indexed`), from the
              grouped count the page already makes. It counted up on a CSS counter,
              which has no grouping style; the marker on that said to delete the
              pseudo-element at a corpus above ten thousand, and production holds
              44,903 (2026-11-06). Beside "Browse all", which is what the listing
              shows; the line under "Recently indexed" says what the difference is. */}
          <span className="count">{total?.toLocaleString('en-US') ?? '…'}</span> artifacts indexed
          at the last complete sync
        </p>
      </li>
    </ol>
  );
}
