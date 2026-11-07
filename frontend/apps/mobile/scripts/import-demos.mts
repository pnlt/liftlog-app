/** Regenerates assets/demos and demos.ts from Everkinetic line art and wger clips (both CC BY-SA 4.0).
 Run from apps/mobile: `../../node_modules/.bin/tsx scripts/import-demos.mts`. Needs `magick` and `ffmpeg`. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import library from '../src/services/content/library.json' with { type: 'json' }
import { SEED_EXERCISES } from '../src/services/content/seed'

const EK = 'https://raw.githubusercontent.com/everkinetic/data/446bb9a3d0c3beb6b84f7c9d77dfc8af707a2ab6'
const WGER = 'https://wger.de/api/v2'
const ART_DIR = new URL('../assets/demos/art/', import.meta.url)
const VIDEO_DIR = new URL('../assets/demos/video/', import.meta.url)
const OUT = new URL('../src/services/content/demos.ts', import.meta.url)
const CLIP_SECONDS = 6

const SEED_ART: Record<string, string> = {
  'bench-press': 'bench-press',
  'incline-bench-press': 'incline-bench-press',
  'db-bench-press': 'bench-press-dumbbell',
  'incline-db-press': 'incline-dumbbell-press',
  'db-fly': 'dumbbell-flys',
  'cable-fly': 'cable-crossover',
  'machine-chest-press': 'machine-bench-press',
  'push-up': 'push-ups',
  dip: 'chest-dips',
  deadlift: 'barbell-dead-lifts',
  'pull-up': 'pull-ups',
  'chin-up': 'chin-ups',
  'lat-pulldown': 'wide-grip-lat-pull-down',
  'seated-cable-row': 'seated-cable-rows',
  'inverted-row': 'body-row',
  'band-pull-apart': 'back-flys-exercise-band',
  'db-shrug': 'shoulder-shrugs',
  'overhead-press': 'barbell-shoulder-press',
  'db-shoulder-press': 'dumbbell-shoulder-press',
  'machine-shoulder-press': 'seated-shoulder-press-machine',
  'lateral-raise': 'lateral-dumbbell-raises',
  'rear-delt-fly': 'bent-over-rear-deltoid-raise-with-head-on-bench',
  'barbell-curl': 'bicep-curls-with-barbell',
  'db-curl': 'biceps-curl-with-dumbbell',
  'hammer-curl': 'bicep-hammer-curl-with-dumbbell',
  'cable-curl': 'standing-biceps-curl-with-cable',
  'triceps-pushdown': 'triceps-pushdown-with-cable',
  'overhead-triceps-extension': 'standing-triceps-extension',
  'skull-crusher': 'lying-triceps-press-with-barbell',
  'close-grip-bench': 'close-grip-barbell-bench-press',
  'bench-dip': 'bench-dips',
  'back-squat': 'barbell-squat',
  'front-squat': 'front-squat-with-barbell',
  'leg-press': 'leg-press',
  'romanian-deadlift': 'romanian-dead-lift',
  'db-rdl': 'dumbbell-dead-lifts',
  'walking-lunge': 'walking-lunges',
  'leg-extension': 'leg-extensions',
  'leg-curl': 'lying-leg-curl-machine',
  'glute-bridge': 'bridging',
  'standing-calf-raise': 'standing-barbell-calf-raise',
  'machine-calf-raise': 'standing-calf-raises-using-machine',
  'step-up': 'step-ups-with-dumbbells',
  'side-plank': 'side-plank',
  'ab-wheel': 'ab-rollout-on-knees-with-barbell',
  'back-extension': 'hyperextensions',
}

const VIDEOS: Record<number, { ids: string[]; start?: number }> = {
  73: { ids: ['bench-press', 'fedb-barbell-bench-press---medium-grip'] },
  75: { ids: ['db-bench-press'] },
  538: { ids: ['incline-bench-press', 'fedb-barbell-incline-bench-press---medium-grip'] },
  537: { ids: ['incline-db-press'] },
  194: { ids: ['dip'] },
  475: { ids: ['pull-up', 'fedb-pullups'] },
  222: { ids: ['face-pull'] },
  570: { ids: ['db-shrug'] },
  567: { ids: ['db-shoulder-press'] },
  543: { ids: ['machine-shoulder-press', 'fedb-machine-shoulder-military-press'] },
  348: { ids: ['lateral-raise', 'fedb-side-lateral-raise'] },
  82: { ids: ['rear-delt-fly', 'fedb-seated-bent-over-rear-delt-raise'] },
  91: { ids: ['barbell-curl'] },
  92: { ids: ['db-curl', 'fedb-dumbbell-bicep-curl'] },
  272: { ids: ['hammer-curl', 'fedb-hammer-curls'] },
  275: { ids: ['fedb-cable-hammer-curls---rope-attachment'] },
  95: { ids: ['cable-curl', 'fedb-standing-biceps-cable-curl'] },
  465: { ids: ['fedb-preacher-curl'] },
  584: { ids: ['fedb-one-arm-dumbbell-preacher-curl'] },
  659: { ids: ['triceps-pushdown'] },
  803: { ids: ['fedb-cable-one-arm-tricep-extension'] },
  211: { ids: ['overhead-triceps-extension', 'fedb-standing-dumbbell-triceps-extension'] },
  246: { ids: ['skull-crusher', 'fedb-ez-bar-skullcrusher'] },
  655: { ids: ['fedb-tricep-dumbbell-kickback'] },
  257: { ids: ['front-squat', 'fedb-front-barbell-squat'] },
  341: { ids: ['fedb-smith-machine-squat'] },
  371: { ids: ['leg-press'] },
  375: { ids: ['fedb-hack-squat'] },
  507: { ids: ['romanian-deadlift'] },
  46: { ids: ['fedb-barbell-lunge'] },
  802: { ids: ['fedb-barbell-walking-lunge'] },
  205: { ids: ['fedb-dumbbell-lunges'] },
  206: { ids: ['walking-lunge'] },
  365: { ids: ['leg-curl', 'fedb-lying-leg-curls'] },
  366: { ids: ['fedb-seated-leg-curl'] },
  367: { ids: ['fedb-standing-leg-curl'] },
  294: { ids: ['hip-thrust'] },
  622: { ids: ['standing-calf-raise', 'fedb-standing-calf-raises'] },
  590: { ids: ['fedb-seated-calf-raise'] },
  512: { ids: ['seated-cable-row', 'fedb-seated-cable-rows'] },
  12: { ids: ['fedb-cable-hip-adduction'] },
}

interface EkExercise {
  title: string
  img?: string[]
}
interface WgerVideo {
  exercise: number
  video: string
  duration: string
  width: number
  height: number
  license_author: string
}

const json = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return (await res.json()) as T
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !['with', 'on', 'the', 'a', 'of', 'and', 'to', 'using'].includes(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .sort()
    .join(' ')

const catalog = [...SEED_EXERCISES, ...library.exercises].map((e) => ({ id: e.id, name: e.name }))
const known = new Set(catalog.map((e) => e.id))
const check = (id: string, from: string) => {
  if (!known.has(id)) throw new Error(`${from}: no exercise ${id}`)
}

const ek = await json<EkExercise[]>(`${EK}/exercises.json`)
const stemOf = (img: string) => img.replace(/^.*\//, '').replace(/-\d\.png$/, '')
const artFor = new Map<string, string>(Object.entries(SEED_ART))
const byTitle = new Map(ek.map((e) => [norm(e.title), e.img?.[0] ? stemOf(e.img[0]) : null]))
for (const e of catalog) {
  const stem = byTitle.get(norm(e.name))
  if (stem && !artFor.has(e.id)) artFor.set(e.id, stem)
}
for (const id of artFor.keys()) check(id, 'SEED_ART')

rmSync(ART_DIR, { recursive: true, force: true })
mkdirSync(ART_DIR, { recursive: true })
const frames = new Map<string, string[]>()
for (const stem of new Set(artFor.values())) {
  const files: string[] = []
  for (let n = 1; ; n++) {
    const res = await fetch(`${EK}/src/images-web/${stem}-${n}.png`)
    if (!res.ok) break
    const file = `${stem}-${n}.webp`
    execFileSync(
      'magick',
      [
        '-',
        ...['-colorspace', 'Gray', '-negate'],
        // Thicker strokes keep the drawing legible at thumbnail size.
        ...['-morphology', 'Dilate', 'Disk:1.5', '-resize', '640x640'],
        ...['-background', 'white', '-alpha', 'shape'],
        ...['-quality', '70', '-define', 'webp:alpha-quality=60', '-define', 'webp:method=6'],
        new URL(file, ART_DIR).pathname,
      ],
      { input: Buffer.from(await res.arrayBuffer()) },
    )
    files.push(file)
  }
  if (files.length >= 2) frames.set(stem, files)
  else if (Object.values(SEED_ART).includes(stem))
    throw new Error(`Everkinetic ${stem}: ${files.length} frames`)
}
for (const [id, stem] of artFor) if (!frames.has(stem)) artFor.delete(id)

const { results: videos } = await json<{ results: WgerVideo[] }>(`${WGER}/video/?limit=200`)
rmSync(VIDEO_DIR, { recursive: true, force: true })
mkdirSync(VIDEO_DIR, { recursive: true })
const clips = new Map<string, { file: string; author: string }>()
for (const [exercise, { ids, start }] of Object.entries(VIDEOS)) {
  const pick = videos
    .filter((v) => v.exercise === Number(exercise) && Number(v.duration) >= CLIP_SECONDS + 1)
    .sort(
      (a, b) => Number(b.width <= 1920) - Number(a.width <= 1920) || Number(a.duration) - Number(b.duration),
    )[0]
  if (!pick) throw new Error(`wger ${exercise}: no usable video`)
  const duration = Number(pick.duration)
  const from = start ?? Math.min(Math.max(duration * 0.2, 1.5), duration - CLIP_SECONDS)
  const file = `wger-${exercise}.mp4`
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y', '-ss', String(from), '-t', String(CLIP_SECONDS), '-i', pick.video, '-an'],
    ...['-vf', 'scale=-2:480,fps=24', '-c:v', 'libx264', '-crf', '32', '-preset', 'slow'],
    ...['-profile:v', 'main', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
    new URL(file, VIDEO_DIR).pathname,
  ])
  for (const id of ids) {
    check(id, `VIDEOS ${exercise}`)
    clips.set(id, { file, author: pick.license_author })
  }
}

const art = [...artFor]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, stem]) => {
    const list = (frames.get(stem) ?? []).map((f) => `require('../../../assets/demos/art/${f}')`)
    return `  '${id}': [${list.join(', ')}],`
  })
const clip = [...clips]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(
    ([id, c]) =>
      `  '${id}': { source: require('../../../assets/demos/video/${c.file}'), author: ${JSON.stringify(c.author)} },`,
  )
writeFileSync(
  OUT,
  `// Generated by scripts/import-demos.mts. Do not edit.

export const LINE_ART: Partial<Record<string, number[]>> = {
${art.join('\n')}
}

export const DEMO_VIDEOS: Partial<Record<string, { source: number; author: string }>> = {
${clip.join('\n')}
}
`,
)
console.log(`${artFor.size} exercises with line art (${frames.size} drawings), ${clips.size} with clips`)
