/**
 * The artifacts route's URL state — query, type, capabilities, sort, page — and
 * the one builder every link on that page goes through: the filter chips, the
 * sort links, the applied-filter removals, the pager and the empty-state exits.
 *
 * Moved out of `src/app/artifacts/page.tsx` so it can be tested without a
 * database: that route imports `@/db/queries/search`, which opens the client at
 * module load. Pure string work only — validation of the ids stays in the route,
 * which can see `ARTIFACT_TYPE_IDS` and `CAPABILITY_FILTER_IDS`.
 */
export type SearchState = {
  q: string;
  types: readonly string[];
  capabilities: readonly string[];
  /** Absent means the default for `q` — see defaultSort. */
  sort?: string;
  page: number;
};

/**
 * The order a result list takes when the URL names none: relevance beside a
 * query, and with no query — where every row ranks the same — the recency
 * order browsing has always had.
 */
export function defaultSort(q: string): 'relevance' | 'recent' {
  return q ? 'relevance' : 'recent';
}

/**
 * Parameter order is fixed (q, type, cap, sort, page) so one state has one URL,
 * and the default sort is left out, so a URL from before sorting existed is
 * still the URL of the same state.
 */
export function searchHref({ q, types, capabilities, sort, page }: SearchState): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  for (const t of types) params.set('type', t);
  for (const c of capabilities) params.append('cap', c);
  if (sort && sort !== defaultSort(q)) params.set('sort', sort);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/artifacts?${qs}` : '/artifacts';
}

/**
 * The state a type chip links to: that one type, or none when it is the one
 * already applied. Always page 1 — a page number belongs to a result set, and
 * changing a filter makes a different one.
 */
export function withType(state: SearchState, type: string | null): SearchState {
  return { ...state, types: type === null || state.types.includes(type) ? [] : [type], page: 1 };
}

/** A sort link reorders the same set, from its first page. */
export function withSort(state: SearchState, sort: string): SearchState {
  return { ...state, sort, page: 1 };
}

/** A capability chip toggles its own id and leaves the others alone. */
export function toggleCapability(state: SearchState, cap: string): SearchState {
  const capabilities = state.capabilities.includes(cap)
    ? state.capabilities.filter((c) => c !== cap)
    : [...state.capabilities, cap];
  return { ...state, capabilities, page: 1 };
}

/**
 * The page links to print: the first, the last, and the current page with one
 * neighbour each side, with `null` where a run of pages is skipped. A gap of
 * exactly one page prints that page instead of an ellipsis standing in for it.
 *
 *   pageWindow(1, 7)  -> [1, 2, null, 7]
 *   pageWindow(5, 9)  -> [1, null, 4, 5, 6, null, 9]
 *   pageWindow(3, 7)  -> [1, 2, 3, 4, null, 7]
 */
export function pageWindow(page: number, last: number): (number | null)[] {
  const wanted = new Set([1, last, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const p of pages) {
    const prev = out.at(-1);
    if (typeof prev === 'number' && p - prev === 2) out.push(p - 1);
    else if (typeof prev === 'number' && p - prev > 2) out.push(null);
    out.push(p);
  }
  return out;
}
