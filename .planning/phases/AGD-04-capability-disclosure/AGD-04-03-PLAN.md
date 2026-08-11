---
phase: AGD-04-capability-disclosure
plan: 03
type: execute
wave: 3
depends_on: ["04-02"]
files_modified:
  - src/analyze/hidden.ts
  - src/analyze/hidden.test.ts
  - src/analyze/markup.ts
  - src/analyze/markup.test.ts
  - src/analyze/index.ts
  - src/analyze/types.ts
  - src/components/HiddenContentPanel.tsx
  - src/components/HiddenContentPanel.test.tsx
  - src/components/SkillBody.test.tsx
  - src/app/r/[owner]/[repo]/[...path]/page.tsx
  - src/db/queries/capabilities.ts
  - src/ingest/persist.test.ts
  - fixtures/adversarial/hidden-zero-width.md
  - fixtures/adversarial/hidden-tags.md
  - fixtures/adversarial/hidden-comment.md
  - fixtures/adversarial/hidden-comment-visible.md
  - fixtures/adversarial/README.md
  - fixtures/capability-precision.md
autonomous: true
requirements: [CAP-06, CAP-07, CAP-13, QUA-03, QUA-05]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "A skill whose description carries a right-to-left override is flagged, and the page names the character rather than removing it"
    - "An HTML comment inside a fenced code block produces no finding, and neither does one inside an inline code span"
    - "An HTML comment in prose produces one finding, and the panel shows its inner text as escaped plain text"
    - "The raw bytes survive: package_version.body still holds the invisible codepoint after the finding exists"
    - "A leading byte order mark is not reported as hidden content; a byte order mark anywhere else is"
    - "Every hidden-content finding renders with a visible sentinel naming the codepoint, so the panel is never itself invisible"
    - "src/components/SkillBody.tsx is unmodified, and its two hidden-content assertions still assert exactly what they asserted before"
    - "No hidden-content finding is described with a word of judgment"
  artifacts:
    - path: "src/analyze/markup.ts"
      provides: "A bounded line-based tracker for the two Markdown constructs that make text visible — the fenced block and the inline code span — with its approximation and its bias stated"
      exports: ["markupRegions", "isInCode", "MarkupState"]
      min_lines: 55
    - path: "src/analyze/hidden.ts"
      provides: "The codepoint classes and the fence-aware HTML-comment rule, with sentinel substitution done at analysis time so no render sink can forget it"
      exports: ["observedHiddenContent", "sentinelize", "HIDDEN_CLASSES", "HIDDEN_VERSION"]
      min_lines: 90
    - path: "src/components/HiddenContentPanel.tsx"
      provides: "A pure component that renders findings as escaped JSX text nodes with no Markdown parsing anywhere in its path"
      exports: ["HiddenContentPanel"]
      min_lines: 45
  key_links:
    - from: "src/analyze/hidden.ts"
      to: "src/analyze/markup.ts"
      via: "the comment rule asks whether the match sits in a construct the renderer shows, and skips it if so"
      pattern: "isInCode"
    - from: "src/components/HiddenContentPanel.tsx"
      to: "src/analyze/hidden.ts"
      via: "the panel renders the sentinel text the analyzer already produced; it performs no substitution of its own"
      pattern: "evidenceText"
    - from: "src/app/r/[owner]/[repo]/[...path]/page.tsx"
      to: "src/components/HiddenContentPanel.tsx"
      via: "a separate panel beside SkillBody, never through it"
      pattern: "HiddenContentPanel"
---

<objective>
Make the content a reader cannot see visible, without touching the component
whose entire safety argument is that it never parses markup.

Purpose: `SkillBody.test.tsx:92-95` asserts today that a right-to-left override
survives into the DOM, and documents the reason as *"it is surfaced later, never
stripped"*. Surfaced later has never been built. So the character is in the page
and invisible to a human, which is exactly the failure mode CAP-06 and CAP-07
exist to close. Meanwhile `SkillBody.test.tsx:52-56` asserts that an HTML
comment's text is dropped from the render entirely — and that is correct, is the
XSS control Phase 1 shipped, and must not be undone.

