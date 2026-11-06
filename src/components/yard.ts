/** One artifact in the yard, as `/api/yard` sends it. */
export type YardRow = {
  id: number;
  name: string;
  type: string;
  fullName: string;
  href: string;
  summary: string | null;
  commitSha: string | null;
};

export type YardBerth = { fullName: string; rows: YardRow[] };

/**
 * Rows by the repository they were read from, in the order the listing met each: the only
 * relation drawn here is the stored one, the same repository. Nothing is placed by similarity.
 */
export function yardBerths(rows: readonly YardRow[]): YardBerth[] {
  const berths = new Map<string, YardRow[]>();
  for (const row of rows) {
    const berth = berths.get(row.fullName);
    if (berth) berth.push(row);
    else berths.set(row.fullName, [row]);
  }
  return [...berths].map(([fullName, list]) => ({ fullName, rows: list }));
}

/** How many of each kind are in the yard, for the chips' own counts. */
export function yardCounts(rows: readonly YardRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1;
  return counts;
}
