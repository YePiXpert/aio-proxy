import { expect, test } from 'bun:test';

import { traceSpan } from '../../schema';
import { createTraceStore } from '../index';
import { openTestDb } from '../test-support';

test('window costs use completion time and final Provider/model, without counting child spans twice', () => {
  const handle = openTestDb();
  try {
    const put = (id: string, overrides: Partial<typeof traceSpan.$inferInsert> = {}) =>
      handle.db
        .insert(traceSpan)
        .values({
          traceId: id,
          spanId: id,
          name: 'aio_proxy.request',
          kind: 1,
          startedAt: new Date(50),
          endedAt: new Date(100),
          statusCode: 0,
          attributes: {},
          events: [],
          links: [],
          finalProviderId: 'account',
          finalModelId: 'upstream-model',
          requestedModelId: 'alias',
          estimatedCostNanoUsd: 100,
          ...overrides,
        })
        .run();
    put('first');
    put('child', { traceId: 'first', parentSpanId: 'first' });
    put('end', { endedAt: new Date(200), estimatedCostNanoUsd: 200 });
    put('unpriced', { estimatedCostNanoUsd: null });
    put('other', { finalProviderId: 'other' });
    put('early', { endedAt: new Date(99) });
    put('late', { endedAt: new Date(201) });
    put('running', { endedAt: null });
    put('failed', { terminationReason: 'failure', estimatedCostNanoUsd: null });
    put('spark', { finalModelId: 'gpt-5.3-codex-spark', estimatedCostNanoUsd: 400 });
    const rows = createTraceStore(handle.db).providerWindowUsage({
      providerId: 'account',
      start: new Date(100),
      end: new Date(200),
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { modelId: 'upstream-model', costNanoUsd: '300', requestCount: 3, pricedRequestCount: 2 },
        { modelId: 'gpt-5.3-codex-spark', costNanoUsd: '400', requestCount: 1, pricedRequestCount: 1 },
      ]),
    );
    expect(rows).toHaveLength(2);
  } finally {
    handle.close();
  }
});
