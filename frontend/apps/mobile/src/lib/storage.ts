import Storage from 'expo-sqlite/kv-store'
import { createJSONStorage } from 'zustand/middleware'

/** Sync calls make stores hydrate before the first render, so gates never flash. */
export const kvStorage = createJSONStorage(() => ({
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => void Storage.removeItemSync(key),
}))
