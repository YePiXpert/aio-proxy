import { describe, expect, test } from 'bun:test';

import type { CredentialPort, RuntimeRequestInit } from '@aio-proxy/plugin-sdk';

import { OPENCODE_GO_MODELS_URL } from '../oauth';
import type { OpenCodeGoAccountOptions, OpenCodeGoCredential } from '../schema';
import {
  discoverOpenCodeGoModels,
  initialOpenCodeGoCatalogFallback,
  OpenCodeGoCatalogError,
  opencodeGoProtocol,
} from './catalog';

describe('OpenCode Go catalog', () => {
  test('maps Hermes/OpenClaw transport prefixes onto catalog protocols', () => {
    expect(opencodeGoProtocol('kimi-k3')).toBe('openai-compatible');
    expect(opencodeGoProtocol('glm-5.3-flash')).toBe('openai-compatible');
    expect(opencodeGoProtocol('deepseek-v4-flash')).toBe('openai-compatible');
    expect(opencodeGoProtocol('gpt-5.6-luna')).toBe('openai-response');
    expect(opencodeGoProtocol('grok-4.6')).toBe('openai-response');
    expect(opencodeGoProtocol('muse-spark-1.3-contributor')).toBe('openai-response');
    expect(opencodeGoProtocol('minimax-m2.7')).toBe('anthropic');
    expect(opencodeGoProtocol('qwen3.8-max')).toBe('anthropic');
  });

  test('lists live Go models with per-model protocol metadata', async () => {
    let request: Request | undefined;
    let traffic: unknown;
    const catalog = await discoverOpenCodeGoModels(context(), {
      fetch: async (input, init) => {
        traffic = (init as RuntimeRequestInit | undefined)?.aioProxy;
        request = new Request(input, init);
        return Response.json({
          data: [
            { id: 'kimi-k3', name: 'Kimi K3' },
            { id: 'gpt-5.6-luna' },
            { id: 'qwen3.8-max', name: 'Qwen3.8 Max' },
            { id: '  ' },
          ],
        });
      },
    });
    expect(request?.url).toBe(OPENCODE_GO_MODELS_URL);
    expect(request?.headers.get('authorization')).toBe('Bearer sk-opencode-go');
    expect(traffic).toEqual({ traffic: 'control' });
    expect(catalog.language).toEqual([
      { id: 'kimi-k3', displayName: 'Kimi K3', extra: { protocol: 'openai-compatible' } },
      { id: 'gpt-5.6-luna', extra: { protocol: 'openai-response' } },
      { id: 'qwen3.8-max', displayName: 'Qwen3.8 Max', extra: { protocol: 'anthropic' } },
    ]);
  });

  test('falls back only for retryable discovery failures', () => {
    const fallback = initialOpenCodeGoCatalogFallback(new OpenCodeGoCatalogError('network', true));
    expect(fallback?.language.map((model) => model.id)).toEqual([
      'kimi-k3',
      'kimi-k2.6',
      'glm-5.3-flash',
      'deepseek-v4-flash',
      'gpt-5.6-luna',
      'grok-4.6',
      'qwen3.8-max',
      'minimax-m2.7',
    ]);
    expect(fallback?.language.find((model) => model.id === 'gpt-5.6-luna')?.extra).toEqual({
      protocol: 'openai-response',
    });
    expect(fallback?.language.find((model) => model.id === 'qwen3.8-max')?.extra).toEqual({
      protocol: 'anthropic',
    });
    expect(initialOpenCodeGoCatalogFallback(new OpenCodeGoCatalogError('unauthorized', false, 401))).toBeUndefined();
    const hostTimeout = Object.assign(new Error('OAUTH_CATALOG_DISCOVERY_TIMEOUT'), {
      name: 'OAuthCatalogDiscoveryTimeoutError',
    });
    expect(initialOpenCodeGoCatalogFallback(hostTimeout)?.language.map((model) => model.id)).toEqual(
      fallback?.language.map((model) => model.id),
    );
  });

  test('treats a successful empty catalog as authoritative', async () => {
    const catalog = await discoverOpenCodeGoModels(context(), {
      fetch: async () => Response.json({ data: [] }),
    });
    expect(catalog.language).toEqual([]);
  });
});

function context() {
  const port: CredentialPort<OpenCodeGoCredential> = {
    read: async () => ({ revision: 1, value: { apiKey: 'sk-opencode-go' } }),
    refresh: async () => {
      throw new Error('catalog must not refresh');
    },
  };
  return {
    credentials: port,
    options: { apiKey: 'sk-opencode-go' } satisfies OpenCodeGoAccountOptions,
    signal: new AbortController().signal,
  };
}
