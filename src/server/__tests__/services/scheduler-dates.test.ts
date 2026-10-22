import { describe, it, expect } from 'vitest'
import { getWeekdaysBetween } from '../../services/scheduler.js'

/**
 * 这个函数之前有两个差一天的坑，导致 catch-up 把「今天」算成昨天：
 *   1. new Date('2026-10-22T00:00:00+08:00') 的 UTC 是 10-21 16:00，
 *      直接 toISOString() 取到的是前一天；
 *   2. 在上面这个时刻 getUTCDay() 取到的是前一天的星期几，
 *      周一会当成周日被跳过。
 * 覆盖点：首尾都包含、周末跳过、跨周末、单日。
 */
describe('getWeekdaysBetween', () => {
  it('包含首尾（周一到周四）', () => {
    expect(getWeekdaysBetween('2026-10-19', '2026-10-22')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
    ])
  })

  it('同一天只返回一节，且是当天', () => {
    expect(getWeekdaysBetween('2026-10-22', '2026-10-22')).toEqual(['2026-10-22'])
  })

  it('纯周末返回空', () => {
    expect(getWeekdaysBetween('2026-10-24', '2026-10-25')).toEqual([])
  })

  it('跨周末只跳过周六周日', () => {
    expect(getWeekdaysBetween('2026-10-23', '2026-10-26')).toEqual(['2026-10-23', '2026-10-26'])
  })

  it('周一不被当成周日跳过', () => {
    expect(getWeekdaysBetween('2026-10-19', '2026-10-19')).toEqual(['2026-10-19'])
  })
})
