import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { isBundledScript } from '@/analyze/files';
import { ANALYZE_CAPS } from '@/analyze/types';
import { ArtifactBadge, artifactTypeLabel } from '@/components/ArtifactBadge';
import { CapabilityPanel } from '@/components/CapabilityPanel';
import { CopyButton } from '@/components/CopyButton';
import { HiddenContentPanel } from '@/components/HiddenContentPanel';
import {
  detailHref,
  detailTail,
  historyHref,
  permalink,
  permalinkAtLine,
  sourcePathCandidates,
  treeHref,
} from '@/components/hrefs';
import { ExternalIcon } from '@/components/Icon';
import { metaDescription } from '@/components/metadata';
import { SetupPanel } from '@/components/SetupPanel';
import { SkillBody } from '@/components/SkillBody';
import { searchHref } from '@/components/searchState';
import { TYPE_FILTER_LABELS } from '@/components/typeFilters';
import { USAGE_GUIDES } from '@/components/usageGuide';
import { getCapabilityFindings, splitHiddenContent } from '@/db/queries/capabilities';
import {
  getPackageDetail,
  getRelatedPackages,
  getVersionHistory,
  pluginRoot,
  type RelatedPackage,
  VERSION_HISTORY_LIMIT,
} from '@/db/queries/packages';
import { AGENT_SPEC_KEYS } from '@/detect/agent';
import { SPEC_KEYS } from '@/detect/skill';

// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

// Written by hand rather than taken from the generated route-typing helper,
// which needs types that exist only after a build or an explicit generation step.
type Props = { params: Promise<{ owner: string; repo: string; path: string[] }> };

// The label map moved to components/ArtifactBadge.tsx so the badge, this page's
// Type row and any future surface cannot drift apart. Same strings, verbatim
// from the seeded artifact_type.label rows (drizzle/0001, drizzle/0003).

// The File section's closing sentence. Single-line and named, rather than
// inline JSX text broken across lines, so it is one exact, unambiguous
// substring — check-boundaries.mjs's SANCTIONED ledger (rule six,
// no-verdict-vocabulary) excises this precise string before its scan runs,
// per CONTEXT.md Measurement 7. Content unchanged from the sentence this
// page has always shipped; only its representation moved.
const FILE_DISCLAIMER =
  'AgentDock reads this file; it does not run it, and it cannot say whether it is safe.';

// CAP-09's opening sentence, near-verbatim from README.md / PROJECT.md's own
// product claim, because the requirement is that this page and the product
// definition say the same thing. Also on the SANCTIONED ledger.
const CAPABILITY_INTRO =
  'AgentDock reads files and reports what it read. It does not run them, and it cannot say whether an artifact is safe.';

// What this phase measured and nobody knew before. Every line is a fact
// with a number or a mechanism behind it — no legalese, no hedging verb, no
// sentence that could be read as reassurance. The 32 KB figure reads from
// ANALYZE_CAPS.maxBodyChars so it cannot drift out of agreement with the
// cap it describes; every other number here is a one-time measurement
// recorded in CONTEXT.md and not expected to change on its own.
const CAPABILITY_NOT_CHECKED = [
  'AgentDock reads files and does not run them.',
  'Bundled scripts are named, never opened. Nothing here says what one does.',
  'Only the first 32 KB of a file is read. Two of the eighty-four files in the reference ' +
    'sample are longer than that, and the rest of those two was never scanned.',
  'Patterns were checked against a sample of ordinary published artifacts to see how often ' +
    'they raise a false alarm. Nothing here measures how much they miss.',
  'Remote-execution detection and hidden-content detection have never matched anything in ' +
    'that sample, so they are unproven rather than proven quiet.',
  'Re-checking an artifact later uses the same stored excerpt, so a check added in future ' +
    'cannot see what was never stored.',
  // Also on the SANCTIONED ledger.
  'AgentDock cannot tell you whether an artifact is safe.',
];

/** One related artifact: its type, its name as a link, its path. */
function RelatedRow({ fullName, item }: { fullName: string; item: RelatedPackage }) {
  return (
    <li>
      <ArtifactBadge type={item.type} />{' '}
      <Link href={detailHref(fullName, item.sourcePath, item.type)}>{item.name}</Link>{' '}
      <span className="muted path">{item.sourcePath}</span>
    </li>
  );
}

