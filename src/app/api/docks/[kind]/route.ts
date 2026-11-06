import type { DockExample, DockKind } from '@/components/dockBoard';
import { detailHref } from '@/components/hrefs';
import { TYPE_FILTER_IDS } from '@/components/typeFilters';
import { HIDDEN_UNLESS_ASKED } from '@/db/queries/language';
import { listPackages } from '@/db/queries/packages';
import { errorCode } from '@/ingest/errors';
import { log } from '@/log';

const SHOWN = 3;
// A repository read in one go writes many rows, and three rows of one would be one
// repository three times. Twelve rows is what it takes to find a second and a third.
const READ = 12;

/**
 * Real rows for the home panel, for the kind in focus. Read-only, and the kind is the only
 * input. Here and not in the page because the page's data comes from one snapshot the sync
 * publishes, so that a home view costs one read (Phase 93): six more listing queries there
 * would be paid by every visitor, whether or not a dock ever came into focus. From the CDN
 * this costs at most one read per kind per six hours, and a sync changes it twice a day.
 * In the listing's own order: nothing here is a ranking.
 */
export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!TYPE_FILTER_IDS.includes(kind as DockKind)) return new Response(null, { status: 404 });
  try {
    const rows = await listPackages({
      type: kind,
      limit: READ,
      hiddenLanguages: HIDDEN_UNLESS_ASKED,
    });
    const repositories = new Set<string>();
    const examples: DockExample[] = [];
    for (const row of rows) {
      if (repositories.has(row.fullName)) continue;
      repositories.add(row.fullName);
      examples.push({
        id: row.id,
        name: row.name,
        fullName: row.fullName,
        href: detailHref(row.fullName, row.sourcePath, row.type),
      });
      if (examples.length === SHOWN) break;
    }
    return Response.json(examples, {
      headers: {
        'cache-control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    log({ event: 'dock_read_unavailable', code: errorCode(error) });
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
