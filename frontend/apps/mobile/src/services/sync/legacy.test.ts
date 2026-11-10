import { expect, it } from 'vitest'
import { parseLegacyPreferences } from './legacy'

it('rejects malformed legacy data instead of assigning it to an account', () => {
  expect(parseLegacyPreferences('{bad', '{"state":{"unit":"stones"}}')).toEqual({
    profile: null,
    settings: null,
  })
})

it('reads valid old settings without inventing account ownership', () => {
  expect(
    parseLegacyPreferences(
      null,
      JSON.stringify({ state: { unit: 'lb', restSeconds: 120, demoStyle: 'photo' } }),
    ),
  ).toEqual({
    profile: null,
    settings: { unit: 'lb', restSeconds: 120, demoStyle: 'photo' },
  })
})
