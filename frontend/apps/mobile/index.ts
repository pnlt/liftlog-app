async function startWeb() {
  const { openDatabaseAsync } = await import('expo-sqlite')
  const { AsyncStorage } = await import('expo-sqlite/kv-store')

  // Load the SQLite worker before routes hydrate stores with synchronous queries.
  await openDatabaseAsync('liftlog.db', { enableChangeListener: true })
  await AsyncStorage.getItemAsync('bundledRevision')
  require('expo-router/entry')
}

if (process.env.EXPO_OS === 'web') {
  void startWeb().catch((error: unknown) => console.error('[storage] web startup failed', error))
} else {
  require('expo-router/entry')
}
