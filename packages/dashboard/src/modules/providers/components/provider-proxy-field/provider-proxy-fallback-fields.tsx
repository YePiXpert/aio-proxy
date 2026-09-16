import { m } from '@aio-proxy/i18n';
import { Field, FieldDescription } from '@aio-proxy/ui/components/field';
import { Input } from '@aio-proxy/ui/components/input';
import { Label } from '@aio-proxy/ui/components/label';
import { Switch } from '@aio-proxy/ui/components/switch';

import type { ProviderEditorForm } from '../../hooks/use-provider-editor-form';

interface ProviderProxyFallbackFieldsProps {
  readonly form: ProviderEditorForm;
}

export const ProviderProxyFallbackFields: React.FC<ProviderProxyFallbackFieldsProps> = ({ form }) => (
  <>
    <form.Field name="proxyBackup">
      {(field) => (
        <Field>
          <Label htmlFor="provider-proxy-backup">{m['dashboard.settings.proxy_backup']()}</Label>
          <Input
            id="provider-proxy-backup"
            value={field.state.value ?? ''}
            className="font-mono"
            onChange={(event) => field.handleChange(event.target.value || null)}
          />
        </Field>
      )}
    </form.Field>
    <form.Field name="proxyFallback">
      {(field) => (
        <Field>
          <Label htmlFor="provider-proxy-fallback">{m['dashboard.settings.proxy_fallback']()}</Label>
          <Switch
            id="provider-proxy-fallback"
            checked={field.state.value ?? false}
            onCheckedChange={(checked) => field.handleChange(checked)}
          />
          <FieldDescription>{m['dashboard.settings.provider_proxy_fallback_description']()}</FieldDescription>
        </Field>
      )}
    </form.Field>
  </>
);
