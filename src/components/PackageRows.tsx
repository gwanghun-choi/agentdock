import Link from 'next/link';
import { detailHref, type PackageListItem, permalink } from '@/db/queries/packages';

/**
 * Dense bordered rows, not cards. Two lines per item so twenty fit on a laptop
 * screen: a title line and a metadata line, with the description clamped between
 * them. The path is never clamped — a truncated path is a useless path.
 */
export function PackageRows({
  items,
  showRepo = true,
}: {
  items: PackageListItem[];
  showRepo?: boolean;
}) {
  return (
    <ul className="rows">
      {items.map((p) => (
        <li key={p.id}>
          <p className="row-title">
            <Link href={detailHref(p.fullName, p.sourcePath, p.type)}>{p.name}</Link>
            {showRepo ? <span className="muted">{p.fullName}</span> : null}
          </p>
          {p.summary ? <p className="row-desc">{p.summary}</p> : null}
          <p className="row-meta">
            <span className="path">{p.sourcePath}</span>
            {p.scannedAt ? <span>read {p.scannedAt.toISOString().slice(0, 10)}</span> : null}
            {p.commitSha ? (
              <a
                href={permalink(p.fullName, p.commitSha, p.sourcePath)}
                rel="noopener noreferrer"
                target="_blank"
              >
                source
              </a>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
