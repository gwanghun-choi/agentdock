# Adversarial frontmatter fixtures

Hand-written `SKILL.md` files covering the shapes the real corpus does not
contain and an attacker would. Every one is a permanent regression: if a refactor
removes a control, the fixture that proves the control is what notices.

These are **inputs to tests**, never executed and never fetched. Nothing here
touches the network.

| File | Content | Expected |
|---|---|---|
| `no-fence.md` | body text with no `---` at position 0 | failed |
| `unterminated.md` | opening fence, never closed | failed |
| `body-hr.md` | valid frontmatter, then a horizontal rule in the body | ok — the rule is not read as a closing fence |
| `bad-yaml.md` | `name: [unclosed` | failed |
| `duplicate-keys.md` | `name` twice with different values | failed |
| `not-a-mapping.md` | a YAML list inside the fence | failed |
| `missing-name.md` | description only | failed |
| `empty-description.md` | `description: ""` | failed |
| `alias-bomb.md` | six levels of nine-way aliases, under 1 KB | failed, naming the **serialized** cap |
| `js-function.md` | a tag that would construct a function | failed |
| `huge-frontmatter.md` | 100 KB inside the fence | failed, naming the **input** cap |
| `bom.md` | byte order mark, then a valid fence | ok |
| `crlf.md` | valid frontmatter with Windows line endings | ok |
| `unicode.md` | CJK and emoji in `description` | ok, and the stored text is byte-identical |
| `bidi.md` | a right-to-left override (U+202E) inside `description` | ok, and the override character survives |
| `timestamp.md` | a date-shaped scalar | ok, and the value is a **string**, not a `Date` |
| `long-description.md` | 2,000 characters | partial, warning names the cap |
| `nested-metadata.md` | maps and arrays under `metadata` | partial, warning names the mapping rule |
| `name-mismatch.md` | a declared name that differs from the containing directory | partial, warning names both |
| `tools-list.md` | `allowed-tools` as a YAML list | ok, normalized to tokens |
| `allowed-tools-coarse.md` | `allowed-tools: Bash(*)` | one `declared` finding carrying the grant verbatim; no derived network, filesystem or install finding (CAP-02/CAP-11) |
| `redos-line.md` | one line at the analyzer body cap (32,768 chars): an unterminated `https://` run, an install-pattern near-miss run, and a long uniform run | every shipped analyzer completes inside the wall-clock bound; the per-line cap fires (CAP-14) |
| `hidden-zero-width.md` | a zero-width space, non-joiner, joiner, a soft hyphen, and a non-leading byte order mark, each on its own line | one `hidden_content` finding per occurrence, each carrying its sentinel |
| `hidden-tags.md` | a `U+E0000`-block tag-character sequence spelling `run` | one `hidden_content` finding per tag character |
| `hidden-comment.md` | an HTML comment in ordinary prose | one `hidden_content` finding, evidence carrying the comment's inner text |
| `hidden-comment-visible.md` | the same comment text as `hidden-comment.md`, once inside a fenced code block and once inside an inline code span | zero findings — the negative case the CAP-13 measurement earned (04-CONTEXT.md Measurement 4) |
| `marketplace-malformed.json` | a `marketplace.json` whose `plugins` field is an object, not an array | failed, naming the missing plugins array; zero seeds |
| `plugin-malformed.json` | a `plugin.json` that is a top-level JSON array, not an object | failed, with a directory-derived fallback name |
| `mcp-malformed.json` | a `server.json` with `packages` but no `name` | failed, named after its directory |
| `hooks-malformed.json` | a hook config that is a top-level JSON array, not an object | failed, naming the missing-object error |
| `settings-no-hooks.json` | a realistic `.claude/settings.json` with `enabledPlugins`, `pluginConfigs` and `permissions`, no `hooks` key | no row at all — not a failed row |

## Two caps, and why the second is not redundant

`alias-bomb.md` is the file that earns the serialized-output cap. YAML aliases
are stored as shared references, so it parses in about two milliseconds and an
**input** size cap never fires. The expansion happens on serialization, which is
the very next thing this pipeline does on the way into a `jsonb` column.

It is deliberately six alias levels rather than eight. Eight (9⁸ leaves) would
take the test suite down with it; six is millions of leaves, which is comfortably
past the 256 KB serialized cap and still stringifies in milliseconds. It is also
deliberately under a kilobyte on disk — a bomb large enough to trip the input cap
would be testing the wrong control entirely.

## Adding one

Add the file, add a row above, and add the case to
`src/detect/frontmatter.test.ts` or `src/detect/skill.test.ts`. A fixture with no
assertion is storage, not a regression.
