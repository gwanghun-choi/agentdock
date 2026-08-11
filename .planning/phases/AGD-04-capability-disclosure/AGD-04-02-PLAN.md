---
phase: AGD-04-capability-disclosure
plan: 02
type: execute
wave: 2
depends_on: ["04-01"]
files_modified:
  - src/analyze/declared.ts
  - src/analyze/declared.test.ts
  - src/analyze/network.ts
  - src/analyze/network.test.ts
  - src/analyze/shell.ts
  - src/analyze/shell.test.ts
  - src/analyze/index.ts
  - src/analyze/types.ts
  - src/analyze/redos.test.ts
  - src/analyze/precision.test.ts
  - scripts/capability-precision.mjs
  - fixtures/capability-precision.md
  - fixtures/adversarial/redos-line.md
  - fixtures/adversarial/allowed-tools-coarse.md
  - fixtures/adversarial/README.md
  - package.json
autonomous: true
requirements: [CAP-02, CAP-04, CAP-05, CAP-13, CAP-14, QUA-03, QUA-05]

estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A coarse Bash(*) grant produces exactly one finding — itself, verbatim — and never a derived network, filesystem or install finding"
    - "A declared capability and an observed pattern match are never the same category and never share a list"
    - "A URL with a fetch verb on its line is a network request; a URL without one is an external reference; an xmlns namespace URI is neither"
    - "A curl piped into a shell is surfaced; the word bash in prose is not"
    - "A single 32 KB line of backtracking bait completes every shipped analyzer inside the wall-clock bound"
    - "Every shipped analyzer has a row in fixtures/capability-precision.md, and a test fails if one does not"
    - "No row in fixtures/capability-precision.md records a false-positive rate at or above 20 percent"
    - "A detector whose measured rate reaches 20 percent is deleted from the registry, not narrowed until it passes"
  artifacts:
    - path: "src/analyze/declared.ts"
      provides: "The declared channel: allowed-tools tokens shown verbatim, plus the per-type meta command fields, never decomposed into inferred sub-capabilities"
      exports: ["declaredCapabilities", "DECLARED_VERSION"]
      min_lines: 60
    - path: "src/analyze/network.ts"
      provides: "URL extraction with the request-versus-reference split and the named xmlns exclusion"
      exports: ["observedNetwork", "FETCH_VERBS", "NETWORK_VERSION"]
      min_lines: 70
    - path: "src/analyze/shell.ts"
      provides: "The remote-execution shape only — never the mere presence of a shell word"
      exports: ["observedRemoteExecution", "SHELL_VERSION"]
      min_lines: 50
    - path: "fixtures/capability-precision.md"
      provides: "The CAP-13 audit record: one row per shipped analyzer naming its pattern version, corpus, hit count, hand-checked sample size, false-positive count and rate"
      min_lines: 40
    - path: "scripts/capability-precision.mjs"
      provides: "Emits the labelling sample — first twenty hits per analyzer with file, line and matched text — so the hand-check is reproducible rather than remembered"
      min_lines: 50
  key_links:
    - from: "src/analyze/precision.test.ts"
      to: "fixtures/capability-precision.md"
      via: "every registered analyzer id must have a row, and no row may record a rate at or above the kill line"
      pattern: "capability-precision"
    - from: "scripts/capability-precision.mjs"
      to: "src/analyze/index.ts"
      via: "the script runs the shipped registry over the four frozen corpora, with no network and no token"
      pattern: "ANALYZERS"
---

<objective>
Finish the detector set, lock CAP-14 with a test instead of a paragraph, and
then actually run the measurement the ROADMAP made binding — including deleting
anything that fails it.

Purpose: 04-01 proved the path on the one detector whose precision was already
known. Three remain, and each one is a different kind of risk. The declared
channel is the only requirement in the phase with **zero real-world instances**
to validate against. The network split is the one place the corpus proves a real
distinction exists and also hands over a concrete false-positive class by name.
The remote-execution shape has never fired on real data at all, so shipping it
means saying so rather than calling it clean.

