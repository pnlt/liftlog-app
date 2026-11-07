import { describe, expect, it } from 'vitest'
import { personalize, STARTER_CATALOG, STARTER_PACK, type PlanningInput } from './planner'
const input: PlanningInput = {
  age: 25,
  experience: 'beginner',
  goal: 'buildMuscle',
  daysPerWeek: 7,
  sessionMinutes: 30,
  equipment: ['bodyweight', 'dumbbell'],
  equipmentConfirmed: true,
  restrictionStatus: 'none',
  excludedMovements: [],
  currentPain: false,
}
describe('private planner', () => {
  it('is deterministic, fits budget and spaces full body sessions', () => {
    const result = personalize(input, STARTER_PACK, STARTER_CATALOG)
    expect(result).toEqual(personalize(input, STARTER_PACK, STARTER_CATALOG))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.days.filter((d) => d.kind === 'training').length).toBe(3)
    for (const day of result.days)
      if (day.kind === 'training') {
        expect(day.minutes).toBeLessThanOrEqual(30)
        expect(new Set(day.exercises.map((e) => e.id)).size).toBe(day.exercises.length)
        expect(
          day.exercises.every((e) => e.requiredEquipment.every((v) => input.equipment.includes(v))),
        ).toBe(true)
      }
  })
  it.each([{ age: 17 }, { currentPain: true }, { restrictionStatus: 'unsure' as const }])(
    'provides guidance for %o',
    (patch) => {
      expect(personalize({ ...input, ...patch }, STARTER_PACK, STARTER_CATALOG)).toEqual({
        status: 'unavailable',
        reason: 'needsGuidance',
      })
    },
  )
  it('does not ignore excluded movement or missing equipment', () => {
    expect(
      personalize(
        { ...input, excludedMovements: ['pulling'], restrictionStatus: 'specified' },
        STARTER_PACK,
        STARTER_CATALOG,
      ).status,
    ).toBe('unavailable')
    expect(personalize({ ...input, equipment: ['bodyweight'] }, STARTER_PACK, STARTER_CATALOG).status).toBe(
      'unavailable',
    )
  })
  it('requires equipment confirmation and enough time', () => {
    expect(personalize({ ...input, equipmentConfirmed: false }, STARTER_PACK, STARTER_CATALOG)).toEqual({
      status: 'unavailable',
      reason: 'needsEquipmentConfirmation',
    })
    expect(personalize({ ...input, sessionMinutes: 10 }, STARTER_PACK, STARTER_CATALOG)).toEqual({
      status: 'unavailable',
      reason: 'cannotFitDuration',
    })
  })
})
