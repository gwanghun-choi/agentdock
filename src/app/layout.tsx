import Link from 'next/link';
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

        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand">
              AgentDock
            </Link>
            <nav>
              <Link href="/skills">Skills</Link>
            </nav>
          </div>
        </header>

        {/* The skip link's destination, and the one main landmark per page. */}
        <main id="main" className="wrap">
          {children}
        </main>

        <footer className="site-footer">
          <div className="wrap">
            <p>
              AgentDock reads files and reports what it read. It does not run them, and it cannot
              say whether an artifact is safe. Read anything before you use it.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