function utc(value: Date | null): string {
  return value ? `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'unknown';
}

export async function generateMetadata({ params }: Props) {
  const { owner, repo, path } = await params;
  // Same cached lookup as the page, so one render pass makes one query.
  const detail = await getPackageDetail(owner, repo, path);
  if (!detail) return { title: 'Not found — AgentDock' };
  // Plain strings. The framework escapes them, and no structured-data block is
  // added: that is the one sink it does not escape.
  const title = `${detail.name} — ${detail.fullName} — AgentDock`;
  const description = metaDescription(
    detail.summary,
    `${artifactTypeLabel(detail.type)} at ${detail.sourcePath} in ${detail.fullName}, as read at commit ${detail.commitSha.slice(0, 7)}.`,
  );
  // Text only: no image is generated, and no URL is emitted because the
  // deployment's own origin is not something this repository records.
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', siteName: 'AgentDock' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function PackagePage({ params }: Props) {
  const { owner, repo, path } = await params;
  const detail = await getPackageDetail(owner, repo, path);
  if (!detail) notFound();
  // One address per artifact. The lookup folds the repository name's case and
  // accepts a skill's SKILL.md, so /r/composiohq/… and …/SKILL.md answered 200
  // with the same page as the address this site links (production, 2026-10-23).
  // A canonical link needs the deployment's origin, which this repository does
  // not record (layout.tsx); a redirect needs none. Compared decoded, so an
  // escape the browser chose differently cannot loop.
  if (
    `${owner}/${repo}` !== detail.fullName ||
    sourcePathCandidates(path)[0] !== detailTail(detail.sourcePath, detail.type)
  ) {
    permanentRedirect(detailHref(detail.fullName, detail.sourcePath, detail.type));
  }

  // Independent reads, one round trip of latency instead of three.
  const [findings, related, history] = await Promise.all([
    getCapabilityFindings(detail.packageVersionId),
    getRelatedPackages(detail),
    getVersionHistory(detail.id),
  ]);
  // The general list and the Hidden Content panel below never show the same
  // row twice — see splitHiddenContent's own doc.
  const { hidden: hiddenFindings, observed: observedFindings } = splitHiddenContent(findings);

  const source = permalink(detail.fullName, detail.commitSha, detail.sourcePath);
  const keys = Array.isArray(detail.meta.frontmatterKeys)
    ? (detail.meta.frontmatterKeys as string[])
    : [];
  // A subagent's documented field set is not a skill's; judging one by the
  // other would call `tools` and `model` unspecified.
  const specKeys: readonly string[] = detail.type === 'agent' ? AGENT_SPEC_KEYS : SPEC_KEYS;
  const extras = keys.filter((k) => !specKeys.includes(k));
  const guide = USAGE_GUIDES[detail.type];
  const typeListing = TYPE_FILTER_LABELS[detail.type as keyof typeof TYPE_FILTER_LABELS];
  // The directory a skill or plugin is, which is what gets copied or installed.
  const directory =
    detail.type === 'skill'
      ? detail.sourcePath.replace(/(^|\/)SKILL\.md$/, '')
      : detail.type === 'plugin'
        ? pluginRoot(detail.sourcePath, detail.meta)
        : null;
  const setup = (
    <SetupPanel
      type={detail.type}
      meta={detail.meta}
      slug={detail.slug}
      argumentHint={detail.argumentHint}
      sourcePath={detail.sourcePath}
      directoryHref={
        directory === null ? null : treeHref(detail.fullName, detail.commitSha, directory)
      }
    />
  );

  const othersShown = related.siblings.length + related.elsewhere.length;
  const othersTotal = related.siblingTotal + related.elsewhereTotal;

  // The page is long — nine sections on a skill, the file itself last — so its
  // sections are named once at the top, as plain fragment links.
  const sections = [
    ['details', 'Details'],
    detail.files.length > 0 ? ['files', 'Files'] : null,
    ['observed', 'Capabilities'],
    ['related', 'Related'],
    // The six types with a usage guide are the six SetupPanel renders for.
    guide ? ['setup', 'Setup'] : null,
    guide ? ['usage', 'Using it'] : null,
    ['versions', 'Versions'],
    ['file', 'File'],
  ].filter((entry) => entry !== null);

  return (
    <>
      {/* Where this page sits: the listing, this type's listing (catalog has
          none — the search route does not filter on it), the repository, then
          this artifact. Every step is a page a reader can go back up to. */}
      <nav aria-label="Breadcrumb" className="crumbs">
        <ol>
          <li>
            <Link href="/artifacts">Artifacts</Link>
          </li>
          {typeListing ? (
            <li>
              <Link href={`/artifacts?type=${detail.type}`}>{typeListing}</Link>
            </li>
          ) : null}
          <li>
            <Link href={`/r/${detail.fullName}`}>{detail.fullName}</Link>
          </li>
          <li aria-current="page">{detail.name}</li>
        </ol>
      </nav>

      {/* One shell for all seven types: badge, name, repository, description, then
          the two links a reader reaches for. Nothing here is skill-specific —
          the type-conditional parts are further down: the usage guide, which
          reads its type's entry from usageGuide.ts, and the frontmatter row's
          field set. */}
      <div className="detail-head">
        <ArtifactBadge type={detail.type} />
        <h1>{detail.name}</h1>
        <p className="repo-line">
          <Link href={`/r/${detail.fullName}`}>{detail.fullName}</Link>
          <span aria-hidden="true">/</span>
          <span className="path">{detail.sourcePath}</span>
        </p>
        {detail.summary ? <p className="lede">{detail.summary}</p> : null}
        <div className="detail-actions">
          {/* Both leave AgentDock, and both say so with the same icon — §16's
              internal/external distinction, made visible rather than implied. */}
          <a href={source} rel="noopener noreferrer" target="_blank">
            <ExternalIcon /> View this file at commit {detail.commitSha.slice(0, 7)}
          </a>
          <a
            href={`https://github.com/${detail.fullName}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalIcon /> Repository on GitHub
          </a>
        </div>
      </div>

      <nav aria-label="On this page" className="toc">
        <ul>
          {sections.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <dl className="facts" id="details">
        <dt>Type</dt>
        <dd>{artifactTypeLabel(detail.type)}</dd>

        <dt>Source repository</dt>
        <dd>
          <Link href={`/r/${detail.fullName}`}>{detail.fullName}</Link>
        </dd>

        <dt>Licence, declared in the file</dt>
        {/* The measured corpus writes free prose here, not an identifier, so it
            is shown as the author's text and never faceted. */}
        <dd>{detail.licenseText ?? 'not declared'}</dd>

        <dt>Licence, detected by GitHub</dt>
        {/* Null on the reference repository, so the honest-unknown path is the
            common path rather than the edge case. */}
        <dd>{detail.licenseSpdx ?? 'not detected'}</dd>

        <dt>Declared version</dt>
        <dd>{detail.declaredVersion ?? 'not declared'}</dd>

        <dt>Last changed upstream</dt>
        <dd>{detail.pushedAt ? detail.pushedAt.toISOString().slice(0, 10) : 'unknown'}</dd>

        <dt>Last read by AgentDock</dt>
        {/* Deliberately a separate row from the one above. Collapsing the two
            would be a false freshness claim. */}
        <dd>{utc(detail.scannedAt)}</dd>

        <dt>GitHub stars</dt>
        {/* GitHub's number, labelled as GitHub's. Never an AgentDock signal.
            Digit-grouped for the same reason the repository page and the
            listing rows group it: it is a number to read, not to parse. */}
        <dd>{detail.stars.toLocaleString('en-US')}</dd>

        {/* The three long values, together and last.

            Above 64rem the short facts sit two to a row; these three carry a
            path, a URL and a sentence, and half a column is not enough for any
            of them — they take the full width instead (`fact-long`, see
            globals.css). Grouping them here is also what makes that layout
            fall out on its own: the eight short pairs above fill exactly four
            two-up rows, so each of these starts a row of its own with no gap
            left behind it.

            Path moved down from beside "Source repository" to join them. It is
            a location, like the permalink under it, and it is the one short-
            looking fact that is routinely long. */}
        <dt>Path in repository</dt>
        <dd className="path fact-long">
          {detail.sourcePath} <CopyButton label="Copy path" value={detail.sourcePath} />
        </dd>

        <dt>Permalink</dt>
        <dd className="fact-long">
          <a href={source} rel="noopener noreferrer" target="_blank" className="path">
            {source}
          </a>{' '}
          <CopyButton label="Copy link" value={source} />
        </dd>

        <dt>Frontmatter fields</dt>
        <dd className="fact-long">
          {extras.length === 0
            ? 'Uses only specification fields.'
            : `Also declares ${extras.join(', ')}, which the specification does not define.`}
        </dd>
      </dl>

      {detail.parseErrors.length > 0 ? (
        <>
          <h2>What AgentDock observed while reading this file</h2>
          <ul className="notes muted">
            {detail.parseErrors.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      ) : null}

      {detail.parseStatus === 'failed' ? (
        <p className="error">
          AgentDock could not read this file's frontmatter. The excerpt below is the raw file as it
          was found.
        </p>
      ) : null}

      {detail.files.length > 0 ? (
        <>
          <h2 id="files">Files</h2>
          <p className="muted">
            The files this artifact owns in the tree AgentDock already read — a skill&apos;s or a
            plugin&apos;s directory, or the single file a command, hook or MCP configuration is. No
            additional GitHub request. A bundled script is named and never opened.
          </p>
          <table className="files">
            <thead>
              <tr>
                <th>Path</th>
                <th>Size</th>
                <th>Type</th>
                <th>Executable</th>
              </tr>
            </thead>
            <tbody>
              {detail.files.map((f) => (
                <tr key={f.path}>
                  <td className="path">
                    {f.path}
                    {isBundledScript(f.path) ? (
                      <span className="muted"> — not analyzed</span>
                    ) : null}
                  </td>
                  <td>{f.size === null ? 'unknown' : f.size}</td>
                  <td>{f.kind}</td>
                  <td>{f.executable ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.files.length >= ANALYZE_CAPS.maxInventoryEntries ? (
            <p className="muted">
              Only the first {ANALYZE_CAPS.maxInventoryEntries} files are listed; the rest were not
              recorded.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="anchor" id="observed" />
      <CapabilityPanel
        findings={observedFindings}
        analyzedAt={detail.analyzedAt}
        permalinkFor={(f) =>
          permalinkAtLine(detail.fullName, detail.commitSha, f.sourcePath, f.startLine)
        }
      />

      <HiddenContentPanel
        findings={hiddenFindings}
        permalinkFor={(f) =>
          permalinkAtLine(detail.fullName, detail.commitSha, f.sourcePath, f.startLine)
        }
      />

      <h2>What AgentDock does not check</h2>
      <p className="muted">{CAPABILITY_INTRO}</p>
      <ul className="notes muted">
        {CAPABILITY_NOT_CHECKED.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {/* Every relation here is a stored fact, said as what it is — a
          directory under a plugin root, or the same repository — and never a
          similarity score. The last line hands the name to the search route,
          which already has a measured ranking (search.eval.test.ts), rather
          than ranking "similar" artifacts with a second, unmeasured one. */}
      <h2 id="related">Related artifacts</h2>
      {related.container || related.components.length > 0 || related.siblings.length > 0 ? (
        <p className="muted">
          Linked by directory: an artifact whose path sits under a plugin&apos;s root. A plugin.json
          that points a component somewhere else is not followed, so such a component is not listed
          here.
        </p>
      ) : null}
      {related.container || related.components.length > 0 ? (
        <ul className="notes">
          {related.container ? (
            <li>
              Inside the plugin{' '}
              <Link href={detailHref(detail.fullName, related.container.sourcePath, 'plugin')}>
                {related.container.name}
              </Link>
            </li>
          ) : null}
          {related.components.map((c) => (
            <RelatedRow fullName={detail.fullName} item={c} key={`${c.type}:${c.sourcePath}`} />
          ))}
        </ul>
      ) : null}
      {related.siblings.length > 0 ? (
        <>
          <h3>Other components of the same plugin</h3>
          <ul className="notes">
            {related.siblings.map((c) => (
              <RelatedRow fullName={detail.fullName} item={c} key={`${c.type}:${c.sourcePath}`} />
            ))}
          </ul>
        </>
      ) : null}
      {related.elsewhere.length > 0 ? (
        <>
          <h3>Elsewhere in {detail.fullName}</h3>
          <ul className="notes">
            {related.elsewhere.map((c) => (
              <RelatedRow fullName={detail.fullName} item={c} key={`${c.type}:${c.sourcePath}`} />
            ))}
          </ul>
        </>
      ) : null}
      <p className="muted">
        {othersShown < othersTotal
          ? `Showing ${othersShown} of the ${othersTotal} other listed artifacts in this repository, by type and name. `
          : othersTotal === 0 && related.components.length === 0 && !related.container
            ? 'No other listed artifact in this repository. '
            : ''}
        <Link href={`/r/${detail.fullName}`}>Every artifact in {detail.fullName}</Link>
        {typeListing ? (
          <>
            {' · '}
            <Link
              href={searchHref({ q: detail.name, types: [detail.type], capabilities: [], page: 1 })}
            >
              Search {typeListing} for &ldquo;{detail.name}&rdquo;
            </Link>
          </>
        ) : null}
      </p>

      {guide ? setup : null}

      {guide ? (
        <>
          <h2 id="usage">Using this kind of artifact</h2>
          <p className="muted">
            About the type, from its documentation — not about this file. AgentDock does not install
            or run anything; read the file at the linked commit first.
          </p>
          <dl className="facts install">
            <dt>What it is</dt>
            <dd>{guide.what}</dd>
            <dt>Format documented by</dt>
            <dd>
              {guide.documentedFor} —{' '}
              <a href={guide.docs} rel="noopener noreferrer" target="_blank">
                <ExternalIcon /> documentation
              </a>
            </dd>
            {guide.places?.map((place) => (
              <div key={place.scope} style={{ display: 'contents' }}>
                <dt>{place.scope} copy</dt>
                <dd>
                  <code>{place.path(detail.slug)}</code>{' '}
                  <CopyButton label="Copy path" value={place.path(detail.slug)} />
                </dd>
              </div>
            ))}
            <dt>Before you copy it</dt>
            <dd>{guide.note}</dd>
          </dl>
        </>
      ) : null}

      <h2 id="versions">Versions</h2>
      <p className="muted">
        One row per distinct content AgentDock stored for this file, latest first. Content that
        returns to an earlier version moves that row back to the top, so this is what the file has
        been, not every commit that touched it. GitHub keeps that list:{' '}
        <a
          href={historyHref(detail.fullName, detail.commitSha, detail.sourcePath)}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalIcon /> commits to this file, up to the one shown
        </a>
        .
      </p>
      <table className="files">
        <thead>
          <tr>
            <th>Commit</th>
            <th>Content</th>
            <th>Recorded</th>
            <th>Declared version</th>
            <th>Read</th>
            <th>Analyzed</th>
          </tr>
        </thead>
        <tbody>
          {history.versions.map((v) => (
            <tr key={v.id}>
              <td className="path">
                <a
                  href={permalink(detail.fullName, v.commitSha, detail.sourcePath)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {v.commitSha.slice(0, 7)}
                </a>
                {v.id === detail.packageVersionId ? <span className="muted"> — shown</span> : null}
              </td>
              {/* The value that makes this row distinct, shortened as a commit is. */}
              <td className="path" title={v.contentHash}>
                {v.contentHash.slice(0, 12)}
              </td>
              <td>{utc(v.ingestedAt)}</td>
              <td>{v.declaredVersion ?? 'not declared'}</td>
              <td>{v.parseStatus}</td>
              <td>{v.analyzedAt ? 'yes' : 'not analyzed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {history.total > history.versions.length ? (
        <p className="muted">
          Showing the latest {VERSION_HISTORY_LIMIT} of {history.total}; the rest are not listed.
        </p>
      ) : null}

      <h2 id="file">File</h2>
      <p className="muted">
        An excerpt of{' '}
        <a href={source} rel="noopener noreferrer" target="_blank">
          {detail.sourcePath}
        </a>{' '}
        as published by {detail.fullName}, at commit {detail.commitSha.slice(0, 7)}.{' '}
        {FILE_DISCLAIMER}
      </p>
      <div className="body">
        {detail.body ? <SkillBody markdown={detail.body} /> : <p className="muted">No body.</p>}
      </div>
    </>
  );
}
