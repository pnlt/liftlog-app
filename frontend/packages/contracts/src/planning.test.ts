import { expect, it } from 'vitest'
import { STARTER_PACK } from '@myos/domain'
import { TemplatePackSchema } from './planning'
it('validates the reviewed pack and rejects unknown ids and missing slots', () => {
  expect(TemplatePackSchema.safeParse(STARTER_PACK).success).toBe(true)
  expect(TemplatePackSchema.safeParse({ ...STARTER_PACK, slots: [] }).success).toBe(false)
  expect(
    TemplatePackSchema.safeParse({
      ...STARTER_PACK,
      slots: STARTER_PACK.slots.map((s) => ({ ...s, candidates: ['unknown'] })),
    }).success,
  ).toBe(false)
})
