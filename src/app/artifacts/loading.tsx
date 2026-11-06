import { RowsPlaceholder } from '@/components/RowsPlaceholder';

/**
 * What the browse and search route looks like before its queries return.
 *
 * This is the ONLY loading.tsx in the application, and that is a decision, not
 * an omission. A `loading.tsx` at `src/app/` would have covered every route,
 * and a loading boundary makes the response stream — which changes the status
 * code a `notFound()` can produce. Measured, on this tree:
 *
 *     with src/app/loading.tsx     /r/nobody/nothing -> 200, /jobs/999999 -> 200
 *     without it                   /r/nobody/nothing -> 404, /jobs/999999 -> 404
 *
 * Next says as much in its own not-found reference — 200 for a streamed
 * response, 404 for a non-streamed one. AgentDock is a public index whose
 * missing-artifact page must stay a real 404, so the three routes that call
 * `notFound()` — both `/r/**` pages and `/jobs/[id]` — deliberately have no
 * loading boundary above them. This route calls `notFound()` nowhere; its
 * zero-result states are pages in their own right.
 *
 * The heading and the scope sentence are absent rather than faked. They are
 * static strings the route always renders identically, but reproducing them
 * here would be a second copy to keep in step with the real one, and a skeleton
 * that quietly drifts out of agreement with the page it stands in for is worse
 * than one that shows less. The rows are what takes the time and the rows are
 * what is drawn.
 *
 * The placeholders are not decoration, they hold the layout still. The bars are
 * the heights the real title, description and metadata lines will be, inside
 * the same two-column grid the real rows use, so the content that arrives lands
 * where the placeholder already was instead of shoving the page down under a
 * reader who has started moving the cursor. Nothing inside it fades or slides
 * in, for the same reason; arriving from another section, the whole page —
 * this placeholder included — gets the page transition (template.tsx), which
 * moves a snapshot and lays out nothing.
 *
 * `aria-hidden` on the list, with one live line beside it: to a screen reader
 * ten identical rows of nothing is worse than silence, and "Loading artifacts"
 * is the entire content of this state.
 *
 * The rows themselves are in RowsPlaceholder, which the home feed uses too.
 */
export default function ArtifactsLoading() {
  return <RowsPlaceholder />;
}
