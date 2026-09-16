import { describe, expect, test } from 'bun:test';

import type { OutboundProxy, ProviderFetch } from '@aio-proxy/core';
import { ConfigSchema, ProviderKind, ProviderProtocol } from '@aio-proxy/types';

import { effectiveProxy, materializeProviders } from './materialize';
import { stubAiSdkInstance, stubApiInstance } from './proxy.test-support';

describe('materializeProviders proxy resolution', () => {
  test('inherits the global proxy when an API provider omits its own', () => {
    const config = ConfigSchema.parse({
      proxy: 'http://global.proxy.example:8080',
      providers: {
        api: {
          baseURL: 'https://api.example.com',
          kind: ProviderKind.Api,
          models: ['model'],
          protocol: ProviderProtocol.OpenAICompatible,
        },
      },
    });
    const seenProxies: (OutboundProxy | undefined)[] = [];
    const capturedFetches: (ProviderFetch | undefined)[] = [];

    materializeProviders(config, {
      createProxyFetch: (proxy) => {
        seenProxies.push(proxy);
        return (async () => new Response()) as ProviderFetch;
      },
      createApiProvider: (provider, options) => {
        capturedFetches.push(options?.fetch);
        return stubApiInstance(provider.id);
      },
      bridgeApiProvider: (provider, options) => {
        capturedFetches.push(options?.fetch);
        return stubAiSdkInstance(`${provider.id}:bridge`);
      },
    });

    expect(seenProxies).toEqual(['http://global.proxy.example:8080']);
    expect(capturedFetches[0]).toBe(capturedFetches[1]);
  });

  test('prefers a provider-level proxy over the global proxy', () => {
    const config = ConfigSchema.parse({
      proxy: 'http://global.proxy.example:8080',
      providers: {
        api: {
          baseURL: 'https://api.example.com',
          kind: ProviderKind.Api,
          models: ['model'],
          protocol: ProviderProtocol.OpenAICompatible,
          proxy: 'http://provider.proxy.example:9090',
        },
      },
    });
    const seenProxies: (OutboundProxy | undefined)[] = [];

    materializeProviders(config, {
      createProxyFetch: (proxy) => {
        seenProxies.push(proxy);
        return (async () => new Response()) as ProviderFetch;
      },
      createApiProvider: (provider) => stubApiInstance(provider.id),
      bridgeApiProvider: (provider) => stubAiSdkInstance(`${provider.id}:bridge`),
    });

    expect(seenProxies).toEqual(['http://provider.proxy.example:9090']);
  });

  test('disables the inherited proxy when a provider sets proxy: false', () => {
    const config = ConfigSchema.parse({
      proxy: 'http://global.proxy.example:8080',
      providers: {
        aiSdk: {
          kind: ProviderKind.AiSdk,
          models: ['model'],
          packageName: '@ai-sdk/openai-compatible',
          proxy: false,
        },
      },
    });
    const seenProxies: (OutboundProxy | undefined)[] = [];

    materializeProviders(config, {
      createProxyFetch: (proxy) => {
        seenProxies.push(proxy);
        return (async () => new Response()) as ProviderFetch;
      },
      createAiSdkProvider: (provider) => stubAiSdkInstance(provider.id),
    });

    expect(seenProxies).toEqual([undefined]);
  });

  test('resolves no proxy when neither the provider nor the config configures one', () => {
    const config = ConfigSchema.parse({
      providers: {
        aiSdk: {
          kind: ProviderKind.AiSdk,
          models: ['model'],
          packageName: '@ai-sdk/openai-compatible',
        },
      },
    });
    const seenProxies: (OutboundProxy | undefined)[] = [];

    materializeProviders(config, {
      createProxyFetch: (proxy) => {
        seenProxies.push(proxy);
        return (async () => new Response()) as ProviderFetch;
      },
      createAiSdkProvider: (provider) => stubAiSdkInstance(provider.id),
    });

    expect(seenProxies).toEqual([undefined]);
  });
});

describe('global proxy fallback precedence', () => {
  const policy = { proxyBackup: 'socks5://backup:1080', proxyFallback: true };
  test('an inheriting provider gets the full enabled global policy', () => {
    expect(effectiveProxy('http://primary:8080', undefined, policy)).toEqual({
      primary: 'http://primary:8080',
      backup: policy.proxyBackup,
    });
  });
  test('fallback defaults off and keeps a saved backup inactive', () => {
    expect(effectiveProxy('http://primary:8080', undefined, { proxyBackup: policy.proxyBackup })).toBe(
      'http://primary:8080',
    );
    expect(effectiveProxy('http://primary:8080', undefined, { ...policy, proxyFallback: false })).toBe(
      'http://primary:8080',
    );
  });
  test('provider overrides and direct mode never borrow the global backup', () => {
    expect(effectiveProxy('http://primary:8080', 'socks://own:1080', policy)).toBe('socks://own:1080');
    expect(effectiveProxy('http://primary:8080', false, policy)).toBeUndefined();
  });
});

test('provider fallback overrides the whole global policy; only inherit uses global', () => {
  const global = { proxyFallback: true, proxyBackup: 'http://global-backup:8080' };
  const own = { proxyFallback: true, proxyBackup: 'socks5://own-backup:1080' };
  expect(effectiveProxy('http://global-primary:8080', 'http://own-primary:8080', global, own)).toEqual({
    primary: 'http://own-primary:8080',
    backup: own.proxyBackup,
  });
  expect(
    effectiveProxy('http://global-primary:8080', 'http://own-primary:8080', global, { ...own, proxyFallback: false }),
  ).toBe('http://own-primary:8080');
  expect(effectiveProxy('http://global-primary:8080', undefined, global, own)).toEqual({
    primary: 'http://global-primary:8080',
    backup: global.proxyBackup,
  });
  expect(effectiveProxy('http://global-primary:8080', false, global, own)).toBeUndefined();
});
