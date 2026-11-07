import type { Equipment } from './types'

export const SEXES = ['male', 'female'] as const
export type Sex = (typeof SEXES)[number]

export const GOALS = ['loseFat', 'buildMuscle', 'getStronger', 'stayFit'] as const
export type Goal = (typeof GOALS)[number]

export const EXPERIENCES = ['new', 'beginner', 'intermediate', 'advanced'] as const
export type Experience = (typeof EXPERIENCES)[number]

export const PLACES = ['gym', 'home', 'bodyweight'] as const
export type Place = (typeof PLACES)[number]

export const ACTIVITIES = ['desk', 'onFeet', 'physical'] as const
export type Activity = (typeof ACTIVITIES)[number]

export const PACES = ['steady', 'standard', 'fast'] as const
export type Pace = (typeof PACES)[number]

export interface Body {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
}

export interface PlanInput extends Body {
  goal: Goal
  experience: Experience
  daysPerWeek: number
  sessionMinutes: number
  place: Place
  activity: Activity
  pace: Pace
}

export type Phase = 'cut' | 'recomp' | 'maintain' | 'leanBulk'
export type Split = 'fullBody' | 'upperLower' | 'pushPullLegs' | 'hybrid'

export interface Plan {
  phase: Phase
  bmr: number
  tdee: number
  calories: number
  proteinG: number
  fatG: number
  carbsG: number
  waterMl: number
  weeklyChangeKg: number
  split: Split
  setsPerMuscle: number
  exercisesPerSession: number
  repRange: readonly [number, number]
  restSeconds: number
  equipment: Equipment[]
  bmi: number
}

export const PLACE_EQUIPMENT: Record<Place, Equipment[]> = {
  gym: [
    'barbell',
    'dumbbell',
    'kettlebell',
    'bench',
    'rack',
    'cable',
    'machine',
    'pullupBar',
    'band',
    'bodyweight',
  ],
  home: ['dumbbell', 'bench', 'pullupBar', 'band', 'bodyweight'],
  bodyweight: ['bodyweight'],
}

/** Mifflin-St Jeor, the most accurate of the common BMR equations for non-athletes. */
export const bmr = ({ sex, age, heightCm, weightKg }: Body) =>
  10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161)

export const bmi = ({ heightCm, weightKg }: Pick<Body, 'heightCm' | 'weightKg'>) =>
  weightKg / (heightCm / 100) ** 2

const DAILY_FACTOR: Record<Activity, number> = { desk: 1.2, onFeet: 1.35, physical: 1.5 }
/** Each weekly strength session adds roughly 3% on top of daily life. */
const SESSION_FACTOR = 0.03

const CUT_RATE: Record<Pace, number> = { steady: 0.0035, standard: 0.0055, fast: 0.0075 }
const BULK_RATE: Record<Experience, number> = {
  new: 0.0045,
  beginner: 0.0035,
  intermediate: 0.0025,
  advanced: 0.0015,
}
const KCAL_PER_KG = 7700
const MIN_KCAL: Record<Sex, number> = { male: 1500, female: 1200 }
const MAX_DEFICIT = 0.25

export function choosePhase(goal: Goal, bmiValue: number, experience: Experience): Phase {
  if (bmiValue < 18.5) return goal === 'loseFat' ? 'maintain' : 'leanBulk'
  switch (goal) {
    case 'loseFat':
      return 'cut'
    case 'buildMuscle':
      if (bmiValue >= 27) return 'cut'
      if (bmiValue >= 25) return 'recomp'
      return experience === 'new' && bmiValue >= 23 ? 'recomp' : 'leanBulk'
    case 'getStronger':
      if (bmiValue >= 30) return 'cut'
      return bmiValue < 22 ? 'leanBulk' : 'maintain'
    case 'stayFit':
      return bmiValue >= 30 ? 'cut' : 'maintain'
  }
}

export function chooseSplit(daysPerWeek: number, experience: Experience): Split {
  if (daysPerWeek <= 3 || experience === 'new') return 'fullBody'
  if (daysPerWeek === 4) return 'upperLower'
  if (daysPerWeek === 5) return 'hybrid'
  return 'pushPullLegs'
}

const SETS: Record<Experience, number> = { new: 8, beginner: 10, intermediate: 14, advanced: 16 }

const round = (n: number, to: number) => Math.round(n / to) * to

export function buildPlan(input: PlanInput): Plan {
  const bmiValue = bmi(input)
  const base = bmr(input)
  const tdee = base * (DAILY_FACTOR[input.activity] + SESSION_FACTOR * input.daysPerWeek)
  const phase = choosePhase(input.goal, bmiValue, input.experience)

  let weeklyChangeKg = 0
  if (phase === 'cut') weeklyChangeKg = -input.weightKg * CUT_RATE[input.pace]
  if (phase === 'leanBulk') weeklyChangeKg = input.weightKg * BULK_RATE[input.experience]
  if (phase === 'recomp') weeklyChangeKg = -input.weightKg * 0.001

  const delta = (weeklyChangeKg * KCAL_PER_KG) / 7
  const floor = Math.max(MIN_KCAL[input.sex], tdee * (1 - MAX_DEFICIT))
  const calories = round(Math.max(floor, tdee + delta), 10)
  weeklyChangeKg = Math.round((((calories - tdee) * 7) / KCAL_PER_KG) * 100) / 100

  // Protein scales with lean mass; above BMI 30 use the weight at BMI 27 so targets stay realistic.
  const proteinWeight = bmiValue > 30 ? 27 * (input.heightCm / 100) ** 2 : input.weightKg
  const proteinPerKg = phase === 'cut' ? 2.2 : phase === 'recomp' ? 2.0 : 1.8
  const proteinG = round(proteinWeight * proteinPerKg, 5)
  const fatG = round(Math.max(0.6 * input.weightKg, (calories * 0.25) / 9), 5)
  const carbsG = Math.max(0, round((calories - proteinG * 4 - fatG * 9) / 4, 5))

  const strength = input.goal === 'getStronger'
  return {
    phase,
    bmr: Math.round(base),
    tdee: round(tdee, 10),
    calories,
    proteinG,
    fatG,
    carbsG,
    waterMl: round(input.weightKg * 35 + input.daysPerWeek * 100, 250),
    weeklyChangeKg,
    split: chooseSplit(input.daysPerWeek, input.experience),
    setsPerMuscle: SETS[input.experience],
    // ~10 minutes per exercise including warm-up sets and rest.
    exercisesPerSession: Math.min(8, Math.max(3, Math.floor(input.sessionMinutes / 10))),
    repRange: strength ? [3, 6] : input.goal === 'loseFat' ? [8, 15] : [6, 12],
    restSeconds: strength ? 180 : input.goal === 'loseFat' ? 60 : 90,
    equipment: PLACE_EQUIPMENT[input.place],
    bmi: Math.round(bmiValue * 10) / 10,
  }
}
