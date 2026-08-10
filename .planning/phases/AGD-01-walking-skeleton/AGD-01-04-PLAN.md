---
phase: AGD-01-walking-skeleton
plan: 04
type: execute
wave: 2
depends_on: ["01-01"]
files_modified:
  - vitest.config.ts
  - next.config.ts
  - src/proxy.ts
  - src/proxy.test.ts
  - src/app/layout.tsx
  - src/app/globals.css
  - src/components/SkillBody.tsx
  - src/components/SkillBody.test.tsx
  - src/components/escaping.test.tsx
  - fixtures/xss/
autonomous: true
requirements: [REN-01, REN-02, REN-03, REN-04, QUA-05, DIS-11]

estimate:
  tokens: 55000
  raw_tokens: 55000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A skill body containing a script tag, an event-handler attribute, an inline style, a comment, a frame, or a javascript-scheme link renders as inert text with none of those markers reaching the output"
    - "The real body of a legitimate skill that happens to contain HTML renders with its prose intact and its markup neutralized — six of the hundred sampled files needed this"
    - "A frontmatter name containing a title-closing payload is escaped in the page title, in the heading, and in the meta description"
    - "The served policy contains no inline-script escape hatch in production, so a sanitizer failure would still be contained (CONTEXT.md binding fact on the renamed proxy file)"
    - "Images are not rendered at all, so no detail page can leak a visitor's address to a host an author chose (CONTEXT.md resolved question 2 / D-02)"
    - "The suite passes before any ingested content is rendered anywhere in the product"
    - "Light and dark both work with no script, so nothing has to fight the policy to set a theme"
  artifacts:
    - path: "src/components/SkillBody.tsx"
      provides: "The sanitized Markdown renderer — a Server Component, narrowed schema, no raw-HTML plugin"
      exports: ["SkillBody"]
      min_lines: 40
    - path: "src/proxy.ts"
      provides: "Per-request nonce and the Content-Security-Policy, at the Next 16 filename"
      exports: ["proxy", "config"]
      min_lines: 45
    - path: "next.config.ts"
      provides: "The security headers that are not per-request"
      min_lines: 20
    - path: "src/components/SkillBody.test.tsx"
      provides: "The eleven-case XSS corpus as a permanent regression"
      min_lines: 70
  key_links:
    - from: "src/proxy.ts"
      to: "src/app/layout.tsx"
      via: "the nonce is generated per request and the framework attaches it to its own scripts"
      pattern: "nonce"
    - from: "src/components/SkillBody.tsx"
      to: "rehype-sanitize"
      via: "a narrowed allowlist schema, applied as the only rehype plugin"
      pattern: "rehypeSanitize"
---

<objective>
Make untrusted Markdown safe to display, and make a failure of that machinery
survivable.

Purpose: this is the requirement that cannot be retrofitted. Once a detail page
exists, every commit that touches it is a commit that could reintroduce an
injection, and the only defence that scales is the one that was there first. The
requirement itself says the fixture suite passes before any ingested content is
rendered — so it lands before the pages that will render it, not alongside them.
It matters that this is not hypothetical: six of the hundred real skill files
sampled for this phase contain HTML-ish content, including one from the reference
repository, so the machinery fires on legitimate input on day one.

Output: a sanitizing renderer that never constructs raw markup, a narrowed
allowlist with three deliberate deviations from the default, a nonce-based policy
served from the Next 16 proxy file, the non-per-request headers, an eleven-case
injection corpus, and a light/dark foundation that needs no script.

Implements CONTEXT.md resolved question 2 (D-02, images dropped from the
allowlist) and the binding fact that Next 16 renamed the middleware file, which a
nonce policy requires.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-01-walking-skeleton/CONTEXT.md
@.planning/phases/AGD-01-walking-skeleton/AGD-01-01-PLAN.md
@src/app/layout.tsx
@vitest.config.ts
</context>

