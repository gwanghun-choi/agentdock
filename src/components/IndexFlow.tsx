import type { CSSProperties } from 'react';
import { CommitIcon, DockIcon, FileIcon, RepoIcon } from '@/components/Icon';

/**
 * The home page's signature element: what AgentDock actually does, drawn as the
 * four steps it actually performs, in the vernacular of the thing it reads.
 *
 * It is a git graph. A 2px spine down the left with a node on it per step is how
 * every tool in this subject's world draws a sequence of commits, and this is a
 * sequence: a repository is discovered, its declaring files are located, each is
 * read, and what was read is filed against the sha it was read at. Naming those
 * four steps is the one thing the old hero — a headline, a paragraph and two
 * buttons over 40% empty canvas — never did.
 *
 * <ol>, because the order is real and load-bearing. A screen reader gets "list
 * of 4 items", which is the correct shape of this content; nothing here depends
 * on the animation to be understood, and with CSS off it degrades to a numbered
 * list of four sentences that still reads correctly.
 *
 * Drawn in HTML and CSS, not SVG. An SVG would need its own text metrics, its
 * own font sizes and a second set of breakpoints, and its labels would not
 * reflow — at 390px a 460-unit viewBox renders 10px type at 7.8px, which is the
 * width where a diagram stops being read and starts being decoration. Every
 * label here is real text at the same tokens as the rest of the page, and the
 * spine, the nodes and the travelling pulse are all CSS on ::before/::after.
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
        <p className="flow-note">
          Found by AgentDock itself, from a registry, a curated seed list and GitHub&apos;s topic
          search. Never by request.
        </p>
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
        <p className="flow-note">
          It records what the file declares about itself. It never runs the file, and never writes
          it to disk.
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
