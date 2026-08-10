import type { ReactNode } from 'react';

export const metadata = {
  title: 'AgentDock',
  description: 'Discover and inspect AI agent skills, plugins, and MCP servers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
