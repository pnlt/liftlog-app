import type { Equipment } from './types'
import type { Experience, Goal } from './plan'

export const MOVEMENTS = [
  'horizontalPress',
  'overheadPress',
  'pulling',
  'kneeDominant',
  'hipHinge',
  'spinalLoading',
  'impact',
  'floorSupported',
] as const
export type Movement = (typeof MOVEMENTS)[number]
export interface PlanningInput {
  age: number
  goal: Goal
  experience: Experience
  daysPerWeek: number
  sessionMinutes: number
  equipment: Equipment[]
  equipmentConfirmed: boolean
  restrictionStatus: 'none' | 'specified' | 'unsure'
  excludedMovements: Movement[]
  currentPain: boolean
}
export const ROLES = ['push', 'pull', 'legs', 'hinge'] as const
export type Role = (typeof ROLES)[number]
export interface PlanningExercise {
  id: string
  name: string
  role: Role
  requiredEquipment: Equipment[]
  movements: Movement[]
  minimumExperience: Experience
}
export interface TemplatePack {
  version: string
  catalogVersion: string
  policyVersion: 'starter-1'
  provenance: 'rules' | 'aiTemplate'
  model: string | null
  slots: { role: Role; candidates: string[] }[]
}
export interface PlannedExercise extends PlanningExercise {
  sets: number
  repLow: number
  repHigh: number
  restSeconds: number
}
export type PlannedDay =
  | { kind: 'recovery'; day: number }
  | { kind: 'training'; day: number; minutes: number; exercises: PlannedExercise[] }
export type PlanningResult =
  | {
      status: 'unavailable'
      reason:
        'needsGuidance' | 'needsEquipmentConfirmation' | 'insufficientCatalogCoverage' | 'cannotFitDuration'
    }
  | {
      status: 'ready'
      provenance: TemplatePack['provenance']
      templateVersion: string
      catalogVersion: string
      policyVersion: string
      days: PlannedDay[]
      rationale: string
    }
const exercise = (
  id: string,
  name: string,
  role: Role,
  requiredEquipment: Equipment[],
  movements: Movement[],
  minimumExperience: Experience = 'new',
): PlanningExercise => ({ id, name, role, requiredEquipment, movements, minimumExperience })
/** Reviewed eligibility is intentionally narrower than the browsable catalog. */
export const STARTER_CATALOG: PlanningExercise[] = [
  exercise('push-up', 'Push-up', 'push', ['bodyweight'], ['horizontalPress', 'floorSupported']),
  exercise(
    'db-bench-press',
    'Dumbbell Bench Press',
    'push',
    ['dumbbell', 'bench'],
    ['horizontalPress'],
    'intermediate',
  ),
  exercise(
    'bench-press',
    'Barbell Bench Press',
    'push',
    ['barbell', 'bench', 'rack'],
    ['horizontalPress'],
    'intermediate',
  ),
  exercise(
    'fedb-bent-over-two-dumbbell-row',
    'Bent Over Two-Dumbbell Row',
    'pull',
    ['dumbbell'],
    ['pulling', 'hipHinge', 'spinalLoading'],
  ),
  exercise('db-row', 'One-arm Dumbbell Row', 'pull', ['dumbbell', 'bench'], ['pulling', 'hipHinge']),
  exercise('pull-up', 'Pull-up', 'pull', ['pullupBar'], ['pulling'], 'intermediate'),
  exercise('bodyweight-squat', 'Bodyweight Squat', 'legs', ['bodyweight'], ['kneeDominant']),
  exercise('goblet-squat', 'Goblet Squat', 'legs', ['dumbbell'], ['kneeDominant', 'spinalLoading']),
  exercise(
    'back-squat',
    'Barbell Back Squat',
    'legs',
    ['barbell', 'rack'],
    ['kneeDominant', 'spinalLoading'],
    'intermediate',
  ),
  exercise('glute-bridge', 'Glute Bridge', 'hinge', ['bodyweight'], ['hipHinge', 'floorSupported']),
  exercise('db-rdl', 'Dumbbell Romanian Deadlift', 'hinge', ['dumbbell'], ['hipHinge', 'spinalLoading']),
]
export const STARTER_PACK: TemplatePack = {
  version: 'rules-1',
  catalogVersion: 'liftlog-reviewed-1',
  policyVersion: 'starter-1',
  provenance: 'rules',
  model: null,
  slots: ROLES.map((role) => ({
    role,
    candidates: STARTER_CATALOG.filter((e) => e.role === role).map((e) => e.id),
  })),
}
const rank: Record<Experience, number> = { new: 0, beginner: 1, intermediate: 2, advanced: 3 }
export function personalize(
  input: PlanningInput,
  pack: TemplatePack,
  catalog: PlanningExercise[],
): PlanningResult {
  if (!input.equipmentConfirmed) return { status: 'unavailable', reason: 'needsEquipmentConfirmation' }
  if (input.age < 18 || input.currentPain || input.restrictionStatus === 'unsure')
    return { status: 'unavailable', reason: 'needsGuidance' }
  const equipment = new Set<Equipment>(['bodyweight', ...input.equipment])
  const selected: PlannedExercise[] = []
  for (const role of ROLES) {
    const slot = pack.slots.find((s) => s.role === role)
    const candidates = slot?.candidates.map((id) => catalog.find((e) => e.id === id)) ?? []
    const match = candidates.find(
      (e) =>
        e &&
        e.role === role &&
        rank[e.minimumExperience] <= rank[input.experience] &&
        e.requiredEquipment.every((v) => equipment.has(v)) &&
        !e.movements.some((v) => input.excludedMovements.includes(v)),
    )
    if (!match) return { status: 'unavailable', reason: 'insufficientCatalogCoverage' }
    selected.push({ ...match, sets: 2, repLow: 8, repHigh: 12, restSeconds: 90 })
  }
  // Five-minute warm-up, up to 48s work per set, full rest after each set, 60s transitions.
  const minutes = Math.ceil(5 + (selected.length * (2 * (48 + 90) + 60)) / 60)
  if (minutes > input.sessionMinutes) return { status: 'unavailable', reason: 'cannotFitDuration' }
  const count = Math.min(3, input.daysPerWeek)
  const training = count === 1 ? [0] : count === 2 ? [0, 3] : [0, 2, 4]
  return {
    status: 'ready',
    provenance: pack.provenance,
    templateVersion: pack.version,
    catalogVersion: pack.catalogVersion,
    policyVersion: pack.policyVersion,
    days: Array.from({ length: 7 }, (_, day): PlannedDay =>
      training.includes(day)
        ? { kind: 'training', day: day + 1, minutes, exercises: selected.map((e) => ({ ...e })) }
        : { kind: 'recovery', day: day + 1 },
    ),
    rationale: `${count} full-body session${count === 1 ? '' : 's'} with recovery days. Exercises match your confirmed equipment and movement exclusions. Start with a comfortable load; no starting weight is inferred.`,
  }
}
