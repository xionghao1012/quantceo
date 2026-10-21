import { db } from '../db/db.js'
import { dailyMetrics } from '../db/schema.js'
import type { IDailyMetricsRepository, DailyMetricInput } from './IDailyMetricsRepository.js'

export class DrizzleDailyMetricsRepository implements IDailyMetricsRepository {
  async upsert(input: DailyMetricInput): Promise<void> {
    await db.insert(dailyMetrics).values({
      metricDate: input.metricDate,
      code: input.code,
      name: input.name,
      exchange: input.exchange,
      board: input.board,
      rsi: input.rsi,
      changePct: input.changePct,
      volRatio: input.volRatio,
      macdSignal: input.macdSignal,
      bbPosition: input.bbPosition,
      maAlignment: input.maAlignment,
      volatility: input.volatility,
      momentum: input.momentum,
    }).onConflictDoUpdate({
      target: [dailyMetrics.metricDate, dailyMetrics.code],
      set: {
        rsi: input.rsi,
        changePct: input.changePct,
        volRatio: input.volRatio,
        macdSignal: input.macdSignal,
        bbPosition: input.bbPosition,
        maAlignment: input.maAlignment,
        volatility: input.volatility,
        momentum: input.momentum,
        computedAt: new Date(),
      },
    })
  }
}
