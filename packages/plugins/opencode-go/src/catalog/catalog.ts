import type { AccountContext, ModelCatalog, ModelDescriptor, ProtocolId, RuntimeFetch } from '@aio-proxy/plugin-sdk';
import { isPlainObject } from 'es-toolkit/predicate';

import { OPENCODE_GO_MODELS_URL, type OpenCodeGoOAuthOptions, readModelEntries } from '../oauth';
import type { OpenCodeGoAccountOptions, OpenCodeGoCredential } from '../schema';

export const OPENCODE_GO_CATALOG_TTL_MS = 6 * 60 * 60_000;

const CURATED = [
  ['kimi-k3', 'Kimi K3'],
  ['kimi-k2.6', 'Kimi K2.6'],
  ['glm-5.3-flash', 'GLM-5.3-Flash'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
  ['gpt-5.6-luna', 'GPT 5.6 Luna'],
  ['grok-4.6', 'Grok 4.6'],
  ['qwen3.8-max', 'Qwen3.8 Max'],
  ['minimax-m2.7', 'MiniMax M2.7'],
] as const;

export class OpenCodeGoCatalogError extends Error {
  override readonly name = 'OpenCodeGoCatalogError';

  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function opencodeGoProtocol(modelId: string): ProtocolId {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith('gpt-') || id.startsWith('grok-') || id.startsWith('muse-spark')) return 'openai-response';
  if (id.startsWith('minimax-') || id.startsWith('qwen')) return 'anthropic';
  return 'openai-compatible';
}

export async function discoverOpenCodeGoModels(
  context: AccountContext<OpenCodeGoCredential, OpenCodeGoAccountOptions>,
  options: OpenCodeGoOAuthOptions = {},
): Promise<ModelCatalog> {
  const { value } = await context.credentials.read();
  const fetcher: RuntimeFetch = options.fetch ?? context.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher(OPENCODE_GO_MODELS_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${value.apiKey}` },
      signal: context.signal,
      aioProxy: { traffic: 'control' },
    });
  } catch {
    if (context.signal.aborted) throw context.signal.reason;
    throw new OpenCodeGoCatalogError('OpenCode Go model discovery network failure', true);
  }
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  if (!response.ok) {
    throw new OpenCodeGoCatalogError('OpenCode Go model discovery rejected', retryable, response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OpenCodeGoCatalogError('OpenCode Go model discovery returned invalid JSON', true);
  }
  const entries = readModelEntries(payload);
  if (entries === undefined) {
    throw new OpenCodeGoCatalogError('OpenCode Go model discovery returned invalid data', true);
  }
  const language: ModelDescriptor[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isPlainObject(entry) || typeof entry['id'] !== 'string') continue;
    const id = entry['id'].trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const name = entry['name'];
    const displayName = typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
    language.push({
      id,
      ...(displayName === undefined ? {} : { displayName }),
      extra: { protocol: opencodeGoProtocol(id) },
    });
  }
  return emptyCatalog(language);
}

export function initialOpenCodeGoCatalogFallback(error: unknown): ModelCatalog | undefined {
  if (isHostCatalogTimeout(error) || (error instanceof OpenCodeGoCatalogError && error.retryable)) {
    return emptyCatalog(
      CURATED.map(([id, displayName]) => ({
        id,
        displayName,
        extra: { protocol: opencodeGoProtocol(id) },
      })),
    );
  }
  return undefined;
}

function isHostCatalogTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'OAuthCatalogDiscoveryTimeoutError';
}

function emptyCatalog(language: ModelCatalog['language']): ModelCatalog {
  return { language, image: [], embedding: [], speech: [], transcription: [], reranking: [] };
}
