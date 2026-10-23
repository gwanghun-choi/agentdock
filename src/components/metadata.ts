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

/**
 * `fallback` stands in for an absent or blank text. An empty string here also
 * overrode the layout's description, so a page whose artifact declares none —
 * every hook, 22 of the 177 e2e artifacts — shipped no description tag at all
 * (2026-10-23). The fallback is built by the caller from stored facts only.
 */
export function metaDescription(text: string | null | undefined, fallback = ''): string {
  const trimmed = (text ?? '').trim() || fallback;
  if (trimmed.length <= META_DESCRIPTION_MAX) return trimmed;
  // Code points, not code units: a byte or unit cut can split an emoji in half.
  return `${[...trimmed].slice(0, META_DESCRIPTION_MAX - 1).join('')}…`;
}
