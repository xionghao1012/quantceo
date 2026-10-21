import { db } from '../db/db.js'
import { positions, priceAlerts } from '../db/schema.js'
import { eq, desc, and } from 'drizzle-orm'
import type {
  IPositionsRepository,
  IPriceAlertsRepository,
  Position,
  CreatePositionInput,
  UpdatePositionInput,
  CreateAlertInput,
  PriceAlert,
} from './IPositionsRepository.js'

export class DrizzlePositionsRepository implements IPositionsRepository {
  async findById(id: number, userId: number): Promise<Position | null> {
    const rows = await db.select().from(positions)
      .where(and(eq(positions.id, id), eq(positions.userId, userId)))
      .limit(1)
    return rows[0] ?? null
  }

  async findByUserId(userId: number): Promise<Position[]> {
    return db.select().from(positions)
      .where(eq(positions.userId, userId))
      .orderBy(desc(positions.createdAt))
  }

  async findOpenByUserId(userId: number): Promise<Position[]> {
    return db.select().from(positions)
      .where(and(eq(positions.userId, userId), eq(positions.status, 'open')))
  }

  async create(input: CreatePositionInput): Promise<{ position: Position; alertIds: number[] }> {
    const [row] = await db.insert(positions).values({
      userId: input.userId,
      code: input.code,
      name: input.name || input.code,
      quantity: input.quantity,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      status: input.status || 'open',
      notes: input.notes || '',
    }).returning()
    return { position: row, alertIds: [] }
  }

  async update(id: number, userId: number, input: UpdatePositionInput): Promise<{ position: Position; alertIds: number[] }> {
    const existing = await this.findById(id, userId)
    if (!existing) {
      throw new Error('Position not found')
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (input.quantity !== undefined) updates.quantity = input.quantity
    if (input.entryPrice !== undefined) updates.entryPrice = input.entryPrice
    if (input.stopLoss !== undefined) updates.stopLoss = input.stopLoss
    if (input.takeProfit !== undefined) updates.takeProfit = input.takeProfit
    if (input.status !== undefined) updates.status = input.status
    if (input.notes !== undefined) updates.notes = input.notes

    const [updated] = await db.update(positions).set(updates)
      .where(and(eq(positions.id, id), eq(positions.userId, userId)))
      .returning()

    return { position: updated, alertIds: [] }
  }

  async delete(id: number, userId: number): Promise<void> {
    const existing = await this.findById(id, userId)
    if (!existing) {
      throw new Error('Position not found')
    }
    await db.delete(positions).where(and(eq(positions.id, id), eq(positions.userId, userId)))
  }
}

export class DrizzlePriceAlertsRepository implements IPriceAlertsRepository {
  async createAlert(input: CreateAlertInput): Promise<PriceAlert> {
    const [row] = await db.insert(priceAlerts).values({
      userId: input.userId,
      code: input.code,
      name: input.name,
      condition: input.condition,
      targetValue: input.targetValue,
    }).returning()
    return row
  }

  async deleteByCodeAndUserId(userId: number, code: string): Promise<void> {
    await db.delete(priceAlerts).where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.code, code)))
  }
}
