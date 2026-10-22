import { describe, it, expect } from 'vitest'
import { nextTradingDay } from '../../services/scheduler.js'

/**
 * 目标日必须是交易日：原来直接 +1 天，周五生成的预测目标日落在周六，
 * 而评估要求「当天有 K 线」，于是这些预测永远 pending（生产积了 146 条）。
 */
describe('nextTradingDay', () => {
  it('周三 → 周四', () => {
    expect(nextTradingDay('2026-10-21')).toBe('2026-10-22')
  })
  it('周四 → 周五', () => {
    expect(nextTradingDay('2026-10-22')).toBe('2026-10-23')
  })
  it('周五 → 下周一（跳过周六周日）', () => {
    expect(nextTradingDay('2026-10-23')).toBe('2026-10-26')
  })
  it('周六 → 周一', () => {
    expect(nextTradingDay('2026-10-24')).toBe('2026-10-26')
  })
  it('周日 → 周一', () => {
    expect(nextTradingDay('2026-10-25')).toBe('2026-10-26')
  })
  it('跨月/跨年也对', () => {
    expect(nextTradingDay('2026-12-31')).toBe('2027-01-01')
  })
})