Then the measurement. `04-RESEARCH.md`'s Pitfall 4 names the failure exactly:
writing the pattern feels like the deliverable and measuring it feels like
polish. This plan makes the measurement a task with an output file and a test
that fails when a shipped analyzer has no row in it — so a future detector
cannot ship unmeasured by being forgotten.

Output: `declared.ts`, `network.ts`, `shell.ts`, the ReDoS lock,
`scripts/capability-precision.mjs`, and `fixtures/capability-precision.md` with
one row per shipped analyzer and a recorded rate for each.

Honours the CONTEXT.md decisions that a coarse grant is one finding and not
three, that `credentials` and `filesystem` do not ship and the measurement is
why, that `shell` is narrowed to `remote_execution`, and that the naive
HTML-comment pattern was already deleted before this plan begins.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-04-capability-disclosure/CONTEXT.md
@.planning/phases/AGD-04-capability-disclosure/04-01-SUMMARY.md
@src/analyze/types.ts
@src/analyze/lines.ts
@src/analyze/install.ts
@src/analyze/run.ts
@src/analyze/index.ts
@src/detect/skill.ts
@src/detect/mcp.ts
@src/detect/hook.ts
@src/detect/frontmatter.ts
@src/detect/skill.test.ts
@fixtures/adversarial/README.md
</context>

<decisions_made_while_planning>

**1. A coarse `Bash(*)` grant is one finding, and the argument is mechanical
rather than aesthetic.**

Accepted from `04-RESEARCH.md` §Q3. AgentDock never executes, so it cannot know
what a shell grant is used for at run time. Emitting "therefore this skill does
network, filesystem and install" converts an observed fact about the file into an
inferred judgment about behaviour — the precise move CAP-11 and CAP-12 forbid —
and it is wrong in the way that costs trust fastest, because a real
`Bash(git:*)` grant implies none of the three. The grant's own literal text says
more, and more accurately, than three derived bullets would.

**2. The declared channel is structurally separate from the observed channel,
never merged into one list.**

A `Bash(git:*)` grant is a fact about what the *author declared*. A `curl` found
in prose is a fact about what the *text says*. A single "Capabilities" list
sourced from either erases the one distinction that makes the declared signal
worth trusting. Two categories, two sections in 04-04, never interleaved.

**3. CAP-02 ships with no corpus validation, and says so.**

`allowed-tools` appears zero times in 84 real bodies. `fixtures/adversarial/tools-list.md`
already exercises the YAML-list form, and one new fixture covers the coarse
`Bash(*)` case. Its precision row records "0 real hits" rather than a rate, and
the summary must not claim corpus validation this detector cannot have.

**4. The network split is real, so it is kept, even though CAP-04 does not ask
for it.**

CAP-04 asks only that outbound URLs be inventoried, and both categories are
outbound URLs. But the corpus proves a genuine distinction — a `homepage:` field
and "Use WebFetch to load <url>" are not the same claim about the artifact — and
§Q3's own discipline says do not collapse a distinction the data shows exists.
The `category` column carries it, which is also what Phase 6's DIS-06 filter will
read.

**5. The `xmlns` exclusion is by context, not by hostname allowlist.**

One hit in 65 (`baoyu-diagram/SKILL.md:214`, `xmlns="http://www.w3.org/2000/svg"`).
Excluding by listing W3C hostnames would need extending every time a new
namespace appears; excluding when `xmlns` precedes the URL on the same line is
one bounded check that generalizes and needs no list. Both directions are
asserted: the SVG namespace produces nothing, and a genuine `w3.org`
documentation link with no `xmlns` still produces an `external_reference`.

**6. `network_request` ships on six hits, and the record says six.**

