const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)
config.resolver.sourceExts.push('sql')

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm')
}

module.exports = withNativeWind(config, { input: './src/global.css' })
