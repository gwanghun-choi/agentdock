# Reference Analysis — SkillMaru

Direct analysis of `https://skillmaru.hell0world.net/`, named in the project brief as the
primary product reference. Automated content fetching failed (client-rendered SPA), so
this analysis was done by inspecting the served HTML shell, the JavaScript bundle, and the
public HTTP surface.

**No design, markup, styling, or code from SkillMaru is copied into AgentDock.** This
document records information architecture and product positioning only.

**Status:** 검증됨 — observed directly
**Evidence:** HTTP responses and served bundle, 2026-08-10
**Last verified:** 2026-08-10

## Headline finding: it is not the product the brief assumes

The brief treats SkillMaru as the closest analog to AgentDock — a public skill discovery
site. **It is not.** Three independent observations establish this:

1. Its own Open Graph description reads:
   `사내 에이전트 스킬 레지스트리 — 스킬 패키지를 발행·탐색·관리한다.`
   ("**In-house** agent skill registry — publish, browse and manage skill packages.")
2. `GET /api/web/packages` returns **HTTP 401**. Browsing the catalog requires
   authentication. There is no public listing at all.
3. Its API surface is built around publishing and tenancy, not discovery:
   `/api/v1/namespaces`, `/api/v1/tokens`, `/api/v1/auth/local/register`,
   `/api/v1/auth/local/login`, `/api/v1/admin/labels`, `/api/v1/admin/search/rebuild`.
   Publish tokens and namespaces are the shape of an internal npm, not a crawler.

**SkillMaru is a push-model private registry: authors publish packages into it.
AgentDock is a pull-model public index: it discovers artifacts already living in public
GitHub repositories.** These are structurally different products that happen to share a
noun. SkillMaru is therefore a useful reference for *information architecture* and a poor
reference for *competitive positioning* — it is not competing for AgentDock's users.

It also appears to be a rebranded deployment of an upstream open-source project called
**SkillHub**: the runtime config global is `window.__SKILLHUB_RUNTIME_CONFIG__`, the
portal container is `<div id="skillhub-portals">`, and HTML comments in the shell refer to
keeping "upstream's own public/favicon.svg" untouched so "cherry-picks still apply
cleanly". The deployment is a fork tracking an upstream, not a bespoke product.

## What was observed

### Stack and delivery

| Aspect | Observation |
|--------|-------------|
| Rendering | Client-side SPA (Vite build, React 19). HTML shell is 3.2 KB with an empty `#root`. |
| Bundle | Single ~640 KB main chunk. |
| Styling | Tailwind, `darkMode: ['class']`, **dark is the default theme**, light is opt-in via `localStorage['skillmaru.theme']`. |
| Fonts | Inter (400–700) + JetBrains Mono (400,500) from Google Fonts. |
| i18n | `lang="ko"`, translation keys present (`apiError.*`), `translate="no"` set to stop Chrome auto-translate racing React 19. |
| Backend | Same-origin (`connect-src 'self'`). Envelope is `{code, msg, data, timestamp, requestId}` with nanosecond RFC3339 timestamps — suggesting a Go backend. |
| CSP | Present and reasonably tight, but `script-src` allows `'unsafe-inline'` and `'unsafe-eval'`. |

### Catalog model

- **Namespaces** — packages are namespaced, like npm scopes.
- **Visibility** — a per-package facet, implying public/private within the tenant.
- **Labels** — a *controlled* taxonomy, administered via `/api/v1/admin/labels` with an
  explicit `sort-order` endpoint. Not free-form user tags.
- **Status** — a package lifecycle facet.
- **Downloads** — tracked and sortable, which is possible only because SkillMaru actually
  serves the packages.
- **Search** — server-side with an admin-triggered index rebuild
  (`/api/v1/admin/search/rebuild`), i.e. a maintained inverted index rather than ad-hoc
  querying.
- **Sort options observed:** `relevance`, `downloads`, `stars`, `updated`, `newest`,
  `name`.

## What AgentDock should take, and what it must not

### Worth adopting

| Observation | Why it applies to AgentDock |
|-------------|------------------------------|
| Controlled, admin-ordered label taxonomy rather than free tags | Free tags on crawled data degrade into noise fast. A curated label set with deliberate ordering keeps facets meaningful at small scale. |
| `relevance` as the default sort, with explicit alternatives | Matches the FTS-first search plan; relevance-by-default is the right registry behaviour. |
| Dark theme as a genuine first-class default, applied pre-paint | The pre-paint inline script that avoids a light/dark flash on load is the correct pattern and costs almost nothing. |
| Inter + JetBrains Mono | A sober developer-tool pairing consistent with the target aesthetic. Convergent, not copied — it is the same pairing GitHub/Linear-class tools use. |
| Explicit `status` lifecycle facet | AgentDock needs an analogous concept for ingestion state (indexed / failed / stale / delisted). |

### Deliberately diverge

| SkillMaru does | AgentDock should not, because |
|----------------|-------------------------------|
| Requires auth to browse | AgentDock's entire value is public discovery. Zero-auth browse is the product, and it is also what makes it linkable and shareable. |
| Client-side rendering only | A discovery product that renders client-side is **invisible to search engines**. For AgentDock, organic search is the primary acquisition channel — server rendering is a real competitive advantage here, not a preference. This is the strongest argument in the whole reference analysis for SSR. |
| Sorts by `downloads` | AgentDock does not host or serve artifacts, so it has no download signal and must never fabricate one. Freshness and source-repo signals substitute. |
| Namespaces + publish tokens | Push-model concepts. AgentDock's identity is derived from the source repository, so `owner/repo` is the namespace and no token infrastructure is needed. |
| No security or capability analysis surfaced anywhere | This is the gap AgentDock exists to fill. |

## Limitations of this analysis

- The catalog itself was never seen — it is behind authentication. All catalog structure
  above is inferred from the client bundle's API calls, facet labels, and sort options,
  not from rendered pages.
- Detail-page information architecture could **not** be observed. The brief asks for an
  analysis of the detail screen; that is not obtainable without credentials.
- No attempt was made to authenticate, register an account, or bypass the 401. Only
  public, unauthenticated endpoints were requested, and only a handful of times.

**Recommendation:** treat the detail-page question as open. AgentDock's package detail
layout should be derived from npm/pkg.go.dev/crates.io conventions (documented in
`FEATURES.md`) plus its own capability-disclosure sections, rather than waiting on a
SkillMaru reference that cannot be obtained.

## Sources

- `https://skillmaru.hell0world.net/` — HTML shell, meta tags, CSP, theme bootstrap script
- `https://skillmaru.hell0world.net/assets/index-DA9gP67O.js` — module loader
- `https://skillmaru.hell0world.net/assets/main-B46Hd5hd.js` — application bundle; API
  paths, facet labels, sort options, runtime config global
- `https://skillmaru.hell0world.net/api/web/packages?limit=2` — HTTP 401
- `https://skillmaru.hell0world.net/api/v1/auth/providers` — HTTP 200, empty provider list