Under the strict same-line-verb rule only 6 exist in the whole corpus; §Q4's
looser sentence rule counted ~15. Either way the sample is under twenty. Step 2
of §Q5's procedure covers this case explicitly — take all hits when fewer than
twenty exist and **record which case applies**. Inflating it to a percentage of
a twenty-sample it does not have would be the dishonest option.

**7. The ReDoS lock is a wall-clock assertion with a deliberately loose bound.**

A bounded, per-line, capped-length scan over 32 KB should finish in single-digit
milliseconds. The bound is set generously — it is a smoke alarm for a
super-linear regression, not a performance budget — because a tight bound turns
a correctness gate into a flaky CI failure on a loaded runner. The value and that
reasoning both go in the test's own comment.

**8. The precision test enforces the kill switch mechanically, so it cannot be
forgotten by the next person.**

Three assertions: every registered analyzer id has a row; every row's recorded
hit count equals what that analyzer produces over the corpora today; and no row
records a rate at or above 20%. The second is what makes a silent pattern change
a visible diff against a recorded number. The third is the ROADMAP's kill line
turned from a policy into a failing test.

</decisions_made_while_planning>

<reference>

## Reference A — `src/analyze/declared.ts`

Two shapes, both reading already-parsed structured data, neither scanning text.

**Frontmatter (`skill`, `command`).** `frontmatter['allowed-tools']`, normalized
the way `skill.ts:31-35`'s `toolTokens()` already normalizes it: split a string
on whitespace and commas, accept a YAML list, ignore anything else. One finding
per token, `summary` carrying the token **verbatim** — `Bash(git:*)` stays
`Bash(git:*)` and is never split on the colon, the parenthesis or the star.
`startLine` is null: a multi-token field has no single useful line, and inventing
one would produce a permalink that points at the right file and the wrong claim.

**Detector `meta` (`mcp_server`, `hook`).** `meta.servers[].command` and
`meta.handlers[].command`, which Phase 3 already stored verbatim and explicitly
deferred to this phase — `hook.ts:112-116` says so in its own words: *"Whether
this reaches the network or installs a package is CAP-05, Phase 4. Stored, never
interpreted."* This phase surfaces them as declared facts and still does not
interpret them: no splitting on shell metacharacters, no URL extraction, no flag
parsing.

`meta.servers[].envKeys` is **never** read here. Phase 3 dropped the values at
parse for FND-08, and re-surfacing the key names as a "credentials" finding would
be the category CONTEXT.md decision 6 already deleted, arriving through a side
door.

No `supports(type)` predicate. Each shape is a small function over the `meta`
key it knows, and a type that has neither produces nothing — the same way
`mcp.ts` and `hook.ts` each define their own `meta` shape independently and no
detector anywhere asks "am I a skill".

## Reference B — `src/analyze/network.ts`

One bounded URL pattern, then one classification decision per hit.

