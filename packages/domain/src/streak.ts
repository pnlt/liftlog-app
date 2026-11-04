const DAY = 86_400_000

export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

function daysPerWeek(dates: Date[]): Map<number, number> {
  const seen = new Set<string>()
  const weeks = new Map<number, number>()
  for (const d of dates) {
    const k = dayKey(d)
    if (seen.has(k)) continue
    seen.add(k)
    const w = startOfWeek(d).getTime()
    weeks.set(w, (weeks.get(w) ?? 0) + 1)
  }
  return weeks
}

export function weeklyProgress(dates: Date[], goal: number, now = new Date()) {
  const done = daysPerWeek(dates).get(startOfWeek(now).getTime()) ?? 0
  return { done, goal, met: done >= goal }
}

export function weekStreak(dates: Date[], goal: number, now = new Date()): number {
  const weeks = daysPerWeek(dates)
  let week = startOfWeek(now)
  let streak = 0
  if ((weeks.get(week.getTime()) ?? 0) >= goal) streak++
  for (;;) {
    // step back via noon to stay safe across DST changes
    week = startOfWeek(new Date(week.getTime() - 3 * DAY))
    if ((weeks.get(week.getTime()) ?? 0) < goal) return streak
    streak++
  }
}
