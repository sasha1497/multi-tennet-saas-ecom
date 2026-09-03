/* eslint-disable @typescript-eslint/no-var-requires */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Metro configuration for this pnpm monorepo.
 *
 * Two settings matter, and the second one is easy to get wrong:
 *
 *   `watchFolders` — the app imports `@retailos/api-client`, `types` and
 *   `config` from the workspace root, so Metro must watch outside the app
 *   directory or it reports "module not found" for packages that are present.
 *
 *   `unstable_enableSymlinks` — pnpm links every dependency as a symlink into
 *   `.pnpm`; without this Metro refuses to follow them.
 *
 * Note what is deliberately NOT set: `disableHierarchicalLookup`. That option
 * suits a hoisted (yarn/npm) layout where every dependency sits in one flat
 * root. pnpm is the opposite — each package keeps its own `node_modules` holding
 * exactly its own dependencies — so hierarchical lookup is precisely the
 * mechanism that resolves a transitive dependency like `@expo/metro-runtime`
 * from inside `expo-router/node_modules`. Disabling it breaks the bundle while
 * the package is demonstrably installed.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.unstable_enableSymlinks = true;

module.exports = config;
