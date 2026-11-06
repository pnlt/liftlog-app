module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Drizzle migrations import .sql files as strings.
    plugins: [
      ['inline-import', { extensions: ['.sql'] }],
      // react-native-filament runs its render callbacks as worklets-core worklets.
      ['react-native-worklets-core/plugin', { processNestedWorklets: true }],
    ],
  }
}
