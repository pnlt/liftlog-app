import { ExerciseSchema, type Exercise } from '@liftlog/contracts'
import Storage from 'expo-sqlite/kv-store'
import { upsertExercises } from '@/data/exercises'
import { envResult } from '@/lib/env'
import { BUNDLED_REVISION, bundledSource } from './bundled'
import { sanitySource } from './sanity'
import type { ExerciseSource } from './source'

function validate(source: ExerciseSource, docs: unknown[]): Exercise[] {
  const valid: Exercise[] = []
  for (const doc of docs) {
    const parsed = ExerciseSchema.safeParse(doc)
    if (parsed.success) valid.push(parsed.data)
    else console.warn(`[content] dropped invalid ${source.name} exercise`, parsed.error.issues)
  }
  return valid
}

async function pull(source: ExerciseSource): Promise<void> {
  await upsertExercises(validate(source, await source.fetchAll()))
}

export async function syncExerciseCatalog(): Promise<void> {
  if (Storage.getItemSync('bundledRevision') !== BUNDLED_REVISION) {
    await pull(bundledSource)
    Storage.setItemSync('bundledRevision', BUNDLED_REVISION)
  }
  const sanity = envResult.success ? envResult.data.sanity : null
  if (!sanity) return
  try {
    await pull(sanitySource(sanity.projectId, sanity.dataset))
  } catch (err) {
    console.warn('[content] CMS refresh failed, using cached catalog', err)
  }
}
