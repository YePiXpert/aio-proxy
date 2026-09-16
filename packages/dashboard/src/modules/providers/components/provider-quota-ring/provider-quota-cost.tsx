import { getLocale, m } from '@aio-proxy/i18n';
import type React from 'react';

import { formatNanoUsd } from '@/lib/nano-usd';

import type { ProviderQuotaResult } from '../../services/provider-quota-service';

interface ProviderQuotaCostProps {
  readonly cost: NonNullable<ProviderQuotaResult['costs']>[number];
}

export const ProviderQuotaCost: React.FC<ProviderQuotaCostProps> = ({ cost }) => {
  if (cost.usedNanoUsd === undefined && cost.estimatedTotalNanoUsd === undefined) return null;
  const unavailable = m['dashboard.providers.quota.cost_unavailable']();
  const amount = (value: string | undefined) => {
    if (value === undefined) return unavailable;
    const nanoUsd = BigInt(value);
    return nanoUsd > 0n && nanoUsd < 10_000_000n
      ? m['dashboard.providers.quota.cost_less_than']({ amount: formatNanoUsd(10_000_000n, getLocale(), 'compact') })
      : formatNanoUsd(nanoUsd, getLocale(), 'compact');
  };
  return (
    <dl
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      title={m['dashboard.providers.quota.cost_note']()}
      data-testid={`provider-quota-cost-${cost.itemId}`}
    >
      <div className="flex items-baseline gap-1 whitespace-nowrap">
        <dt>{m['dashboard.providers.quota.cost_used']()}</dt>
        <dd
          className="font-medium text-foreground/80 tabular-nums"
          title={cost.usedNanoUsd === undefined ? undefined : formatNanoUsd(BigInt(cost.usedNanoUsd), getLocale())}
        >
          {amount(cost.usedNanoUsd)}
        </dd>
      </div>
      <div className="flex items-baseline gap-1 whitespace-nowrap">
        <dt>{m['dashboard.providers.quota.cost_total']()}</dt>
        <dd
          className="font-medium text-foreground/80 tabular-nums"
          title={
            cost.estimatedTotalNanoUsd === undefined
              ? undefined
              : formatNanoUsd(BigInt(cost.estimatedTotalNanoUsd), getLocale())
          }
        >
          {amount(cost.estimatedTotalNanoUsd)}
        </dd>
      </div>
    </dl>
  );
};
