import { ProviderProtocol } from '@aio-proxy/types';
import { isPlainObject } from 'es-toolkit/predicate';

import type { RuntimeProviderInstance } from '../../runtime';

// Image generation cannot use the one-token chat probe or its ten-second budget.
const IMAGE_TEST_TIMEOUT_MS = 120_000;
const IMAGE_TEST_PROMPT = 'A small blue circle on a white background.';

export async function testProviderImage(runtime: RuntimeProviderInstance, modelId: string): Promise<boolean> {
  const signal = AbortSignal.timeout(IMAGE_TEST_TIMEOUT_MS);
  const raw = runtime.raw?.resolve({
    protocol: ProviderProtocol.OpenAIImage,
    modelId,
    requestPath: '/v1/images/generations',
  });
  if (raw !== undefined) {
    const response = await raw.invoke(
      new Request('http://provider-draft.invalid/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          prompt: IMAGE_TEST_PROMPT,
          n: 1,
          response_format: 'b64_json',
          stream: false,
        }),
        signal,
      }),
      undefined,
      { upstreamStream: false },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const body: unknown = await response.json();
    if (!isPlainObject(body) || !Array.isArray(body['data'])) return false;
    return body['data'].some(
      (image: unknown) =>
        isPlainObject(image) &&
        ((typeof image['b64_json'] === 'string' && image['b64_json'].length > 0) ||
          (typeof image['url'] === 'string' && image['url'].length > 0)),
    );
  }
  if (runtime.image === undefined) return false;
  await runtime.image.ensureAvailable?.();
  const result = await runtime.image.invoke({
    modelId,
    invocation: { operation: 'generate', prompt: IMAGE_TEST_PROMPT, n: 1, responseFormat: 'b64_json' },
    signal,
  });
  return result.images.some((image) => image.byteLength > 0);
}
