const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// EPUB is a ZIP container, so Metro must treat it as a binary app asset.
config.resolver.assetExts.push('epub');

module.exports = config;
