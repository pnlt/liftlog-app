import { UserProfileSchema } from '@myos/contracts'
import { z } from 'zod'

const preferences = z.object({
  unit: z.enum(['kg', 'lb']),
  restSeconds: z.int().min(0).max(600),
  demoStyle: z.enum(['art', 'photo']),
})
function state(text: string | null): unknown {
  try {
    const parsed: unknown = text ? JSON.parse(text) : null
    const result = z.object({ state: z.unknown() }).safeParse(parsed)
    return result.success ? result.data.state : null
  } catch {
    return null
  }
}

/** Parsing does not claim legacy global keys for any signed-in account. */
export function parseLegacyPreferences(profileText: string | null, settingsText: string | null) {
  const profile = z.object({ profile: UserProfileSchema }).safeParse(state(profileText))
  const settings = preferences.safeParse(state(settingsText))
  return {
    profile: profile.success ? profile.data.profile : null,
    settings: settings.success ? settings.data : null,
  }
}
