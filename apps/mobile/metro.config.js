/* eslint-env node */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Metro only watches the app folder by default. `@nexa/types` and `@nexa/contract`
// are pnpm symlinks into `packages/`, so their sources live outside that tree and
// would neither bundle nor hot-reload without this.
config.watchFolders = [workspaceRoot];

// Both roots participate in resolution: this app's own `node_modules` and the
// workspace root.
//
// Expo's monorepo guide also tells you to set `disableHierarchicalLookup = true`
// here. That advice assumes a hoisting package manager, and it is actively wrong
// under pnpm. pnpm gives every package its own isolated tree under
// `node_modules/.pnpm/<pkg>@<version>/node_modules/`, so when Metro follows the
// symlink into `expo/src/Expo.ts` and that file imports `expo-modules-core`, the
// dependency is a directory walk *up* from where the importer lives — nowhere
// near either root. With the walk disabled the bundle fails on exactly that
// import. Leaving hierarchical lookup on (the default) is what makes the two
// listed roots a fallback rather than the whole story.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * `@nexa/types` is published as TypeScript source and its internal imports carry
 * the ESM `.js` extension (`export * from './domain.js'`) — the form `tsc`,
 * `vite` and `tsx` all expect. Metro resolves that literally and fails, because
 * on disk the file is `domain.ts`. Retry those specifiers without the extension
 * so Metro picks the `.ts` source, and only for imports originating inside this
 * repo: a `.js` specifier from `node_modules` really does mean a `.js` file.
 */
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const origin = context.originModulePath ?? '';
  const isRepoSource =
    origin.startsWith(workspaceRoot) && !origin.includes(`${path.sep}node_modules${path.sep}`);

  if (isRepoSource && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    } catch {
      // Fall through: a real sibling `.js` file is still a legal import.
    }
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
