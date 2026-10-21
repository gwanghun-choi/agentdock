import type { Schema } from 'hast-util-sanitize';
import type { ComponentProps } from 'react';
import Markdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/**
 * Narrowed from the GitHub-flavoured default. Every deviation is deliberate.
 *
 *  - Images and the responsive-image elements are removed. The default permits
 *    any HTTPS source, which leaks a visitor's address and a load signal to a
 *    host the artifact's author chose; the source-set attribute additionally has
 *    no scheme restriction in the default schema. The policy blocks remote images
 *    anyway, so keeping them would produce broken images plus console noise.
 *  - Links gain relationship and target attributes, which the default omits, so
 *    the component override below can actually set them.
 *
 * Everything else is left at the default on purpose: it is an allowlist with
 * scheme restrictions, comments and doctypes off, and identifier clobbering
 * prevented. Rewriting it by hand would be replacing a reviewed control with an
 * unreviewed one.
 */
const schema: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => t !== 'img' && t !== 'source' && t !== 'picture',
  ),
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'rel', 'target'],
  },
};

/**
 * A leading YAML frontmatter block, shown as what it is. The stored body keeps
 * it — finding line numbers count from the file's first line — but Markdown
 * reads `---`, the keys, then `---` as a rule followed by one giant setext
 * heading (U1). As a fenced `yaml` block it stays visible and stays text. The
 * fence is one backtick longer than any run inside, so a frontmatter value
 * holding ``` cannot close it early.
 */
function fenceFrontmatter(markdown: string): string {
  // The first line must be a `key:`. Without it a body opening on a `---` rule
  // had everything up to its next rule — title and all — fenced as yaml.
  const match = /^---\r?\n([A-Za-z_][\w-]*:[\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(markdown);
  if (!match) return markdown;
  const longestRun = Math.max(0, ...(match[1].match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}yaml\n${match[1]}\n${fence}\n${markdown.slice(match[0].length)}`;
}

/**
 * The body sits under the page's own `<h2>File</h2>`, so its headings start
 * two levels down: an author's `# Title` was a second `<h1>` on the page, and
 * the outline read as two documents (U2). h5 and h6 both land on h6, the
 * last level there is.
 */
const demote = (Tag: 'h3' | 'h4' | 'h5' | 'h6') =>
  function Demoted({ node: _node, ...props }: { node?: unknown } & ComponentProps<'h3'>) {
    return <Tag {...props} />;
  };

/**
 * A Server Component. Nothing untrusted crosses into a Client Component, and no
 * raw-markup construction exists anywhere in this path.
 *
 * The primary control is structural: with no raw-HTML plugin, HTML in the source
 * is never parsed into element nodes at all — a script tag in a body is a text
 * node. The sanitizer is the second layer, kept so this is still right in month
 * six if someone adds a plugin.
 */
export function SkillBody({ markdown }: { markdown: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, schema]]}
      // The URL transform is left at its default, which permits only http,
      // https, mailto, irc, ircs, xmpp and relative targets. Overriding it is the
      // one documented way to reintroduce injection into this component.
      components={{
        a: ({ node: _node, ...props }) => (
          <a {...props} rel="noopener noreferrer nofollow ugc" target="_blank" />
        ),
        // `.body pre` scrolls horizontally, and a region that scrolls with no
        // way to focus it is unreachable by keyboard — WCAG 2.1.1. axe-core
        // reported it as a serious violation on both mobile runs over the
        // reference artifact, on three separate code blocks; it was the only
        // violation a 28-run sweep found anywhere.
        //
        // This is an override on the React side, applied after rehype-sanitize
        // has already run. It adds no tag and no attribute to the allowlist —
        // the schema above is untouched, and a `tabindex` written by an author
        // in a body is still stripped before this ever sees the node.
        //
        // The linter objects, and this is the case its rule does not cover. Its
        // concern is inert elements in the tab order; a <pre> that scrolls is
        // not inert — it holds content a reader can only reach by scrolling it,
        // and focus is the only way a keyboard reaches a scroll container.
        // Removing the attribute makes axe's scrollable-region-focusable fail
        // again, which is a measured WCAG failure traded for a lint heuristic.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable <pre> must be focusable — WCAG 2.1.1, measured by axe-core.
        pre: ({ node: _node, ...props }) => <pre {...props} tabIndex={0} />,
        h1: demote('h3'),
        h2: demote('h4'),
        h3: demote('h5'),
        h4: demote('h6'),
        h5: demote('h6'),
      }}
    >
      {fenceFrontmatter(markdown)}
    </Markdown>
  );
}
