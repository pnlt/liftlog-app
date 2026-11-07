import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { kvStorage } from '@/lib/storage'

interface RestTimerState {
  endsAt: number | null
  durationSec: number
  start: (sec: number) => void
  adjust: (deltaSec: number) => void
  stop: () => void
}

export const useRestTimer = create<RestTimerState>()(
  persist(
    (set, get) => ({
      endsAt: null,
      durationSec: 0,
      start: (sec) => set(sec > 0 ? { endsAt: Date.now() + sec * 1000, durationSec: sec } : { endsAt: null }),
      adjust: (deltaSec) => {
        const { endsAt, durationSec } = get()
        if (endsAt == null) return
        const next = endsAt + deltaSec * 1000
        set(
          next <= Date.now()
            ? { endsAt: null }
            : { endsAt: next, durationSec: Math.max(1, durationSec + deltaSec) },
        )
      },
      stop: () => set({ endsAt: null }),
    }),
    { name: 'rest-timer', version: 1, storage: kvStorage },
  ),
)
