import localFont from 'next/font/local';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRightIcon, DockIcon, SearchIcon } from '@/components/Icon';
import { PointerTilt } from '@/components/PointerTilt';
import { SearchHotkey } from '@/components/SearchHotkey';
import { SearchLauncher } from '@/components/SearchLauncher';
import { TYPE_FILTER_IDS } from '@/components/typeFilters';
import './globals.css';

// One typeface for every word on the site, served from this origin. It was the
// system UI stack, which set the same page in Segoe UI, San Francisco or
// whatever a Linux desktop had installed — the brand looked like a different
// product on each. Schibsted Grotesk (OFL-1.1, ./fonts/OFL.txt) is the latin
// subset of the variable font, every weight in one 46,752-byte file, preloaded.
// No request leaves the origin: the CSP's font-src is 'self'. Glyphs outside
// latin — the CJK descriptions — fall through to the stack in --sans.
const brand = localFont({
  src: './fonts/SchibstedGrotesk-latin-wght.woff2',
  weight: '400 900',
  variable: '--font-brand',
  display: 'swap',
});

const DESCRIPTION =
  'An index of agent skills, plugins, MCP servers, commands, hooks and subagents read from public GitHub repositories, each linked to the commit it was read at.';

// Text-only sharing cards. No image is generated and no absolute URL is
// emitted: the deployment's origin is not recorded anywhere in this repository
// (CLAUDE.md, "Deployment work"), and a guessed one would be wrong on the
// Docker path.
export const metadata = {
  title: 'AgentDock',
  description: DESCRIPTION,
  openGraph: {
    siteName: 'AgentDock',
    type: 'website',
    title: 'AgentDock',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary', title: 'AgentDock', description: DESCRIPTION },
};

// Single-line and named, rather than JSX text wrapped across lines, so it is
// one exact, unambiguous substring — check-boundaries.mjs's SANCTIONED
// ledger (rule six, no-verdict-vocabulary) excises this precise string
// before its scan runs. Content unchanged from the sentence this footer has
// always shipped; only its representation moved (04-04, Measurement 7).
const FOOTER_DISCLAIMER =
  'AgentDock reads files and reports what it read. It does not run them, and it cannot say whether an artifact is safe. Read anything before you use it.';

// Shorter than the listing's labels: a column of links, not filter names.
const FOOTER_KINDS = {
  skill: 'Skills',
  plugin: 'Plugins',
  mcp_server: 'MCP servers',
  command: 'Commands',
  hook: 'Hooks',
  agent: 'Subagents',
} as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // One scheme, the stage's, from the hero to the footer (Phase 97). The page used to turn
    // light under the hero on a light system, which made the listing and the detail page a
    // different site. Declared here so form controls and scrollbars agree.
    <html lang="en" className={brand.variable} style={{ colorScheme: 'dark' }}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <header className="site-header stage">
          <div className="wrap">
            <Link href="/" className="brand">
              <DockIcon />
              AgentDock
            </Link>
            {/* Relative hrefs throughout. An internal link must never carry a
                scheme: the deployment is served over plain HTTP today and behind
                TLS later, and neither should require a code change. */}
            <nav aria-label="Main">
              <Link href="/artifacts">Artifacts</Link>
              {/* No shortcut hint here. It was tried and removed: a <kbd> inside
                  the link needs aria-hidden to keep "slash" out of the link's
                  accessible name, and aria-hidden on a descendant of a focusable
                  element is the pattern that produces a control a screen reader
                  announces differently from what is on screen. The hint belongs
                  next to the field the key acts on, which is where it is. */}
              <Link href="/artifacts?q=">
                <SearchIcon />
                Search
              </Link>
            </nav>
          </div>
        </header>

        {/* A closed <dialog>: display:none, and absent from the accessibility
            tree, until something calls showModal() on it. Server-rendered
            markup, no client component, and its close button works with
            JavaScript off because <form method="dialog"> is the platform's. */}
        <SearchLauncher />

        {/* Renders nothing. It binds `/` and Ctrl/Cmd+K to the search field, or
            to the launcher above on a page that has no field. One of the two
            pieces of JavaScript this layout loads, and every page is complete
            without it. */}
        <SearchHotkey />
        <PointerTilt />

        {/* The skip link's destination, and the one main landmark per page. */}
        <main id="main" className="wrap">
          {children}
        </main>

        <footer className="site-footer stage">
          <div className="wrap footer-grid">
            <div className="footer-close">
              <p className="footer-line">Read it before you use it.</p>
              <p>{FOOTER_DISCLAIMER}</p>
              <Link className="footer-cta" href="/artifacts">
                Into the index <ArrowRightIcon />
              </Link>
            </div>
            <nav aria-label="Kinds, from the footer" className="footer-links">
              <p>Kinds</p>
              <ul>
                {TYPE_FILTER_IDS.map((id) => (
                  <li className={`hue-${id}`} key={id}>
                    <Link href={`/artifacts?type=${id}`}>{FOOTER_KINDS[id]}</Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Orders, from the footer" className="footer-links">
              <p>By date</p>
              <ul>
                <li>
                  <Link href="/artifacts?sort=added">First indexed</Link>
                </li>
                <li>
                  <Link href="/artifacts?sort=changed">Changed upstream</Link>
                </li>
                <li>
                  <Link href="/#policy-heading">How one gets indexed</Link>
                </li>
              </ul>
            </nav>
          </div>
          {/* The name from the stylesheet: the brand link at the top of the page is the name,
              this is the sign on the building. */}
          <div className="footer-mark" />
        </footer>
      </body>
    </html>
  );
}
