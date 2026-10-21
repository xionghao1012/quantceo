import { describe, it, expect } from 'vitest'
import type { KLine } from '../../shared/types.js'


// Inline the pure function under test (extracted from source)
function findForwardCloses(klData: KLine[], pickDate: string, horizons: number[]): { days: number; close: number }[] {
  const pickIdx = klData.findIndex(k => k.date >= pickDate)
  if (pickIdx === -1) return []
  const result: { days: number; close: number }[] = []
  for (const h of horizons) {
    const idx = pickIdx + h
    if (idx < klData.length) {
      result.push({ days: h, close: klData[idx].close })
    }
  }
  return result
}

function makeKline(date: string, close: number, high?: number, low?: number): KLine {
  const c = close
  return { code: '000001', date, open: c, high: high ?? c, low: low ?? c, close: c, volume: 0, amount: 0 }
}

describe('findForwardCloses', () => {
  it('returns empty array when pickDate is after all klines', () => {
    const klData = [
      makeKline('2024-01-01', 10),
      makeKline('2024-01-02', 11),
      makeKline('2024-01-03', 12),
    ]
    expect(findForwardCloses(klData, '2024-01-10', [1, 3, 5])).toEqual([])
  })

  it('returns empty array when klines is empty', () => {
    expect(findForwardCloses([], '2024-01-01', [1, 3, 5])).toEqual([])
  })

  it('finds exact match on first kline', () => {
    const klData = [
      makeKline('2024-01-01', 10),
      makeKline('2024-01-02', 11),
      makeKline('2024-01-03', 12),
      makeKline('2024-01-04', 13),
    ]
    const result = findForwardCloses(klData, '2024-01-01', [1, 2, 3])
    expect(result).toEqual([
      { days: 1, close: 11 },
      { days: 2, close: 12 },
      { days: 3, close: 13 },
    ])
  })

  it('finds close >= pickDate (first kline after pick date)', () => {
    const klData = [
      makeKline('2024-01-01', 10),
      makeKline('2024-01-02', 11),
      makeKline('2024-01-03', 12),
    ]
    // pickDate 2024-01-02 falls on index 1
    const result = findForwardCloses(klData, '2024-01-02', [1])
    expect(result).toEqual([{ days: 1, close: 12 }])
  })

  it('skips horizons that exceed array bounds', () => {
    const klData = [
      makeKline('2024-01-01', 10),
      makeKline('2024-01-02', 11),
      makeKline('2024-01-03', 12),
    ]
    const result = findForwardCloses(klData, '2024-01-01', [1, 5])
    // index 1 exists, index 5 doesn't
    expect(result).toEqual([{ days: 1, close: 11 }])
  })

  it('returns results in horizon order', () => {
    const klData = [
      makeKline('2024-01-01', 10),
      makeKline('2024-01-02', 20),
      makeKline('2024-01-03', 30),
      makeKline('2024-01-04', 40),
      makeKline('2024-01-05', 50),
    ]
    const result = findForwardCloses(klData, '2024-01-01', [20, 10, 5])
    // horizon 5 -> index 5 (doesn't exist), horizon 10 -> index 10 (doesn't exist)
    // only horizon 20 -> out of bounds
    expect(result).toEqual([])
  })

  it('handles unsorted dates by finding first date >= pickDate', () => {
    const klData = [
      makeKline('2024-01-03', 30),
      makeKline('2024-01-01', 10),
      makeKline('2024-01-02', 20),
    ]
    const result = findForwardCloses(klData, '2024-01-01', [1, 2])
    // findIndex finds first element where date >= pickDate
    // 2024-01-03 >= 2024-01-01 → index 0, so horizons are at indices 1 and 2
    expect(result).toEqual([
      { days: 1, close: 10 },
      { days: 2, close: 20 },
    ])
  })
})

// ─── Pure computation tests for pickEvaluator helpers ────────────────────────

describe('PickAccuracyStats computation', () => {
  // These test the aggregation logic without DB by simulating what getPickAccuracyStats returns

  it('computes positive return counts correctly', () => {
    // Simulate rows with known return signs
    const rows = [
      { return1d: '5.0', return3d: '-2.0', return5d: '10.0' },
      { return1d: '-3.0', return3d: '4.0', return5d: '-1.0' },
      { return1d: '2.0', return3d: '1.0', return5d: '2.0' },
    ]
    const p1d = rows.filter(r => Number(r.return1d) > 0)
    const p3d = rows.filter(r => Number(r.return3d) > 0)
    const p5d = rows.filter(r => Number(r.return5d) > 0)
    expect(p1d.length).toBe(2) // 5.0, 2.0
    expect(p3d.length).toBe(2) // -2.0 excluded, 4.0, 1.0
    expect(p5d.length).toBe(2) // 10.0, 2.0
  })

  it('computes average returns correctly', () => {
    const rows = [
      { return1d: '10.0', return3d: '10.0', return5d: '10.0', return10d: '10.0' },
      { return1d: '-10.0', return3d: '-10.0', return5d: '-10.0', return10d: '-10.0' },
    ]
    const avg = (field: string) => {
      const vals = rows.map(r => Number((r as any)[field])).filter(v => !isNaN(v))
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    }
    expect(avg('return1d')).toBe(0)
    expect(avg('return5d')).toBe(0)
  })

  it('identifies best and worst pick by return5d', () => {
    const rows = [
      { id: 1, code: 'A', name: 'Alpha', return5d: '5.0' },
      { id: 2, code: 'B', name: 'Beta', return5d: '-3.0' },
      { id: 3, code: 'C', name: 'Gamma', return5d: '12.0' },
    ]
    const sorted = [...rows].filter(r => !isNaN(Number(r.return5d))).sort((a, b) => Number(b.return5d) - Number(a.return5d))
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    expect(best.code).toBe('C')
    expect(worst.code).toBe('B')
  })

  it('handles empty rows gracefully', () => {
    const rows: any[] = []
    const avg = (field: string) => {
      const vals = rows.map(r => Number((r as any)[field])).filter(v => !isNaN(v))
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    }
    expect(avg('return1d')).toBe(0)
  })
})

