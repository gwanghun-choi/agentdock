/**
 * The longest real description measured in the sampled corpus is 1,077
 * characters, which is useless in a meta tag and pushes against the layout
 * requirement. Truncating belongs here with the other escaping guarantees rather
 * than being rediscovered on each page that renders a meta description.
 *
 * Escaping is NOT done here: the framework escapes text children and attribute
 * values it renders, and the metadata API goes through that same path. Escaping
 * twice would produce visible entities. `src/components/escaping.test.tsx`
 * proves the framework's escaping at all three sinks.
 */
export const META_DESCRIPTION_MAX = 200;

export function metaDescription(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  if (trimmed.length <= META_DESCRIPTION_MAX) return trimmed;
  // Code points, not code units: a byte or unit cut can split an emoji in half.
  return `${[...trimmed].slice(0, META_DESCRIPTION_MAX - 1).join('')}…`;
}
