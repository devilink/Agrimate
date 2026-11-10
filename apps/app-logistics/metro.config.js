// Metro for a pnpm monorepo. pnpm's isolated layout stays in place: symlinks are followed (Metro default), and
// hierarchical lookup stays on because transitive packages live under node_modules/.pnpm.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(monorepoRoot, 'node_modules')];

// The other apps are never imported from here. Hiding them keeps the file crawl small and stops
// their build output (.next, dist) from being watched.
const self = path.basename(projectRoot);
const others = ['api', 'web-admin', 'web-buyer', 'pwa-farmer', 'app-inspector', 'app-logistics'].filter((a) => a !== self);
const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const appsDir = escapeForRegex(path.join(monorepoRoot, 'apps'));
config.resolver.blockList = [new RegExp(`${appsDir}[\\\\/](${others.join('|')})[\\\\/].*`)];

module.exports = config;
