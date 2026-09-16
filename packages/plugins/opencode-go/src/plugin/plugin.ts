import {
  type ConfigSpec,
  definePlugin,
  type LocalizedText,
  type OAuthAdapter,
  type PluginDescriptor,
} from '@aio-proxy/plugin-sdk';

import { discoverOpenCodeGoModels, initialOpenCodeGoCatalogFallback, OPENCODE_GO_CATALOG_TTL_MS } from '../catalog';
import { loginOpenCodeGo, type OpenCodeGoOAuthOptions } from '../oauth';
import { createOpenCodeGoRuntime } from '../runtime';
import {
  accountOptionsSchema,
  credentialSchema,
  type OpenCodeGoAccountOptions,
  type OpenCodeGoCredential,
} from '../schema';

export type OpenCodeGoPresentationText = {
  readonly pluginLabel?: LocalizedText;
  readonly pluginDescription?: LocalizedText;
  readonly adapterLabel: LocalizedText;
  readonly apiKeyLabel: LocalizedText;
  readonly apiKeyDescription?: LocalizedText;
  readonly waitingForAuthorization?: LocalizedText;
};

export const englishPresentationText: OpenCodeGoPresentationText = {
  pluginLabel: 'OpenCode Go',
  pluginDescription: 'Use an OpenCode Go subscription to access open coding models',
  adapterLabel: 'Login with OpenCode Go',
  apiKeyLabel: 'OpenCode API key',
  apiKeyDescription: 'Create or copy a key at https://opencode.ai/auth. Go needs its own paid subscription.',
  waitingForAuthorization: 'Waiting for OpenCode authorization',
};

export function createOpenCodeGoPlugin(
  presentationText: OpenCodeGoPresentationText = englishPresentationText,
  dependencies: OpenCodeGoOAuthOptions = {},
): PluginDescriptor<undefined> {
  const accountOptions = {
    schema: accountOptionsSchema,
    form: [
      {
        type: 'secret',
        key: 'apiKey',
        label: presentationText.apiKeyLabel,
        ...(presentationText.apiKeyDescription === undefined
          ? {}
          : { description: presentationText.apiKeyDescription }),
      },
    ],
  } as const satisfies ConfigSpec<OpenCodeGoAccountOptions>;
  const adapter: OAuthAdapter<OpenCodeGoAccountOptions, OpenCodeGoCredential> = {
    id: 'default',
    displayName: presentationText.adapterLabel,
    account: { options: accountOptions },
    credentials: credentialSchema,
    login: async (context, options) => {
      const parsed = await accountOptions.schema.parseAsync(options);
      if (presentationText.waitingForAuthorization !== undefined) {
        context.progress(presentationText.waitingForAuthorization);
      }
      return await loginOpenCodeGo(context, parsed, {
        ...dependencies,
        ...(dependencies.fetch === undefined && context.fetch !== undefined ? { fetch: context.fetch } : {}),
      });
    },
    catalog: {
      policy: { kind: 'ttl', ttlMs: OPENCODE_GO_CATALOG_TTL_MS },
      discover: (context) =>
        discoverOpenCodeGoModels(context, {
          ...dependencies,
          ...(dependencies.fetch === undefined && context.fetch !== undefined ? { fetch: context.fetch } : {}),
        }),
      initialFallback: initialOpenCodeGoCatalogFallback,
    },
    createRuntime: (context) => createOpenCodeGoRuntime(context, dependencies),
  };
  return definePlugin(
    (api) => {
      api.oauth.register(adapter);
    },
    {
      displayName: presentationText.pluginLabel ?? 'OpenCode Go',
      description: presentationText.pluginDescription ?? 'Use an OpenCode Go subscription to access open coding models',
      icon: 'opencode',
    },
  );
}
