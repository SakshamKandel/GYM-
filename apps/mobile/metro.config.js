const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Native libraries compile inside node_modules/<pkg>/android/build during
// `expo run:android`; gradle churns those dirs and Metro's watcher crashes
// (ENOENT mid-crawl) if it tries to watch them. Never watch build output.
const defaultBlock = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlock) ? defaultBlock : defaultBlock ? [defaultBlock] : []),
  /node_modules[\/\\].*[\/\\]android[\/\\]build[\/\\].*/,
  /android[\/\\]app[\/\\]build[\/\\].*/,
];

module.exports = config;
