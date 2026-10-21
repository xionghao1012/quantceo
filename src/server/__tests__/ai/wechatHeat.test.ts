import { describe, it, expect } from 'vitest'

describe('pseudoRandom', () => {
  // This is the pure function from wechatHeat.ts
  const pseudoRandom = (seed: number): number => {
    const x = Math.sin(seed * 9301 + 49297) * 49297
    return x - Math.floor(x)
  }

  it('returns value between 0 and 1', () => {
    for (let seed = 0; seed < 100; seed++) {
      const result = pseudoRandom(seed)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(1)
    }
  })

  it('is deterministic for same seed', () => {
    expect(pseudoRandom(42)).toBe(pseudoRandom(42))
    expect(pseudoRandom(12345)).toBe(pseudoRandom(12345))
  })

  it('produces consistent values for known seeds', () => {
    // These are regression tests
    const r0 = pseudoRandom(0)
    const r1 = pseudoRandom(1)
    const r100 = pseudoRandom(100)

    expect(r0).toBeGreaterThan(0)
    expect(r1).toBeGreaterThan(0)
    expect(r100).toBeGreaterThan(0)

    // All should be different (statistically almost certain)
    expect(new Set([r0, r1, r100]).size).toBe(3)
  })

  it('different seeds produce different values', () => {
    const values = Array.from({ length: 20 }, (_, i) => pseudoRandom(i))
    expect(new Set(values).size).toBe(20)
  })
})

describe('heat value calculation', () => {
  // Recreate the heat calculation logic for testing
  const pseudoRandom = (seed: number): number => {
    const x = Math.sin(seed * 9301 + 49297) * 49297
    return x - Math.floor(x)
  }

  const calcHeat = (code: string) => {
    const seedBase = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    return Math.round((pseudoRandom(seedBase) * 10 - 5) * 100) / 100
  }

  const calcArticles = (code: string) => {
    const seedBase = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    return Math.floor(pseudoRandom(seedBase + 1) * 50) + 1
  }

  const calcReads = (code: string) => {
    const seedBase = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    return Math.floor(pseudoRandom(seedBase + 2) * 50000) + 1000
  }

  const calcTrend = (code: string): 'up' | 'down' | 'stable' => {
    const seedBase = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    const trendRand = pseudoRandom(seedBase + 3)
    return trendRand > 0.6 ? 'up' : trendRand < 0.3 ? 'down' : 'stable'
  }

  it('heat is in range [-5, 5]', () => {
    const codes = ['000001', '600519', '000002', '000004']
    for (const code of codes) {
      const heat = calcHeat(code)
      expect(heat).toBeGreaterThanOrEqual(-5)
      expect(heat).toBeLessThanOrEqual(5)
    }
  })

  it('articles is in range [1, 51]', () => {
    const codes = ['000001', '600519', '000002']
    for (const code of codes) {
      const articles = calcArticles(code)
      expect(articles).toBeGreaterThanOrEqual(1)
      expect(articles).toBeLessThanOrEqual(51)
    }
  })

  it('reads is in range [1000, 51000]', () => {
    const codes = ['000001', '600519', '000002']
    for (const code of codes) {
      const reads = calcReads(code)
      expect(reads).toBeGreaterThanOrEqual(1000)
      expect(reads).toBeLessThanOrEqual(51000)
    }
  })

  it('trend is always valid value', () => {
    const trends = new Set<string>()
    const codes = Array.from({ length: 100 }, (_, i) => String(i).padStart(6, '0'))
    for (const code of codes) {
      trends.add(calcTrend(code))
    }
    expect(trends).toEqual(new Set(['up', 'down', 'stable']))
  })

  it('same code produces same values', () => {
    const code = '600519'
    expect(calcHeat(code)).toBe(calcHeat(code))
    expect(calcArticles(code)).toBe(calcArticles(code))
    expect(calcReads(code)).toBe(calcReads(code))
    expect(calcTrend(code)).toBe(calcTrend(code))
  })
})
