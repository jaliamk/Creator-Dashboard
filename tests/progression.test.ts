import { describe, expect, it } from 'vitest'
import { progression, threshold } from '../lib/progression'

describe('progression', () => {
  it('starts both tracks at level 1 and advances at exact thresholds', () => {
    expect(progression(0, 50)).toEqual({ level: 1, current: 0, target: 100, percent: 0 })
    expect(progression(99, 50).level).toBe(1)
    expect(progression(100, 50)).toEqual({ level: 2, current: 0, target: 200, percent: 0 })
    expect(progression(199, 100).level).toBe(1)
    expect(progression(200, 100).level).toBe(2)
    expect(threshold(4, 100)).toBe(1200)
  })

  it('accepts configurable factors and carries over XP', () => {
    expect(progression(31, 5)).toEqual({ level: 3, current: 1, target: 30, percent: 100 / 30 })
  })
})
