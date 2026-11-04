import type { UserProfile } from '@liftlog/contracts'
import { buildPlan } from '@liftlog/domain'
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { kvStorage } from '@/lib/storage'

interface ProfileState {
  profile: UserProfile | null
  setProfile: (profile: UserProfile) => void
  clearProfile: () => void
}

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (profile) => set({ profile }),
      clearProfile: () => set({ profile: null }),
    }),
    { name: 'profile', version: 1, storage: kvStorage },
  ),
)

export function usePlan() {
  const profile = useProfile((s) => s.profile)
  return useMemo(() => (profile ? buildPlan(profile) : null), [profile])
}
