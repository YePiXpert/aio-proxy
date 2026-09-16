import { expect, test } from 'bun:test';
import { once } from 'node:events';
import { request } from 'node:http';

import { createProxyFetch } from './proxy-fetch';
import { resolveNativeProxyUrl } from './socks-bridge';
import { socksFixture, tlsFixture } from './socks-test-support';

test.each(['socks', 'socks5', 'socks5h'])(
  '%s routes streaming HTTP bodies and resolves names remotely',
  async (scheme) => {
    const socks = await socksFixture({ username: 'u@ser', password: 'p:ss' });
    const upstream = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        expect(req.headers.get('proxy-authorization')).toBeNull();
        return new Response(await req.text(), { headers: { 'x-proxied': 'yes' } });
      },
    });
    try {
      const fetch = createProxyFetch(`${scheme}://u%40ser:p%3Ass@127.0.0.1:${socks.port}`);
      const response = await fetch(`http://upstream.invalid:${upstream.port}/echo`, {
        method: 'POST',
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('streamed'));
            c.close();
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('x-proxied')).toBe('yes');
      expect(await response.text()).toBe('streamed');
      expect(socks.destinations).toEqual(['upstream.invalid']);
    } finally {
      socks.close();
      upstream.stop(true);
    }
  },
);

test('bridge requires signed credentials and does not fall back to a direct connection', async () => {
  const socks = await socksFixture({ username: 'user', password: 'secret' });
  const upstream = Bun.serve({ port: 0, fetch: () => new Response('direct access is a failure') });
  try {
    const proxy = await resolveNativeProxyUrl(`socks5://user:wrong@127.0.0.1:${socks.port}`);
    const response = await fetch(`http://127.0.0.1:${upstream.port}`, { proxy, signal: AbortSignal.timeout(5000) });
    expect(response.status).toBeGreaterThanOrEqual(500);
    await response.text();
    const unauthenticated = new URL(proxy);
    unauthenticated.username = '';
    unauthenticated.password = '';
    const denied = await fetch(`http://127.0.0.1:${upstream.port}`, { proxy: unauthenticated.href });
    expect(denied.status).toBe(407);
    await denied.text();
    expect(socks.destinations).toHaveLength(0);
  } finally {
    socks.close();
    upstream.stop(true);
  }
});

test('native proxy URL supports CONNECT tunnels for TLS and realtime sockets', async () => {
  const socks = await socksFixture();
  const upstream = Bun.serve({ port: 0, fetch: () => new Response('tunnel works') });
  try {
    const proxy = new URL(await resolveNativeProxyUrl(`socks://127.0.0.1:${socks.port}`));
    const req = request({
      hostname: proxy.hostname,
      port: proxy.port,
      method: 'CONNECT',
      path: `upstream.invalid:${upstream.port}`,
      headers: {
        'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`,
      },
    });
    req.end();
    const [response, socket] = await once(req, 'connect');
    expect(response.statusCode).toBe(200);
    socket.write('GET / HTTP/1.1\r\nHost: upstream.invalid\r\nConnection: close\r\n\r\n');
    let body = '';
    for await (const chunk of socket) body += chunk.toString();
    expect(body).toContain('tunnel works');
    expect(socks.destinations).toEqual(['upstream.invalid']);
  } finally {
    socks.close();
    upstream.stop(true);
  }
});

test('Bun HTTPS and secure WebSocket use the SOCKS tunnel', async () => {
  const socks = await socksFixture();
  const upstream = Bun.serve({
    port: 0,
    tls: tlsFixture,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response('secure');
    },
    websocket: {
      message(ws, message) {
        ws.send(message);
      },
    },
  });
  try {
    const url = `https://upstream.invalid:${upstream.port}`;
    const proxy = await resolveNativeProxyUrl(`socks5://127.0.0.1:${socks.port}`);
    const response = await createProxyFetch(`socks5://127.0.0.1:${socks.port}`)(url, {
      tls: { ca: tlsFixture.cert },
      signal: AbortSignal.timeout(5000),
    });
    expect(await response.text()).toBe('secure');
    const ws = new WebSocket(url.replace('https:', 'wss:'), { proxy, tls: { ca: tlsFixture.cert } });
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => ws.send('realtime');
      ws.onmessage = (event) => {
        expect(event.data).toBe('realtime');
        ws.close();
        resolve();
      };
      ws.onerror = reject;
    });
    expect(socks.destinations).toEqual(['upstream.invalid', 'upstream.invalid']);
  } finally {
    socks.close();
    upstream.stop(true);
  }
});

test('aborting an active streaming response closes the SOCKS connection', async () => {
  const socks = await socksFixture();
  let cancelled = false;
  const upstream = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('first'));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  try {
    const controller = new AbortController();
    const response = await createProxyFetch(`socks5://127.0.0.1:${socks.port}`)(
      `http://upstream.invalid:${upstream.port}`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
    for (let i = 0; i < 50 && !cancelled; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cancelled).toBe(true);
  } finally {
    socks.close();
    upstream.stop(true);
  }
});

test.each([false, true])('separate SOCKS configurations keep their own route (TLS: %s)', async (tls) => {
  const first = await socksFixture();
  const second = await socksFixture();
  const upstream = Bun.serve({ port: 0, ...(tls ? { tls: tlsFixture } : {}), fetch: () => new Response('ok') });
  try {
    const url = `${tls ? 'https' : 'http'}://upstream.invalid:${upstream.port}`;
    for (const socks of [first, second]) {
      const response = await createProxyFetch(`socks5://127.0.0.1:${socks.port}`)(url, {
        tls: { ca: tlsFixture.cert },
        signal: AbortSignal.timeout(5000),
      });
      expect(await response.text()).toBe('ok');
    }
    expect(first.destinations).toEqual(['upstream.invalid']);
    expect(second.destinations).toEqual(['upstream.invalid']);
  } finally {
    first.close();
    second.close();
    upstream.stop(true);
  }
});

test('a standalone SOCKS proxy supports an IPv6 proxy address', async () => {
  const socks = await socksFixture(undefined, '::1');
  const upstream = Bun.serve({ port: 0, fetch: () => new Response('ipv6 proxy') });
  try {
    const response = await createProxyFetch(`socks5://[::1]:${socks.port}`)(
      `http://upstream.invalid:${upstream.port}`,
      { signal: AbortSignal.timeout(2000) },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ipv6 proxy');
  } finally {
    socks.close();
    upstream.stop(true);
  }
});
