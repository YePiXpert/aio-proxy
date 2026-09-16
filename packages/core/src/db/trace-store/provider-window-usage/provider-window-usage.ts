import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

import { traceSpan } from '../../schema';
import type { ProviderModelWindowUsage, ProviderWindowUsageQuery } from '../types';

/** Count each completed request once, against its actual Provider and upstream model. */
export function providerWindowUsage(
  db: BunSQLiteDatabase,
  query: ProviderWindowUsageQuery,
): readonly ProviderModelWindowUsage[] {
  const rows = db
    .select({
      modelId: traceSpan.finalModelId,
      cost: traceSpan.estimatedCostNanoUsd,
    })
    .from(traceSpan)
    .where(
      and(
        isNull(traceSpan.parentSpanId),
        isNull(traceSpan.terminationReason),
        eq(traceSpan.finalProviderId, query.providerId),
        gte(traceSpan.endedAt, query.start),
        lte(traceSpan.endedAt, query.end),
      ),
    )
    .all();
  const totals = new Map<string, { cost: bigint; requestCount: number; pricedRequestCount: number }>();
  for (const row of rows) {
    const modelId = row.modelId ?? '';
    const total = totals.get(modelId) ?? { cost: 0n, requestCount: 0, pricedRequestCount: 0 };
    total.requestCount += 1;
    if (row.cost !== null) {
      total.cost += BigInt(row.cost);
      total.pricedRequestCount += 1;
    }
    totals.set(modelId, total);
  }
  return [...totals].map(([modelId, total]) => ({
    modelId,
    costNanoUsd: total.cost.toString(),
    requestCount: total.requestCount,
    pricedRequestCount: total.pricedRequestCount,
  }));
}
