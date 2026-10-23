import { describe, it, expect } from 'vitest'
import { SCREENER_FIELDS, matchesConditions } from '../../routes/screener.js'
import { SCREENER_PRESETS } from '../../../shared/screenerPresets.js'
import { defaultBacktestRange, addDays, todayCN } from '../../../shared/dateRange.js'

/**
 * 这组测试盯的是「新用户点一个示例就能出结果」这条路上最容易静默坏掉的三个点：
 *  1. 示例字段不在服务端白名单 → 400（用户看到「请求失败」）
 *  2. 过滤语义（>、<、between、上穿）写错 → 结果静默变空
 *  3. 回测默认区间算错 → 用户打开页面就得到 0 笔交易
 */
describe('筛选页预置示例', () => {
  it('每个示例的字段都在服务端白名单内', () => {
    const allowed = new Set(SCREENER_FIELDS.map(f => f.field))
    for (const preset of SCREENER_PRESETS) {
      for (const c of preset.conditions) {
        expect(allowed.has(c.field), `${preset.label} 的字段 ${c.field} 不在白名单`).toBe(true)
      }
    }
  })

  it('每个示例的操作符都被服务端接受', () => {
    const ops = new Set(['>', '<', '==', 'between', 'cross_above', 'cross_below'])
    for (const preset of SCREENER_PRESETS) {
      for (const c of preset.conditions) {
        expect(ops.has(c.operator), `${preset.label} 的操作符 ${c.operator} 不被接受`).toBe(true)
      }
    }
  })

  it('至少给出 3 个示例', () => {
    expect(SCREENER_PRESETS.length).toBeGreaterThanOrEqual(3)
  })
})

describe('matchesConditions', () => {
  const row = (latest: any, prev: any = latest) => ({
    code: '600519', name: 'x', latest, prev, mf: { dailyFlows: [100, 200, 300], sum: 600, pctAvg: 1, days: 3 },
  })

  it('大于 / 小于', () => {
    expect(matchesConditions(row({ rsi: 30 }), [{ field: 'rsi', operator: '<', value: 40 }], [])).toBe(true)
    expect(matchesConditions(row({ rsi: 50 }), [{ field: 'rsi', operator: '<', value: 40 }], [])).toBe(false)
    expect(matchesConditions(row({ change: 3 }), [{ field: 'change', operator: '>', value: 2 }], [])).toBe(true)
  })

  it('多条件是 AND', () => {
    const conds: any[] = [
      { field: 'change', operator: '>', value: 2 },
      { field: 'amplitude', operator: '>', value: 4 },
    ]
    expect(matchesConditions(row({ change: 3, amplitude: 5 }), conds, [])).toBe(true)
    expect(matchesConditions(row({ change: 3, amplitude: 3 }), conds, [])).toBe(false)
  })

  it('between', () => {
    expect(matchesConditions(row({ rsi: 50 }), [{ field: 'rsi', operator: 'between', value: [40, 60] }], [])).toBe(true)
    expect(matchesConditions(row({ rsi: 70 }), [{ field: 'rsi', operator: 'between', value: [40, 60] }], [])).toBe(false)
  })

  it('上穿：昨天在下方、今天在上方', () => {
    const conds: any[] = [{ field: 'ma5', operator: 'cross_above', value: 'ma20' }]
    expect(matchesConditions(row({ ma5: 11, ma20: 10 }, { ma5: 9, ma20: 10 }), conds, [])).toBe(true)
    // 今天在上方但昨天也在上方 → 不是「上穿」
    expect(matchesConditions(row({ ma5: 11, ma20: 10 }, { ma5: 10.5, ma20: 10 }), conds, [])).toBe(false)
  })

  it('NaN / 缺值不通过（不能把「没数据」当成「满足条件」）', () => {
    expect(matchesConditions(row({ rsi: NaN }), [{ field: 'rsi', operator: '<', value: 40 }], [])).toBe(false)
    expect(matchesConditions(row({}), [{ field: 'rsi', operator: '<', value: 40 }], [])).toBe(false)
  })

  it('资金流条件按窗口求和', () => {
    const mf: any[] = [{ field: 'moneyInflowSum', operator: '>', value: 500, window: 3 }]
    expect(matchesConditions(row({ rsi: 50 }), [], mf)).toBe(true)
    const mf2: any[] = [{ field: 'moneyInflowSum', operator: '>', value: 1000, window: 3 }]
    expect(matchesConditions(row({ rsi: 50 }), [], mf2)).toBe(false)
  })
})

describe('defaultBacktestRange', () => {
  it('结束=今天、开始=一年前', () => {
    const r = defaultBacktestRange(new Date('2026-10-24T03:00:00Z'))
    expect(r.endDate).toBe('2026-10-24')
    expect(r.startDate).toBe('2025-10-24')
  })

  it('跨年也对', () => {
    const r = defaultBacktestRange(new Date('2026-01-05T02:00:00Z'))
    expect(r.endDate).toBe('2026-01-05')
    expect(r.startDate).toBe('2025-01-05')
  })

  it('北京时间凌晨不会被算成前一天', () => {
    // UTC 20:00 = 北京次日 04:00
    expect(todayCN(new Date('2026-10-23T20:00:00Z'))).toBe('2026-10-24')
  })

  it('addDays 跨月', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
