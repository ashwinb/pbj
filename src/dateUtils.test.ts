import { describe, expect, it, vi } from 'vitest'
import { daysInMonth, formatMonth, monthLabel, todayISO } from './dateUtils'

describe('date utils', () => {
  it('formats a date to the month key', () => {
    expect(formatMonth(new Date('2024-02-09T10:00:00Z'))).toBe('2024-02')
  })

  it('returns days in a month string', () => {
    expect(daysInMonth('2024-02')).toBe(29)
  })

  it('returns a human readable label', () => {
    expect(monthLabel('2025-01')).toBe('January 2025')
  })

  it('returns today in ISO format', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-10T12:00:00Z'))
    expect(todayISO()).toBe('2024-03-10')
    vi.useRealTimers()
  })
})
