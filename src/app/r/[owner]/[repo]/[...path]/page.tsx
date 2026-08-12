import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isBundledScript } from '@/analyze/files';
import { ArtifactBadge, artifactTypeLabel } from '@/components/ArtifactBadge';
import { CapabilityPanel } from '@/components/CapabilityPanel';
import { HiddenContentPanel } from '@/components/HiddenContentPanel';
import { ExternalIcon } from '@/components/Icon';
import { metaDescription } from '@/components/metadata';
import { SkillBody } from '@/components/SkillBody';
import { getCapabilityFindings, splitHiddenContent } from '@/db/queries/capabilities';
import { getPackageDetail, permalink, permalinkAtLine } from '@/db/queries/packages';
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
  return {
    title: `${detail.name} — ${detail.fullName} — AgentDock`,
    description: metaDescription(detail.summary),
  };
}

export default async function PackagePage({ params }: Props) {
  const { owner, repo, path } = await params;
  const detail = await getPackageDetail(owner, repo, path);
  if (!detail) notFound();

  const findings = await getCapabilityFindings(detail.packageVersionId);
  // The general list and the Hidden Content panel below never show the same
  // row twice — see splitHiddenContent's own doc.
  const { hidden: hiddenFindings, observed: observedFindings } = splitHiddenContent(findings);

  const source = permalink(detail.fullName, detail.commitSha, detail.sourcePath);
  const keys = Array.isArray(detail.meta.frontmatterKeys)
    ? (detail.meta.frontmatterKeys as string[])
    : [];
  const extras = keys.filter((k) => !SPEC_KEYS.includes(k as (typeof SPEC_KEYS)[number]));

  // Text only. Nothing here is executed, and no line pipes a download into a shell.
  const install = [
    { runtime: 'Claude Code (project)', text: `.claude/skills/${detail.slug}/` },
    { runtime: 'Claude Code (personal)', text: `~/.claude/skills/${detail.slug}/` },
  ];

  return (
    <>
      {/* One shell for all six types: badge, name, repository, description, then
          the two links a reader reaches for. Nothing here is skill-specific —
          the only type-conditional block on this page is Install, further down,
          and it stays conditional. */}
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

      <dl className="facts">
        <dt>Type</dt>
        <dd>{artifactTypeLabel(detail.type)}</dd>

        <dt>Source repository</dt>
        <dd>
          <Link href={`/r/${detail.fullName}`}>{detail.fullName}</Link>
        </dd>

        <dt>Path in repository</dt>
        <dd className="path">{detail.sourcePath}</dd>

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
        {/* GitHub's number, labelled as GitHub's. Never an AgentDock signal. */}
        <dd>{detail.stars}</dd>

        <dt>Permalink</dt>
        <dd>
          <a href={source} rel="noopener noreferrer" target="_blank" className="path">
            {source}
          </a>
        </dd>

        <dt>Frontmatter fields</dt>
        <dd>
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
          <h2>Files</h2>
          <p className="muted">
            Every file AgentDock found alongside this artifact&apos;s manifest, from the tree it
            already read — no additional GitHub request. A bundled script is named and never opened.
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
        </>
      ) : null}

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

      {detail.type === 'skill' ? (
        <>
          <h2>Install</h2>
          <p className="muted">
            Copy the skill directory from the source repository to one of these paths. AgentDock
            does not install anything for you.
          </p>
          <dl className="facts install">
            {install.map((i) => (
              <div key={i.runtime} style={{ display: 'contents' }}>
                <dt>{i.runtime}</dt>
                <dd>
                  <code>{i.text}</code>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <h2>File</h2>
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
