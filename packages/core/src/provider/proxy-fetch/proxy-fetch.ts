import type { OutboundProxy } from './socks-bridge';
import { isSocksProxy, resolveNativeProxyUrl } from './socks-bridge';

export type ProviderFetch = typeof globalThis.fetch;

/**
 * Wraps a fetch implementation to route requests through a HTTP(S) or SOCKS5
 * proxy via Bun's `proxy` fetch option. Returns the implementation unchanged
 * when no proxy is configured so callers pay no overhead in the common case.
 */
export function createProxyFetch(
  proxy: OutboundProxy | undefined,
  fetchImpl: ProviderFetch = globalThis.fetch,
): ProviderFetch {
  if (proxy === undefined) return fetchImpl;
  if (typeof proxy !== 'string' || isSocksProxy(proxy)) {
    return (async (input, init) =>
      fetchImpl(input, { ...init, proxy: await resolveNativeProxyUrl(proxy) })) as ProviderFetch;
  }
  return ((input, init) => fetchImpl(input, { ...init, proxy })) as ProviderFetch;
}
