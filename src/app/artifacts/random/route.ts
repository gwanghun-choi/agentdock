import type { DockKind } from '@/components/dockBoard';
import { detailHref } from '@/components/hrefs';
import { TYPE_FILTER_IDS } from '@/components/typeFilters';
import { HIDDEN_UNLESS_ASKED } from '@/db/queries/language';
import { randomListedPackage } from '@/db/queries/packages';
import { errorCode } from '@/ingest/errors';
import { log } from '@/log';

/**
 * One artifact of a kind, by chance: a GET that redirects, so it is a plain link that needs
 * no script and works on every screen. Nothing is written, and the only input reaching the
 * query is a kind from the fixed list. With no row to go to, the listing says so itself.
 */
export async function GET(request: Request) {
  const type = new URL(request.url).searchParams.get('type') ?? '';
  const known = TYPE_FILTER_IDS.includes(type as DockKind);
  // A read that fails ends on the listing, which has its own words for a database that is down.
  const row = known
    ? await randomListedPackage(type, HIDDEN_UNLESS_ASKED).catch((error) => {
        log({ event: 'dock_read_unavailable', code: errorCode(error) });
        return null;
      })
    : null;
  const location = row
    ? detailHref(row.fullName, row.sourcePath, row.type)
    : known
      ? `/artifacts?type=${type}`
      : '/artifacts';
  return new Response(null, {
    status: 307,
    headers: { location, 'cache-control': 'no-store' },
  });
}
