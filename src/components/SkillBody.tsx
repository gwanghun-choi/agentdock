import type { Schema } from 'hast-util-sanitize';
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
      }}
    >
      {markdown}
    </Markdown>
  );
}
