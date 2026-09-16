import { expect, test } from 'bun:test';

import type { CredentialPort, ModelCatalog, RuntimeContext, RuntimeRequestInit } from '@aio-proxy/plugin-sdk';

import type { OpenCodeGoAccountOptions, OpenCodeGoCredential } from '../schema';
import { createOpenCodeGoDynamicFetch, createOpenCodeGoRuntime } from './runtime';

test('selects language providers from catalog protocol metadata', async () => {
  const runtime = await createOpenCodeGoRuntime(runtimeContext());
  expect(runtime.provider.specificationVersion).toBe('v4');
  expect(runtime.provider.languageModel('kimi-k3').provider).toContain('openai-compatible');
  expect(runtime.provider.languageModel('qwen3.8-max').provider).toContain('anthropic');
  expect(runtime.provider.languageModel('gpt-5.6-luna').provider).toContain('openai');
  expect(() => runtime.provider.languageModel('missing')).toThrow('missing');
});

test('routes Chat Completions through the Go endpoint with the stored key', async () => {
  const calls: Request[] = [];
  const runtime = await createOpenCodeGoRuntime({
    ...runtimeContext(),
    fetch: async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'kimi-k3',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });
  await runtime.provider.languageModel('kimi-k3').doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
  expect(calls[0]?.headers.get('authorization')).toBe('Bearer sk-opencode-go');
  expect(JSON.stringify([...(calls[0]?.headers ?? new Headers())])).not.toContain('dynamic-credential');
});

test('routes Anthropic Messages and OpenAI Responses to the matching Go paths', async () => {
  const calls: Request[] = [];
  const runtime = await createOpenCodeGoRuntime({
    ...runtimeContext(),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      if (request.url.endsWith('/messages')) {
        return Response.json({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'qwen3.8-max',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      return Response.json({
        id: 'resp_test',
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: 'gpt-5.6-luna',
        output: [
          {
            id: 'msg_test',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [], logprobs: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  await runtime.provider.languageModel('qwen3.8-max').doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  await runtime.provider.languageModel('gpt-5.6-luna').doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  expect(calls.map((request) => request.url)).toEqual([
    'https://opencode.ai/zen/go/v1/messages',
    'https://opencode.ai/zen/go/v1/responses',
  ]);
  expect(calls.every((request) => request.headers.get('authorization') === 'Bearer sk-opencode-go')).toBe(true);
});

test('raw same-protocol passthrough rewrites the Go URL and session header', async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const runtime = await createOpenCodeGoRuntime({
    ...runtimeContext(),
    fetch: async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response('{}', { status: 200 });
    },
  });
  const transport = runtime.raw?.({
    protocol: 'openai-compatible',
    modelId: 'kimi-k3',
    capability: 'language',
    requestPath: '/v1/chat/completions',
  });
  expect(transport).toBeDefined();
  await transport!.invoke(
    new Request('http://127.0.0.1:9317/v1/chat/completions', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:9317',
        authorization: 'Bearer client-secret',
        cookie: 'session=client-secret',
        'proxy-authorization': 'Basic client-secret',
        'x-api-key': 'client-secret',
      },
      body: '{}',
    }),
    {
      requestId: 'req-1',
      session: { key: 'sha256:session', source: 'header-session' },
    },
  );
  expect(calls[0]?.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
  expect(calls[0]?.headers.get('authorization')).toBe('Bearer sk-opencode-go');
  expect(calls[0]?.headers.get('x-opencode-session')).toBe('sha256:session');
  for (const name of 'host cookie proxy-authorization x-api-key'.split(' ')) {
    expect(calls[0]?.headers.get(name)).toBeNull();
  }
  expect(
    runtime.raw?.({
      protocol: 'anthropic',
      modelId: 'kimi-k3',
      capability: 'language',
    }),
  ).toBeUndefined();
});

test('injects the durable Bearer key and preserves the abort signal', async () => {
  const inits: RuntimeRequestInit[] = [];
  const controller = new AbortController();
  const fetch = createOpenCodeGoDynamicFetch(staticPort(), {
    fetch: async (_input, init) => {
      inits.push(init ?? {});
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer dynamic-credential', 'content-type': 'application/json' },
    body: '{"model":"kimi-k3"}',
    signal: controller.signal,
  });
  expect(new Headers(inits[0]?.headers).get('authorization')).toBe('Bearer sk-opencode-go');
  expect(inits[0]?.signal).toBe(controller.signal);
  expect(inits[0]?.aioProxy?.traffic).not.toBe('control');
});

function runtimeContext(): RuntimeContext<OpenCodeGoCredential, OpenCodeGoAccountOptions> {
  return {
    credentials: staticPort(),
    options: { apiKey: 'sk-opencode-go' },
    catalog: catalog(),
    fetch: globalThis.fetch,
  };
}

function catalog(): ModelCatalog {
  return {
    language: [
      { id: 'kimi-k3', extra: { protocol: 'openai-compatible' } },
      { id: 'qwen3.8-max', extra: { protocol: 'anthropic' } },
      { id: 'gpt-5.6-luna', extra: { protocol: 'openai-response' } },
    ],
    image: [],
    embedding: [],
    speech: [],
    transcription: [],
    reranking: [],
  };
}

function staticPort(): CredentialPort<OpenCodeGoCredential> {
  return {
    read: async () => ({ revision: 1, value: { apiKey: 'sk-opencode-go' } }),
    refresh: async () => {
      throw new Error('OpenCode Go keys must not refresh');
    },
  };
}
