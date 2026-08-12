import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_HOSTS,
  fetchServerPage,
  parseServerPage,
  RegistryError,
  readCapped,
  registryFetch,
} from './client';
import { REGISTRY_CAPS } from './types';

const REGISTRY_HOST = [...ALLOWED_HOSTS][0];

function fixture(name: string): string {
  return readFileSync(`fixtures/mcp-registry/list-${name}.json`, 'utf8');
}

/** Every call the stub saw, so "contacted the registry and nothing else" is an
 *  assertion rather than a design intention. */
let hosts: string[] = [];
let urls: string[] = [];

function stubRegistry(respond: (url: URL) => Response) {
  hosts = [];
  urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      urls.push(url.toString());
      return respond(url);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registryFetch', () => {
  it('refuses a non-HTTPS target without issuing a request', async () => {
    stubRegistry(() => new Response('{}'));
    await expect(registryFetch(`http://${REGISTRY_HOST}/v0/servers`)).rejects.toThrow(/non-HTTPS/i);
    expect(hosts).toEqual([]);
  });

  it('refuses a host that is not on the allowlist without issuing a request', async () => {
    stubRegistry(() => new Response('{}'));
    await expect(registryFetch('https://example.invalid/v0/servers')).rejects.toThrow(
      /Refusing to contact/,
    );
    expect(hosts).toEqual([]);
  });

  it('refuses a redirect whose location leaves the allowlist, and does not follow it', async () => {
    stubRegistry(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/x' } }),
    );

    await expect(registryFetch(`https://${REGISTRY_HOST}/v0/servers`)).rejects.toThrow(
      /Refusing to contact evil\.invalid/,
    );
    // One hop attempted, and the second never made: the hop the runtime would
    // have taken automatically is the one refused here.
    expect(hosts).toEqual([REGISTRY_HOST]);
  });

  it('follows a redirect that stays on the allowlist', async () => {
    let hop = 0;
    stubRegistry(() => {
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 301,
          headers: { location: `https://${REGISTRY_HOST}/v0/servers?moved=1` },
        });
      }
      return Response.json({ servers: [], metadata: { count: 0 } });
    });

    const res = await registryFetch(`https://${REGISTRY_HOST}/v0/servers`);
    expect(res.status).toBe(200);
    expect(hosts).toEqual([REGISTRY_HOST, REGISTRY_HOST]);
  });

  it('gives up rather than following a redirect chain past the cap', async () => {
    stubRegistry(
      (url) =>
        new Response(null, {
          status: 302,
          headers: { location: `https://${REGISTRY_HOST}${url.pathname}/again` },
        }),
    );
    await expect(registryFetch(`https://${REGISTRY_HOST}/v0/servers`)).rejects.toThrow(
      /too many times/,
    );
    // The initial request plus the redirects the cap allows, and no more.
    expect(hosts.length).toBe(REGISTRY_CAPS.maxRedirects + 1);
  });

  it('sends no authorization header to a host that needs none', async () => {
    let seen: Headers | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: URL | string, init: RequestInit) => {
        seen = new Headers(init.headers);
        return Response.json({ servers: [], metadata: { count: 0 } });
      }),
    );
    await registryFetch(`https://${REGISTRY_HOST}/v0/servers`);
    expect(seen?.has('authorization')).toBe(false);
  });
});

describe('readCapped', () => {
  it('stops reading past the byte ceiling instead of buffering the whole body', async () => {
    const body = 'x'.repeat(2048);
    await expect(readCapped(new Response(body), 1024)).rejects.toThrow(RegistryError);
  });

  it('reads a body that fits', async () => {
    expect(await readCapped(new Response('hello'), 1024)).toBe('hello');
  });
});

describe('parseServerPage', () => {
  it('reads a normal page and its cursor', () => {
    const page = parseServerPage(fixture('normal'));
    expect(page.rows).toHaveLength(5);
    expect(page.sanitized).toBe(false);
    expect(page.nextCursor).toBe('ex.gitlab/example:1.0.0');
  });

  it('treats the absent nextCursor key as the end of pagination, not an error', () => {
    // The live final page's metadata was exactly {"count": 55} — no null, no
    // empty string. A truthiness check happens to work today and would end every
    // sweep one page early on an empty-string cursor.
    const page = parseServerPage(fixture('empty'));
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('recovers a page carrying a raw control byte, on one retry, and still reads its cursor', () => {
    const raw = fixture('control-byte');
    expect(() => JSON.parse(raw)).toThrow();

    const page = parseServerPage(raw);
    expect(page.sanitized).toBe(true);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBe('ai.agentberg/agentberg:1.0.0');
  });

  it('refuses a page that is not JSON even after the control-byte strip', () => {
    expect(() => parseServerPage('{"servers":')).toThrow(
      expect.objectContaining({ failure: 'invalid_response' }),
    );
  });

  it('refuses a page carrying no servers array', () => {
    expect(() => parseServerPage('{"metadata":{"count":0}}')).toThrow(/no servers array/);
  });

  it('refuses a non-string cursor rather than coercing it', () => {
    expect(() => parseServerPage('{"servers":[],"metadata":{"nextCursor":7}}')).toThrow(
      /non-string cursor/,
    );
  });
});

describe('fetchServerPage', () => {
  it('asks the registry and nothing else, carrying the cap and the watermark', async () => {
    stubRegistry(() => new Response(fixture('normal')));

    const page = await fetchServerPage({ cursor: 'c1', updatedSince: '2026-08-01T00:00:00.000Z' });

    expect(page.rows).toHaveLength(5);
    expect(hosts).toEqual([REGISTRY_HOST]);
    const asked = new URL(urls[0]);
    expect(asked.searchParams.get('limit')).toBe(String(REGISTRY_CAPS.pageLimit));
    expect(asked.searchParams.get('cursor')).toBe('c1');
    expect(asked.searchParams.get('updated_since')).toBe('2026-08-01T00:00:00.000Z');
  });

  it('reports a non-2xx answer as unavailable rather than parsing it', async () => {
    stubRegistry(() => new Response('nope', { status: 503 }));
    await expect(fetchServerPage()).rejects.toThrow(
      expect.objectContaining({ failure: 'unavailable' }),
    );
  });
});