```
https?://[^\s<>()\[\]"'`]+
```

A single character class with one quantifier and no nesting. The terminator set
is what stops a Markdown link's closing bracket, a parenthesis or a backtick from
being swallowed into the URL, and it is why this needs no lookahead.

**Exclusion, by name.** A match whose line contains `xmlns` before the match
position (case-insensitive) is not a URL the artifact reaches — it is an XML
namespace identifier. Measured: exactly 1 of 65 bare-URL lines in the corpora,
`baoyu-diagram/SKILL.md:214`. This is the one false-positive class the corpus
names, and it is excluded explicitly rather than tolerated.

**Classification.** `network_request` when the same line carries a fetch verb or
tool name directed at the URL, or the URL appears as an argument in a shown
command; `external_reference` otherwise. `FETCH_VERBS` is an exported constant
list with the measurement in its comment — `WebFetch`, `WebSearch`, `Fetch from`,
`GET`/`POST`/`PUT`/`DELETE`, `Navigate to`, `Open`, `curl`, `wget`,
`requests.get`, `axios`. Six hits in 84 files under the strict rule; the corpus's
dominant real shape is a prose imperative naming a tool, not a shell command, so
a code-fence-only detector would miss most of them.

Both categories are one `outbound_url` inventory for CAP-04's purposes; the
`category` column is what carries the distinction into the UI and, later, into
DIS-06's filter.

## Reference C — `src/analyze/shell.ts`

The narrow literal shape, and only it:

- `curl` … `| sh` / `| bash` / `| sudo sh` / `| sudo bash`
- `wget` … `&& sh` / `&& bash`
- `iwr` / `Invoke-WebRequest` … `| iex`

Bounded on both sides, no nested quantifier, no `.*` adjacent to another
quantifier. **Zero hits across all 84 real bodies** — which matches
`PITFALLS.md`'s own prediction and means the pattern is rare-but-clean here, not
validated here. The precision row records "0 hits on real data; precision
untested, not proven clean", and 04-04's "not checked" copy says the same thing
in the user's words.

The maintainer's rule decides what is *not* in this file: the presence of the
words bash, shell, exec or command is not a finding. This detector fires only on
an execution *instruction* — a download whose output is piped into an
interpreter. Prose about shells produces nothing, and the test asserts that on a
line containing all four words and no pipe.

## Reference D — the ReDoS lock

`fixtures/adversarial/redos-line.md`, hand-written, joining the flat adversarial
directory and its README table the way every hostile fixture already does. It is
the first fixture in that directory aimed at an **analyzer** rather than at
frontmatter or JSON parsing.

Its body is one line at the body cap, built from shapes chosen to be worst-case
for a *naive* version of each shipped pattern — a long unterminated
`https://` run, a long alternation-prefix run (`npm inst`-shaped near-misses),
and a long run of characters that a nested-quantifier URL pattern would
backtrack over. Generate the long runs in the fixture file itself rather than in
the test, so the committed file is the regression and the test is only the
assertion — that is `fixtures/adversarial/README.md`'s own stated rule: *"A
fixture with no assertion is storage, not a regression."*

`src/analyze/redos.test.ts` asserts three things: every shipped analyzer
completes over the fixture inside the wall-clock bound; the pass reports a
non-zero skipped-line count, proving `maxLineChars` actually fired; and no
analyzer returns more than `maxFindingsPerDetector` findings.

## Reference E — `scripts/capability-precision.mjs`

Runs the shipped registry over the four frozen corpora and prints, per analyzer:
the total hit count, and the first twenty hits as `corpus/file:line` plus the
matched text. No network, no token, no database — the corpora are on disk and
the analyzers are one-parameter pure functions.

`src/detect/skill.test.ts:23-43`'s `corpus()` loader is the precedent for reading
a frozen corpus: read `tree.json`, build a `Map` of the URL-decoded body paths
from `files/`, and hand it around as a parameter. The script needs the bodies
only, not the reader indirection.

Add `"precision": "bun scripts/capability-precision.mjs"` to `package.json`.
It is not wired into `ci` — the hand-check is the point and a script that prints
a sample has nothing to fail on. `src/analyze/precision.test.ts` is what runs in
`ci`.

## Reference F — `fixtures/capability-precision.md`

Follows `fixtures/adversarial/README.md`'s convention: a short statement of what
the file is for, then one table, one row per shipped analyzer, so a later pattern
change is a visible diff against a recorded number rather than an unrecorded
rewrite.

| Analyzer | Version | Corpus | Hits | Hand-checked | FP | Rate | Verdict |
|---|---|---|---|---|---|---|---|

Plus, under the table, the procedure that produced it — verbatim from
`04-RESEARCH.md` §Q5 so the next person reproduces it rather than reinventing it:

1. Run the pattern over all four frozen corpora.
2. Take the first twenty hits, or all of them if fewer than twenty exist, and
   **record which case applies**.
3. Label each **positive** (the matched text genuinely represents the claimed
   capability), **negative** (the pattern matched but the text does not represent
   it — prose about the tool, a namespace URI, a negated instruction), or
   **ambiguous**.
