import { buildPlan } from '@myos/domain'
import { randomUUID } from 'expo-crypto'
import { create } from 'zustand'
import { syncRepository } from '@/data/sync'
import { createProfileModel } from './model'

export const useProfile = create(
  createProfileModel({
    repository: syncRepository,
    uuid: randomUUID,
    now: () => new Date().toISOString(),
    buildPlan,
  }),
)
export function hydrateProfileAccount(owner: string | null): void {
  useProfile.getState().hydrateAccount(owner)
}
export function usePlan() {
  return useProfile((state) => state.plan)
}
