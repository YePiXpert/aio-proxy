import packageJson from '../package.json' with { type: 'json' };
import { createOpenCodeGoPlugin, englishPresentationText } from './plugin/index';

export * from './catalog/index';
export * from './oauth/index';
export { createOpenCodeGoPlugin, englishPresentationText, type OpenCodeGoPresentationText } from './plugin/index';
export * from './runtime/index';
export * from './schema/index';

export const OPENCODE_GO_PLUGIN_VERSION = packageJson.version;

export default createOpenCodeGoPlugin(englishPresentationText);
