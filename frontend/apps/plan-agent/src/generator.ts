import { TemplatePackSchema } from '@myos/contracts'
import { STARTER_CATALOG } from '@myos/domain'

/** Provider injection keeps this draft testable without credentials or personal inputs. */
export async function generateTemplate(scenario: string, provider: (prompt: string) => Promise<unknown>) {
  if (scenario !== 'fullBody') throw new Error('Unknown public template scenario')
  let repair: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await provider(
      JSON.stringify({
        schemaVersion: 1,
        scenario,
        catalog: STARTER_CATALOG,
        instruction: 'Return a validated public full-body template pack using only the catalog IDs.',
        repair,
      }),
    )
    const parsed = TemplatePackSchema.safeParse(output)
    if (parsed.success) return parsed.data
    repair = 'The previous output failed template validation. Return a complete valid pack.'
  }
  throw new Error('Template output failed validation after one repair')
}