Both facts point the same way: detection reads storage, rendering reads the
render, and the two paths must stay structurally separate. Raw bytes are already
retained losslessly in `package_version.body`, so half of CAP-07 is already true
by construction. What is missing is the visible sentinel, and it goes in a panel
of its own.

This plan also carries the one design decision the phase's own measurement
forced. A naive HTML-comment pattern was measured at 26 false positives out of
26 against the real render and deleted before any code existed. What ships here
is a different rule making a different claim, and it gets its own row in the
precision record and dies by the same line if it fails.

Output: `src/analyze/markup.ts`, `src/analyze/hidden.ts`, four new adversarial
fixtures, `HiddenContentPanel.tsx`, and a precision row.

Honours the CONTEXT.md decisions that fence-awareness applies to the HTML-comment
class and to nothing else, that hidden-styled HTML does not ship and the
measurement is why, that `SkillBody.tsx` is not modified, and that wording stays
factual and never says malicious.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-04-capability-disclosure/CONTEXT.md
@.planning/phases/AGD-04-capability-disclosure/04-02-SUMMARY.md
@src/analyze/types.ts
@src/analyze/lines.ts
@src/analyze/index.ts
@src/components/SkillBody.tsx
@src/components/SkillBody.test.tsx
@src/components/JobPanel.tsx
@src/app/r/[owner]/[repo]/[...path]/page.tsx
@src/db/queries/capabilities.ts
@fixtures/adversarial/README.md
@fixtures/capability-precision.md
</context>

<decisions_made_while_planning>

**1. The panel is additive. `SkillBody.tsx` is not modified, and the mechanism —
not the convenience — is why.**

`04-PATTERNS.md` reaches this conclusion and it holds under inspection. The raw
bytes are retained at the **storage** sink (`skill.ts:124`,
`body: source.slice(0, MAX_BODY)`, over the unmodified raw file); the comment is
dropped at the **render** sink. Detection reads storage. The two paths never
meet, so nothing has to be re-parsed, re-enabled or re-sanitized to satisfy
CAP-07 — the panel reads the same column the renderer reads and draws a
different conclusion from it.

The shortest path to "show the hidden content" is to enable `rehype-raw` for one
view. That reopens the injection vector Pitfall 3 closed, and
`check-boundaries.mjs`'s `no-raw-html` rule already fails CI on it, so the wrong
answer is mechanically unavailable rather than merely discouraged.

What does change is the standing of two existing assertions. `:52-56` (comment
text absent from the render) and `:92-95` (U+202E survives the render) now
together prove that the new panel is the **only** place a user can see this
content. A comment is added above them saying so. The assertions themselves are
not touched, and a plan that edits either has reopened Pitfall 3 by definition.

**2. Sentinel substitution happens in the analyzer, not in the panel.**

If the finding stored raw bytes and the panel substituted at render, then every
future render sink — a future API, a future export, a log line someone adds —
would have to remember to substitute, and the panel's own failure mode would be
rendering invisibly. Substituting in `hidden.ts` makes it a pure function with a
unit test and makes the panel a dumb text renderer.

Raw-byte retention is unaffected and separately asserted: `package_version.body`
still holds the original codepoint after the finding exists. That is the half of
CAP-07 the storage layer already satisfies, and the test says so out loud rather
than assuming it.

**3. Fence and code-span awareness is a bounded line tracker, not a Markdown
parser, and the bias is toward under-reporting.**

Two options were considered and one rejected. `remark-parse` would classify
`html` versus `code` and `inlineCode` nodes exactly and is already installed
transitively through `react-markdown` — but using it means declaring a new
runtime dependency, and, more decisively, it means running an unbounded AST parse
over untrusted input inside the ingest path. `mdast` offers no cap doctrine, and
CAP-14 is the requirement that says every scan of hostile bytes is bounded by
construction. A line tracker is bounded by the same `maxLineChars` every other
analyzer uses.

The tracker is therefore an approximation of CommonMark, and its errors go one
way: a construct it misreads as code produces **no** finding rather than a false
one. That bias is the right one here specifically because the measurement that
opened this phase was a 100% false-positive rate on this exact class — and
because the codepoint classes, which are fence-blind, are the ones that catch
actual concealment.

**4. Fence-awareness is scoped to the HTML-comment class and nothing else.**

