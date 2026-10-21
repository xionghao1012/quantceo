import { db } from '../db/db.js'
import { stocks } from '../db/schema.js'
import type { IStocksRepository, Stock } from './IStocksRepository.js'

export class DrizzleStocksRepository implements IStocksRepository {
  async findAll(): Promise<Stock[]> {
    return db.select().from(stocks)
  }
}
