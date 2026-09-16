import { describe, expect, test } from 'bun:test';

import type { OAuthLoginContext, RuntimeRequestInit } from '@aio-proxy/plugin-sdk';

import { loginOpenCodeGo, OPENCODE_AUTH_URL, OPENCODE_GO_MODELS_URL, openCodeGoLoginResult } from './oauth';

describe('OpenCode Go login', () => {
  test('opens the shared console and stores a validated API key', async () => {
    let authorizeUrl: string | undefined;
    const inits: RuntimeRequestInit[] = [];
    const result = await loginOpenCodeGo(
      loginContext({
        presentAuthorizeUrl: async (input) => {
          authorizeUrl = input.url;
        },
      }),
      { apiKey: '  sk-opencode-go  ' },
      {
        fetch: async (_input, init) => {
          inits.push(init ?? {});
          return Response.json({ data: [{ id: 'kimi-k3' }] });
        },
      },
    );
    expect(authorizeUrl).toBe(OPENCODE_AUTH_URL);
    expect(inits[0]?.aioProxy).toEqual({ traffic: 'control' });
    const digest = new Bun.CryptoHasher('sha256').update('key:sk-opencode-go').digest('hex');
    expect(result).toEqual({
      fingerprint: `sha256:${digest}`,
      suggestedKey: `opencode-go-${digest.slice(0, 12)}`,
      accountLabel: 'OpenCode Go',
      credentials: { apiKey: 'sk-opencode-go' },
    });
    expect(result).not.toHaveProperty('expiresAt');
    expect(openCodeGoLoginResult({ apiKey: 'sk-opencode-go' }).fingerprint).toBe(result.fingerprint);
  });

  test('rejects an unauthorized key without inventing a catalog', async () => {
    await expect(
      loginOpenCodeGo(loginContext(), { apiKey: 'sk-bad' }, { fetch: async () => new Response('', { status: 401 }) }),
    ).rejects.toThrow('OpenCode Go rejected the API key');
  });

  test('reports HTTP status when the model list is not JSON', async () => {
    await expect(
      loginOpenCodeGo(
        loginContext(),
        { apiKey: 'sk-opencode-go' },
        {
          fetch: async () =>
            new Response('<html>denied</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
        },
      ),
    ).rejects.toThrow(/HTTP 502/);
  });

  test('probes the Go models URL with the pasted key', async () => {
    let request: Request | undefined;
    await loginOpenCodeGo(
      loginContext(),
      { apiKey: 'sk-opencode-go' },
      {
        fetch: async (input, init) => {
          request = new Request(input, init);
          return Response.json({ data: [] });
        },
      },
    );
    expect(request?.url).toBe(OPENCODE_GO_MODELS_URL);
    expect(request?.headers.get('authorization')).toBe('Bearer sk-opencode-go');
  });
});

function loginContext(overrides: Partial<OAuthLoginContext['authorization']> = {}): OAuthLoginContext {
  return {
    authorization: {
      presentDeviceCode: async () => {
        throw new Error('OpenCode Go must not use device code');
      },
      presentAuthorizeUrl: async () => {},
      loopback: async () => {
        throw new Error('OpenCode Go must not use loopback');
      },
      ...overrides,
    },
    progress: () => {},
    signal: new AbortController().signal,
  };
}
