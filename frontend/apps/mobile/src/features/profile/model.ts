import { UserProfileSchema, type TrainingState, type UserProfile } from '@myos/contracts'
import type { Plan } from '@myos/domain'
import type { StateCreator } from 'zustand/vanilla'
import type { SyncRepository } from '../../data/sync/repository'

export interface ProfileState {
  owner: string | null
  profile: UserProfile | null
  plan: Plan | null
  onboardingCompletedAt: string | null
  editing: boolean
  setProfile(profile: UserProfile): void
  clearProfile(): void
  cancelEditing(): void
  hydrateAccount(owner: string | null): void
}
interface ProfileModelOptions {
  repository: Pick<SyncRepository, 'readTrainingState' | 'saveTrainingState'>
  uuid: () => string
  now: () => string
  buildPlan: (profile: UserProfile) => Plan
}

export function createProfileModel({
  repository,
  uuid,
  now,
  buildPlan,
}: ProfileModelOptions): StateCreator<ProfileState> {
  return (set, get) => {
    function actions(boundOwner: string | null) {
      const active = () => boundOwner !== null && get().owner === boundOwner
      return {
        setProfile(input: UserProfile): void {
          if (!active() || boundOwner === null) return
          const profile = UserProfileSchema.parse(input)
          const plan = buildPlan(profile)
          const profileRevisionId = uuid(),
            acceptedAt = now()
          const trainingState: TrainingState = {
            profileRevisionId,
            profile,
            onboardingCompletedAt: acceptedAt,
            plan: {
              id: uuid(),
              kind: 'legacySummary',
              calculationVersion: '1',
              profileRevisionId,
              createdAt: acceptedAt,
              result: { ...plan, repRange: [plan.repRange[0], plan.repRange[1]] },
            },
          }
          repository.saveTrainingState(boundOwner, trainingState)
          const accepted = repository.readTrainingState(boundOwner)!
          if (active())
            set({
              profile: accepted.profile,
              plan: accepted.plan!.result,
              onboardingCompletedAt: accepted.onboardingCompletedAt,
              editing: false,
            })
        },
        clearProfile(): void {
          if (active()) set({ editing: true })
        },
        cancelEditing(): void {
          if (active()) set({ editing: false })
        },
      }
    }
    return {
      owner: null,
      profile: null,
      plan: null,
      onboardingCompletedAt: null,
      editing: false,
      ...actions(null),
      hydrateAccount(owner: string | null): void {
        const previous = get(),
          sameOwner = previous.owner === owner
        const saved = owner ? repository.readTrainingState(owner) : null
        const incomingProfile = saved?.profile ?? null,
          incomingPlan = saved?.plan?.result ?? null
        const onboardingCompletedAt = saved?.onboardingCompletedAt ?? null
        const profile =
          sameOwner && JSON.stringify(previous.profile) === JSON.stringify(incomingProfile)
            ? previous.profile
            : incomingProfile
        const plan =
          sameOwner && JSON.stringify(previous.plan) === JSON.stringify(incomingPlan)
            ? previous.plan
            : incomingPlan
        if (!sameOwner)
          set({ owner, profile, plan, onboardingCompletedAt, editing: false, ...actions(owner) })
        else if (
          profile !== previous.profile ||
          plan !== previous.plan ||
          onboardingCompletedAt !== previous.onboardingCompletedAt
        )
          set({ profile, plan, onboardingCompletedAt })
      },
    }
  }
}
