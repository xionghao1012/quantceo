/**
 * 业务日期工具：A 股的「今天」是北京时间的今天。
 *
 * 为什么需要它：`new Date().toISOString()` 永远是 UTC，北京时间 00:00-08:00
 * 之间会算成前一天 —— 于是「今日预测」「今日信号」「默认日期」全部查成昨天。
 * 容器时区改成 Asia/Shanghai 也救不了，因为 toISOString() 不看时区。
 *
 * 只用于业务日期（查表/展示）；时间戳、文件名之类仍用 ISO 字符串。
 */

/** 把某个时刻转成北京日期 YYYY-MM-DD */
export function ymdCN(d: Date = new Date()): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 北京时间今天 YYYY-MM-DD */
export function todayCN(): string {
  return ymdCN()
}

/** 在北京日期上加减天数，返回 YYYY-MM-DD */
export function addDaysCN(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setTime(d.getTime() + days * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}
