import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

/**
 * The proxy is pure with respect to its input, so no server is started here.
 * The served-response check lives in the plan's build verification instead.
 */
function request(
  url = 'https://agentdock.test/skills',
  headers?: Record<string, string>,
): NextRequest {
  return new Request(url, { headers }) as unknown as NextRequest;
}

function policy(res: Response): string {
  return res.headers.get('content-security-policy') ?? '';
}

function directive(csp: string, name: string): string {
  return csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy — the production policy', () => {
  it('carries a nonce on the script directive and no inline escape hatch', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const csp = policy(proxy(request()));
    const script = directive(csp, 'script-src');

    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain('unsafe-inline');
    expect(script).not.toContain('unsafe-eval');
  });

  // A nonce on style-src would be security theatre: the CSP spec applies a nonce
  // to `<style>` ELEMENTS only and cannot apply it to a `style` ATTRIBUTE, so it
  // blocks nothing an attacker would use while breaking this application's own
  // rendering. What must hold is that style-src still forbids REMOTE
  // stylesheets, and that the concession never leaks into script-src.
  it('allows inline style, still forbids remote stylesheets', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const style = directive(policy(proxy(request())), 'style-src');
    expect(style).toContain("'unsafe-inline'");
    expect(style).toContain("'self'");
    expect(style).not.toContain('http');
    expect(style).not.toContain('*');
  });

  it('never lets the inline concession reach script-src', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const script = directive(policy(proxy(request())), 'script-src');
    expect(script).not.toContain('unsafe-inline');
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });

  it.each([
    ["object-src 'none'"],
    ["base-uri 'none'"],
    ["frame-ancestors 'none'"],
    ["form-action 'self'"],
    ["img-src 'self'"],
    ["default-src 'self'"],
    ['upgrade-insecure-requests'],
  ])('locks down %s', (fragment) => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(policy(proxy(request())).split('; ')).toContain(fragment);
  });
});

// A deployment served over plain HTTP, with no TLS and no terminating proxy,
// is a supported shape: `AGENTDOCK_PORT` publishes a port and nothing requires
// a certificate in front of it. `upgrade-insecure-requests` rewrote every
// in-page link to https://, where nothing listens, so the home page loaded and
// each internal navigation failed. These pin the directive to the scheme the
// request actually arrived on, in both directions — a one-sided test would let
// the bug back in by simply deleting the directive.
//
// The host below is deliberately a documentation-reserved address (RFC 5737)
// rather than the address of any real deployment: a test is a tracked file, and
// a tracked file naming a live host is one grep away from being a target list.
const HTTP_ORIGIN = 'http://192.0.2.10:8080';

describe('proxy — upgrade-insecure-requests follows the request scheme', () => {
  const has = (res: Response) => policy(res).split('; ').includes('upgrade-insecure-requests');

  it('omits the upgrade on a plain HTTP origin, so internal links stay HTTP', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(has(proxy(request(`${HTTP_ORIGIN}/artifacts`)))).toBe(false);
  });

  it('keeps the upgrade on an HTTPS origin', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(has(proxy(request('https://agentdock.test/artifacts')))).toBe(true);
  });

  // Behind a TLS-terminating proxy the socket is HTTP while the browser's origin
  // is HTTPS. Trusting the socket would strip the upgrade from the one deployment
  // shape that genuinely wants it.
  it('trusts x-forwarded-proto over the socket scheme', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(
      has(proxy(request('http://internal:3000/artifacts', { 'x-forwarded-proto': 'https' }))),
    ).toBe(true);
    expect(has(proxy(request('https://internal/artifacts', { 'x-forwarded-proto': 'http' })))).toBe(
      false,
    );
  });

  it('reads only the leftmost value when several proxies appended one', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(
      has(proxy(request('http://internal:3000/x', { 'x-forwarded-proto': 'https, http' }))),
    ).toBe(true);
  });

  // Everything else in the policy is scheme-independent. If a future change makes
  // another directive conditional, this catches it.
  it('changes nothing else between the two schemes', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const strip = (res: Response) =>
      policy(res)
        .split('; ')
        .filter((d) => d !== 'upgrade-insecure-requests')
        .map((d) => d.replace(/'nonce-[A-Za-z0-9+/=]+'/, "'nonce-X'"));

    expect(strip(proxy(request(`${HTTP_ORIGIN}/a`)))).toEqual(
      strip(proxy(request('https://agentdock.test/a'))),
    );
  });
});

describe('proxy — the development difference', () => {
  it('adds the evaluation hatch in development and only there', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const dev = directive(policy(proxy(request())), 'script-src');
    expect(dev).toContain("'unsafe-eval'");

    vi.stubEnv('NODE_ENV', 'production');
    const prod = directive(policy(proxy(request())), 'script-src');
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it('keeps inline script forbidden in development too', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const csp = policy(proxy(request()));
    // style-src is identical in both environments — the inline allowance is a
    // spec consequence, not a development convenience, so it must not vary.
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'");
    // Never the script directive, not even in development.
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
  });
});

describe('proxy — the nonce', () => {
  it('is different on every request', () => {
    const first = policy(proxy(request()));
    const second = policy(proxy(request()));
    expect(first).not.toBe(second);
  });

  it('is set on the forwarded request headers as well as the response', () => {
    const response = proxy(request());
    const csp = policy(response);
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];

    expect(nonce).toBeTruthy();
    // NextResponse.next({ request: { headers } }) encodes the overridden request
    // headers onto the response under these keys, which is how the framework
    // hands the nonce to the rendering pass. Verified against the real object.
    expect(response.headers.get('x-middleware-override-headers')?.split(',')).toContain('x-nonce');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });
});

describe('proxy — the matcher', () => {
  it('skips static assets and prefetches', () => {
    const source = config.matcher[0].source;
    expect(source).toContain('_next/static');
    expect(source).toContain('_next/image');
    expect(source).toContain('favicon.ico');
    expect(config.matcher[0].missing.map((m) => m.key)).toEqual([
      'next-router-prefetch',
      'purpose',
    ]);
  });
});
