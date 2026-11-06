import { artifactTypeLabel } from '@/components/ArtifactBadge';
import { CommitPrint } from '@/components/CommitPrint';

/**
 * This artifact as what it is on this site: one box on a dock, stencilled with the commit it was
 * read at. CSS 3D, three faces, no WebGL and no client code, so a detail page costs no scene: a
 * browser without a GPU draws it as well as one with. Everything on it is on the page in words
 * (the heading, the badge, the glance), so a screen reader skips it.
 */
export function CargoBox({ type, name, sha }: { type: string; name: string; sha: string }) {
  return (
    <div aria-hidden="true" className="cargo" data-tilt="">
      <div className="cargo-body">
        <div className="cargo-face cargo-front">
          <span className="cargo-name">{name}</span>
          <CommitPrint sha={sha} />
          <span className="cargo-sha">{sha.slice(0, 7)}</span>
        </div>
        <div className="cargo-face cargo-side">
          <span>{artifactTypeLabel(type)}</span>
        </div>
        <div className="cargo-face cargo-top" />
      </div>
      <div className="cargo-shadow" />
    </div>
  );
}
