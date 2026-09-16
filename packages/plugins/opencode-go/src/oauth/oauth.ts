import type { OAuthLoginContext, OAuthLoginResult, RuntimeFetch } from '@aio-proxy/plugin-sdk';
import { isPlainObject } from 'es-toolkit/predicate';

import type { OpenCodeGoAccountOptions, OpenCodeGoCredential } from '../schema';

export const OPENCODE_AUTH_URL = 'https://opencode.ai/auth';
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
export const OPENCODE_GO_MODELS_URL = `${OPENCODE_GO_BASE_URL}/models`;

export type OpenCodeGoOAuthOptions = {
  readonly fetch?: RuntimeFetch;
};

export function openCodeGoLoginResult(credential: OpenCodeGoCredential): OAuthLoginResult<OpenCodeGoCredential> {
  const apiKey = credential.apiKey.trim();
  if (apiKey === '') throw new Error('OpenCode Go API key is missing');
  const digest = new Bun.CryptoHasher('sha256').update(`key:${apiKey}`).digest('hex');
  return {
    fingerprint: `sha256:${digest}`,
    suggestedKey: `opencode-go-${digest.slice(0, 12)}`,
    accountLabel: 'OpenCode Go',
    credentials: { apiKey },
  };
}

export async function loginOpenCodeGo(
  context: OAuthLoginContext,
  options: OpenCodeGoAccountOptions,
  dependencies: OpenCodeGoOAuthOptions = {},
): Promise<OAuthLoginResult<OpenCodeGoCredential>> {
  const apiKey = options.apiKey.trim();
  if (apiKey === '') throw new Error('OpenCode Go API key is missing');
  await context.authorization.presentAuthorizeUrl({
    url: OPENCODE_AUTH_URL,
    instructions: 'Create or copy your OpenCode API key, then return here. Go needs its own subscription.',
  });
  await verifyOpenCodeGoApiKey(apiKey, {
    fetch: dependencies.fetch ?? context.fetch ?? globalThis.fetch,
    signal: context.signal,
  });
  return openCodeGoLoginResult({ apiKey });
}

export async function verifyOpenCodeGoApiKey(
  apiKey: string,
  options: { readonly fetch: RuntimeFetch; readonly signal: AbortSignal },
): Promise<void> {
  options.signal.throwIfAborted();
  let response: Response;
  try {
    response = await options.fetch(OPENCODE_GO_MODELS_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: options.signal,
      aioProxy: { traffic: 'control' },
    });
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason;
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('OpenCode Go rejected the API key');
  }
  if (!response.ok) {
    throw new Error(`OpenCode Go login failed (HTTP ${response.status})`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('OpenCode Go model list returned invalid JSON');
  }
  if (readModelEntries(body) === undefined) {
    throw new Error('OpenCode Go model list returned invalid data');
  }
}

export function readModelEntries(payload: unknown): readonly unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  if (isPlainObject(payload) && Array.isArray(payload['data'])) return payload['data'];
  return undefined;
}
