const pad = (n: number) => String(n).padStart(2, '0')

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

export const formatDate = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export const formatNumber = (n: number) => Math.round(n).toLocaleString()

export const formatCount = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`
