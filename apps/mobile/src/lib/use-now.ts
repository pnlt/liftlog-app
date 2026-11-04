import { useEffect, useState } from 'react'

export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    const tick = () => setNow(Date.now())
    // Refresh right away: `now` may be stale after being disabled.
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [intervalMs, enabled])
  return now
}