4. **Score ambiguous as negative.** A detector whose hits need an argued
   judgment to defend is exactly the kind that trains users to dismiss the whole
   panel.
5. Record corpus, hit count, sample size, FP count and rate.
6. **At or above 20%, delete the detector.** Do not narrow it until it passes.

The file opens with the row already earned before any code was written: the naive
`<!--...-->` HTML-comment pattern, 26 hits, 26 hand-checked, 26 false positives,
**100%**, verdict **deleted** — with the measurement's method named (each
comment's own text was searched for in the output of the real `SkillBody`
render, and found, 26 times out of 26). Recording a deleted detector is the
point: without a row, the next person reintroduces it.

## Reference G — `src/analyze/precision.test.ts`

Three assertions, in this order:

1. **Coverage.** Every id in the analyzer registry appears in a row of
   `fixtures/capability-precision.md`. This is the mechanized form of Pitfall 4's
   warning sign — *"a detector file with no corresponding row in the precision
   record"* — and it is what stops the seventh detector shipping unmeasured.
2. **Drift.** For every row, the hit count the analyzer produces over the four
   corpora today equals the recorded count. A pattern edit that changes coverage
   fails here until the record and the hand-check are redone.
3. **The kill line.** No row records a rate at or above 20%. Parse the rate out
   of the table; a row that cannot be parsed is a failure, not a skip.

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The declared channel, and it never becomes three findings</name>
  <files>src/analyze/declared.ts, src/analyze/declared.test.ts, src/analyze/index.ts, src/analyze/types.ts, fixtures/adversarial/allowed-tools-coarse.md, fixtures/adversarial/README.md</files>
  <behavior>
    - allowed-tools as a space-separated string yields one finding per token, each token stored exactly as written.
    - allowed-tools as a YAML list yields the same findings as the equivalent string, using the existing tools-list.md fixture.
    - A Bash(*) grant yields exactly one finding whose summary is the literal grant text, and yields no network, no filesystem and no install finding.
    - A Bash(git:*) grant is not split on the colon, the parenthesis or the asterisk.
    - Frontmatter with no allowed-tools key yields no findings and no error.
    - An mcp_server meta.servers[].command yields one declared finding per server, carrying the command verbatim.
    - A hook meta.handlers[].command yields one declared finding per handler.
    - meta.servers[].envKeys never appears in any finding, in any field, including metadata.
    - Every declared finding has a null startLine and a null endLine.
    - Running the declared analyzer over all four frozen corpora yields zero findings, because allowed-tools appears zero times in them.
  </behavior>
  <action>
    Apply Reference A. Reuse skill.ts's existing token normalization rather than
    writing a second one — the string-or-list tolerance is already written,
    already tested at skill.test.ts:206-216, and a second implementation would
    drift from the first.

    Store the grant text verbatim and stop. Do not derive sub-capabilities from a
    coarse grant. AgentDock never executes, so it cannot know what a shell grant
    is used for at run time, and emitting three inferred bullets from one
    declared fact converts an observation into a judgment — which is the one
    thing CAP-11 and CAP-12 forbid by name. Put that sentence in the file, at the
    line where the temptation lives.

    Never read envKeys. Phase 3 dropped MCP environment values at parse for
    FND-08 and kept only the key names; surfacing those key names as a finding
    would reintroduce the credentials category the measurement already deleted.
    Assert it, because the absence is otherwise invisible.

    Write the coarse-grant fixture into the flat adversarial directory and add
    its row to that directory's README table. Do not add any file under
    fixtures/&lt;slug&gt;/files/ — skill.test.ts's measured COUNTS table iterates
    those directories and a new file there breaks a passing suite for an
    unrelated reason.

    Assert the zero-hit corpus result explicitly rather than omitting it. This is
    the one requirement in the phase with no real-world instance, and a test that
    records the zero is what stops a later summary claiming corpus validation
    this detector cannot have.
  </action>
  <verify>
    <automated>bun run test src/analyze/declared.test.ts &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>A declared grant is one finding carrying its own text; a coarse grant is still one finding; the four corpora yield zero, and the test says so. No environment key name reaches any finding field.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Network, remote execution, and the ReDoS lock</name>
  <files>src/analyze/network.ts, src/analyze/network.test.ts, src/analyze/shell.ts, src/analyze/shell.test.ts, src/analyze/index.ts, src/analyze/redos.test.ts, fixtures/adversarial/redos-line.md, fixtures/adversarial/README.md</files>
  <behavior>
    - A line reading "Use WebFetch to load https://example.com/x" yields one network_request finding.
    - A line reading "Source: https://example.com/x" yields one external_reference finding.
    - A line containing xmlns="http://www.w3.org/2000/svg" yields no finding at all.
    - A line containing an https://www.w3.org documentation link with no xmlns still yields an external_reference finding.
    - A Markdown link's closing parenthesis, bracket and backtick are not swallowed into the extracted URL.
    - Across the four frozen corpora the URL analyzer produces the measured 65 hit lines, of which the xmlns one is excluded, and 6 classify as network_request under the same-line-verb rule.
    - curl piped into sh, wget followed by && bash, and iwr piped into iex each yield one remote_execution finding.
    - A line containing the words bash, shell, exec and command with no download and no pipe yields nothing.
    - Across the four frozen corpora the remote-execution analyzer produces zero findings.
    - Every shipped analyzer completes over fixtures/adversarial/redos-line.md inside the wall-clock bound.
    - The redos fixture makes the per-line cap fire, so the pass reports a non-zero skipped-line count.
    - No analyzer returns more findings than maxFindingsPerDetector for the redos fixture.
  </behavior>
  <action>
    Apply References B, C and D.

    Exclude the namespace case by context, not by hostname. A W3C hostname list
    needs extending every time a namespace appears; requiring that the match is
    not preceded by xmlns on the same line is one bounded check that generalizes.
    Assert both directions — the SVG namespace produces nothing, and a real
    w3.org documentation link still produces a reference — because an exclusion
    tested in one direction only is an exclusion that can swallow the class it
    was meant to keep.

    Gate the request classification on an explicit verb, not on URL shape. The
    two classes are syntactically identical, and §Q4's hand-classification of all
    65 hits found zero false positives among the verb-gated ones. Export the verb
    list as a named constant with the measurement in its comment, so widening it
    later is a visible diff.

    Keep the remote-execution pattern narrow and literal. The maintainer's rule
    settles the scope: the presence of a shell word is not a finding, only an
    execution instruction is. Assert the negative case with a line carrying all
    four shell words and no download.

    Record the zero-hit result rather than treating it as nothing to say. Zero
    hits on real data means untested, not clean, and 04-04's user-facing copy
    depends on this distinction being written down now.

    Generate the long runs inside the fixture file, not in the test. The
    committed hostile input is the regression; the test is only the assertion.
    That is the adversarial directory's own stated rule and it is why the
    existing nineteen fixtures are files rather than string builders — with the
    documented exception of an oversized case, which is generated because
    committing megabytes to prove a cap is not worth it.

    Set the wall-clock bound generously and say why in the test's own comment. A
    bounded per-line scan over 32 KB finishes in single-digit milliseconds; a
    tight bound turns a correctness gate into a flake on a loaded runner, and a
    flaky gate gets deleted.

    Register both analyzers in src/analyze/index.ts as one import and one array
    element each, keeping that file the short registry its comment claims.
  </action>
  <verify>
    <automated>bun run test src/analyze &amp;&amp; bun run typecheck &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>Outbound URLs are inventoried and split into request and reference on the presence of a fetch verb, with the one measured false-positive class excluded by name and both directions asserted. Remote-execution shape is surfaced and shell prose is not. CAP-14 is locked by a test over a committed hostile fixture that makes the per-line cap fire.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Run the measurement, record it, and delete whatever fails it</name>
  <files>scripts/capability-precision.mjs, fixtures/capability-precision.md, src/analyze/precision.test.ts, src/analyze/index.ts, package.json</files>
  <behavior>
    - The script runs every registered analyzer over the four frozen corpora with no network access, no token and no database.
    - The script prints, per analyzer, the total hit count and the first twenty hits as corpus/file:line plus the matched text.
    - fixtures/capability-precision.md holds one row per registered analyzer, plus the row for the already-deleted naive HTML-comment pattern.
    - The precision test fails when an analyzer is registered with no row in the record file.
    - The precision test fails when a row's recorded hit count no longer matches what the analyzer produces over the corpora.
    - The precision test fails when any row records a rate at or above 20 percent.
    - The precision test fails on a row whose rate cannot be parsed, rather than skipping it.
    - Every analyzer that survives is still registered; any that does not is absent from src/analyze/index.ts, absent from src/analyze/, and present in the record file with its verdict.
  </behavior>
  <action>
    Apply References E, F and G.

    Run the script and hand-label the sample it prints. This is the task, not the
    preamble to it. Take the first twenty hits per analyzer, or all of them when
    fewer than twenty exist, and record which case applies for each. Score an
    ambiguous hit as a negative — the bar exists to protect a user's willingness
    to read the panel at all, and a hit that needs an argument to defend is the
    kind that erodes it.

    Write the record file with the deleted HTML-comment row already in it, before
    any surviving row. It was measured during planning at 26 out of 26 by
    rendering each comment's own text through the real SkillBody component and
    finding it present every time, and a deleted detector with no row is a
    detector the next person reintroduces.

    If any analyzer measures at or above the kill line, delete it: remove the
    file, remove its registry element, remove its tests, and leave its row in the
    record with the verdict and the rate. Do not narrow the pattern until it
    passes. Narrowing a failing pattern is the behaviour the ROADMAP's kill line
    exists to prevent, and the one legitimate replacement — a detector making a
    genuinely different claim — is a new detector with its own row and its own
    measurement, not an edit to the failing one.

    Make the coverage assertion read the registry rather than a hand-written list
    of ids. A list would have to be remembered; the registry cannot be forgotten
    because the pipeline imports it.

    Do not wire the script into ci. A script that prints a sample has nothing to
    fail on, and the hand-check is a human step by definition. The precision test
    is what runs in ci, and it is the part that can fail.

    Record in the summary, per analyzer: hits, sample size, which of the two
    sampling cases applied, FP count, rate, and verdict. Name any detector
    deleted and the rate that deleted it.
  </action>
  <verify>
    <automated>bun run precision &amp;&amp; bun run test src/analyze/precision.test.ts &amp;&amp; bun run ci</automated>
  </verify>
  <done>Every shipped analyzer has a hand-checked false-positive rate recorded against the four frozen corpora, no recorded rate reaches 20 percent, a test fails if a registered analyzer has no row or a row drifts from the code, and any detector that failed the measurement is gone from the source tree rather than tuned into compliance.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a repository body → the URL and shell patterns | Attacker-chosen text sized and shaped by the author, scanned per line |
