import { describe, it, expect } from 'vitest'

// Re-exported pure helpers from scheduler.ts for isolated testing
function getBoard(code: string, exchange: string): string {
  if (exchange === 'SH') {
    if (code.startsWith('688')) return 'kcb'
    return 'hsb'
  }
  if (code.startsWith('30')) return 'cyb'
  return 'hsb'
}

function getWeekdaysBetween(start: string, end: string): string[] {
  const dates: string[] = []
  const parseDate = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  }
  const cur = parseDate(start)
  const last = parseDate(end)
  while (cur <= last) {
    const day = cur.getUTCDay() // UTC day = CST day (CST = UTC+8, no DST)
    if (day !== 0 && day !== 6) dates.push(cur.toISOString().split('T')[0])
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

function today(): string { return new Date().toISOString().split('T')[0] }

// ---------------------------------------------------------------------------
// getBoard — pure stock board classifier
// ---------------------------------------------------------------------------

describe('getBoard', () => {
  it('classifies SH 688 as kcb', () => {
    expect(getBoard('688001', 'SH')).toBe('kcb')
    expect(getBoard('688500', 'SH')).toBe('kcb')
  })

  it('classifies SH non-688 as hsb', () => {
    expect(getBoard('600000', 'SH')).toBe('hsb')
    expect(getBoard('600519', 'SH')).toBe('hsb')
    expect(getBoard('601989', 'SH')).toBe('hsb')
  })

  it('classifies SZ 30-prefix as cyb', () => {
    expect(getBoard('300001', 'SZ')).toBe('cyb')
    expect(getBoard('300750', 'SZ')).toBe('cyb')
  })

  it('classifies SZ non-30 as hsb', () => {
    expect(getBoard('000001', 'SZ')).toBe('hsb')
    expect(getBoard('002594', 'SZ')).toBe('hsb')
    expect(getBoard('001979', 'SZ')).toBe('hsb')
  })

  it('treats unknown exchange as hsb by default', () => {
    expect(getBoard('123456', 'UNKNOWN')).toBe('hsb')
  })

  it('treats BJ as hsb', () => {
    expect(getBoard('430001', 'BJ')).toBe('hsb')
  })
})

// ---------------------------------------------------------------------------
// getWeekdaysBetween — pure business-day calculator
// ---------------------------------------------------------------------------

describe('getWeekdaysBetween', () => {
  it('returns single date when start equals end and it is a weekday', () => {
    // 2024-01-03 is a Wednesday
    expect(getWeekdaysBetween('2024-01-03', '2024-01-03')).toEqual(['2024-01-03'])
  })

  it('returns empty array when range is a single weekend day', () => {
    // 2024-01-06 is a Saturday
    expect(getWeekdaysBetween('2024-01-06', '2024-01-06')).toEqual([])
  })

  it('excludes Saturdays', () => {
    // 2024-01-05 (Fri) → 2024-01-08 (Mon) skips Sat Jan 6
    const result = getWeekdaysBetween('2024-01-05', '2024-01-08')
    expect(result).toEqual(['2024-01-05', '2024-01-08'])
    expect(result).not.toContain('2024-01-06')
  })

  it('excludes Sundays', () => {
    // 2024-01-05 (Fri) → 2024-01-08 (Mon) skips Sun Jan 7
    const result = getWeekdaysBetween('2024-01-05', '2024-01-08')
    expect(result).not.toContain('2024-01-07')
  })

  it('returns all weekdays in a full working week', () => {
    // Mon Jan 8 → Fri Jan 12 2024
    const result = getWeekdaysBetween('2024-01-08', '2024-01-12')
    expect(result).toEqual(['2024-01-08', '2024-01-09', '2024-01-10', '2024-01-11', '2024-01-12'])
    expect(result).toHaveLength(5)
  })

  it('returns empty for a full weekend range', () => {
    // Sat Jan 6 → Sun Jan 7
    expect(getWeekdaysBetween('2024-01-06', '2024-01-07')).toEqual([])
  })

  it('handles range spanning two weeks', () => {
    // Mon Jan 8 → Fri Jan 19 (10 business days)
    const result = getWeekdaysBetween('2024-01-08', '2024-01-19')
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('2024-01-08')
    expect(result[result.length - 1]).toBe('2024-01-19')
  })

  it('returns empty when end is before start', () => {
    // No weekdays are generated if the loop condition cur <= last is never met
    const result = getWeekdaysBetween('2024-01-15', '2024-01-08')
    expect(result).toHaveLength(0)
  })

  it('is ordered chronologically', () => {
    const result = getWeekdaysBetween('2024-01-08', '2024-01-19')
    for (let i = 1; i < result.length; i++) {
      expect(result[i] > result[i - 1]).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// today — date helper
// ---------------------------------------------------------------------------

describe('today', () => {
  it('returns a valid ISO date string (YYYY-MM-DD)', () => {
    const result = today()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Should be today's date — just validate format and reasonability
    const parsed = new Date(result)
    expect(parsed.getFullYear()).toBeGreaterThanOrEqual(2020)
    expect(parsed.getMonth()).toBeGreaterThanOrEqual(0)
    expect(parsed.getMonth()).toBeLessThanOrEqual(11)
  })
})
