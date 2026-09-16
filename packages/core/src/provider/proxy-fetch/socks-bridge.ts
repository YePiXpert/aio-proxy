import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Server } from 'proxy-chain';

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
    prepareRequestFunction: ({ username, password }) => {
      const expected = Buffer.from(signature(password));
      const actual = Buffer.from(username);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return { requestAuthentication: true };
      }
      // Signed, stateless routing avoids retaining old proxy credentials after config reloads.
      return { upstreamProxyUrl: Buffer.from(password, 'base64url').toString('utf8') };
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
export async function resolveNativeProxyUrl(proxy: string): Promise<string> {
  if (!isSocksProxy(proxy)) return proxy;
  const upstream = new URL(proxy);
  upstream.protocol = 'socks5h:';
  if (!upstream.port) upstream.port = '1080';
  bridge ??= startBridge().catch((error: unknown) => {
    bridge = undefined;
    throw error;
  });
  const server = await bridge;
  const payload = Buffer.from(upstream.href).toString('base64url');
  return `http://${signature(payload)}:${payload}@127.0.0.1:${server.port}`;
}
