/**
 * Ten rows. A screenful at a typical window, and deliberately not
 * SEARCH_CAPS.pageSize (25) — a placeholder twice the height of the viewport
 * for a wait measured in tens of milliseconds is worse than a short one. The
 * cap is not imported to match it, either: `@/db/queries/search` pulls the
 * database client in at module load, and a placeholder that cannot render
 * without a database is not a placeholder.
 */
const ROWS = 10;

export function RowsPlaceholder() {
  return (
    <>
      <p className="sr-only" role="status">
        Loading artifacts
      </p>
      <ul className="rows" aria-hidden="true">
        {Array.from({ length: ROWS }, (_, index) => `placeholder-${index}`).map((key) => (
          <li key={key}>
            <div className="row-type">
              <span className="skeleton skeleton-badge" />
            </div>
            <div className="row-main">
              <p className="row-title">
                <span className="skeleton skeleton-title" />
              </p>
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-meta" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
