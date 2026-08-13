import type { CSSProperties } from 'react';
import { CommitIcon, DockIcon, FileIcon, RepoIcon } from '@/components/Icon';

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
 * It is now one horizontal run under the headline, at the full width of the
 * shell: repository → declaring files → AgentDock reads → filed against a
 * commit. A pipeline is a left-to-right object in every tool that draws one, and
 * at this width the four stages are the widest thing on the page rather than the
 * narrowest, which is the right relative size for the one picture that states
 * what the product is.
 *
 * <ol>, because the order is real and load-bearing. A screen reader gets "list
 * of 4 items", which is the correct shape of this content; nothing here depends
 * on the animation to be understood, and with CSS off it degrades to a numbered
 * list of four short sentences that still reads correctly. The connectors and
 * the travelling beam are ::before/::after in the stylesheet, so they cost the
 * markup nothing and vanish cleanly when styles do.
 *
 * ## The prose left
 *
 * Each stage carries a label and at most one short line. The sentences that used
 * to run three lines deep inside the diagram — where a repository is found, that
 * nothing is added by request — are facts about policy rather than about the
 * flow, and they now sit in the trust strip under it and in the discovery gate
 * further down the page. A pipeline stage that needs a paragraph is not a
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
 * hook.ts .claude/settings.json, and command.ts commands/*.md. They are shown
 * as leaf names because that is what a reader recognises; the full paths are on
 * every artifact's own row.
 */
export function IndexFlow({ total }: { total: number }) {
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
          <li>SKILL.md</li>
          <li>plugin.json</li>
          <li>marketplace.json</li>
          <li>.mcp.json</li>
          <li>server.json</li>
          <li>commands/*.md</li>
          <li>settings.json</li>
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
          {/* The count is the one live number on this page and it is the one the
              server already had — countPackages(), the same call the "Browse
              all N artifacts" link below has always used. Nothing new is
              queried for it. The digits count up once on arrival; see
              globals.css, where the mechanism and its ceiling are written down.
              Ungrouped, like the "Browse all {total} artifacts" link it
              restates — CSS counters have no grouping style, so a grouped
              string here and an ungrouped one two sections down would be the
              same number spelled two ways on one page. */}
          <span className="count" style={{ '--target': total } as CSSProperties}>
            {total}
          </span>{' '}
          artifacts indexed right now
        </p>
      </li>
    </ol>
  );
}
