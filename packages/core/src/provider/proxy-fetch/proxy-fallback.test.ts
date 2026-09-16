import { expect, test } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';

import { Server } from 'proxy-chain';

import { createProxyFetch } from './proxy-fetch';
import { resolveNativeProxyUrl } from './socks-bridge';
import { socksFixture, tlsFixture } from './socks-test-support';

async function httpProxy(reject = false) {
  let attempts = 0;
  const proxy = new Server({
    host: '127.0.0.1',
    port: 0,
    prepareRequestFunction: () => {
      attempts++;
      return { requestAuthentication: reject };
    },
  });
  await proxy.listen();
  return { url: `http://127.0.0.1:${proxy.port}`, attempts: () => attempts, close: () => proxy.close(true) };
}

test.each([false, true])('falls back from HTTP to SOCKS before sending a streaming request (TLS: %s)', async (tls) => {
  const primary = await httpProxy(true);
  const backup = await socksFixture();
  let requests = 0;
  const upstream = Bun.serve({
    port: 0,
    ...(tls ? { tls: tlsFixture } : {}),
    async fetch(req) {
      requests++;
      expect(req.headers.get('proxy-authorization')).toBeNull();
      return new Response(await req.text());
    },
  });
  try {
    const response = await createProxyFetch({ primary: primary.url, backup: `socks5://127.0.0.1:${backup.port}` })(
      `${tls ? 'https' : 'http'}://upstream.invalid:${upstream.port}`,
      {
        method: 'POST',
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('one request'));
            c.close();
          },
        }),
        tls: { ca: tlsFixture.cert },
        signal: AbortSignal.timeout(4000),
      },
    );
    expect(await response.text()).toBe('one request');
    expect(primary.attempts()).toBe(1);
    expect(backup.destinations).toEqual(['upstream.invalid']);
    expect(requests).toBe(1);
  } finally {
    await primary.close();
    backup.close();
    upstream.stop(true);
  }
});

test('falls back from SOCKS authentication failure to HTTP', async () => {
  const primary = await socksFixture({ username: 'user', password: 'secret' });
  const backup = await httpProxy();
  const upstream = Bun.serve({ port: 0, fetch: () => new Response('backup') });
  try {
    const response = await createProxyFetch({
      primary: `socks://user:wrong@127.0.0.1:${primary.port}`,
      backup: backup.url,
    })(`http://127.0.0.1:${upstream.port}`, { signal: AbortSignal.timeout(4000) });
    expect(await response.text()).toBe('backup');
    expect(backup.attempts()).toBe(1);
  } finally {
    primary.close();
    await backup.close();
    upstream.stop(true);
  }
});

test('upstream HTTP errors do not trigger proxy fallback or replay', async () => {
  const primary = await httpProxy();
  const backup = await socksFixture();
  const upstream = Bun.serve({ port: 0, fetch: () => new Response('upstream failure', { status: 503 }) });
  try {
    const response = await createProxyFetch({ primary: primary.url, backup: `socks5://127.0.0.1:${backup.port}` })(
      `http://127.0.0.1:${upstream.port}`,
      { signal: AbortSignal.timeout(4000) },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('upstream failure');
    expect(primary.attempts()).toBe(1);
    expect(backup.destinations).toHaveLength(0);
  } finally {
    await primary.close();
    backup.close();
    upstream.stop(true);
  }
});

test('both proxies failing never falls back to a direct request', async () => {
  const primary = await httpProxy(true);
  const backup = await httpProxy(true);
  let requests = 0;
  const upstream = Bun.serve({
    port: 0,
    fetch: () => {
      requests++;
      return new Response('direct');
    },
  });
  try {
    const response = await createProxyFetch({ primary: primary.url, backup: backup.url })(
      `http://127.0.0.1:${upstream.port}`,
    );
    expect(response.status).toBe(502);
    await response.text();
    expect(primary.attempts()).toBe(1);
    expect(backup.attempts()).toBe(1);
    expect(requests).toBe(0);
  } finally {
    await primary.close();
    await backup.close();
    upstream.stop(true);
  }
});

test('secure WebSocket uses the backup tunnel', async () => {
  const primary = await httpProxy(true);
  const backup = await socksFixture();
  const upstream = Bun.serve({
    port: 0,
    tls: tlsFixture,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response('no upgrade', { status: 400 });
    },
    websocket: {
      message(ws, message) {
        ws.send(message);
      },
    },
  });
  try {
    const proxy = await resolveNativeProxyUrl({ primary: primary.url, backup: `socks5://127.0.0.1:${backup.port}` });
    const ws = new WebSocket(`wss://upstream.invalid:${upstream.port}`, { proxy, tls: { ca: tlsFixture.cert } });
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => ws.send('realtime');
      ws.onmessage = (event) => {
        expect(event.data).toBe('realtime');
        ws.close();
        resolve();
      };
      ws.onerror = reject;
    });
    expect(primary.attempts()).toBe(1);
    expect(backup.destinations).toEqual(['upstream.invalid']);
  } finally {
    await primary.close();
    backup.close();
    upstream.stop(true);
  }
});

async function stalledProxy() {
  const sockets = new Set<Socket>();
  const server = createServer();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  let connected!: () => void;
  const attempted = new Promise<void>((resolve) => {
    connected = resolve;
  });
  server.on('connect', () => connected());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    attempted,
    close() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

test('cancelling a pending primary handshake never tries the backup', async () => {
  const primary = await stalledProxy();
  const backup = await httpProxy();
  const controller = new AbortController();
  try {
    const pending = createProxyFetch({ primary: primary.url, backup: backup.url })('https://upstream.invalid', {
      signal: controller.signal,
    });
    const rejected = pending.then(
      () => false,
      () => true,
    );
    await primary.attempted;
    controller.abort();
    expect(await rejected).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(backup.attempts()).toBe(0);
  } finally {
    primary.close();
    await backup.close();
  }
});

test('a stalled primary handshake times out and uses the backup', async () => {
  const primary = await stalledProxy();
  const backup = await socksFixture();
  const upstream = Bun.serve({ port: 0, fetch: () => new Response('after timeout') });
  try {
    const response = await createProxyFetch({ primary: primary.url, backup: `socks5://127.0.0.1:${backup.port}` })(
      `http://upstream.invalid:${upstream.port}`,
      { signal: AbortSignal.timeout(8000) },
    );
    expect(await response.text()).toBe('after timeout');
    expect(backup.destinations).toEqual(['upstream.invalid']);
  } finally {
    primary.close();
    backup.close();
    upstream.stop(true);
  }
}, 10000);