<decisions_made_while_planning>

**1. The primary control is that raw markup is never parsed, and the sanitizer is
the second layer.**

The renderer turns Markdown into React elements directly. Without a raw-HTML
plugin, HTML in the source is never parsed into element nodes at all — a script
tag in a body is a text node, not markup, and there is no raw-markup construction
anywhere in the path for a bug to reach. The sanitizer is kept anyway, and its
job is to still be right in month six when someone adds a plugin. Both are
tested, because a defence nobody exercises is a defence nobody notices losing.

**2. Three deliberate deviations from the default sanitizer schema.**

The default permits images from any HTTPS host, which turns every detail page
into an address-and-load-signal leak to whatever host an author chose, for no
value in a skill listing — and the policy blocks them anyway, producing broken
images and a console full of violations. Images are dropped. The responsive-image
elements go with them, because their source-set attribute has no scheme
restriction in the default schema and this phase has no responsive-image
requirement. And link relationship and target attributes are added to the schema,
because the default omits them and the renderer needs to set them so an untrusted
link cannot reach the opening window.

**3. The nonce policy costs nothing that has not already been spent.**

The framework's own no-nonce recipe requires an inline-script escape hatch, which
this project forbids by name and which makes the policy worthless as a second
layer. The alternative disables static optimization — but every page in this
phase reads the database and is dynamic already. The cost is sunk, so the strict
policy is free.

**4. No structured-data block in this phase.**

The framework escapes text it renders, including titles and meta content, so
hostile frontmatter is escaped rather than injected. The one sink it does not
escape requires raw-markup construction, which is exactly the sink the escaping
requirement names — and the boundary scanner from plan 01-01 already fails the
build on it. Structured data can arrive later, with explicit escaping and a test.

**5. No syntax highlighting.**

It adds a dependency whose class names have to survive sanitization, against a
requirement list that never mentions it.

**6. Rendering is asserted as a string, not in a simulated browser.**

The assertion is that a payload marker does not appear in the output. Static
markup rendering is already available from the installed framework packages and
needs no browser environment, no testing library, and no configuration switch. If
that turns out not to work with this renderer, the fallback is one line of test
configuration and the plan says so rather than pretending the risk is zero.

</decisions_made_while_planning>

<reference>

## Reference A — `src/components/SkillBody.tsx`

```tsx
import type { Schema } from 'hast-util-sanitize';
import Markdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/**
 * Narrowed from the GitHub-flavoured default. Every deviation is deliberate.
 *
 *  - Images and the responsive-image elements are removed. The default permits
 *    any HTTPS source, which leaks a visitor's address and a load signal to a
 *    host the artifact's author chose; the source-set attribute additionally has
 *    no scheme restriction in the default schema. The policy blocks remote images
 *    anyway, so keeping them would produce broken images plus console noise.
 *  - Links gain relationship and target attributes, which the default omits, so
 *    the component override below can actually set them.
 *
 * Everything else is left at the default on purpose: it is an allowlist with
 * scheme restrictions, comments and doctypes off, and identifier clobbering
 * prevented. Rewriting it by hand would be replacing a reviewed control with an
 * unreviewed one.
 */
const schema: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => t !== 'img' && t !== 'source' && t !== 'picture',
  ),
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'rel', 'target'],
  },
};

/**
 * A Server Component. Nothing untrusted crosses into a Client Component, and no
 * raw-markup construction exists anywhere in this path.
 */
export function SkillBody({ markdown }: { markdown: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, schema]]}
      // The URL transform is left at its default, which permits only http,
      // https, mailto, irc, ircs, xmpp and relative targets. Overriding it is the
      // one documented way to reintroduce injection into this component.
      components={{
        a: ({ node: _node, ...props }) => (
          <a {...props} rel="noopener noreferrer nofollow ugc" target="_blank" />
        ),
      }}
    >
      {markdown}
    </Markdown>
  );
}
```

