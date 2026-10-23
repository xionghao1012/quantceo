/**
 * 日期区间工具（客户端/服务端/测试共用）。
 *
 * 为什么放在 shared：回测页需要「今天 ~ 一年前」的默认区间，
 * 而服务端已有 addDaysCN。跨层直接 import server 代码没有先例，
 * 所以把纯函数放这里，两边都引同一份，避免两套实现漂移。
 */

/** YYYY-MM-DD（北京日期），避免 toISOString 在凌晨算成前一天 */
export function todayCN(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 在 YYYY-MM-DD 上加减天数 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setTime(d.getTime() + days * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

/**
 * 回测默认区间：结束=今天，开始=一年前。
 * 用户打开页面就能直接跑，不用先想日期。
 */
export function defaultBacktestRange(now: Date = new Date()): { startDate: string; endDate: string } {
  const endDate = todayCN(now)
  return { startDate: addDays(endDate, -365), endDate }
}
