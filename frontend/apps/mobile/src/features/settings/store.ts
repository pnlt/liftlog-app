import { create } from 'zustand'
import { syncRepository } from '@/data/sync'
import { createSettingsModel } from './model'
export type { DemoStyle } from './model'

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
export const useSettings = create(
  createSettingsModel({ repository: syncRepository, timeZone: deviceTimeZone }),
)
export function hydrateSettingsAccount(owner: string | null): void {
  useSettings.getState().hydrateAccount(owner)
}
