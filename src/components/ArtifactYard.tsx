'use client';

import Link from 'next/link';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactBadge, artifactTypeLabel } from '@/components/ArtifactBadge';
import { CommitPrint } from '@/components/CommitPrint';
import { ArrowRightIcon } from '@/components/Icon';
import { TYPE_FILTER_IDS, TYPE_FILTER_LABELS } from '@/components/typeFilters';
import { type YardRow, yardBerths, yardCounts } from '@/components/yard';

/**
 * The most recently read artifacts, one box each, standing with the repository they came from.
 * A reader can run along them and read what each is; a kind can be picked out. Fetched from the
 * CDN when the section comes near the window, so the first screen pays nothing for it and a
 * reader who never scrolls here sends no request. With no script the section's own link to the
 * listing is what is there, which is all this is a way into.
 *
 * Every box is a real link. One tab stop for the whole yard, arrows inside it, so a keyboard does
 * not walk 240 links to reach the next section.
 */
export function ArtifactYard({ total }: { total: number | null }) {
  const root = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<YardRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<YardRow | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  // Read at the press, before the press itself has picked the box (a focus lands first).
  const shownAtPress = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        seen.disconnect();
        fetch('/api/yard')
          .then((r) => (r.ok ? (r.json() as Promise<YardRow[]>) : Promise.reject()))
          .then(setRows)
          .catch(() => setFailed(true));
      },
      { rootMargin: '600px' },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  const berths = useMemo(() => yardBerths(rows ?? []), [rows]);
  const counts = useMemo(() => yardCounts(rows ?? []), [rows]);
  const shown = picked ?? rows?.find((row) => !only || row.type === only) ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const boxes = [
      ...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a.yard-box:not([data-off])'),
    ];
    const at = boxes.indexOf(document.activeElement as HTMLAnchorElement);
    const next = boxes[at + step];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  if (failed || (rows && rows.length === 0)) {
    return (
      <div className="yard" ref={root}>
        <p className="muted">
          {failed ? 'AgentDock could not read this just now.' : 'Nothing has been read yet.'}{' '}
          <Link href="/artifacts">Browse all artifacts</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="yard" ref={root}>
      {/* What this is a sample of, in words: a cap says what it dropped. */}
      <p className="yard-scope">
        {rows
          ? `The ${rows.length} artifacts read most recently${total ? `, of ${total.toLocaleString('en-US')} listed` : ''}, in ${berths.length} ${berths.length === 1 ? 'repository' : 'repositories'}. One box is one artifact. Boxes stand together when they come from the same repository, and that is the only relation drawn.`
          : 'One box is one artifact. Boxes stand together when they come from the same repository.'}
      </p>
      <p aria-live="polite" className="sr-only">
        {only && rows
          ? `${counts[only] ?? 0} of ${rows.length} boxes are ${TYPE_FILTER_LABELS[only as keyof typeof TYPE_FILTER_LABELS]}.`
          : ''}
      </p>
      <fieldset className="yard-kinds">
        <legend className="sr-only">Pick out one kind</legend>
        <button aria-pressed={only === null} onClick={() => setOnly(null)} type="button">
          All kinds
        </button>
        {TYPE_FILTER_IDS.filter((id) => counts[id]).map((id) => (
          <button
            aria-pressed={only === id}
            className={`hue-${id}`}
            key={id}
            onClick={() => {
              setOnly(only === id ? null : id);
              setPicked(null);
            }}
            type="button"
          >
            {TYPE_FILTER_LABELS[id]} <span>{counts[id]}</span>
          </button>
        ))}
      </fieldset>
      <div className="yard-floor">
        <div className={`yard-readout hue-${shown?.type ?? 'skill'}`}>
          {shown ? (
            <>
              <ArtifactBadge type={shown.type} />
              <p className="yard-name">{shown.name}</p>
              <Link className="yard-repo" href={`/r/${shown.fullName}`} prefetch={false}>
                {shown.fullName}
              </Link>
              <p className="yard-summary">{shown.summary ?? 'No description in the file.'}</p>
              {shown.commitSha ? (
                <p className="yard-commit">
                  <CommitPrint sha={shown.commitSha} />
                  <code>{shown.commitSha.slice(0, 7)}</code>
                </p>
              ) : null}
              <Link className="yard-open" href={shown.href} prefetch={false}>
                Open {shown.name} <ArrowRightIcon />
              </Link>
            </>
          ) : (
            <p className="yard-name">Reading the yard…</p>
          )}
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the arrow keys belong to the links inside, and this is where they bubble to. */}
        <div className="yard-map" onKeyDown={onKeyDown}>
          {rows === null ? <div className="yard-pending" /> : null}
          <ul className="yard-berths">
            {berths.map((berth) => (
              <li className="yard-berth" key={berth.fullName}>
                <Link
                  className="yard-berth-name"
                  href={`/r/${berth.fullName}`}
                  prefetch={false}
                  tabIndex={-1}
                  title={berth.fullName}
                >
                  {berth.fullName}
                </Link>
                <span className="yard-boxes">
                  {berth.rows.map((row) => (
                    <Link
                      aria-hidden={only && row.type !== only ? true : undefined}
                      className={`yard-box hue-${row.type}${shown?.id === row.id ? ' is-picked' : ''}`}
                      data-off={only && row.type !== only ? '' : undefined}
                      href={row.href}
                      key={row.id}
                      onClick={(event) => {
                        // No hover to read a box by: the first touch shows it, the link under
                        // the words opens it. Detail 0 is a key, which means this one, now.
                        if (
                          event.detail !== 0 &&
                          matchMedia('(hover: none)').matches &&
                          !shownAtPress.current
                        ) {
                          event.preventDefault();
                          setPicked(row);
                        }
                      }}
                      onFocus={() => setPicked(row)}
                      onPointerDown={() => {
                        shownAtPress.current = shown?.id === row.id;
                      }}
                      onPointerEnter={(event) => {
                        // A finger crossing a box on its way down the page is not reading it.
                        if (event.pointerType === 'mouse') setPicked(row);
                      }}
                      prefetch={false}
                      tabIndex={shown?.id === row.id ? 0 : -1}
                    >
                      <span className="sr-only">
                        {artifactTypeLabel(row.type)}: {row.name}, in {row.fullName}
                      </span>
                    </Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
