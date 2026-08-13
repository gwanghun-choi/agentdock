import Link from 'next/link';
import type { ReactNode } from 'react';
import { DockIcon, SearchIcon } from '@/components/Icon';
import { SearchHotkey } from '@/components/SearchHotkey';
import './globals.css';

export const metadata = {
  title: 'AgentDock',
  description: 'Discover and inspect AI agent skills, plugins, and MCP servers.',
};

// Single-line and named, rather than JSX text wrapped across lines, so it is
// one exact, unambiguous substring — check-boundaries.mjs's SANCTIONED
// ledger (rule six, no-verdict-vocabulary) excises this precise string
// before its scan runs. Content unchanged from the sentence this footer has
// always shipped; only its representation moved (04-04, Measurement 7).
const FOOTER_DISCLAIMER =
  'AgentDock reads files and reports what it read. It does not run them, and it cannot say whether an artifact is safe. Read anything before you use it.';

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

        <header className="site-header">
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

        {/* Renders nothing. It binds `/` and Ctrl/Cmd+K to the search field —
            the only JavaScript this layout loads, and the page is complete
            without it. */}
        <SearchHotkey />

        {/* The skip link's destination, and the one main landmark per page. */}
        <main id="main" className="wrap">
          {children}
        </main>

        <footer className="site-footer">
          <div className="wrap">
            <p>{FOOTER_DISCLAIMER}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
