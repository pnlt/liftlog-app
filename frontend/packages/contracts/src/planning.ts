import { EQUIPMENT, MOVEMENTS, ROLES, STARTER_CATALOG } from '@myos/domain'
import { z } from 'zod'
import { UserProfileSchema } from './workout'
export const PlanningProfileSchema = UserProfileSchema.extend({
  equipment: z.array(z.enum(EQUIPMENT)).min(1),
  equipmentConfirmed: z.boolean(),
  restrictionStatus: z.enum(['none', 'specified', 'unsure']),
  excludedMovements: z.array(z.enum(MOVEMENTS)),
  currentPain: z.boolean(),
}).refine(
  (p) => p.restrictionStatus !== 'none' || p.excludedMovements.length === 0,
  'Conflicting restrictions',
)
export type PlanningProfile = z.infer<typeof PlanningProfileSchema>
export const TemplatePackSchema = z
  .object({
    version: z.string().min(1),
    catalogVersion: z.literal('liftlog-reviewed-1'),
    policyVersion: z.literal('starter-1'),
    provenance: z.enum(['rules', 'aiTemplate']),
    model: z.string().min(1).nullable(),
    slots: z
      .array(z.object({ role: z.enum(ROLES), candidates: z.array(z.string()).min(1) }).strict())
      .length(4),
  })
  .strict()
  .superRefine((pack, ctx) => {
    if (new Set(pack.slots.map((s) => s.role)).size !== 4)
      ctx.addIssue({ code: 'custom', message: 'Every role is required once' })
    for (const slot of pack.slots)
      for (const id of slot.candidates) {
        if (!STARTER_CATALOG.some((e) => e.id === id && e.role === slot.role))
          ctx.addIssue({ code: 'custom', message: 'Unknown or ineligible exercise' })
      }
    if ((pack.provenance === 'aiTemplate') !== (pack.model !== null))
      ctx.addIssue({ code: 'custom', message: 'Provenance mismatch' })
  })
const PlannedExerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(ROLES),
  requiredEquipment: z.array(z.enum(EQUIPMENT)),
  movements: z.array(z.enum(MOVEMENTS)),
  minimumExperience: z.enum(['new', 'beginner', 'intermediate', 'advanced']),
  sets: z.literal(2),
  repLow: z.literal(8),
  repHigh: z.literal(12),
  restSeconds: z.literal(90),
})
export const PlanningResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum([
      'needsGuidance',
      'needsEquipmentConfirmation',
      'insufficientCatalogCoverage',
      'cannotFitDuration',
    ]),
  }),
  z.object({
    status: z.literal('ready'),
    provenance: z.enum(['rules', 'aiTemplate']),
    templateVersion: z.string().min(1),
    catalogVersion: z.literal('liftlog-reviewed-1'),
    policyVersion: z.literal('starter-1'),
    rationale: z.string(),
    days: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('recovery'), day: z.int().min(1).max(7) }),
          z.object({
            kind: z.literal('training'),
            day: z.int().min(1).max(7),
            minutes: z.int().positive().max(180),
            exercises: z.array(PlannedExerciseSchema).length(4),
          }),
        ]),
      )
      .length(7),
  }),
])
