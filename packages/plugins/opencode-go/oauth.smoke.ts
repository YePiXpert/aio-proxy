import { expect, test } from 'bun:test';

import plugin, { OPENCODE_GO_PLUGIN_VERSION } from './dist/index.js';
import packageJson from './package.json' with { type: 'json' };

test('built artifact exports the OpenCode Go descriptor', () => {
  expect(plugin.apiVersion).toBe(1);
  expect(OPENCODE_GO_PLUGIN_VERSION).toBe(packageJson.version);
});