| a `.mcp.json`'s `env` block → a declared finding | Phase 3 already dropped the values; the key names must not become a finding either |
| `fixtures/capability-precision.md` → the product's own trust claim | A recorded rate nobody re-derives is a claim, not a measurement |
| `fixtures/adversarial/redos-line.md` → the analyzers | Deliberately hostile input, committed, never executed and never fetched |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-04-10 | Denial of Service | the URL character class and the alternation patterns | high | mitigate | Single-quantifier character class with an explicit terminator set, fixed alternations, no nesting; every line pre-sliced to `maxLineChars`; locked by `redos.test.ts` over a committed fixture that makes the cap fire. |
| T-04-11 | Information Disclosure | `meta.servers[].envKeys` reaching a finding | high | mitigate | Never read by `declared.ts`, and asserted absent from every finding field including `metadata`. Phase 3 already dropped the values at parse (FND-08). |
| T-04-12 | Tampering | a URL in a finding becoming a fetch target | high | mitigate | Structural: no code path in `src/analyze/` performs I/O, and `check:boundaries`'s host rule keeps every GitHub hostname inside `src/github/`. ING-11 says extracted URLs are displayed and never fetched. |
| T-04-13 | Repudiation | a pattern edited after its rate was recorded | medium | mitigate | `precision.test.ts`'s drift assertion fails when the live hit count diverges from the recorded one, so a pattern change cannot outrun its measurement. |
| T-04-14 | Tampering (of the product's own guarantee) | a failing detector narrowed rather than deleted | high | mitigate | The kill line is a failing test over the record file, and the record keeps deleted detectors as rows so a reintroduction is visible. |
| T-04-15 | Denial of Service | a body with tens of thousands of URL hits | medium | mitigate | `maxFindingsPerDetector` caps rows per analyzer and the overflow is reported as a count; the cap is 7× the measured worst case. |
</threat_model>

<verification>
1. A coarse `Bash(*)` grant is exactly one finding, and never three.
2. No declared finding carries a line number, and none carries an MCP environment key name.
3. The declared analyzer produces zero findings over the four corpora, and the test records that.
4. An `xmlns` namespace URI produces nothing; a genuine w3.org link still produces a reference.
5. The URL analyzer reproduces the measured 65 hit lines, with 6 classifying as requests.
6. The remote-execution analyzer produces zero findings over the corpora and fires on all three literal shapes.
7. Shell prose with no download produces nothing.
8. Every shipped analyzer completes over the ReDoS fixture inside the bound, with the per-line cap observably firing.
9. `fixtures/capability-precision.md` has a row for every registered analyzer plus the deleted HTML-comment pattern.
10. `precision.test.ts` fails on a missing row, on a drifted count, and on a rate at or above 20%.
11. Any detector that failed the measurement is absent from `src/analyze/` and present in the record with its verdict.
12. `bun run ci` passes.
</verification>

<success_criteria>
- **CAP-02** — declared capabilities are extracted from frontmatter and from the per-type `meta` fields Phase 3 stored verbatim, shown as the author's own text, with the zero-real-instance fact recorded rather than papered over.
- **CAP-04** — outbound URLs are inventoried, split into request and reference on evidence rather than on shape, with the one measured false-positive class excluded by name.
- **CAP-05** — remote-execution directives are surfaced, and the honest state of their validation ("zero hits on real data") is written down where 04-04's copy can quote it.
- **CAP-13** — every shipped detector has a hand-checked rate recorded against the labelled corpus, and the 20% line is a failing test rather than a policy.
- **CAP-14** — bounded patterns and input caps are locked by a test over a committed hostile fixture, not asserted in prose.
- **QUA-03 / QUA-05** — every analyzer has direct unit tests that need no database and no token; the ReDoS and coarse-grant fixtures join the permanent adversarial suite with README rows.
- ROADMAP criteria 2, 8 and 9 — declared capabilities, outbound URLs and install/remote-execution directives surfaced as observed facts; a recorded false-positive rate per detector; a hostile input that cannot blow up analyzer runtime.
</success_criteria>

<output>
Create `.planning/phases/AGD-04-capability-disclosure/04-02-SUMMARY.md` when done.
Record: per analyzer, the hit count over the four corpora, the sample size, which of §Q5's
two sampling cases applied, the false-positive count, the computed rate and the verdict;
the name and rate of any detector deleted by the measurement; whether the URL analyzer
reproduced 65 hit lines and 6 request classifications; and the wall-clock figure the ReDoS
test actually observed against the bound it asserts. Record no credential, no connection
string, and no line of any scanned body beyond the short matched excerpts the precision
record itself requires.

**Do not `git add`, do not `git commit`, do not `git push`.** End with a recommended commit
message and leave the working tree for the maintainer.
</output>
