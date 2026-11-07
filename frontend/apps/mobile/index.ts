import { startWebApp } from './src/lib/web-startup'

async function loadWebApp() {
  const { openDatabaseAsync } = await import('expo-sqlite')
  const { AsyncStorage } = await import('expo-sqlite/kv-store')

  // Load the SQLite worker before routes hydrate stores with synchronous queries.
  await openDatabaseAsync('liftlog.db', { enableChangeListener: true })
  await AsyncStorage.getItemAsync('bundledRevision')
  require('expo-router/entry')
}

if (process.env.EXPO_OS === 'web') {
  void startWebApp(
    {
      href: window.location.href,
      development: __DEV__,
      isolated: globalThis.crossOriginIsolated,
      sharedArrayBufferAvailable: typeof globalThis.SharedArrayBuffer === 'function',
    },
    { load: loadWebApp, redirect: (url) => window.location.replace(url) },
  ).catch((error: unknown) => {
    console.error('[storage] web startup failed', error)
    const root = document.getElementById('root')
    if (root)
      root.textContent =
        error instanceof Error ? error.message : 'MYØS could not open web storage. Reload to try again.'
  })
} else {
  require('expo-router/entry')
}
