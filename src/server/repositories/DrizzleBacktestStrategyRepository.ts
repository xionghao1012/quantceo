import { db } from '../db/db.js'
import { klines } from '../db/schema.js'
import { sql, and, inArray, asc } from 'drizzle-orm'
import type { IBacktestStrategyRepository, KlinePrice } from './IBacktestStrategyRepository.js'

export class DrizzleBacktestStrategyRepository implements IBacktestStrategyRepository {
  async getDailyMetricsDates(startDate: string, endDate: string): Promise<string[]> {
    const { rows } = await db.execute(sql`
      SELECT DISTINCT metric_date
      FROM daily_metrics
      WHERE metric_date >= ${startDate} AND metric_date <= ${endDate}
      ORDER BY metric_date ASC
    `)
    return rows.map((r: any) => r.metric_date)
  }

  async getTopNByScore(date: string, scoreSQL: string, topN: number): Promise<{ code: string; name: string; score: number }[]> {
    const { rows } = await db.execute(sql`
      SELECT dm.code, dm.name, ${sql.raw(scoreSQL)} AS score
      FROM daily_metrics dm
      INNER JOIN klines k ON k.code = dm.code AND k.date = dm.metric_date
      WHERE dm.metric_date = ${date}
      ORDER BY score DESC
      LIMIT ${topN}
    `)
    return rows.map((r: any) => ({
      code: r.code,
      name: r.name,
      score: Number(r.score) || 0,
    }))
  }

  async checkConditions(date: string, code: string, conditionsSQL: string[]): Promise<boolean> {
    if (conditionsSQL.length === 0) return true
    const whereClause = conditionsSQL.map(c => `(${c})`).join(' AND ')
    const { rows } = await db.execute(sql`
      SELECT 1 AS ok
      FROM daily_metrics
      WHERE metric_date = ${date}
        AND code = ${code}
        AND ${sql.raw(whereClause)}
      LIMIT 1
    `)
    return rows.length > 0
  }

  async getKlinesForCodes(codes: string[], startDate: string, endDate: string): Promise<Map<string, KlinePrice[]>> {
    if (codes.length === 0) return new Map()
    const result = await db.select({
      code: klines.code,
      date: klines.date,
      close: klines.close,
    })
      .from(klines)
      .where(and(
        inArray(klines.code, codes),
        sql`${klines.date} >= ${startDate}`,
        sql`${klines.date} <= ${endDate}`,
      ))
      .orderBy(asc(klines.date))

    const map = new Map<string, KlinePrice[]>()
    for (const row of result) {
      const close = Number(row.close)
      if (isNaN(close)) continue
      const arr = map.get(row.code) || []
      arr.push({ date: row.date, close })
      map.set(row.code, arr)
    }
    return map
  }
}
