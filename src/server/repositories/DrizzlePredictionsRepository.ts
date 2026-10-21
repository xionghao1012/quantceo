import { db } from '../db/db.js'
import { aiPredictions } from '../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import type { IPredictionsRepository, PredictionRow } from './IPredictionsRepository.js'

export class DrizzlePredictionsRepository implements IPredictionsRepository {
  async findByDate(predictDate: string, limit = 10): Promise<PredictionRow[]> {
    return db.select({
      id: aiPredictions.id,
      stockCode: aiPredictions.stockCode,
      stockName: aiPredictions.stockName,
      predictDate: aiPredictions.predictDate,
      direction: aiPredictions.direction,
      confidence: aiPredictions.confidence,
      targetPrice: aiPredictions.targetPrice,
      stopLoss: aiPredictions.stopLoss,
    }).from(aiPredictions)
      .where(eq(aiPredictions.predictDate, predictDate))
      .orderBy(desc(aiPredictions.confidence))
      .limit(limit)
  }
}
