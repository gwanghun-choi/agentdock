import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_TYPE_LABELS, ArtifactBadge } from '@/components/ArtifactBadge';

/**
 * The badge carries artifact type on three channels — shape, word and hue — so
 * that no reader depends on any one of them. These tests are about that
 * property, not about which glyph was chosen.
 */
describe('ArtifactBadge', () => {
  it('gives every known type a glyph as well as a word and a hue', () => {
    for (const [type, label] of Object.entries(ARTIFACT_TYPE_LABELS)) {
      const html = renderToStaticMarkup(<ArtifactBadge type={type} />);
      expect(html, `${type} hue`).toContain(`badge badge-${type}`);
      expect(html, `${type} word`).toContain(label);
      expect(html, `${type} glyph`).toContain('<svg');
    }
  });

  it('draws a different glyph for each type', () => {
    const paths = Object.keys(ARTIFACT_TYPE_LABELS).map((type) =>
      renderToStaticMarkup(<ArtifactBadge type={type} />).replace(/^.*?<svg/s, '<svg'),
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  /** The word is right there. Announcing the glyph too would read the type twice. */
  it('keeps the glyph out of the accessibility tree', () => {
    const html = renderToStaticMarkup(<ArtifactBadge type="skill" />);
    expect(html).toContain('aria-hidden="true"');
  });

  /**
   * A type added to the database before this component knows about it should
   * look unstyled, not invisible — and must not borrow another type's glyph.
   */
  it('renders an unknown type as itself, with no hue and no glyph', () => {
    const html = renderToStaticMarkup(<ArtifactBadge type="something_new" />);
    expect(html).toContain('something_new');
    expect(html).toContain('class="badge"');
    expect(html).not.toContain('<svg');
  });
});
