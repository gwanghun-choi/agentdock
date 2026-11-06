import { detailHref } from '@/components/hrefs';
import type { YardRow } from '@/components/yard';
import { HIDDEN_UNLESS_ASKED } from '@/db/queries/language';
import { listPackages } from '@/db/queries/packages';
import { errorCode } from '@/ingest/errors';
import { log } from '@/log';

// Enough to show repositories side by side, and small enough to send: about 240 rows of this
// shape gzip to tens of kilobytes. The section says it is this many, of how many, and which.
const ROWS = 240;
const SUMMARY_CHARS = 160;

/**
 * The home page's yard: the rows read most recently, in the listing's own order. Read-only, no
 * input, and off the CDN for the reason `/api/docks/[kind]` is: the page's data comes from one
 * snapshot so a home view costs one read, and this costs at most one read per six hours, fetched
 * only by a reader who scrolls to it. Nothing here is a ranking.
 */
export async function GET() {
  try {
    const rows = await listPackages({ limit: ROWS, hiddenLanguages: HIDDEN_UNLESS_ASKED });
    const yard: YardRow[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      fullName: row.fullName,
      href: detailHref(row.fullName, row.sourcePath, row.type),
      summary:
        row.summary && row.summary.length > SUMMARY_CHARS
          ? `${row.summary.slice(0, SUMMARY_CHARS)}…`
          : row.summary,
      commitSha: row.commitSha,
    }));
    return Response.json(yard, {
      headers: {
        'cache-control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    log({ event: 'dock_read_unavailable', code: errorCode(error) });
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
