import type { UserSettings } from '@liftlog/contracts'
import type { Unit } from '@liftlog/domain'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { kvStorage } from '@/lib/storage'

export type DemoStyle = 'art' | 'photo'

interface SettingsState extends UserSettings {
  demoStyle: DemoStyle
  setDemoStyle: (demoStyle: DemoStyle) => void
  setUnit: (unit: Unit) => void
  setRestSeconds: (restSeconds: number) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      unit: 'kg',
      restSeconds: 90,
      demoStyle: 'art',
      setDemoStyle: (demoStyle) => set({ demoStyle }),
      setUnit: (unit) => set({ unit }),
      setRestSeconds: (restSeconds) =>
        set({ restSeconds: Math.min(600, Math.max(0, Math.round(restSeconds))) }),
    }),
    { name: 'settings', version: 1, storage: kvStorage },
  ),
)