## Reference B — `src/proxy.ts`

Note the filename. The framework's file convention for this is `proxy` as of
version 16; the older name still resolves but is not the current one.

```ts
import { type NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  // Image sources are restricted to this origin. The sanitizer already drops
  // image elements, so a remote image request would be a bug — and this is where
  // that bug becomes visible instead of silent.
  const csp = [
    `default-src 'self'`,
    // In development the framework evaluates code to provide debugging
    // information, which is why the escape hatch is present there and absent in
    // production. It is not required in production and must never be added.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `img-src 'self'`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
```

## Reference C — `next.config.ts`

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Headers that are the same on every request. The policy is not among them:
  // it carries a per-request nonce and therefore lives in the proxy.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here uses any of these, and saying so is free.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
        // X-Frame-Options is deliberately absent: frame-ancestors in the policy
        // supersedes it and expresses the same thing.
      },
    ];
  },
};

export default config;
```

## Reference D — `src/app/layout.tsx`

```tsx
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'AgentDock',
  description: 'Discover and inspect AI agent skills, plugins, and MCP servers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Declaring both schemes lets the browser pick form controls, scrollbars and
    // the default canvas without a script. No toggle, no stored preference, no
    // anti-flash inline script — which is convenient, because an inline script is
    // exactly what the policy exists to forbid.
    <html lang="en" style={{ colorScheme: 'light dark' }}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
