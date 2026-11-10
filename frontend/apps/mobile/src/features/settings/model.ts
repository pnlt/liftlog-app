import { SyncedSettingsSchema, type SyncedSettings } from '@myos/contracts'
import type { Unit } from '@myos/domain'
import type { StateCreator } from 'zustand/vanilla'
import type { SyncRepository } from '../../data/sync/repository'

export type DemoStyle = 'art' | 'photo'
export interface SettingsState extends SyncedSettings {
  owner: string | null
  setDemoStyle(value: DemoStyle): void
  setUnit(value: Unit): void
  setRestSeconds(value: number): void
  setTimeZone(value: string): void
  hydrateAccount(owner: string | null): void
}
interface SettingsModelOptions {
  repository: Pick<SyncRepository, 'readSettings' | 'saveSettings'>
  timeZone: () => string
}
export function createSettingsModel({
  repository,
  timeZone,
}: SettingsModelOptions): StateCreator<SettingsState> {
  return (set, get) => {
    const defaults = (): SyncedSettings => ({
      unit: 'kg',
      restSeconds: 90,
      demoStyle: 'art',
      timeZone: timeZone(),
    })
    function actions(boundOwner: string | null) {
      function change(patch: Partial<SyncedSettings>) {
        if (!boundOwner || get().owner !== boundOwner) return
        const current = get()
        const settings = SyncedSettingsSchema.parse({
          unit: current.unit,
          restSeconds: current.restSeconds,
          demoStyle: current.demoStyle,
          timeZone: current.timeZone,
          ...patch,
        })
        repository.saveSettings(boundOwner, settings)
        if (get().owner === boundOwner) set(settings)
      }
      return {
        setDemoStyle: (demoStyle: DemoStyle) => change({ demoStyle }),
        setUnit: (unit: Unit) => change({ unit }),
        setRestSeconds: (restSeconds: number) =>
          change({ restSeconds: Math.min(600, Math.max(0, Math.round(restSeconds))) }),
        setTimeZone: (zone: string) => change({ timeZone: zone }),
      }
    }
    return {
      owner: null,
      ...defaults(),
      ...actions(null),
      hydrateAccount(owner: string | null): void {
        const current = get(),
          settings = (owner ? repository.readSettings(owner) : null) ?? defaults()
        if (owner !== current.owner) set({ owner, ...settings, ...actions(owner) })
        else if (
          settings.unit !== current.unit ||
          settings.restSeconds !== current.restSeconds ||
          settings.demoStyle !== current.demoStyle ||
          settings.timeZone !== current.timeZone
        )
          set(settings)
      },
    }
  }
}
