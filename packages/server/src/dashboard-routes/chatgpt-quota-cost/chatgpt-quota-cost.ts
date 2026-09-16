import type { TraceStore } from '@aio-proxy/core/db';
import type { OAuthQuotaItem } from '@aio-proxy/plugin-sdk';

import type { OAuthQuotaCacheEntry } from '../../plugin-quota';

export type ChatGPTQuotaCost = {
  readonly itemId: string;
  readonly usedNanoUsd?: string;
  readonly estimatedTotalNanoUsd?: string;
};

/** These are the ChatGPT plugin's known metering lanes, not arbitrary quota labels. */
function lane(item: OAuthQuotaItem): 'codex' | 'spark' | undefined {
  if (item.id === 'primary' || item.id === 'secondary') return 'codex';
  if (item.id === 'codex-spark' || item.id === 'codex-spark-secondary') return 'spark';
  return undefined;
}

export function chatgptQuotaCosts(
  store: Pick<TraceStore, 'providerWindowUsage'>,
  providerId: string,
  entry: OAuthQuotaCacheEntry,
): readonly ChatGPTQuotaCost[] {
  return entry.snapshot.items.flatMap((item): ChatGPTQuotaCost[] => {
    const scope = lane(item);
    if (scope === undefined) return [];
    const unavailable: ChatGPTQuotaCost = { itemId: item.id };
    const { resetsAt, windowMinutes, remainingRatio } = item;
    if (resetsAt === undefined || windowMinutes === undefined || remainingRatio === undefined) return [unavailable];
    const start = resetsAt - windowMinutes * 60_000;
    // Never combine a current cost with an old percentage, including a stale last-good snapshot.
    if (start > entry.sampledAt || resetsAt <= entry.sampledAt) return [unavailable];
    const rows = store.providerWindowUsage({ providerId, start: new Date(start), end: new Date(entry.sampledAt) });
    let cost = 0n;
    let priced = 0;
    let unpriced = 0;
    for (const row of rows) {
      // Missing model attribution makes both lanes incomplete. Images use a separate allowance.
      if (row.modelId === '') {
        unpriced += row.requestCount;
        continue;
      }
      if (row.modelId.startsWith('gpt-image-')) continue;
      if (!/^gpt-\d/u.test(row.modelId) && !/^o\d/u.test(row.modelId)) {
        unpriced += row.requestCount;
        continue;
      }
      const spark = /-codex-spark(?:-|$)/u.test(row.modelId);
      if ((scope === 'spark') !== spark) continue;
      cost += BigInt(row.costNanoUsd);
      priced += row.pricedRequestCount;
      unpriced += row.requestCount - row.pricedRequestCount;
    }
    if (priced === 0) return [unavailable];
    // Integer millionths preserve currency precision without converting a potentially large sum to Number.
    // Below 1% consumption, the upstream's rounded percentage is too noisy to extrapolate.
    const usedMillionths = Math.round((1 - remainingRatio) * 1_000_000);
    const total =
      !entry.stale && unpriced === 0 && cost > 0n && usedMillionths >= 10_000
        ? (cost * 1_000_000n) / BigInt(usedMillionths)
        : undefined;
    return [
      {
        itemId: item.id,
        usedNanoUsd: cost.toString(),
        ...(total === undefined ? {} : { estimatedTotalNanoUsd: total.toString() }),
      },
    ];
  });
}
