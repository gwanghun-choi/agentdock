# Injection fixtures

Ten crafted bodies plus one real one. Every file here is untrusted Markdown of
the shape a scanned repository can contain, and each has an assertion in
`src/components/SkillBody.test.tsx`.

The eleventh fixture is not in this directory on purpose: it is the actual body
of `skills/algorithmic-art/SKILL.md` from the frozen `anthropics-skills` corpus,
read in place. Six of the hundred real skill files sampled for this phase contain
HTML-ish content, so "no markup reaches the output" has to hold against a
legitimate file and not only against a crafted one — and reading the frozen
capture rather than copying it means the two can never drift apart.

| Fixture | Payload | Assertion |
|---|---|---|
| `script-tag.md` | a script element containing an alert call | neither the element name nor the alert text reaches the output |
| `img-onerror.md` | an image element with an error handler | neither the handler attribute name nor the element name appears |
| `js-url-link.md` | a Markdown link whose target uses the javascript scheme | no link target carries that scheme |
| `data-url-img.md` | a Markdown image whose target is a data URL | no data scheme appears in the output |
| `html-comment.md` | an HTML comment carrying instruction-shaped text | the comment is absent |
| `style-attr.md` | a span carrying an inline style declaration | no style attribute appears |
| `iframe.md` | a frame element pointing at another origin | the element name does not appear |
| `svg-onload.md` | a vector element with a load handler | neither the element name nor the handler appears |
| `nested-encoded.md` | an entity-encoded and case-varied script element | no executable element appears after rendering |
| `bidi-override.md` | a right-to-left override (U+202E) in the body | the character **is present** — surfaced later, never silently stripped |
| *(frozen corpus)* `skills/algorithmic-art/SKILL.md` | a real skill body containing HTML | renders with no image or script element and the prose intact |

## The inverted expectation

`bidi-override.md` asserts presence, not absence. Stripping the character here
would destroy what a later phase needs in order to show it, and would be
indistinguishable downstream from the character never having been there.
