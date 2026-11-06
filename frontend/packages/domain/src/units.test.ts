import { describe, expect, it } from 'vitest'
import { fromDisplay, stepValue, toDisplay } from './units'

describe('stepValue', () => {
  it('starts an empty value from zero', () => expect(stepValue(null, 2.5)).toBe(2.5))
  it('never goes below zero', () => expect(stepValue(1.25, -2.5)).toBe(0))
  it('does not drift over repeated float steps', () => {
    let v: number | null = null
    for (let i = 0; i < 30; i++) v = stepValue(v, 0.1)
    expect(v).toBe(3)
  })
  it('round-trips a pound step through kg storage', () => {
    const kg = fromDisplay(stepValue(135, 5), 'lb')
    expect(toDisplay(kg, 'lb')).toBe(140)
  })
})