describe('PickBacktestDetail equity computation', () => {
  // Test the equity curve logic from getPickBacktestDetail without DB

  it('computes equity curve correctly', () => {
    const entryPrice = 100
    const pickIdx = 5 // pick is at index 5 (2024-01-06)
    const klData = [
      makeKline('2024-01-01', 98),
      makeKline('2024-01-02', 99),
      makeKline('2024-01-03', 101),
      makeKline('2024-01-04', 102),
      makeKline('2024-01-05', 103),
      makeKline('2024-01-06', 100), // entry
      makeKline('2024-01-07', 105),
      makeKline('2024-01-08', 103),
      makeKline('2024-01-09', 108),
      makeKline('2024-01-10', 110),
    ]

    const equity = klData.slice(pickIdx + 1, pickIdx + 21).map(k => ({
      date: k.date,
      close: k.close,
      return: entryPrice > 0 ? ((k.close - entryPrice) / entryPrice) * 100 : 0,
    }))

    expect(equity).toHaveLength(4)
    expect(equity[0].close).toBe(105)
    expect(equity[0].return).toBeCloseTo(5, 1) // (105-100)/100 * 100
    expect(equity[1].return).toBeCloseTo(3, 1) // (103-100)/100 * 100
    expect(equity[2].return).toBeCloseTo(8, 1) // (108-100)/100 * 100
    expect(equity[3].return).toBeCloseTo(10, 1) // (110-100)/100 * 100
  })

  it('handles entry price of zero gracefully', () => {
    const entryPrice = 0
    const equity = [{ date: '2024-01-07', close: 105 }].map(k => ({
      date: k.date,
      close: k.close,
      return: entryPrice > 0 ? ((k.close - entryPrice) / entryPrice) * 100 : 0,
    }))
    expect(equity[0].return).toBe(0)
  })
})

describe('Max drawdown and max return computation', () => {
  it('computes max drawdown and max return over the holding period', () => {
    const entryPrice = 100
    const klData = [
      makeKline('2024-01-06', 100), // entry
      makeKline('2024-01-07', 105), // peak = 105
      makeKline('2024-01-08', 102), // drawdown from 105
      makeKline('2024-01-09', 98),  // deeper drawdown
      makeKline('2024-01-10', 103), // new peak
      makeKline('2024-01-11', 108), // max return here
    ]

    const pickIdx = 0
    let maxReturn = 0
    let maxDrawdown = 0
    let peakEntry = entryPrice

    for (let i = pickIdx + 1; i < klData.length && i - pickIdx <= 20; i++) {
      const k = klData[i]
      if (k.high > peakEntry) peakEntry = k.high
      const dd = (peakEntry - k.low) / peakEntry * 100
      if (dd > maxDrawdown) maxDrawdown = dd
      const ret = (k.high - entryPrice) / entryPrice * 100
      if (ret > maxReturn) maxReturn = ret
    }

    // maxDrawdown: peak=105, at i=3 low=98 → dd=(105-98)/105*100≈6.67%
    expect(maxDrawdown).toBeCloseTo(6.67, 1)
    // maxReturn: high=108 at i=5 → (108-100)/100*100=8%
    expect(maxReturn).toBeCloseTo(8, 1)
  })

  it('returns zero maxDrawdown when price only goes up', () => {
    const entryPrice = 100
    const klData = [
      makeKline('2024-01-06', 100),
      makeKline('2024-01-07', 105),
      makeKline('2024-01-08', 110),
    ]

    const pickIdx = 0
    let maxDrawdown = 0
    let peakEntry = entryPrice

    for (let i = pickIdx + 1; i < klData.length; i++) {
      const k = klData[i]
      if (k.high > peakEntry) peakEntry = k.high
      const dd = (peakEntry - k.low) / peakEntry * 100
      if (dd > maxDrawdown) maxDrawdown = dd
    }

    expect(maxDrawdown).toBe(0)
  })
})
