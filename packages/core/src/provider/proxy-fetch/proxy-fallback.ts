import { Agent, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';

import { RequestError, type PrepareRequestFunctionOpts, type PrepareRequestFunctionResult } from 'proxy-chain';

import { connectProxy } from './proxy-connect';

export async function prepareFallback(
  proxies: { readonly primary: string; readonly backup?: string },
  options: PrepareRequestFunctionOpts,
): Promise<PrepareRequestFunctionResult> {
  const { request, hostname, port, isHttp } = options;
  const source = request.socket;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  source.once('close', cancel);
  if (source.destroyed) controller.abort();
  let target: Socket | undefined;
  try {
    const candidates = proxies.backup === undefined ? [proxies.primary] : [proxies.primary, proxies.backup];
    for (const proxy of candidates) {
      if (controller.signal.aborted) break;
      try {
        target = await connectProxy(proxy, hostname, port, controller.signal);
        break;
      } catch {
        // Only the tunnel handshake is retried. No upstream request has been sent yet.
      }
    }
  } finally {
    source.off('close', cancel);
  }
  if (target === undefined || source.destroyed) {
    target?.destroy();
    throw new RequestError('Proxy connection failed', 502);
  }
  const socket = target;
  const closeTarget = () => {
    socket.destroy();
  };
  source.once('close', closeTarget);
  socket.once('close', () => source.off('close', closeTarget));
  socket.on('error', () => source.destroy());
  if (isHttp) {
    const agent = new Agent({ keepAlive: false });
    agent.createConnection = () => socket;
    return { httpAgent: agent };
  }
  // proxy-chain supplies the CONNECT acknowledgement; this server only splices bytes.
  const tunnel = new HttpServer();
  tunnel.removeAllListeners('connection');
  tunnel.on('connection', (client: Socket) => {
    client.on('error', () => socket.destroy());
    socket.once('close', () => client.destroy());
    client.pipe(socket).pipe(client);
  });
  return { customConnectServer: tunnel };
}
