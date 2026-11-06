/** Regenerates library.json from free-exercise-db (public domain), pinned so the catalog only changes with this file.
 Run from apps/mobile: `pnpm exec tsx scripts/import-exercises.mts`. */
import { writeFileSync } from 'node:fs'
import { ExerciseSchema, type Exercise } from '@liftlog/contracts'
import type { Equipment, Load, Muscle } from '@liftlog/domain'
import { SEED_EXERCISES } from '../src/services/content/seed'

const COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5'
const BASE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${COMMIT}`
const IMPORTED_AT = '2026-11-04T00:00:00.000Z'
const OUT = new URL('../src/services/content/library.json', import.meta.url)

interface Source {
  id: string
  name: string
  equipment: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  category: string
  images: string[]
}

const MUSCLE: Record<string, Muscle> = {
  abdominals: 'abs',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lowerBack',
  'middle back': 'upperBack',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
}

// Medicine balls, stability balls, foam rollers and "other" have no match in the app's equipment filter.
const EQUIPMENT: Record<string, Equipment> = {
  barbell: 'barbell',
  'e-z curl bar': 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  bands: 'band',
  'body only': 'bodyweight',
}

const SEED_ART: Record<string, string> = {
  'bench-press': 'Barbell_Bench_Press_-_Medium_Grip',
  'incline-bench-press': 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  'db-bench-press': 'Dumbbell_Bench_Press',
  'incline-db-press': 'Incline_Dumbbell_Press',
  'db-fly': 'Dumbbell_Flyes',
  'cable-fly': 'Cable_Crossover',
  'machine-chest-press': 'Machine_Bench_Press',
  'push-up': 'Pushups',
  'incline-push-up': 'Incline_Push-Up',
  dip: 'Dips_-_Chest_Version',
  deadlift: 'Barbell_Deadlift',
  'barbell-row': 'Bent_Over_Barbell_Row',
  'db-row': 'One-Arm_Dumbbell_Row',
  'pull-up': 'Pullups',
  'chin-up': 'Chin-Up',
  'lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  'seated-cable-row': 'Seated_Cable_Rows',
  'inverted-row': 'Inverted_Row',
  'band-pull-apart': 'Band_Pull_Apart',
  'face-pull': 'Face_Pull',
  'db-shrug': 'Dumbbell_Shrug',
  'overhead-press': 'Standing_Military_Press',
  'db-shoulder-press': 'Dumbbell_Shoulder_Press',
  'machine-shoulder-press': 'Machine_Shoulder_Military_Press',
  'lateral-raise': 'Side_Lateral_Raise',
  'cable-lateral-raise': 'Cable_Seated_Lateral_Raise',
  'rear-delt-fly': 'Cable_Rear_Delt_Fly',
  'barbell-curl': 'Barbell_Curl',
  'db-curl': 'Dumbbell_Bicep_Curl',
  'hammer-curl': 'Hammer_Curls',
  'cable-curl': 'Standing_Biceps_Cable_Curl',
  'triceps-pushdown': 'Triceps_Pushdown',
  'overhead-triceps-extension': 'Standing_Dumbbell_Triceps_Extension',
  'skull-crusher': 'EZ-Bar_Skullcrusher',
  'close-grip-bench': 'Close-Grip_Barbell_Bench_Press',
  'bench-dip': 'Bench_Dips',
  'back-squat': 'Barbell_Squat',
  'front-squat': 'Front_Barbell_Squat',
  'goblet-squat': 'Goblet_Squat',
  'bodyweight-squat': 'Bodyweight_Squat',
  'leg-press': 'Leg_Press',
  'romanian-deadlift': 'Romanian_Deadlift',
  'db-rdl': 'Stiff-Legged_Dumbbell_Deadlift',
  'bulgarian-split-squat': 'Split_Squat_with_Dumbbells',
  'split-squat': 'Split_Squats',
  'walking-lunge': 'Bodyweight_Walking_Lunge',
  'leg-extension': 'Leg_Extensions',
  'leg-curl': 'Lying_Leg_Curls',
  'hip-thrust': 'Barbell_Hip_Thrust',
  'glute-bridge': 'Single_Leg_Glute_Bridge',
  'kb-swing': 'One-Arm_Kettlebell_Swings',
  'standing-calf-raise': 'Standing_Calf_Raises',
  'machine-calf-raise': 'Calf_Press_On_The_Leg_Press_Machine',
  'step-up': 'Dumbbell_Step_Ups',
  plank: 'Plank',
  'side-plank': 'Side_Bridge',
  'dead-bug': 'Dead_Bug',
  'hanging-knee-raise': 'Hanging_Leg_Raise',
  'cable-crunch': 'Cable_Crunch',
  'ab-wheel': 'Ab_Roller',
  'russian-twist': 'Russian_Twist',
  'back-extension': 'Hyperextensions_Back_Extensions',
  'farmers-carry': 'Farmers_Walk',
}

const SKIP_CATEGORIES = new Set(['stretching'])
const LOADED: Equipment[] = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine']

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
const muscles = (names: string[]) => [...new Set(names.flatMap((n) => MUSCLE[n] ?? []))]

function equipmentFor(e: Source, main: Equipment): Equipment[] {
  const name = e.name.toLowerCase()
  const extra: Equipment[] = []
  if (/bench|incline|decline/.test(name) && main !== 'machine') extra.push('bench')
  if (main === 'barbell' && /squat|bench press|overhead press|military press/.test(name)) extra.push('rack')
  if (/pull-?up|chin-?up|hanging/.test(name)) extra.push('pullupBar')
  return [main, ...extra]
}

function loadFor(e: Source, equipment: Equipment[]): Load {
  if (/plank|wall sit|isometric|\bhold\b/i.test(e.name) && !/push[- ]?up/i.test(e.name)) return 'time'
  return equipment.some((x) => LOADED.includes(x)) ? 'weight' : 'bodyweight'
}

const framesOf = (e: Source) => e.images.map((path) => `${BASE}/exercises/${path}`)

function convert(e: Source): Exercise | null {
  const main = e.equipment == null ? 'bodyweight' : EQUIPMENT[e.equipment]
  const primaryMuscles = muscles(e.primaryMuscles)
  if (!main || primaryMuscles.length === 0 || SKIP_CATEGORIES.has(e.category)) return null
  const equipment = equipmentFor(e, main)
  const frames = framesOf(e)
  return ExerciseSchema.parse({
    id: `fedb-${e.id.toLowerCase().replace(/_/g, '-')}`,
    name: e.name,
    primaryMuscles,
    secondaryMuscles: muscles(e.secondaryMuscles).filter((m) => !primaryMuscles.includes(m)),
    equipment,
    load: loadFor(e, equipment),
    instructions: e.instructions.map((s) => s.trim()).filter(Boolean),
    tips: [],
    imageUrl: frames[0] ?? null,
    frames,
    videoUrl: null,
    updatedAt: IMPORTED_AT,
  })
}

const res = await fetch(`${BASE}/dist/exercises.json`)
if (!res.ok) throw new Error(`free-exercise-db fetch failed: ${res.status}`)
const source = (await res.json()) as Source[]

const taken = new Set(SEED_EXERCISES.map((e) => normalize(e.name)))
const ids = new Set(SEED_EXERCISES.map((e) => e.id))
const library: Exercise[] = []
for (const e of source) {
  const ex = convert(e)
  if (!ex || taken.has(normalize(ex.name)) || ids.has(ex.id)) continue
  taken.add(normalize(ex.name))
  ids.add(ex.id)
  library.push(ex)
}

const byId = new Map(source.map((e) => [e.id, e]))
const seedFrames: Record<string, string[]> = {}
for (const [seedId, artId] of Object.entries(SEED_ART)) {
  const art = byId.get(artId)
  if (!art) throw new Error(`SEED_ART: ${seedId} -> ${artId} is not in free-exercise-db`)
  if (!ids.has(seedId)) throw new Error(`SEED_ART: ${seedId} is not a seed exercise`)
  seedFrames[seedId] = framesOf(art)
}

writeFileSync(OUT, `${JSON.stringify({ seedFrames, exercises: library })}\n`)
console.log(
  `library.json: ${library.length} of ${source.length} exercises, ${Object.keys(seedFrames).length} seed demos`,
)