A zero-width character inside a fenced block is still invisible, so the codepoint
scan ignores fences entirely. A `curl … | sh` inside a fence is still a directive
the reader is meant to run, so 04-02's detectors ignore them too. What a fence
changes is whether *markup* is parsed, and exactly one class of hidden content is
markup. Any drift of fence logic into another analyzer is a regression.

**5. Hidden-styled HTML does not ship, and the measurement is recorded rather
than the omission.**

`04-RESEARCH.md` §Q7 lists `display:none` / `font-size:0` / a bare `hidden`
attribute as a class. Measured over the 84 real bodies: zero style-based hits and
one `hidden` attribute, and that one is
`<div role="tabpanel" ... hidden>` in an accessibility skill's own example — a
legitimate ARIA pattern. A rule with one hit, that hit being a false positive,
and no true positive anywhere is a 100% rate on a sample of one. It gets a row in
the precision record with the verdict, so the next person does not rediscover it
as a gap.

**6. The corpus regression pins the code-span half of the rule to a real file.**

A fence-only rule would report `anthropics-skills skills/pptx/SKILL.md:15` — an
`<!-- Slide number: N -->` sitting in a table cell, which looks like prose until
you notice it is wrapped in backticks and therefore rendered visibly. The test
asserts zero findings at that exact path and line. It is the one place in 84
files where the code-span half of the rule is the only thing standing between the
shipped detector and a false positive.

</decisions_made_while_planning>

<reference>

## Reference A — `src/analyze/markup.ts`

Two constructs, both tracked with a linear scan, both bounded.

**Fenced block.** A line matching `^\s{0,3}(?:```|~~~)` toggles the state, and the
fence line itself counts as inside. This is the same bounded, anchored shape as
`frontmatter.ts:19`'s `FENCE` — anchored at position zero, nothing to backtrack.

**Inline code span.** Within one line, backtick runs delimit code. A scan over the
line's characters tracks whether the current offset sits between an odd and an
even backtick run. No regex, no lookahead — this is the same "one linear pass, no
regex" posture `plugin.ts:75` states for paths, applied to characters.

```ts
/**
 * Whether the renderer will show this offset as literal text.
 *
 * An approximation of CommonMark, deliberately. remark-parse would classify
 * exactly, and is rejected twice over: it is a new declared runtime dependency,
 * and it is an unbounded AST parse over untrusted bytes inside the ingest path,
 * which is the surface CAP-14 exists to bound.
 *
 * Errors go one way on purpose. A construct misread as code yields NO finding
 * rather than a false one — the right bias, because the naive version of this
 * rule measured 26 false positives out of 26 against the real render, and
 * because the codepoint classes that catch actual concealment do not consult
 * this function at all.
 *
 * Known ceilings, stated rather than discovered: a fence opened with a longer
 * backtick run than its closer, and a code span containing an escaped backtick.
 * Both under-report.
 */