```

## Reference E — `src/app/globals.css`, the foundation only

Plan 01-06 owns the visual design. This file exists here because the layout
imports it and because the theme and overflow rules are the accessibility floor
the injection suite renders against.

```css
:root {
  color-scheme: light dark;
  --bg: light-dark(#ffffff, #0b0d10);
  --fg: light-dark(#16191d, #e6e8eb);
  --muted: light-dark(#5c636b, #9aa2ab);
  --border: light-dark(#e3e6ea, #23272d);
  --accent: light-dark(#1a56b8, #7aa7f0);
}

html {
  background: var(--bg);
  color: var(--fg);
}

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.55;
}

/* A 1,077-character description and a 78-character path are both in the measured
   corpus, so this is a real constraint and not a hypothetical one. min-width on
   a flex child is the piece that is usually missing. */
p,
li,
td {
  overflow-wrap: anywhere;
}

code,
.path {
  word-break: break-all;
}

* {
  min-width: 0;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.skip-link {
  position: absolute;
  left: -9999px;
}

.skip-link:focus {
  left: 0.5rem;
  top: 0.5rem;
  background: var(--bg);
  padding: 0.5rem;
  border: 1px solid var(--border);
}
```

## Reference F — the injection corpus

Eleven fixtures under `fixtures/xss/`, each a body fragment plus its assertion.
The last one is the reason the corpus is real rather than only crafted.

| Fixture | Payload | Assertion |
|---|---|---|
| `script-tag` | a script element containing an alert call | the output contains neither the element name nor the alert text — the strip rule removes the text too |
| `img-onerror` | an image element with an error handler | neither the handler attribute name nor the element name appears |
| `js-url-link` | a Markdown link whose target uses the javascript scheme | no link target carries that scheme |
| `data-url-img` | a Markdown image whose target is a data URL | no data scheme appears in the output |
| `html-comment` | an HTML comment carrying instruction-shaped text | the comment is absent |
| `style-attr` | a span carrying an inline style declaration | no style attribute appears |
| `iframe` | a frame element pointing at another origin | the element name does not appear |
| `svg-onload` | a vector element with a load handler | neither the element name nor the handler appears |
| `nested-encoded` | an entity-encoded and case-varied script element | no executable element appears after rendering |
| `bidi-override` | a right-to-left override inside the body | the character **is present** in the output — it is surfaced later, never silently stripped |
| `real-world-html` | the actual body of the reference repository's generative-art skill, taken from the frozen fixture | renders with no image or script element, and the surrounding prose is intact |

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: The renderer, and the corpus that proves it inert</name>
  <files>vitest.config.ts, src/components/SkillBody.tsx, src/components/SkillBody.test.tsx, fixtures/xss/</files>
  <behavior>
    - Every one of the first nine fixtures renders with none of its payload markers in the output string.
    - The bidi fixture renders with the override character still present, because it is surfaced later rather than stripped.
    - The real reference-repository body renders with no image or script element and with its prose intact.
    - Ordinary Markdown still works: headings, lists, tables from the extended syntax, fenced code, and emphasis all render.
    - Every rendered link carries the no-opener relationship set.
    - A body of a hundred thousand characters renders without error.
  </behavior>
  <action>
    First widen the test include pattern in `vitest.config.ts` to cover component
    test files as well as plain ones — the existing pattern matches only one
    extension and every test in this plan uses the other. Change nothing else in
    that file; the environment-loading comment and the CI guard stay as they are.

    Then write `src/components/SkillBody.tsx` exactly as Reference A.

    The three deviations from the default schema are the substance of this file
    and each is a decision, not a preference. Images and the responsive-image
    elements are removed because the default admits any HTTPS host, which turns
    every detail page into a load signal for a host the artifact's author chose,
    and because the responsive source attribute carries no scheme restriction in
    that schema. Link relationship and target attributes are added because the
    default omits them and the component override needs them to exist before it
    can set them. Everything else stays at the default deliberately: it is an
    allowlist with scheme restrictions, comments and doctypes disabled and
    identifier clobbering prevented, and hand-rewriting it would swap a reviewed
    control for an unreviewed one.

    Leave the URL transform alone. It is documented as the one supported way to
    reintroduce injection into this component, and there is no requirement here
    that wants it changed.

    Then build `fixtures/xss/` from Reference F and write
    `src/components/SkillBody.test.tsx` against it, rendering to a static markup
    string and asserting on that string. The eleventh fixture is copied from the
    frozen corpus captured in plan 01-01 rather than written by hand — six of the
    hundred sampled real files contain HTML-ish content, so "no markup reaches the
    output" has to hold against a legitimate file and not only against a crafted
    one.

    The bidi case asserts presence, not absence, and its expectation is inverted
    from the others on purpose. Stripping the character here would destroy what a
    later phase needs in order to show it, and would be indistinguishable
    downstream from the character never having been there.

    If static markup rendering turns out not to work with this renderer, switch
    that one suite to a browser-like environment and record the change — do not
    weaken an assertion to make it pass.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run check:boundaries</automated>
  </verify>
  <done>All eleven fixtures behave as tabulated, including the real-world body and the inverted bidi expectation. Ordinary Markdown and extended tables still render. Every link carries the no-opener relationship set.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: A policy that would contain a sanitizer failure</name>
  <files>src/proxy.ts, src/proxy.test.ts, next.config.ts, src/app/layout.tsx, src/app/globals.css</files>
  <behavior>
    - In production mode the script directive carries a nonce and no inline escape hatch; in development mode the evaluation hatch is present and the difference is explained by the code.
    - The style directive carries a nonce in production.
    - Object, base, frame-ancestors and form-action are all locked down; images are restricted to this origin.
    - Two requests produce two different nonces.
    - The nonce is set on both the forwarded request headers and the response.
    - A response from the running server carries the policy header, the content-type-options header, the referrer policy and the permissions policy.
  </behavior>
  <action>
    Write `src/proxy.ts`, `next.config.ts`, `src/app/layout.tsx` and
    `src/app/globals.css` exactly as References B, C, D and E.

    The filename matters and is easy to get wrong: the framework renamed this
    convention in version 16, and the file at the older name still resolves, so a
    file at the wrong name would appear to work in some places and be ignored in
    others. Use the current name.

    The policy is generated per request because a nonce cannot be produced at
    build time. The documented no-nonce alternative requires an inline-script
    escape hatch, which this project forbids by name and which would make the
    policy useless as a second layer behind the sanitizer. The cost the
    documentation attaches to nonces — that static optimization is disabled — is
    already paid, because every page in this phase reads the database and is
    dynamic regardless.

    The remaining headers are the same on every request, so they belong in the
    configuration file rather than in the per-request path. The framing header is
    deliberately omitted: the policy's frame-ancestors directive supersedes it.

    The stylesheet is the accessibility and layout floor, not the visual design —
    that is plan 01-06's. What lives here is the two-scheme declaration, the
    overflow rules that keep a thousand-character description and a
    seventy-character path from breaking a page, the visible focus ring, and the
    skip link. The theme needs no script at all, which matters beyond taste: an
    anti-flash inline script is precisely what the policy is there to forbid.

    Then write `src/proxy.test.ts` calling the proxy function directly with a
    constructed request and asserting on the header it returns, for both
    environment modes. Do not start a server for this; the function is pure with
    respect to its input.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run build &amp;&amp; sh -c 'PORT=3024 bun run start &gt;/tmp/agd-01-04.log 2&gt;&amp;1 &amp; SRV=$!; for i in $(seq 1 40); do curl -sf http://localhost:3024/skills &gt;/dev/null 2&gt;&amp;1 &amp;&amp; break; sleep 1; done; H=$(curl -sD - -o /dev/null http://localhost:3024/skills); kill $SRV 2&gt;/dev/null; echo "$H" | grep -qi "content-security-policy" || exit 1; echo "$H" | grep -qi "x-content-type-options: nosniff" || exit 1; echo "$H" | grep -qi "referrer-policy" || exit 1; echo "$H" | grep -qi "permissions-policy" || exit 1; echo "$H" | grep -i "content-security-policy" | grep -q "nonce-" || exit 1; echo "$H" | grep -i "content-security-policy" | grep -o "script-src[^;]*" | grep -q "unsafe-inline" &amp;&amp; exit 1; exit 0'</automated>
  </verify>
  <done>A production response carries a policy whose script directive holds a nonce and no inline escape hatch, alongside the three static security headers. Two requests produce two different nonces. The built application starts and serves pages under the policy.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Escaping at the metadata sinks</name>
  <files>src/components/escaping.test.tsx</files>
  <behavior>
    - A name containing a title-closing payload appears escaped when rendered as a heading, and no executable element appears in the output.
    - The same value used as a page title produces escaped output, not markup.
    - The same value used as a meta description produces escaped output.
    - A description containing quotes, angle brackets and an ampersand round-trips as text rather than as attribute-breaking markup.
    - A description over a thousand characters is truncated before it reaches the meta sink.
  </behavior>
  <action>
    Write `src/components/escaping.test.tsx` proving that hostile frontmatter
    values are inert at the three sinks the escaping requirement names.

    The framework escapes text children and attribute values it renders, and the
    metadata API renders titles and meta content through the same path — so a name
    carrying a title-closing payload is escaped rather than injected, and this
    suite documents that rather than adding machinery. The point of writing it
    down is the negative: the one sink that is not escaped requires raw-markup
    construction, and this phase must not add one. The boundary rule from plan
    01-01 already fails the build on that construction, so this suite and that
    rule together are the whole control.

    Include the truncation case. The longest real description measured is 1,077
    characters, which is useless in a meta tag and pushes against the layout
    requirement; truncating before the sink is one line and belongs with the other
    escaping guarantees rather than being rediscovered on the detail page.

    Do not add a structured-data block anywhere in this phase, and do not add a
    helper that would make adding one easy. It arrives later with explicit
    escaping and its own test.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run test &amp;&amp; bun run check:boundaries &amp;&amp; bun run ci</automated>
  </verify>
  <done>Hostile frontmatter values are proven escaped as a heading, as a title and as a meta description; long descriptions are truncated before the meta sink. `bun run ci` passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| stored artifact body → the rendered page | The body is attacker-controlled Markdown that may contain HTML, entity-encoded payloads and hostile link targets. |
| stored frontmatter values → titles, headings and meta content | Short strings from the same untrusted source, reaching sinks that look like plain text and are not always treated as such. |
| the served document → the browser | If a sanitizer gap ever exists, the policy is the only thing between it and execution. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-01-28 | Elevation of Privilege | `SkillBody` | critical | mitigate | Markdown is rendered to framework elements with no raw-markup construction anywhere in the path and no raw-HTML plugin installed; a narrowed allowlist runs as defence in depth; nine crafted fixtures plus one real body assert inertness. The boundary rule from plan 01-01 fails the build if a raw-HTML path is reintroduced. |
| T-01-29 | Elevation of Privilege | a future sanitizer gap | critical | mitigate | Production policy carries a nonce with no inline-script escape hatch, plus locked object, base and form-action directives, so an element that slipped through still would not execute. |
| T-01-30 | Information Disclosure | remote images in bodies | high | mitigate | Image and responsive-image elements are removed from the allowlist, and the policy restricts image sources to this origin, so a remote load is impossible and would be visible if attempted. |
| T-01-31 | Elevation of Privilege | untrusted link targets | high | mitigate | Default scheme restrictions retained on the URL transform; every rendered link carries the no-opener, no-referrer, nofollow and user-generated relationship set and opens in a new context. |
| T-01-32 | Tampering | metadata sinks | high | mitigate | Titles and meta content are plain strings rendered by the framework, which escapes them; no structured-data block and no raw-markup helper is added in this phase; three sinks are covered by tests. |
| T-01-33 | Tampering | clickjacking | medium | mitigate | Frame-ancestors is set to none, which supersedes the older framing header. |
| T-01-34 | Tampering | invisible characters silently removed | medium | accept | A bidi override renders through to the output unchanged, and a fixture asserts presence rather than absence. Visible sentinels are a later requirement and need the original bytes to exist. |
| T-01-35 | Denial of Service | a very large body | low | mitigate | Bodies are stored as a capped excerpt upstream, and a hundred-thousand-character render is covered by a test. |
</threat_model>

<verification>
1. All eleven injection fixtures behave as tabulated, including the inverted bidi expectation and the real reference-repository body.
2. Ordinary and extended Markdown still render; every link carries the no-opener relationship set.
3. Two requests through the proxy produce two different nonces.
4. A production response carries a policy whose script directive holds a nonce and no inline escape hatch.
5. The three static security headers are present on a served response; the framing header is deliberately absent.
6. Hostile frontmatter is proven escaped as a heading, as a title and as a meta description, and long descriptions are truncated before the meta sink.
7. Light and dark both resolve with no script anywhere in the document.
8. `bun run build` succeeds with no database, and `bun run ci` passes.
</verification>

<success_criteria>
- **REN-01** — bodies render through a sanitizing pipeline with raw HTML never parsed into elements, enforced structurally and by the boundary scanner.
- **REN-02** — a policy is served that would contain a sanitizer failure, with no inline-script escape hatch in production.
- **REN-03** — names and descriptions are escaped at the heading, title and meta sinks, and the one unescaped sink is not introduced.
- **REN-04** — the injection suite exists and passes before any ingested content is rendered by a product page.
- **QUA-05** — the injection corpus, including a real file and an invisible-character case, is a permanent regression running with no database and no network.
- **DIS-11** — light and dark both work with no script, focus is visible, and a skip link exists.
- CONTEXT.md resolved question 2 (D-02) — images are not rendered.
</success_criteria>

<output>
Create `.planning/phases/AGD-01-walking-skeleton/01-04-SUMMARY.md` when done.
Record the exact production policy string, the three schema deviations and why
each was made, and whether static markup rendering sufficed or the suite needed a
browser-like environment. Record no credential.
</output>
