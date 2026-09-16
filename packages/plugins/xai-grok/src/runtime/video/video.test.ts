import { expect, test } from 'bun:test';

import { createXAIGrokVideoTransport } from './video';

const model = 'grok-imagine-video-1.5';

test('creates a pin-compatible job and polls it through the xAI API', async () => {
  const requests: Request[] = [];
  const transport = createXAIGrokVideoTransport(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return Response.json(
      request.method === 'POST'
        ? { request_id: 'job-123' }
        : { status: 'done', video: { url: 'https://video.example/result.mp4' } },
    );
  }, model);
  const created = await transport.invoke(
    new Request('http://proxy/v1/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer caller-secret' },
      body: JSON.stringify({
        model,
        prompt: 'A blue circle',
        seconds: '6',
        size: '1280x720',
        input_reference: { image_url: 'https://image.example/ref.png' },
      }),
    }),
  );
  expect(await created.json()).toMatchObject({ id: 'job-123', status: 'queued', model });
  expect(requests[0]?.url).toBe('https://api.x.ai/v1/videos/generations');
  expect(requests[0]?.headers.get('authorization')).toBeNull();
  expect(await requests[0]?.json()).toEqual({
    model,
    prompt: 'A blue circle',
    duration: 6,
    resolution: '720p',
    aspect_ratio: '16:9',
    image: { url: 'https://image.example/ref.png' },
  });
  const polled = await transport.invoke(new Request('http://proxy/v1/videos/job-123'));
  expect(await polled.json()).toMatchObject({
    id: 'job-123',
    status: 'completed',
    video: { url: 'https://video.example/result.mp4' },
  });
  expect(requests[1]?.url).toBe('https://api.x.ai/v1/videos/job-123');
  const content = await transport.invoke(new Request('http://proxy/v1/videos/job-123/content'));
  expect(content.status).toBe(302);
  expect(content.headers.get('location')).toBe('https://video.example/result.mp4');
});

test('multipart references are encoded as xAI image input', async () => {
  let captured: unknown;
  const transport = createXAIGrokVideoTransport(async (input, init) => {
    captured = await new Request(input, init).json();
    return Response.json({ request_id: 'job' });
  }, model);
  const form = new FormData();
  form.set('prompt', 'Animate this');
  form.set('seconds', '3');
  form.set('input_reference', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'ref.png');
  const response = await transport.invoke(new Request('http://proxy/v1/videos', { method: 'POST', body: form }));
  expect(response.status).toBe(200);
  expect(captured).toEqual({
    model,
    prompt: 'Animate this',
    duration: 3,
    image: { url: 'data:image/png;base64,AQID' },
  });
});

test('passes through upstream errors and rejects unsupported operations before network I/O', async () => {
  let calls = 0;
  const transport = createXAIGrokVideoTransport(async () => {
    calls++;
    return Response.json({ error: 'quota' }, { status: 429 });
  }, model);
  expect((await transport.invoke(new Request('http://proxy/v1/videos/job', { method: 'DELETE' }))).status).toBe(501);
  expect((await transport.invoke(new Request('http://proxy/v1/videos/edits', { method: 'POST' }))).status).toBe(501);
  expect(calls).toBe(0);
  const response = await transport.invoke(new Request('http://proxy/v1/videos/job'));
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: 'quota' });
});

test('rejects an invalid upstream job ID instead of returning an unpollable success', async () => {
  const transport = createXAIGrokVideoTransport(async () => Response.json({ request_id: '../bad' }), model);
  const response = await transport.invoke(
    new Request('http://proxy/v1/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'circle' }),
    }),
  );
  expect(response.status).toBe(502);
});
