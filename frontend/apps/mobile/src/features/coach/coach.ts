import type { UserProfile } from '@myos/contracts'
import type { Plan } from '@myos/domain'

/** AI coaching seam, not implemented. API keys cannot ship in the binary, so this wraps Clerk-authed backend endpoints. */
export interface CoachClient {
  explainExercise(exerciseId: string): Promise<string>
  suggestPlan(profile: UserProfile, baseline: Plan): Promise<{ plan: Plan; rationale: string }>
  suggestNextWorkout(userId: string): Promise<{ exerciseIds: string[]; rationale: string }>
}
