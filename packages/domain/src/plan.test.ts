import { describe, expect, it } from 'vitest'
import { bmr, buildPlan, choosePhase, chooseSplit, type PlanInput } from './plan'

const base: PlanInput = {
  sex: 'male',
  age: 25,
  heightCm: 178,
  weightKg: 75,
  goal: 'buildMuscle',
  experience: 'beginner',
  daysPerWeek: 4,
  sessionMinutes: 60,
  place: 'gym',
  activity: 'desk',
  pace: 'standard',
}

describe('bmr', () => {
  it('matches Mifflin-St Jeor reference values', () => {
    expect(bmr({ sex: 'male', age: 25, heightCm: 178, weightKg: 75 })).toBe(1742.5)
    expect(bmr({ sex: 'female', age: 30, heightCm: 165, weightKg: 60 })).toBe(1320.25)
  })
})

describe('choosePhase', () => {
  it('cuts when losing fat, bulks lean when slim and building', () => {
    expect(choosePhase('loseFat', 26, 'beginner')).toBe('cut')
    expect(choosePhase('buildMuscle', 22, 'beginner')).toBe('leanBulk')
  })
  it('steers overweight muscle-builders to recomp or cut', () => {
    expect(choosePhase('buildMuscle', 26, 'intermediate')).toBe('recomp')
    expect(choosePhase('buildMuscle', 29, 'intermediate')).toBe('cut')
  })
  it('never cuts an underweight person', () => {
    expect(choosePhase('loseFat', 17.9, 'new')).toBe('maintain')
    expect(choosePhase('stayFit', 17.9, 'new')).toBe('leanBulk')
  })
})

describe('chooseSplit', () => {
  it('keeps new lifters and short weeks on full body', () => {
    expect(chooseSplit(3, 'advanced')).toBe('fullBody')
    expect(chooseSplit(6, 'new')).toBe('fullBody')
    expect(chooseSplit(4, 'beginner')).toBe('upperLower')
    expect(chooseSplit(6, 'intermediate')).toBe('pushPullLegs')
  })
})

describe('buildPlan', () => {
  it('adds a small surplus for a lean bulk', () => {
    const p = buildPlan(base)
    expect(p.phase).toBe('leanBulk')
    expect(p.calories).toBeGreaterThan(p.tdee)
    expect(p.weeklyChangeKg).toBeCloseTo(0.26, 1)
    expect(p.proteinG).toBe(135)
  })

  it('macros add up to the calorie target', () => {
    const p = buildPlan({ ...base, goal: 'loseFat' })
    expect(Math.abs(p.proteinG * 4 + p.fatG * 9 + p.carbsG * 4 - p.calories)).toBeLessThan(25)
  })

  it('caps the deficit and respects the calorie floor', () => {
    const p = buildPlan({
      ...base,
      sex: 'female',
      heightCm: 155,
      weightKg: 58,
      age: 45,
      goal: 'loseFat',
      pace: 'fast',
      daysPerWeek: 2,
    })
    expect(p.calories).toBeGreaterThanOrEqual(1200)
    expect(p.calories).toBeGreaterThanOrEqual(Math.round(p.tdee * 0.75) - 10)
    expect(p.weeklyChangeKg).toBeLessThan(0)
  })

  it('bases protein on a reference weight above BMI 30', () => {
    const p = buildPlan({ ...base, weightKg: 120, goal: 'loseFat' })
    expect(p.proteinG).toBeLessThan(120 * 2.2)
  })

  it('uses heavy reps and long rest for strength', () => {
    const p = buildPlan({ ...base, goal: 'getStronger' })
    expect(p.repRange).toEqual([3, 6])
    expect(p.restSeconds).toBe(180)
  })
})
