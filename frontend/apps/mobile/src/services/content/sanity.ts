import type { ExerciseSource } from './source'

const API_VERSION = 'v2025-02-19'

/** Sanity `exercise` doc: slug, name, primaryMuscles[], secondaryMuscles[], equipment[], load,
 instructions[], tips[], image, video (file). Enum values must match @liftlog/domain. */
const QUERY = `*[_type == "exercise" && defined(slug.current)]{
  "id": slug.current,
  name,
  primaryMuscles,
  "secondaryMuscles": coalesce(secondaryMuscles, []),
  equipment,
  load,
  "instructions": coalesce(instructions, []),
  "tips": coalesce(tips, []),
  "imageUrl": image.asset->url,
  "videoUrl": video.asset->url,
  "updatedAt": _updatedAt
}`

export function sanitySource(projectId: string, dataset: string): ExerciseSource {
  return {
    name: 'sanity',
    async fetchAll() {
      const url = `https://${projectId}.apicdn.sanity.io/${API_VERSION}/data/query/${dataset}?query=${encodeURIComponent(QUERY)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Sanity responded ${res.status}`)
      const body = (await res.json()) as { result?: unknown }
      if (!Array.isArray(body.result)) throw new Error('Sanity response has no result array')
      return body.result
    },
  }
}
