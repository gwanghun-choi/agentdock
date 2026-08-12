import { type NextRequest, NextResponse } from 'next/server';

/**
 * The filename matters. Next 16 renamed this convention from `middleware` to
 * `proxy`; the older name still resolves, so a file at the wrong name would
 * appear to work in some places and be ignored in others.
 *
 * The policy is generated per request because a nonce cannot be produced at
 * build time. The documented no-nonce alternative requires `script-src
 * 'unsafe-inline'`, which this project forbids by name and which would make the
 * policy useless as a second layer behind the sanitizer. The cost the
 * documentation attaches to nonces — static optimization disabled — is already
 * paid, because every page in this phase reads the database and is dynamic
 * regardless.
 */
/**
 * The scheme this request actually arrived on.
 *
 * `x-forwarded-proto` wins when present, because behind a TLS-terminating proxy
 * the request reaching this process is plain HTTP while the browser's origin is
 * HTTPS — trusting the socket there would strip the upgrade from exactly the
 * deployment that needs it. Only the first value is read: the header is a
 * comma-separated list when several proxies append to it, and the leftmost is
 * the one the client spoke.
 *
 * Falls back to the request URL, which is what a direct origin (no proxy)
 * reports. Deliberately not `request.nextUrl`: that property does not exist on a
 * plain `Request`, and the tests construct one.
 */
function requestScheme(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase();
  try {
    return new URL(request.url).protocol.replace(':', '').toLowerCase();
  } catch {
    // An unparseable URL is not a reason to assert HTTPS. Treating it as
    // insecure omits the upgrade, which fails open for navigation rather than
    // breaking every link — the failure mode this function exists to prevent.
    return 'http';
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const isHttps = requestScheme(request) === 'https';

  // Image sources are restricted to this origin. The sanitizer already drops
  // image elements, so a remote image request would be a bug — and this is where
  // that bug becomes visible instead of silent.
  const csp = [
    `default-src 'self'`,
    // In development the framework evaluates code to provide debugging
    // information, which is why the escape hatch is present there and absent in
    // production. It is not required in production and must never be added.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // `style-src` carries 'unsafe-inline' deliberately, and it is not the same
    // concession as allowing inline script. A nonce covers `<style>` ELEMENTS
    // only; the CSP spec cannot apply it to a `style` ATTRIBUTE, which needs
    // 'unsafe-hashes' plus a hash of every individual attribute value — not
    // obtainable for markup a framework emits at render time. A nonce here
    // therefore blocks nothing an attacker would use and only breaks this
    // application's own styling, which is what it did: every page render logged
    // "Applying inline style violates..." and the declaration was dropped.
    //
    // The exposure it leaves is CSS injection, not script execution — and
    // untrusted content cannot reach it anyway, because rehype-sanitize strips
    // `style` from ingested Markdown before it is ever rendered. Every inline
    // style that survives to the browser originates in this codebase.
    // `script-src` keeps its nonce; that is the boundary that matters.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self'`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    // Conditional, and this is the whole reason the scheme is computed above.
    //
    // `upgrade-insecure-requests` rewrites every same-origin http:// request the
    // browser makes — including in-page NAVIGATION — to https://. On an HTTPS
    // origin that is free hardening. On an HTTP-only origin it is a self-inflicted
    // outage: the deployment at http://<host>:<port> loads (the address bar is not
    // upgraded, and the policy only arrives with that first response), then every
    // link inside the page is upgraded to https://<host>:<port>, where no TLS
    // listener exists. Observed exactly that way on a plain-HTTP deployment: the
    // home page opened, and every internal link failed.
    //
    // Emitting it only for requests that already arrived over HTTPS keeps the
    // protection wherever it can protect anything — a page served over HTTPS is
    // the only place a mixed-content upgrade has work to do — and removes it where
    // it can only break navigation. No env var, no hardcoded scheme, and nothing
    // to change on the day this moves behind TLS.
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
