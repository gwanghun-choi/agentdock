---
phase: AGD-01-walking-skeleton
plan: 04
subsystem: rendering-and-policy
tags: [xss, sanitizer, csp, nonce, escaping, accessibility]
status: complete

requires:
  - 01-01 (react-markdown, remark-gfm, rehype-sanitize; check-boundaries no-raw-html rule)
provides:
  - src/components/SkillBody.tsx — the sanitizing Markdown renderer
  - src/components/metadata.ts — metaDescription() truncation before the meta sink
  - src/proxy.ts — per-request nonce and the Content-Security-Policy
  - next.config.ts — the three static security headers
  - src/app/globals.css — the light/dark and overflow floor
  - fixtures/xss/ — the injection corpus
affects:
  - vitest.config.ts (include widened to .tsx)
  - src/app/layout.tsx (two-scheme declaration, skip link)

tech-stack:
  added: []
  patterns:
    - Raw markup is never parsed; the sanitizer is the second layer, not the first
    - Light and dark with no script, because an inline script is what the policy forbids
    - Truncation belongs with the escaping guarantees, not on each page

key-files:
  created:
    - src/components/SkillBody.tsx
    - src/components/SkillBody.test.tsx
    - src/components/escaping.test.tsx
    - src/components/metadata.ts
    - src/proxy.ts
    - src/proxy.test.ts
    - next.config.ts
    - src/app/globals.css
    - fixtures/xss/ (10 fixtures + README.md)
  modified:
    - vitest.config.ts
    - src/app/layout.tsx

decisions:
  - renderToStaticMarkup sufficed — no jsdom, no testing library, no environment switch
  - The eleventh fixture is READ IN PLACE from the frozen corpus, not copied
  - metaDescription lives in its own module so the truncation test has something to call

metrics:
  duration: ~25m
  completed: 2026-08-10

actuals:
  tokens: 49000
  tasks: 3
  commits: 0
---

# Phase AGD-01 Plan 04: Safe Rendering and a Survivable Failure Summary

Untrusted Markdown renders to framework elements with no raw-markup construction
anywhere in the path, behind a narrowed allowlist that drops images entirely, and
under a production policy whose script directive carries a per-request nonce and
no inline escape hatch — verified against a real running server, not asserted.

## Not committed

**No `git commit` or `git push` was run.** The maintainer commits.

## Static markup rendering sufficed — no browser environment needed

The plan flagged this as an unverified research assumption with a named fallback.
**`renderToStaticMarkup` from `react-dom/server` works with `react-markdown@10`
under the plain `node` vitest environment.** No jsdom, no testing library, no
`environment` switch, no extra dependency. The only change to `vitest.config.ts`
was widening `include` to cover `.tsx`.

No assertion was weakened to make anything pass.

## The exact production policy string

Captured from a real response of the built server on `http://localhost:3024/skills`:

```
default-src 'self'; script-src 'self' 'nonce-MDNkZWFhOTYtODdjYy00ZDIzLWE0MDYtNTE2MzJkY2EwZjM3' 'strict-dynamic'; style-src 'self' 'nonce-MDNkZWFhOTYtODdjYy00ZDIzLWE0MDYtNTE2MzJkY2EwZjM3'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

No `unsafe-inline`. No `unsafe-eval`. The nonce differs on every request —
two consecutive requests produced `nonce-MDNkZWFh…` and `nonce-ODJlY2Ey…`.

The framework picked the nonce up for its own preload, which is the proof the
file is at the right name:

```
Link: </_next/static/chunks/14yei4hk4yrdr.css>; rel=preload; as="style"; nonce="MDNkZWFhOTYt…"
```

Alongside it, from `next.config.ts`:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

`X-Frame-Options` is **deliberately absent** — `frame-ancestors 'none'` supersedes
it. `bun run build` reports `ƒ Proxy (Middleware)`, confirming `src/proxy.ts` is
the file the framework loaded.

## The three schema deviations, and why each was made

1. **`img` removed.** The default schema permits an image from any HTTPS host.
   Every detail page would then be an address-and-load-signal leak to whatever
   host the artifact's author chose, for no value in a skill listing. The policy's
   `img-src 'self'` blocks the load anyway, so keeping the element would produce
   broken images plus a console full of violations. Images render as their alt
   text. This is CONTEXT.md resolved question 2 / D-02.
2. **`source` and `picture` removed with it.** The responsive source-set
   attribute carries **no scheme restriction** in the default schema, and this
   phase has no responsive-image requirement. Leaving them would keep the leak
   open through a different element after `img` was closed.
3. **`rel` and `target` added to `a`.** The default omits both, so the component
   override could not set them — the sanitizer would strip exactly the attributes
   added to make an untrusted link safe. Every rendered link now carries
   `rel="noopener noreferrer nofollow ugc" target="_blank"`.

Everything else is left at the default on purpose. It is a reviewed allowlist
with scheme restrictions, comments and doctypes off, and identifier clobbering
prevented; hand-rewriting it would swap a reviewed control for an unreviewed one.
The URL transform is untouched — it is the one documented way to reintroduce
injection into this component.

## The injection corpus

All eleven behave as tabulated.

| Fixture | Result |
|---|---|
| `script-tag` | no `<script`, no `alert(`, no marker; the prose survives |
| `img-onerror` | no `<img`, no `onerror`, no marker |
| `js-url-link` | no `javascript:` anywhere; the link **text** survives |
| `data-url-img` | no `data:`, no `<img` |
| `html-comment` | no `<!--`, and the instruction-shaped text is gone |
| `style-attr` | no `style=`, no `position:fixed` |
| `iframe` | no `<iframe`, no `evil.tld` |
| `svg-onload` | no `<svg`, no `onload` |
| `nested-encoded` | see below |
| `bidi-override` | **U+202E is PRESENT** — the inverted expectation |
| real reference body | see below |

**`nested-encoded` corrected an assertion, not the renderer.** The fixture holds
both an entity-encoded copy (`&lt;ScRiPt&gt;alert(…)`) and a raw uppercase copy
(`<SCRIPT>alert(…)</SCRIPT>`). The entity-encoded copy is *supposed* to survive —
as escaped text, which is literally what the author wrote and is inert. Asserting
`alert(` never appears would have been asserting the renderer corrupts text. The
assertion is now precise: the output contains `&lt;ScRiPt&gt;` (escaped, proving
nothing decoded before sanitizing), contains no `<script` and no `href=`, and
holds **exactly one** occurrence of the marker rather than two — the raw copy was
removed text and all.

**The real body.** `skills/algorithmic-art/SKILL.md` from the frozen
`anthropics-skills` corpus is the one file of the eighteen that contains HTML —
`<script src="…p5.min.js">`, two `<div>`s and a `<span>`. It is **read in place**
from the capture rather than copied into `fixtures/xss/`, so the two can never
drift apart. The test first asserts the source really does contain `<script src=`
(otherwise it would be proving nothing), then that the rendered output contains no
`<script`, no `<img`, no `<iframe`, keeps its prose, and keeps the `<code>` fence
the markup lived inside.

Ordinary Markdown still renders: `<h1>`, `<h2>`, `<li>`, remark-gfm `<table>` and
`<del>`, fenced `<code>`, `<em>`, `<strong>`. A 100,000-character body renders
without error.

## Escaping at the metadata sinks

| Sink | Payload `</title><script>alert("xss-marker")</script>` becomes |
|---|---|
| heading | `<h1>&lt;/title&gt;&lt;script&gt;alert(&quot;xss-marker&quot;)&lt;/script&gt;</h1>` |
| page title | exactly one `<title>` and one `</title>`; the payload is `&lt;script&gt;` |
| meta description | exactly one `content="`; the payload is `&lt;script&gt;` |

`a "quoted" & <angled> 'value'` round-trips to
`content="a &quot;quoted&quot; &amp; &lt;angled&gt; &#x27;value&#x27;"` — text in,
text out, nothing became markup.

The one sink the framework does **not** escape requires raw-markup construction,
and the `no-raw-html` rule in `scripts/check-boundaries.mjs` fails the build on
it. That rule and this suite together are the whole control. No structured-data
block was added, and no helper that would make adding one easy.

## Deviations from Plan

### 1. [Rule 3 — Blocking] `src/components/metadata.ts` was added

The plan lists only `src/components/escaping.test.tsx` under Task 3, but the
required behaviour — "a description over a thousand characters is truncated
before it reaches the meta sink" — needs something to call. A test that truncates
inline would be testing `String.prototype.slice`.

`metaDescription()` is four lines in its own module, capped at 200 characters
(the useful length for a meta description; the longest real description measured
is 1,077). It slices **code points, not code units**, so an emoji cannot be cut in
half — a test covers that with 400 rockets. It deliberately does **not** escape:
the framework escapes at the sink, and escaping twice would render visible
entities.

### 2. The eleventh fixture is read in place, not copied

The plan says "copied from the frozen corpus rather than written by hand". Reading
it directly from `fixtures/anthropics-skills/files/` satisfies the intent —
the point is that it is a real file and not a crafted one — and avoids a 20 KB
duplicate that could silently diverge from the capture.

### 3. `fixtures/xss/` holds ten files, not eleven

By consequence of the above. `fixtures/xss/README.md` documents the eleventh and
where it lives.

### 4. Per-task commits skipped

Forbidden by the phase's hard constraints.

## Requirements satisfied

| ID | Evidence |
|---|---|
| REN-01 | No raw-HTML plugin anywhere; HTML in a body is a text node, not markup. The `no-raw-html` boundary rule passes over 23 source files. Ten crafted fixtures plus one real body assert inertness. |
| REN-02 | The production policy string above, captured from a live response: nonce present, `unsafe-inline` and `unsafe-eval` both absent, `object-src`/`base-uri`/`frame-ancestors` locked. |
| REN-03 | Heading, title and meta description each proven escaped; long descriptions truncated before the meta sink. |
| REN-04 | The suite exists and passes **before** any product page renders ingested content — `/skills` still renders only stored rows from plan 01-01. |
| QUA-05 | The corpus, including the real file and the invisible-character case, runs under `CI=1 bun run test` with no database and no network. |
| DIS-11 | `color-scheme: light dark` with `light-dark()` variables and **no script at all**; a visible `:focus-visible` outline; a `.skip-link` in the layout. |
| D-02 | `img`, `source` and `picture` are absent from `tagNames`, and `img-src 'self'` makes a remote load impossible and visible if attempted. |

## Known Stubs

| Stub | File | Reason |
|---|---|---|
| `metaDescription()` exported but not yet used by a page | `src/components/metadata.ts` | The detail page that consumes it is plan 01-06's. Wiring it to a page that does not exist would be scaffolding. |
| `SkillBody` not rendered by any route | `src/components/SkillBody.tsx` | Intentional and required: REN-04 says the injection suite passes **before** ingested content is rendered anywhere. |
| `.skip-link` targets `#main`, which no page defines yet | `src/app/layout.tsx` | The page shell carrying `<main id="main">` is plan 01-06's. |
| `globals.css` carries no visual design | `src/app/globals.css` | The accessibility and overflow floor only; design is plan 01-06's. |

Neither stub blocks this plan's goal.

## Notes for later plans

- The file is `src/proxy.ts`, not `middleware.ts`. The old name still resolves,
  so a file at the wrong name would appear to work in some places and be ignored
  in others.
- The nonce reaches the render pass through `x-nonce` on the forwarded request
  headers (`x-middleware-request-x-nonce` on the response object) — verified
  against the real `NextResponse`, not assumed.
- Every page is dynamic, so the static-optimization cost of the nonce is already
  paid. Do not add `unsafe-inline` to reclaim it.
- Do not add a theme toggle with an anti-flash inline script. That inline script
  is precisely what the policy exists to forbid.

## Self-Check: PASSED

All nine created files exist on disk, and the served-header verification was run
against a real build. Nothing was committed, by constraint.
