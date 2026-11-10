import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { ExerciseSchema } from '@myos/contracts'
import { BUNDLED_REVISION, bundledSource } from '../src/services/content/bundled'

const items = (await bundledSource.fetchAll())
  .map((item) => ExerciseSchema.parse(item))
  .sort((a, b) => a.id.localeCompare(b.id))
if (new Set(items.map((item) => item.id)).size !== items.length)
  throw new Error('Duplicate catalog exercise ID')
const hash = createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12)
const attribution = await readFile(new URL('../../../../CREDITS.md', import.meta.url), 'utf8')
const directory = new URL('../../../../backend/data/', import.meta.url)
await mkdir(directory, { recursive: true })
const revision = `bundled-${BUNDLED_REVISION}-${hash}`
await writeFile(
  new URL('exercise-catalog.json', directory),
  JSON.stringify({ revision, attribution, items }, null, 2) + '\n',
)
process.stdout.write(`Exported ${items.length} validated exercises (${revision})\n`)
