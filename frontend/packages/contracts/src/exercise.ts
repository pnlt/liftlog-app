import { EQUIPMENT, LOADS, MUSCLES } from '@myos/domain'
import { z } from 'zod'

export const ExerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  primaryMuscles: z.array(z.enum(MUSCLES)).min(1),
  secondaryMuscles: z.array(z.enum(MUSCLES)).default([]),
  equipment: z.array(z.enum(EQUIPMENT)).min(1),
  load: z.enum(LOADS),
  instructions: z.array(z.string().min(1)).default([]),
  tips: z.array(z.string().min(1)).default([]),
  imageUrl: z.url().nullable().default(null),
  frames: z.array(z.url()).default([]),
  videoUrl: z.url().nullable().default(null),
  updatedAt: z.iso.datetime(),
})
export type Exercise = z.infer<typeof ExerciseSchema>