export function isInCode(state: MarkupState, line: string, offset: number): boolean;
```

## Reference B — `src/analyze/hidden.ts`

**The codepoint classes.** Fence-blind, scanned per line after the per-line cap:

| class | codepoints | sentinel |
|---|---|---|
| zero width | `U+200B` ZWSP, `U+200C` ZWNJ, `U+200D` ZWJ, `U+FEFF` **non-leading** | `[U+200B ZERO WIDTH SPACE]` |
| bidi control | `U+202A`–`U+202E`, `U+2066`–`U+2069` | `[U+202E RIGHT-TO-LEFT OVERRIDE]` |
| Unicode tag | `U+E0000`–`U+E007F` | `[U+E0041 UNICODE TAG]` |
| soft hyphen | `U+00AD` | `[U+00AD SOFT HYPHEN]` |

Character-class checks and a codepoint range comparison — arithmetic, not
parsing. `04-RESEARCH.md`'s Don't-Hand-Roll table is explicit that a Unicode
security library buys nothing over eight range comparisons and costs
supply-chain surface for a solved, bounded problem.

**`U+FEFF` at offset 0 of the body is a byte order mark, not concealment**, and
produces nothing. `frontmatter.ts:23` strips it into a local variable only, so it
survives into the stored body as the first character of line 1;
`fixtures/adversarial/bom.md` is the negative case that proves the exemption is
positional and not a blanket skip of the codepoint.

**The HTML-comment rule.** `<!--[\s\S]*?-->` — non-greedy with a required fixed
terminator, the reviewed shape `frontmatter.ts:19` already ships, so the safety
argument is cited rather than re-derived. A match is a finding only when
`isInCode` says the renderer will not show it.

**`sentinelize(text)`** replaces every hidden codepoint in a string with its
sentinel and returns the result. The finding's `evidenceText` is the
sentinel-substituted line, capped at `maxEvidenceChars`. That is what makes the
panel a dumb renderer and stops a future sink from rendering the panel itself
invisibly.

**Wording.** `summary` is factual and names the construct:
`contains a Unicode bidirectional control character (U+202E)`,
`contains an HTML comment the page does not display`. Never *malicious*, never
*suspicious*, never *attack*. Hidden content is not malice, and the panel's job
is to let the reader decide.

## Reference C — the fixtures

Four new files in the flat `fixtures/adversarial/` directory, each with a row in
that directory's README table, per its own stated rule: *"A fixture with no
assertion is storage, not a regression."* **Nothing goes under
`fixtures/<slug>/files/`** — `skill.test.ts`'s measured `COUNTS` table iterates
those directories.

| file | content | expected |
|---|---|---|
| `hidden-zero-width.md` | ZWSP, ZWNJ, ZWJ and a soft hyphen in the body, and a non-leading `U+FEFF` | one finding per occurrence, each with its line and its sentinel |
| `hidden-tags.md` | a `U+E0000`-block sequence spelling an instruction | one finding per tag character |
| `hidden-comment.md` | an HTML comment in ordinary prose | one finding, inner text shown escaped |
| `hidden-comment-visible.md` | the same comment text inside a fenced block, and again inside an inline code span | **zero** findings — the negative case the measurement earned |

Two fixtures already on disk join the suite unchanged: `bidi.md` (a `U+202E` in
`description`, and the analyzer must find it there — the frontmatter fence is
part of `body`) and `bom.md` (leading `U+FEFF`, zero findings).

## Reference D — `src/components/HiddenContentPanel.tsx`

`JobPanel.tsx` is the analog, **not** `SkillBody.tsx`. Its docstring states the
property this needs: *"Pure: it takes two rows, holds nothing and reaches nothing
— no database, no router, no server function. That is what lets every state
below, including the two that are dishonest by default, be asserted in a suite
that runs where there is neither a database nor a browser."*

And its rendering idiom is the whole security argument: `JobPanel.tsx:83` renders
`attempt.errorDetail`, untrusted-adjacent text, as a bare JSX child. React
escapes it. There is no sanitizer because nothing is parsed as markup.

The panel takes `findings: CapabilityFindingView[]` and renders, per finding: the
class label, the line number as a link to `permalinkAtLine(...)`, and the
sentinel-substituted evidence inside a `<code>` element. No Markdown, no
`dangerouslySetInnerHTML`, no `rehype-raw`, no icon, no colour.

Its test uses `renderToStaticMarkup` and string assertions, the harness
`SkillBody.test.tsx:20-22` already established — no testing-library, no jsdom.

## Reference E — the page, and the comment on the two assertions

`page.tsx` gains one section between the existing observations block and the
`File` block. It renders only when hidden-content findings exist; the general
`not detected` / `not analyzed` states belong to 04-04's panel and are not
duplicated here.

The section's own muted sentence states the mechanism plainly and without a
verdict: this content is present in the file and the rendered body above does not
show it — for a comment, because the renderer drops it; for an invisible
character, because it has no visible form.

In `src/components/SkillBody.test.tsx`, add a comment above the two existing
assertions naming the load they now carry — together they are the proof that the
Hidden Content panel is the only place a user can see this content, so changing
either reopens Pitfall 3. **Add the comment. Change nothing else in that file,
and change nothing at all in `SkillBody.tsx`.**

## Reference F — the precision rows

Two rows appended to `fixtures/capability-precision.md`:

- `hidden_content` (shipped): hits over the four corpora, hand-checked, rate.
  Expected zero hits — zero codepoint occurrences, and zero comments surviving
  the fence-and-code-span rule. Recorded as "0 hits on real data; precision
  untested, not proven clean", the same honest phrasing the remote-execution row
  uses.
- `hidden_style` (**not shipped**): 1 hit, 1 hand-checked, 1 false positive,
  100%, verdict deleted — with the hit named
  (`wshobson-agents … screen-reader-testing/SKILL.md:464`, an ARIA `tabpanel`
  example). A rule deleted with no row is a rule the next person reintroduces.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Detect what the page does not show, and nothing it does</name>
  <files>src/analyze/markup.ts, src/analyze/markup.test.ts, src/analyze/hidden.ts, src/analyze/hidden.test.ts, src/analyze/index.ts, src/analyze/types.ts, fixtures/adversarial/hidden-zero-width.md, fixtures/adversarial/hidden-tags.md, fixtures/adversarial/hidden-comment.md, fixtures/adversarial/hidden-comment-visible.md, fixtures/adversarial/README.md, fixtures/capability-precision.md</files>
  <behavior>
    - A zero-width space, a zero-width non-joiner, a zero-width joiner and a soft hyphen each yield one finding carrying their codepoint, line and column.
    - A U+FEFF at offset 0 of the body yields no finding; the same character later in the body yields one.
    - The existing bidi.md fixture yields one finding for the U+202E inside its description, because the frontmatter fence is part of body.
    - A U+E0000-block character yields one finding per character.
    - An HTML comment in ordinary prose yields one finding whose evidence carries the comment's inner text.
    - The same comment text inside a fenced code block yields no finding, and inside an inline code span yields no finding.
    - Over the four frozen corpora the hidden-content analyzer yields zero findings, and specifically zero at anthropics-skills skills/pptx/SKILL.md line 15 — the one hit a fence-only rule would report.
    - Every finding's evidence text contains its sentinel and contains no raw invisible codepoint, so the evidence itself cannot render invisibly.
    - No finding's summary contains a word of judgment.
    - A body of 32 KB consisting entirely of zero-width characters yields at most maxFindingsPerDetector findings and reports the overflow.
  </behavior>
  <action>
    Apply References A, B, C and the shipped half of F.

    Write the fence-and-code-span negative test before the comment rule. The
    naive version of this rule was measured at 26 false positives out of 26
    against the real render and deleted before this plan existed; the test that
    stops it coming back is the one asserting the corpora produce zero, with the
    pptx table-cell line named explicitly. That single line is where the
    code-span half of the rule earns its place — a fence-only rule reports it and
    is wrong.

    Track fences and code spans with a linear scan, not a Markdown parser.
    remark-parse would classify exactly and is rejected twice: a new declared
    runtime dependency, and an unbounded AST parse over untrusted bytes in the
    ingest path, which is the surface CAP-14 bounds. Say both reasons in the
    file, and say that the tracker's errors under-report rather than over-report.

    Consult the code tracker from the comment rule only. A zero-width character
    inside a fenced block is still invisible, so the codepoint scan must not ask.
    Assert that: a zero-width character inside a fence still produces a finding.

    Exempt a byte order mark by position, not by codepoint. The character
    survives into the stored body because frontmatter.ts strips it into a local
    variable only; at offset 0 it is a byte order mark and at any other offset it
    is concealment. bom.md is the negative case and it already exists.

    Substitute sentinels in the analyzer, not at render. A finding whose evidence
    still holds the raw invisible character makes the panel's own output
    invisible, and every future sink would have to remember the substitution.
    Assert that no evidence string contains a raw invisible codepoint.

    Keep the wording factual. Name the construct and the codepoint. Hidden
    content is not malice — an author can leave a zero-width character in a file
    by accident, and the panel's job is to let the reader decide, not to decide
    for them.

    Record both precision rows, including the hidden-style rule that does not
    ship. Its single corpus hit is an ARIA tabpanel example in an accessibility
    skill, which makes it a rule with one hit, that hit a false positive, and no
    true positive anywhere. Leaving it out of the record means the next person
    reads its absence as an oversight.

    Write the fixtures with real codepoints in the file bytes, not with escape
    sequences the test decodes. The committed hostile file is the regression;
    bidi.md already does exactly this and is the shape to follow.
  </action>
  <verify>
    <automated>bun run test src/analyze &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>Every hidden-content class in CAP-06 that survived measurement is detected with its line and codepoint, an HTML comment the renderer would show produces nothing, the four corpora produce zero findings including at the one line a fence-only rule would misreport, and every evidence string carries a sentinel rather than a character nobody can see.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: A panel that shows it, beside a renderer that still does not</name>
  <files>src/components/HiddenContentPanel.tsx, src/components/HiddenContentPanel.test.tsx, src/components/SkillBody.test.tsx, src/app/r/[owner]/[repo]/[...path]/page.tsx, src/db/queries/capabilities.ts, src/ingest/persist.test.ts</files>
  <behavior>
    - The panel renders one row per finding with its class label, its line number, and its sentinel-substituted evidence.
    - Evidence containing angle brackets, quotes and an ampersand renders escaped, with no element created.
    - Evidence containing a script tag renders as text, and the rendered markup contains no script element.
    - The panel renders with no database and no browser, from an array of plain objects.
    - Each row links to a permalink ending in the line fragment for that finding's line.
    - The panel renders nothing at all when there are no hidden-content findings; the not-detected and not-analyzed states belong to the capability panel.
    - After a scan that produced a hidden-content finding, package_version.body still contains the raw invisible codepoint, unchanged.
    - src/components/SkillBody.tsx is byte-identical to its state before this plan.
    - SkillBody.test.tsx's two hidden-content assertions still assert exactly what they asserted before, and the file's only change is an added comment.
  </behavior>
  <action>
    Apply References D and E.

    Model the panel on JobPanel.tsx, not on SkillBody.tsx. JobPanel is pure — it
    takes rows, holds nothing and reaches nothing — which is what lets its states
    be asserted where there is neither a database nor a browser. And its
    rendering idiom is the security argument itself: untrusted-adjacent text as a
    bare JSX child, escaped by React, with no sanitizer because nothing is parsed
    as markup.

    Do not import SkillBody, do not import react-markdown, and do not import
    rehype-sanitize into this component. There is nothing to sanitize when
    nothing is parsed, and a second sanitizer is a second thing to keep in sync
    and a second thing to get wrong. check-boundaries already fails CI on the
    raw-HTML shortcut, so the wrong answer is unavailable rather than merely
    discouraged.

    Assert the raw-byte retention against the database, not against the analyzer.
    CAP-07 says the bytes are retained, and the place that claim is either true
    or false is the stored column. Read package_version.body back after a persist
    and compare the codepoint.

    Add the comment above SkillBody.test.tsx's two assertions and change nothing
    else in that file. Those two assertions now carry a second load: together
    they prove the new panel is the only place a user can see this content.
    Editing either one reopens Pitfall 3 by definition, and the comment is what
    tells the next reader that before they try.

    Render the section only when there is something to show. Duplicating the
    not-detected state here would put the same sentence in two components, and
    04-04 owns the honest-absence rendering for the whole disclosure surface.

    Write the section's own sentence to state the mechanism and stop: the content
    is in the file and the body above does not show it, because the renderer
    drops a comment and because an invisible character has no visible form. No
    verdict, no warning tone, no colour.
  </action>
  <verify>
    <automated>bun run test src/components src/ingest &amp;&amp; bun run typecheck &amp;&amp; bun run ci</automated>
  </verify>
  <done>Hidden content is shown with a visible sentinel in a panel that parses nothing, the raw bytes are still in the stored body afterwards, and SkillBody.tsx is untouched while its two assertions now carry a comment naming the proof they have become.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `package_version.body` → `hidden.ts` | Bytes deliberately chosen to be invisible or to be dropped by a renderer |
| a hidden-content finding → the rendered page | The one place where content the safe renderer refused to show is deliberately shown |
| `markup.ts`'s approximation → the finding set | A tracker that misreads a construct decides whether a finding exists |
| `SkillBody.tsx`'s sanitize path → the new panel | Two render paths over the same column, one of which must never gain the other's permissions |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-04-16 | Elevation of Privilege | re-injecting hidden content into the Markdown render path | critical | mitigate | The panel imports no Markdown renderer and no sanitizer; content is a JSX text node React escapes. `check-boundaries.mjs`'s `no-raw-html` rule fails CI on `rehype-raw`, `dangerouslySetInnerHTML` or `allowDangerousHtml` in any new component. |
| T-04-17 | Tampering | the panel itself rendering invisibly | high | mitigate | Sentinel substitution happens in the analyzer, and a test asserts no evidence string contains a raw invisible codepoint — so the panel cannot forget, and neither can any future sink. |
| T-04-18 | Tampering | Pitfall 3 reopened by relaxing `SkillBody`'s schema to satisfy CAP-07 | critical | mitigate | Structural: `SkillBody.tsx` is unmodified and detection reads storage, not render output. The two existing assertions get a comment naming the proof they now carry, so an edit to either is visibly a security change. |
| T-04-19 | Denial of Service | a body that is entirely invisible codepoints | medium | mitigate | Per-line cap before scanning, `maxFindingsPerDetector` on the output, overflow reported as a count. Asserted with a 32 KB all-zero-width body. |
| T-04-20 | Denial of Service | the HTML-comment pattern over pathological input | medium | mitigate | Non-greedy with a required fixed terminator — the reviewed `FENCE` shape — run per capped line. Covered by 04-02's ReDoS fixture, which now also runs this analyzer. |
| T-04-21 | Repudiation | under-reporting from the markup approximation | medium | accept | Stated ceiling: a construct misread as code yields no finding. Accepted deliberately, because the naive alternative measured 100% false positives and because the codepoint classes that catch actual concealment never consult the tracker. Recorded in the file and in the precision row. |
| T-04-22 | Information Disclosure | a hidden comment carrying a credential into `evidence_text` | medium | mitigate | Evidence is capped at `maxEvidenceChars`, is never logged, and reaches only a page that already displays the public file it came from. No analyzer extracts a credential-shaped token, per CONTEXT.md decision 6. |
</threat_model>

<verification>
1. Every codepoint class in CAP-06 that survived measurement produces a finding with its line and codepoint.
2. A leading byte order mark produces nothing; the same character elsewhere produces a finding.
3. `bidi.md`'s U+202E is found inside `description`, because the frontmatter fence is part of `body`.
4. An HTML comment in prose produces one finding; the same text inside a fence and inside an inline code span produces none.
5. The four corpora produce zero hidden-content findings, including zero at `anthropics-skills skills/pptx/SKILL.md:15`.
6. Every evidence string carries a sentinel and contains no raw invisible codepoint.
7. No summary contains a word of judgment.
8. The panel escapes angle brackets, quotes and ampersands, and creates no element from evidence.
9. `package_version.body` still contains the raw codepoint after the finding exists.
10. `src/components/SkillBody.tsx` is unchanged, and `SkillBody.test.tsx`'s only change is an added comment.
11. `fixtures/capability-precision.md` carries a row for the shipped hidden-content rule and one for the hidden-style rule that does not ship.
12. `bun run ci` passes.
</verification>

<success_criteria>
- **CAP-06** — Unicode tag characters, zero-width characters, bidi controls and HTML comments are detected; hidden-styled text is measured, deleted and recorded rather than silently dropped.
- **CAP-07** — hidden content is rendered with a visible sentinel, is never silently stripped, and the raw bytes are proven still present in the stored column.
- **CAP-13** — the shipped rule and the deleted rule each carry a row in the precision record.
- **QUA-03 / QUA-05** — the analyzers have direct unit tests needing no database and no token; four new hidden-content fixtures join the permanent adversarial suite with README rows, which is the "invisible characters" category QUA-05 names by name.
- ROADMAP criterion 3 — a skill containing invisible Unicode is flagged, and that content is rendered with visible sentinels rather than stripped.
</success_criteria>

<output>
Create `.planning/phases/AGD-04-capability-disclosure/04-03-SUMMARY.md` when done.
Record: the finding count each new fixture produced; the corpus result for the shipped
comment rule, and confirmation that `anthropics-skills skills/pptx/SKILL.md:15` produced
nothing; the exact sentinel strings shipped; the observed ceilings of the markup tracker
that the file documents; and confirmation that `src/components/SkillBody.tsx` is byte-identical
and that `SkillBody.test.tsx`'s two assertions are unchanged. Record no credential, no
connection string, and no evidence text beyond the sentinel forms.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer.
</output>
