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

  const late = async () => {
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
    return { fail, errors, stream };
  };

  it('keeps search and the links, and says so, when the read fails after the first byte', async () => {
    const lines = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fail, errors, stream } = await late();
    fail(Object.assign(new Error('down after the budget: secret-host'), { code: '42703' }));
    const html = await new Response(stream).text();
    // Nothing thrown: app/error.tsx would have replaced the search box and the chips.
    expect(errors).toHaveLength(0);
    expect(html).toContain('name="q"');
    expect(html).toContain('href="/artifacts?type=skill"');
    expect(html).toContain('could not read its index');
    expect(html).toContain('Try again');
    // Nothing that reads as data, and release.mjs's smoke fails on this.
    expect(html).not.toMatch(/chip-count">\d/);
    expect(html).not.toContain('a-skill');
    const logged = lines.mock.calls.flat().join(' ');
    expect(logged.match(/home_unavailable/g)).toHaveLength(1);
    expect(logged).toContain('"reason":"failed"');
    expect(logged).toContain('"code":"42703"');
    expect(logged).not.toContain('secret-host');
    lines.mockRestore();
  });

  it('still shows data that arrives at the slowest wake measured', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      let arrive = (_: HomeData) => {};
      const pending = (async () => {
        readHomeData.mockReturnValue(
          new Promise((resolve) => {
            arrive = resolve;
          }),
        );
        return renderToReadableStream(await HomePage());
      })();
      await vi.advanceTimersByTimeAsync(400);
      const body = new Response(await pending).text();
      await vi.advanceTimersByTimeAsync(13_700);
      arrive(data);
      const html = await body;
      expect(html).toContain('a-skill');
      expect(html).not.toContain('could not read its index');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a read that never ends, rather than holding the stream open', async () => {
    const lines = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const pending = (async () => {
        readHomeData.mockReturnValue(new Promise(() => {}));
        return renderToReadableStream(await HomePage());
      })();
      await vi.advanceTimersByTimeAsync(400);
      const stream = await pending;
      const body = new Response(stream).text();
      await vi.advanceTimersByTimeAsync(20_000);
      const html = await body;
      expect(html).toContain('could not read its index');
      expect(lines.mock.calls.flat().join(' ')).toContain('"reason":"deadline"');
    } finally {
      vi.useRealTimers();
      lines.mockRestore();
    }
  });

  it('tells a reader with JavaScript off what to do, and takes the skeleton away', async () => {
    const { fail, stream } = await late();
    fail(new Error('end the stream'));
    const html = await new Response(stream).text();
    expect(html).toMatch(/<noscript>.*cannot fill in by itself.*<\/noscript>/s);
    expect(html).toContain('class="home-pending"');
  });

  it('is a failed page, not a placeholder, when the read fails inside the budget', async () => {
    readHomeData.mockRejectedValue(new Error('down'));
    await expect(HomePage()).rejects.toThrow('down');
  });
});
