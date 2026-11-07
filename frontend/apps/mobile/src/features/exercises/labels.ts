import type { Equipment, Muscle } from '@myos/domain'

export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: 'Chest',
  lats: 'Lats',
  upperBack: 'Upper back',
  traps: 'Traps',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  lowerBack: 'Lower back',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
}

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  bench: 'Bench',
  rack: 'Rack',
  cable: 'Cable',
  machine: 'Machine',
  pullupBar: 'Pull-up bar',
  band: 'Band',
  bodyweight: 'Bodyweight',
}
