import { createRequire } from 'node:module'
import { eq, desc } from 'drizzle-orm'
import type { aiPredictions } from '../db/schema.js'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface PredictionRow {
  id: number
  stockCode: string
  stockName: string | null
  predictDate: string
  direction: string
  confidence: number
  targetPrice: string | null
  stopLoss: string | null
}

export interface IPredictionsRepository {
  findByDate(predictDate: string, limit?: number): Promise<PredictionRow[]>
}

// Module-level singleton
let _repo: IPredictionsRepository | null = null

export function setPredictionsRepository(repo: IPredictionsRepository): void {
  _repo = repo
}

export function getPredictionsRepository(): IPredictionsRepository {
  if (!_repo) {
     
    const { DrizzlePredictionsRepository } = require('./DrizzlePredictionsRepository.js')
    _repo = new DrizzlePredictionsRepository()
  }
  return _repo!
}
