import { PlanningProfileSchema, PlanningResultSchema, type PlanningProfile } from '@myos/contracts'
import type { PlanningResult } from '@myos/domain'
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { acceptedPlans } from './db/schema'
export function readAcceptedPlan(
  userId: string,
): { profile: PlanningProfile; result: PlanningResult } | null {
  const row = db.select().from(acceptedPlans).where(eq(acceptedPlans.userId, userId)).get()
  if (!row) return null
  return {
    profile: PlanningProfileSchema.parse(JSON.parse(row.profile)),
    result: PlanningResultSchema.parse(JSON.parse(row.result)),
  }
}
export function acceptPlan(userId: string, profile: PlanningProfile, result: PlanningResult) {
  const validProfile = PlanningProfileSchema.parse(profile)
  const validResult = PlanningResultSchema.parse(result)
  db.transaction((tx) => {
    tx.insert(acceptedPlans)
      .values({
        userId,
        profile: JSON.stringify(validProfile),
        result: JSON.stringify(validResult),
        acceptedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run()
  })
}
