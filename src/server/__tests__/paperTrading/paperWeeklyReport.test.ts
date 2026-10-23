import { describe, it, expect } from 'vitest'
import { maxDrawdownOf } from '../../services/paperWeeklyReport.js'

/**
 * 最大回撤是周报里唯一不能靠肉眼验算的数字，写几个边界：
 * 单调上涨应为 0；单次下跌取峰值到谷底；多次下跌取最深那次。
 */
describe('maxDrawdownOf', () => {
  it('单调上涨 → 0', () => {
    expect(maxDrawdownOf([1, 1.02, 1.05, 1.1])).toBe(0)
  })

  it('峰值到谷底 = 回撤', () => {
    // 1.2 → 0.9 = -25%
    expect(maxDrawdownOf([1, 1.2, 0.9, 1.0])).toBeCloseTo(25, 6)
  })

  it('取最深的一次，而不是最后一次', () => {
    // 第一次 1.5 → 1.0 = 33.3%；第二次 1.1 → 1.05 = 4.5%
    expect(maxDrawdownOf([1, 1.5, 1.0, 1.1, 1.05])).toBeCloseTo(33.3333, 3)
  })

  it('空序列与单点 → 0', () => {
    expect(maxDrawdownOf([])).toBe(0)
    expect(maxDrawdownOf([1])).toBe(0)
  })

  it('先跌后涨：回撤只算峰值之后', () => {
    // 0.8 时还没建峰（peak=1），回撤 20%；随后涨到 1.3 无回撤
    expect(maxDrawdownOf([1, 0.8, 1.3])).toBeCloseTo(20, 6)
  })
})
