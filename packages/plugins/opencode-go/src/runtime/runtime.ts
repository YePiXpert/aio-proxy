import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  CredentialPort,
  OAuthRuntimeResult,
  ProtocolId,
  RuntimeContext,
  RuntimeFetch,
} from '@aio-proxy/plugin-sdk';
import { isPlainObject } from 'es-toolkit/predicate';

import { OPENCODE_GO_BASE_URL, type OpenCodeGoOAuthOptions } from '../oauth';
import type { OpenCodeGoAccountOptions, OpenCodeGoCredential } from '../schema';

const PLACEHOLDER_CREDENTIAL = 'dynamic-credential';

export async function createOpenCodeGoRuntime(
  context: RuntimeContext<OpenCodeGoCredential, OpenCodeGoAccountOptions>,
  options: OpenCodeGoOAuthOptions = {},
): Promise<OAuthRuntimeResult> {
  const fetch = options.fetch ?? context.fetch ?? globalThis.fetch;
  const dynamicFetch = createOpenCodeGoDynamicFetch(context.credentials, { ...options, fetch });
  const compatible = createOpenAICompatible({
    name: 'opencode-go.openai-compatible',
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey: PLACEHOLDER_CREDENTIAL,
    fetch: dynamicFetch,
  });
  const anthropic = createAnthropic({
    name: 'opencode-go.anthropic',
    baseURL: OPENCODE_GO_BASE_URL,
    authToken: PLACEHOLDER_CREDENTIAL,
    fetch: dynamicFetch,
  });
  const openAI = createOpenAI({
    name: 'opencode-go.openai',
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey: PLACEHOLDER_CREDENTIAL,
    fetch: dynamicFetch,
  });
  const protocolByModelId = new Map(
    context.catalog.language.flatMap((model) => {
      const protocol = catalogProtocol(model.extra);
      return protocol === undefined ? [] : [[model.id, protocol] as const];
    }),
  );

  return {
    provider: {
      specificationVersion: 'v4',
      languageModel(modelId: string) {
        const protocol = protocolByModelId.get(modelId);
        switch (protocol) {
          case 'openai-compatible':
            return compatible.languageModel(modelId);
          case 'anthropic':
            return anthropic.languageModel(modelId);
          case 'openai-response':
            return openAI.responses(modelId);
          default:
            throw new Error(`OpenCode Go model ${modelId} has no supported protocol metadata`);
        }
      },
      embeddingModel() {
        throw new Error('OpenCode Go OAuth does not support embedding');
      },
      imageModel() {
        throw new Error('OpenCode Go OAuth does not support image');
      },
    },
    raw(input) {
      if (input.capability !== undefined && input.capability !== 'language') return undefined;
      if (protocolByModelId.get(input.modelId) !== input.protocol) return undefined;
      if (input.requestPath !== undefined && !advertisedRawPath(input.protocol, input.requestPath)) {
        return undefined;
      }
      return {
        invoke: async (request, requestContext) => {
          if (!advertisedRawPath(input.protocol, new URL(request.url).pathname)) {
            return unsupportedRawPath(input.protocol);
          }
          const { value } = await context.credentials.read();
          const target = new URL(rawPath(input.protocol), `${OPENCODE_GO_BASE_URL}/`);
          const headers = sanitizeRawHeaders(request.headers);
          headers.set('authorization', `Bearer ${value.apiKey}`);
          headers.set('accept-encoding', 'identity');
          if (!headers.has('x-opencode-session') && requestContext?.session.key !== undefined) {
            headers.set('x-opencode-session', requestContext.session.key);
          }
          const response = await fetch(target, {
            method: request.method,
            headers,
            ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: request.body }),
            signal: request.signal,
            redirect: request.redirect,
          });
          return new Response(response.body, decodedRawResponseInit(response));
        },
      };
    },
  };
}

export function createOpenCodeGoDynamicFetch(
  credentials: CredentialPort<OpenCodeGoCredential>,
  options: OpenCodeGoOAuthOptions & { readonly fetch?: RuntimeFetch } = {},
): RuntimeFetch {
  const fetch = options.fetch ?? globalThis.fetch;
  const dynamicFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const { value } = await credentials.read();
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.delete('x-api-key');
    headers.set('authorization', `Bearer ${value.apiKey}`);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : request.signal);
    return await fetch(request.url, {
      method: request.method,
      headers,
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: request.body }),
      ...(signal === undefined ? {} : { signal }),
      redirect: request.redirect,
    });
  };
  return Object.assign(dynamicFetch, { preconnect: fetch.preconnect });
}

function sanitizeRawHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const key of [
    'authorization',
    'proxy-authorization',
    'cookie',
    'host',
    'accept-encoding',
    'x-api-key',
    'x-goog-api-key',
    'anthropic-api-key',
  ]) {
    headers.delete(key);
  }
  return headers;
}

function decodedRawResponseInit(response: Response): ResponseInit {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return {
    headers,
    status: response.status,
    statusText: response.statusText,
  };
}

function catalogProtocol(extra: unknown): ProtocolId | undefined {
  if (!isPlainObject(extra)) return undefined;
  const protocol = Reflect.get(extra, 'protocol');
  return protocol === 'openai-compatible' || protocol === 'anthropic' || protocol === 'openai-response'
    ? protocol
    : undefined;
}

function advertisedRawPath(protocol: ProtocolId, pathname: string): boolean {
  switch (protocol) {
    case 'openai-compatible':
      return pathname.endsWith('/chat/completions');
    case 'openai-response':
      return pathname.endsWith('/responses');
    case 'anthropic':
      return pathname.endsWith('/messages');
    default:
      return false;
  }
}

function rawPath(protocol: ProtocolId): string {
  switch (protocol) {
    case 'openai-compatible':
      return '/zen/go/v1/chat/completions';
    case 'openai-response':
      return '/zen/go/v1/responses';
    case 'anthropic':
      return '/zen/go/v1/messages';
    default:
      return '/zen/go/v1/chat/completions';
  }
}

function unsupportedRawPath(protocol: ProtocolId): Response {
  const message = 'OpenCode Go does not serve this endpoint';
  return protocol === 'anthropic'
    ? Response.json({ type: 'error', error: { type: 'invalid_request_error', message } }, { status: 501 })
    : Response.json(
        { error: { code: 'unsupported_endpoint', message, type: 'invalid_request_error' } },
        { status: 501 },
      );
}
