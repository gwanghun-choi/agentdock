import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { HomeData } from '@/db/queries/homeSnapshot';

const data: HomeData = {
  recent: [
    {
      id: 1,
      name: 'a-skill',
      summary: 'One row.',
      type: 'skill',
      sourcePath: 'skills/a/SKILL.md',
      fullName: 'o/r',
      stars: 5,
      commitSha: 'c'.repeat(40),
      scannedAt: new Date('2026-11-06T00:00:00Z'),
      notListedBecause: null,
    },
  ],
  visible: { skill: 1234, hook: 5 },
  hidden: 2,
  lastSync: new Date('2026-11-06T06:30:00Z'),
};

const readHomeData = vi.fn<() => Promise<HomeData>>();
vi.mock('@/db/queries/homeSnapshot', () => ({ readHomeData: () => readHomeData() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: HomePage } = await import('./page');

describe('the home page and its first byte', () => {
  it('goes out whole, with no boundary, when the data is inside the budget', async () => {
    readHomeData.mockResolvedValue(data);
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('1,239');
    expect(html).toContain('1,241');
    expect(html).toContain('a-skill');
    expect(html).toContain('last sync without errors 2026-11-06 06:30 UTC');
    expect(html).not.toContain('Loading artifacts');
  });

  it('sends the words, search and working links first when the data is late', async () => {
    let arrive = (_: HomeData) => {};
    readHomeData.mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    const started = Date.now();
    const stream = await renderToReadableStream(await HomePage());
    expect(Date.now() - started).toBeLessThan(2000);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    // Everything sent before the data arrives: a stream chunks the shell, so read
    // until nothing more comes.
    let shell = '';
    let next = reader.read();
    for (;;) {
      const chunk = await Promise.race([
        next,
        new Promise<null>((resolve) => setTimeout(resolve, 100, null)),
      ]);
      if (!chunk) break;
      shell += decoder.decode(chunk.value);
      next = reader.read();
    }
    expect(shell).toContain('Find agent artifacts');
    expect(shell).toContain('name="q"');
    expect(shell).toContain('href="/artifacts?type=hook"');
    expect(shell).toContain('Loading artifacts');
    // A placeholder must never read as a figure.
    expect(shell).not.toMatch(/chip-count">\d/);
    expect(shell).not.toContain('None listed yet');

    arrive(data);
    let rest = '';
    for (;;) {
      const chunk = await next;
      if (chunk.done) break;
      rest += decoder.decode(chunk.value);
      next = reader.read();
    }
    expect(rest).toContain('1,239');
    expect(rest).toContain('a-skill');
  });

  it('hands a read that fails after the first byte to the error boundary', async () => {
    let fail = (_: Error) => {};
    readHomeData.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const errors: unknown[] = [];
    const page = await HomePage();
    const stream = await renderToReadableStream(page, {
      onError: (e) => {
        errors.push(e);
      },
    });
    fail(new Error('down after the budget'));
    const html = await new Response(stream).text();
    expect(errors).toHaveLength(5);
    expect(html).not.toMatch(/chip-count">\d/);
  });

  it('is a failed page, not a placeholder, when the read fails inside the budget', async () => {
    readHomeData.mockRejectedValue(new Error('down'));
    await expect(HomePage()).rejects.toThrow('down');
  });
});
