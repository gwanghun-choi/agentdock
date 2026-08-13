import Link from 'next/link';
import { SearchIcon } from '@/components/Icon';
import { TYPE_FILTER_IDS, TYPE_FILTER_LABELS } from '@/components/typeFilters';

/**
 * The command palette, at the size the answer is worth.
 *
 * It is a launcher, not a second search surface. There is no result list in
 * here, no fetch, no ranking and no empty state: a query typed here submits to
 * `/artifacts`, which is the one route that knows how to search — same GET, same
 * `q` parameter, same server query, same page. The failure mode a palette
 * usually has, two search implementations that drift apart, is absent by
 * construction because there is only one.
 *
 * A native `<dialog>` opened with `showModal()`, which is where the accessibility
 * comes from rather than from a component library: the top layer, the modal
 * backdrop, the focus trap, the inert background and Escape-to-close are all the
 * platform's, and none of them is re-implemented here. The close control is a
 * `<form method="dialog">`, so it closes with no JavaScript at all.
 *
 * This is a Server Component. It renders markup and nothing else — the whole
 * client cost of the palette is the `showModal()` call in SearchHotkey.tsx.
 *
 * No `maxLength` on this field, deliberately, unlike the one on `/artifacts`:
 * reading `SEARCH_CAPS` here would pull `@/db/queries/search` — and with it the
 * database client, which parses the environment at module load — into the root
 * layout's module graph, on every route including the ones `next build`
 * prerenders without a DATABASE_URL. The cap is enforced where it matters, in
 * `normalizeQuery` on the route this submits to.
 */
export function SearchLauncher() {
  return (
    <dialog aria-label="Search artifacts" className="launcher" id="search-launcher">
      <form action="/artifacts" className="launcher-form" method="get">
        <label className="sr-only" htmlFor="launcher-q">
          Search artifacts
        </label>
        <span className="field">
          <SearchIcon />
          {/* autoFocus, which is usually the wrong answer and here is the only
              one. showModal() has already moved focus into the dialog before
              this element is seen; all this decides is which control inside it
              receives that focus, and the reader pressed a key whose entire
              purpose was to put their cursor in this field. Without it they
              land on the dialog and have to tab into the box they asked for. */}
          <input
            autoFocus
            id="launcher-q"
            name="q"
            placeholder="Name, description, repository or path"
            type="search"
          />
        </span>
        <button type="submit">Search</button>
      </form>
      {/* Jump straight to a kind, without typing anything.

          These are plain links to `/artifacts?type=…` — the same URL the
          artifacts page's own radio group produces when you pick that type, and
          the same one the address bar shows afterwards. No new parameter, no
          new predicate, no ranking: the launcher still knows nothing about
          searching and still has exactly one job, which is getting a reader to
          the route that does.

          A nav, not a list of buttons: every one of them is a destination. That
          also means they are in the dialog's tab order for free, after the field
          and its submit, which is the order they are read in. */}
      <nav aria-label="Browse by type" className="launcher-quick">
        {TYPE_FILTER_IDS.map((id) => (
          <Link href={`/artifacts?type=${id}`} key={id}>
            {TYPE_FILTER_LABELS[id]}
          </Link>
        ))}
      </nav>
      {/* A div, not a <p>: a form is not phrasing content and cannot legally sit
          inside a paragraph. */}
      <div className="launcher-hint">
        <span>Enter opens the full result list on the artifacts page.</span>
        <form method="dialog">
          <button type="submit">Close</button>
        </form>
      </div>
    </dialog>
  );
}
