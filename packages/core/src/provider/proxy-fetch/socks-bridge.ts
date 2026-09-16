import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Server } from 'proxy-chain';

import { prepareFallback } from './proxy-fallback';

export type OutboundProxy = string | { readonly primary: string; readonly backup: string };

const signingKey = randomBytes(32);
let bridge: Promise<Server> | undefined;

export function isSocksProxy(proxy: string): boolean {
  return /^socks(?:5h?)?:\/\//iu.test(proxy);
}

function signature(payload: string): string {
  return createHmac('sha256', signingKey).update(payload).digest('hex');
}

async function startBridge(): Promise<Server> {
  const server = new Server({
    host: '127.0.0.1',
    port: 0,
    verbose: false,
    prepareRequestFunction: (options) => {
      const { username, password } = options;
      const expected = Buffer.from(signature(password));
      const actual = Buffer.from(username);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return { requestAuthentication: true };
      }
      // Signed, stateless routing avoids retaining old proxy credentials after config reloads.
      const route = JSON.parse(Buffer.from(password, 'base64url').toString('utf8')) as OutboundProxy;
      return typeof route === 'string' ? { upstreamProxyUrl: route } : prepareFallback(route, options);
    },
  });
  await server.listen();
  server.server.unref();
  return server;
}

/**
 * Bun's fetch and WebSocket accept HTTP proxies only. Share a loopback-only,
 * authenticated bridge so Bun still owns TLS, streaming and cancellation.
 * SOCKS URLs use SOCKS5 with remote DNS, including the `socks://` alias.
 */
export async function resolveNativeProxyUrl(proxy: OutboundProxy): Promise<string> {
  if (typeof proxy === 'string' && !isSocksProxy(proxy)) return proxy;
  let route = proxy;
  if (typeof proxy === 'string') {
    const upstream = new URL(proxy);
    upstream.protocol = 'socks5h:';
    if (!upstream.port) upstream.port = '1080';
    route = upstream.href;
  }
  bridge ??= startBridge().catch((error: unknown) => {
    bridge = undefined;
    throw error;
  });
  const server = await bridge;
  const payload = Buffer.from(JSON.stringify(route)).toString('base64url');
  return `http://${signature(payload)}:${payload}@127.0.0.1:${server.port}`;
}
