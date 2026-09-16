import { expect, test } from 'bun:test';

import type { OAuthAdapter, PluginDescriptor } from '@aio-proxy/plugin-sdk';

import { OPENCODE_GO_PLUGIN_VERSION } from '..';
import packageJson from '../../package.json' with { type: 'json' };
import type { OpenCodeGoAccountOptions, OpenCodeGoCredential } from '../schema';
import { createOpenCodeGoPlugin, englishPresentationText } from './plugin';

test('exports a versioned OpenCode Go OAuth descriptor', async () => {
  const plugin = createOpenCodeGoPlugin();
  const adapter = await adapterFrom(plugin);
  expect(adapter.id).toBe('default');
  expect(adapter.displayName).toBe('Login with OpenCode Go');
  expect(plugin.metadata.icon).toBe('opencode');
  expect(adapter.account.options.form).toEqual([
    {
      type: 'secret',
      key: 'apiKey',
      label: 'OpenCode API key',
      description: 'Create or copy a key at https://opencode.ai/auth. Go needs its own paid subscription.',
    },
  ]);
  await expect(adapter.account.options.schema.parseAsync({ apiKey: 'sk-opencode-go' })).resolves.toEqual({
    apiKey: 'sk-opencode-go',
  });
  expect(adapter.catalog.policy).toEqual({ kind: 'ttl', ttlMs: 6 * 60 * 60_000 });
  expect(adapter.refreshCredential).toBeUndefined();
  expect(adapter.credentialImports).toBeUndefined();
  expect(adapter.quota).toBeUndefined();
  expect(OPENCODE_GO_PLUGIN_VERSION).toBe(packageJson.version);
});

test('accepts localized copy without changing the secret field key', async () => {
  const adapter = await adapterFrom(
    createOpenCodeGoPlugin({
      ...englishPresentationText,
      pluginLabel: 'OpenCode Go',
      adapterLabel: 'Connexion OpenCode Go',
      apiKeyLabel: 'Clé API OpenCode',
    }),
  );
  expect(adapter.displayName).toBe('Connexion OpenCode Go');
  expect(adapter.account.options.form[0]?.key).toBe('apiKey');
});

async function adapterFrom(
  descriptor: PluginDescriptor<undefined>,
): Promise<OAuthAdapter<OpenCodeGoAccountOptions, OpenCodeGoCredential>> {
  let registered: OAuthAdapter<OpenCodeGoAccountOptions, OpenCodeGoCredential> | undefined;
  await descriptor.setup(
    {
      oauth: {
        register(adapter) {
          registered = adapter as OAuthAdapter<OpenCodeGoAccountOptions, OpenCodeGoCredential>;
        },
      },
    },
    undefined,
  );
  if (registered === undefined) throw new Error('OpenCode Go OAuth adapter was not registered');
  return registered;
}
