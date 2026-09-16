import { expect, test } from 'bun:test';

import type { ProviderModelWindowUsage, TraceStore } from '@aio-proxy/core/db';

import type { OAuthQuotaCacheEntry } from '../../plugin-quota';
import { chatgptQuotaCosts } from './chatgpt-quota-cost';

const sampledAt = Date.UTC(2026, 8, 16, 12);
const item = {
  id: 'secondary',
  displayName: 'Weekly',
  remainingRatio: 0.75,
  windowMinutes: 7 * 24 * 60,
  resetsAt: sampledAt + 24 * 60 * 60_000,
};
const entry: OAuthQuotaCacheEntry = { sampledAt, stale: false, snapshot: { items: [item] } };
const row: ProviderModelWindowUsage = {
  modelId: 'gpt-5.4',
  costNanoUsd: '10000000000',
  requestCount: 2,
  pricedRequestCount: 2,
};
function store(rows: readonly ProviderModelWindowUsage[] = [row]): Pick<TraceStore, 'providerWindowUsage'> {
  return {
    providerWindowUsage: (query) => {
      expect(query.providerId).toBe('account');
      expect(query.end.getTime()).toBe(sampledAt);
      expect(query.start.getTime()).toBe(item.resetsAt - item.windowMinutes * 60_000);
      return rows;
    },
  };
}

test('estimates dollar allowance from priced consumption, keeping Spark and image costs separate', () => {
  const result = chatgptQuotaCosts(
    store([
      row,
      { ...row, modelId: 'gpt-5.3-codex-spark', costNanoUsd: '2000000000' },
      { ...row, modelId: 'gpt-image-2', costNanoUsd: '99999999999' },
    ]),
    'account',
    { ...entry, snapshot: { items: [item, { ...item, id: 'codex-spark-secondary' }] } },
  );
  expect(result).toEqual([
    { itemId: 'secondary', usedNanoUsd: '10000000000', estimatedTotalNanoUsd: '40000000000' },
    { itemId: 'codex-spark-secondary', usedNanoUsd: '2000000000', estimatedTotalNanoUsd: '8000000000' },
  ]);
});

test.each([1, 0.995])(
  'shows recorded dollars but withholds extrapolation for a remaining ratio of %s',
  (remainingRatio) => {
    expect(
      chatgptQuotaCosts(store(), 'account', { ...entry, snapshot: { items: [{ ...item, remainingRatio }] } }),
    ).toEqual([{ itemId: 'secondary', usedNanoUsd: '10000000000' }]);
  },
);

test('missing prices and stale quota readings withhold total estimates, not recorded costs', () => {
  expect(chatgptQuotaCosts(store([{ ...row, pricedRequestCount: 1 }]), 'account', entry)).toEqual([
    { itemId: 'secondary', usedNanoUsd: row.costNanoUsd },
  ]);
  expect(chatgptQuotaCosts(store(), 'account', { ...entry, stale: true })).toEqual([
    { itemId: 'secondary', usedNanoUsd: row.costNanoUsd },
  ]);
  expect(chatgptQuotaCosts(store([{ ...row, pricedRequestCount: 0, costNanoUsd: '0' }]), 'account', entry)).toEqual([
    { itemId: 'secondary' },
  ]);
  expect(chatgptQuotaCosts(store([]), 'account', entry)).toEqual([{ itemId: 'secondary' }]);
});

test('invalid or unidentified windows never query unrelated usage', () => {
  const noRead = {
    providerWindowUsage: () => {
      throw new Error('must not query');
    },
  };
  for (const overrides of [
    { resetsAt: undefined },
    { windowMinutes: undefined },
    { resetsAt: sampledAt },
    { resetsAt: sampledAt + 8 * 24 * 60 * 60_000 },
  ]) {
    expect(
      chatgptQuotaCosts(noRead, 'account', { ...entry, snapshot: { items: [{ ...item, ...overrides }] } }),
    ).toEqual([{ itemId: 'secondary' }]);
  }
  expect(chatgptQuotaCosts(noRead, 'account', { ...entry, snapshot: { items: [{ ...item, id: 'unknown' }] } })).toEqual(
    [],
  );
});
