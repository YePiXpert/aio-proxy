import { m } from '@aio-proxy/i18n';
import type { DashboardSettingsMutationInput, DashboardSettingsView } from '@aio-proxy/types';
import { Input } from '@aio-proxy/ui/components/input';
import { Switch } from '@aio-proxy/ui/components/switch';

import { SettingsFieldRow } from '../settings-field-row';
import { proxySchema } from './settings-form-contract';
import type { SettingsFormApi } from './use-settings-form';

interface SettingsProxyFallbackProps {
  readonly disabled: boolean;
  readonly form: SettingsFormApi;
  readonly settings: DashboardSettingsView;
  readonly onSave: (input: DashboardSettingsMutationInput) => void;
}

export const SettingsProxyFallback: React.FC<SettingsProxyFallbackProps> = ({ disabled, form, settings, onSave }) => (
  <>
    <form.Field name="proxyBackup">
      {(field) => {
        const value = field.state.value.trim() || null;
        const unchangedMask = value === '****' && settings.proxyBackup === '****';
        const invalid = field.state.meta.isTouched && !unchangedMask && !proxySchema.safeParse(value).success;
        return (
          <SettingsFieldRow
            label={m['dashboard.settings.proxy_backup']()}
            htmlFor={field.name}
            error={invalid ? m['dashboard.settings.invalid']() : null}
          >
            <Input
              id={field.name}
              value={field.state.value}
              disabled={disabled}
              aria-invalid={invalid}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={() => {
                field.handleBlur();
                if (field.state.meta.isDirty && !unchangedMask && proxySchema.safeParse(value).success) {
                  onSave({ proxyBackup: value });
                }
              }}
            />
          </SettingsFieldRow>
        );
      }}
    </form.Field>
    <form.Field name="proxyFallback">
      {(field) => (
        <SettingsFieldRow
          label={m['dashboard.settings.proxy_fallback']()}
          htmlFor={field.name}
          description={m['dashboard.settings.proxy_fallback_description']()}
        >
          <Switch
            id={field.name}
            checked={field.state.value}
            disabled={disabled || (!field.state.value && (!settings.proxy || !settings.proxyBackup))}
            onCheckedChange={(checked) => {
              field.handleChange(checked);
              onSave({ proxyFallback: checked });
            }}
          />
        </SettingsFieldRow>
      )}
    </form.Field>
  </>
);
