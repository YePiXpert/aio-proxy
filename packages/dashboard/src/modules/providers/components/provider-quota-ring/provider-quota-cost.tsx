import { getLocale, m } from '@aio-proxy/i18n';
import type React from 'react';

import { formatNanoUsd } from '@/lib/nano-usd';

import type { ProviderQuotaResult } from '../../services/provider-quota-service';

interface ProviderQuotaCostProps {
  readonly cost: NonNullable<ProviderQuotaResult['costs']>[number];
}

export const ProviderQuotaCost: React.FC<ProviderQuotaCostProps> = ({ cost }) => {
  const unavailable = m['dashboard.providers.quota.cost_unavailable']();
  const amount = (value: string | undefined) => {
    if (value === undefined) return unavailable;
    const nanoUsd = BigInt(value);
    return formatNanoUsd(nanoUsd, getLocale(), nanoUsd > 0n && nanoUsd < 10_000_000n ? 'exact' : 'compact');
  };
  return (
    <dl
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      data-testid={`provider-quota-cost-${cost.itemId}`}
    >
      <div className="flex gap-1">
        <dt>{m['dashboard.providers.quota.cost_used']()}</dt>
        <dd>{amount(cost.usedNanoUsd)}</dd>
      </div>
      <div className="flex gap-1">
        <dt>{m['dashboard.providers.quota.cost_total']()}</dt>
        <dd>{amount(cost.estimatedTotalNanoUsd)}</dd>
      </div>
    </dl>
  );
};
