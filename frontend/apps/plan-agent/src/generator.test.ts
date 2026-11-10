import { expect, it } from 'vitest'
import { STARTER_PACK } from '@myos/domain'
import { generateTemplate } from './generator'
it('repairs once and provider input has no profile fields', async () => {
  const inputs: unknown[] = []
  const pack = await generateTemplate('fullBody', async (prompt) => {
    inputs.push(JSON.parse(prompt))
    return inputs.length === 1 ? {} : { ...STARTER_PACK, provenance: 'aiTemplate', model: 'test-model' }
  })
  expect(inputs).toHaveLength(2)
  expect(Object.keys(inputs[0] as object).sort()).toEqual([
    'catalog',
    'instruction',
    'repair',
    'scenario',
    'schemaVersion',
  ])
  expect(pack.provenance).toBe('aiTemplate')
})
it('rejects invalid output after one repair and rejects nonregistry inputs before provider', async () => {
  let calls = 0
  await expect(
    generateTemplate('fullBody', async () => {
      calls++
      return {}
    }),
  ).rejects.toThrow()
  expect(calls).toBe(2)
  await expect(
    generateTemplate('personal-profile', async () => {
      calls++
      return STARTER_PACK
    }),
  ).rejects.toThrow()
  expect(calls).toBe(2)
})
