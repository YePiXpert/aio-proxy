import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Socket } from 'node:net';

import { SocksClient } from 'socks';

const CONNECT_TIMEOUT_MS = 5_000;

/** Establish a tunnel without sending any upstream application request bytes. */
export async function connectProxy(proxy: string, host: string, port: number, cancelled: AbortSignal): Promise<Socket> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  const signal = AbortSignal.any([cancelled, controller.signal]);
  const url = new URL(proxy);
  try {
    signal.throwIfAborted();
    if (url.protocol.startsWith('socks')) {
      const socket = new Socket();
      const abort = () => socket.destroy(new Error('Proxy connection cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      try {
        socket.connect(Number(url.port || 1080), url.hostname.replace(/^\[|\]$/gu, ''));
        await once(socket, 'connect');
        const result = await SocksClient.createConnection({
          existing_socket: socket,
          command: 'connect',
          proxy: {
            host: url.hostname.replace(/^\[|\]$/gu, ''),
            port: Number(url.port || 1080),
            type: 5,
            userId: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
          },
          destination: { host: host.replace(/^\[|\]$/gu, ''), port },
          timeout: CONNECT_TIMEOUT_MS,
        });
        signal.throwIfAborted();
        return result.socket;
      } catch (error) {
        socket.destroy();
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    }
    return await new Promise<Socket>((resolve, reject) => {
      const authority = `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
      const headers: Record<string, string> = { host: authority };
      if (url.username || url.password) {
        headers['proxy-authorization'] =
          `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
      }
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)({
        hostname: url.hostname.replace(/^\[|\]$/gu, ''),
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        method: 'CONNECT',
        path: authority,
        headers,
        agent: false,
        signal,
      });
      req.on('error', reject);
      req.on('connect', (response, socket, head) => {
        if (response.statusCode !== 200 || signal.aborted) {
          socket.destroy();
          reject(new Error('Proxy tunnel rejected'));
          return;
        }
        if (head.length) socket.unshift(head);
        resolve(socket);
      });
      req.end();
    });
  } finally {
    clearTimeout(timeout);
  }
}
