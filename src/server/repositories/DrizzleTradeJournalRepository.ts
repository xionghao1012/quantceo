import { db } from '../db/db.js'
import { eq, desc, sql, and, gte, lte } from 'drizzle-orm'
import type {
  ITradeJournalRepository,
  TradeJournalEntry,
  CreateTradeJournalInput,
  UpdateTradeJournalInput,
  TradeJournalStats,
  PnlCalendarEntry,
} from './ITradeJournalRepository.js'

// tradeJournal table definition (mirrors the inline definition in tradeJournal.ts route)
const tradeJournalDef = {
  id: sql`serial('id').primaryKey()`,
  userId: sql`integer('user_id').notNull()`,
  code: sql`varchar('code', { length: 10 }).notNull()`,
  name: sql`varchar('name', { length: 100 })`,
  direction: sql`varchar('direction', { length: 10 }).notNull()`,
  entryDate: sql`date('entry_date').notNull()`,
  exitDate: sql`date('exit_date')`,
  entryPrice: sql`numeric('entry_price', { precision: 12, scale: 4 }).notNull()`,
  exitPrice: sql`numeric('exit_price', { precision: 12, scale: 4 })`,
  shares: sql`integer('shares').notNull()`,
  pnl: sql`numeric('pnl', { precision: 14, scale: 2 })`,
  returnPct: sql`numeric('return_pct', { precision: 10, scale: 4 })`,
  tags: sql`varchar('tags', { length: 200 }).array()`,
  notes: sql`text('notes')`,
  strategy: sql`varchar('strategy', { length: 100 })`,
  rating: sql`integer('rating').default(0)`,
  createdAt: sql`timestamp('created_at').defaultNow()`,
  updatedAt: sql`timestamp('updated_at').defaultNow()`,
}

export class DrizzleTradeJournalRepository implements ITradeJournalRepository {
  async create(input: CreateTradeJournalInput): Promise<TradeJournalEntry> {
    const { rows } = await db.execute(sql`
      INSERT INTO trade_journal (user_id, code, name, direction, entry_date, exit_date, entry_price, exit_price, shares, pnl, return_pct, tags, notes, strategy, rating)
      VALUES (
        ${input.userId}, ${input.code}, ${input.name || null}, ${input.direction}, ${input.entryDate},
        ${input.exitDate || null}, ${input.entryPrice}, ${input.exitPrice || null}, ${input.shares},
        ${input.pnl || null}, ${input.returnPct || null}, ${input.tags || []}, ${input.notes || null},
        ${input.strategy || null}, ${input.rating || 0}
      )
      RETURNING *
    `)
    return rows[0] as unknown as TradeJournalEntry
  }

  async findById(id: number, userId: number): Promise<TradeJournalEntry | null> {
    const { rows } = await db.execute(sql`
      SELECT * FROM trade_journal WHERE id = ${id} AND user_id = ${userId} LIMIT 1
    `)
    return (rows as unknown as TradeJournalEntry[])[0] ?? null
  }

  async findByUserId(userId: number, options?: {
    limit?: number
    offset?: number
    tag?: string
    strategy?: string
    direction?: string
    startDate?: string
    endDate?: string
    status?: 'open' | 'closed'
  }): Promise<{ rows: TradeJournalEntry[]; total: number }> {
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    // 条件全部走占位符：options 里的值不能拼进 SQL 文本（注入）
    const conds = [sql`user_id = ${userId}`]
    if (options?.tag) conds.push(sql`${options.tag} = ANY(tags)`)
    if (options?.strategy) conds.push(sql`strategy = ${options.strategy}`)
    if (options?.direction) conds.push(sql`direction = ${options.direction}`)
    if (options?.startDate) conds.push(sql`entry_date >= ${options.startDate}`)
    if (options?.endDate) conds.push(sql`entry_date <= ${options.endDate}`)
    if (options?.status === 'open') conds.push(sql`exit_date IS NULL`)
    if (options?.status === 'closed') conds.push(sql`exit_date IS NOT NULL`)

    const { rows } = await db.execute(sql`
      SELECT * FROM trade_journal WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY entry_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const countResult = await db.execute(sql`SELECT COUNT(*) as c FROM trade_journal WHERE user_id = ${userId}`)
    const total = Number((countResult.rows[0] as any)?.c || 0)

    return { rows: rows as unknown as TradeJournalEntry[], total }
  }

  async update(id: number, userId: number, input: UpdateTradeJournalInput): Promise<TradeJournalEntry> {
    const existing = await this.findById(id, userId)
    if (!existing) {
      throw new Error('Trade journal entry not found')
    }

    const updates: string[] = ['updated_at = NOW()']
    if (input.exitDate !== undefined) updates.push(`exit_date = ${input.exitDate ? `'${input.exitDate}'` : 'NULL'}`)
    if (input.exitPrice !== undefined) updates.push(`exit_price = ${input.exitPrice ? `'${input.exitPrice}'` : 'NULL'}`)
    if (input.tags !== undefined) updates.push(`tags = '{${input.tags.map(t => `"${t}"`).join(',')}}'`)
    if (input.notes !== undefined) updates.push(`notes = ${input.notes ? `'${input.notes.replace(/'/g, "''")}'` : 'NULL'}`)
    if (input.strategy !== undefined) updates.push(`strategy = ${input.strategy ? `'${input.strategy.replace(/'/g, "''")}'` : 'NULL'}`)
    if (input.rating !== undefined) updates.push(`rating = ${input.rating}`)
    if (input.pnl !== undefined) updates.push(`pnl = ${input.pnl}`)
    if (input.returnPct !== undefined) updates.push(`return_pct = ${input.returnPct}`)

    const { rows } = await db.execute(sql`
      UPDATE trade_journal SET ${sql.raw(updates.join(', '))}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `)
    return (rows as unknown as TradeJournalEntry[])[0]
  }

  async delete(id: number, userId: number): Promise<void> {
    await db.execute(sql`DELETE FROM trade_journal WHERE id = ${id} AND user_id = ${userId}`)
  }

  async getStats(userId: number): Promise<TradeJournalStats> {
    const { rows } = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE exit_date IS NOT NULL) as closed,
        COUNT(*) FILTER (WHERE exit_date IS NULL) as open,
        COUNT(*) FILTER (WHERE pnl > 0) as wins,
        COUNT(*) FILTER (WHERE pnl < 0) as losses,
        COALESCE(SUM(pnl), 0) as total_pnl,
        COALESCE(AVG(pnl) FILTER (WHERE exit_date IS NOT NULL), 0) as avg_pnl,
        COALESCE(AVG(return_pct) FILTER (WHERE exit_date IS NOT NULL), 0) as avg_return,
        COALESCE(MAX(pnl) FILTER (WHERE exit_date IS NOT NULL), 0) as best_trade,
        COALESCE(MIN(pnl) FILTER (WHERE exit_date IS NOT NULL), 0) as worst_trade
      FROM trade_journal WHERE user_id = ${userId}
    `)

    const stats = rows[0] as any
    const closed = Number(stats.closed)
    const wins = Number(stats.wins)
    const losses = Number(stats.losses)
    const winRate = closed > 0 ? (wins / closed) * 100 : 0

    const { rows: pnlRows } = await db.execute(sql`
      SELECT AVG(pnl) FILTER (WHERE pnl > 0) as avg_win,
             AVG(pnl) FILTER (WHERE pnl < 0) as avg_loss
      FROM trade_journal WHERE user_id = ${userId} AND exit_date IS NOT NULL
    `)
    const avgWin = Math.abs(Number((pnlRows[0] as any)?.avg_win || 0))
    const avgLoss = Math.abs(Number((pnlRows[0] as any)?.avg_loss || 0))
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0
    const expectancy = closed > 0
      ? (winRate / 100 * avgWin - (1 - winRate / 100) * avgLoss)
      : 0

    const { rows: trendRows } = await db.execute(sql`
      SELECT DATE_TRUNC('month', entry_date) as month,
             COUNT(*) as count,
             COALESCE(SUM(pnl), 0) as pnl
      FROM trade_journal WHERE user_id = ${userId} AND exit_date IS NOT NULL
      GROUP BY month ORDER BY month DESC LIMIT 12
    `)

    return {
      totalClosed: closed,
      totalOpen: Number(stats.open),
      wins,
      losses,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(Number(stats.total_pnl) * 100) / 100,
      avgPnl: Math.round(Number(stats.avg_pnl) * 100) / 100,
      avgReturn: Math.round(Number(stats.avg_return) * 100) / 100,
      bestTrade: Math.round(Number(stats.best_trade) * 100) / 100,
      worstTrade: Math.round(Number(stats.worst_trade) * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      monthlyTrend: trendRows.map((r: any) => ({
        month: r.month,
        count: Number(r.count),
        pnl: Number(r.pnl),
      })),
    }
  }

  async getPnlCalendar(userId: number, year?: number, mode: 'daily' | 'monthly' = 'daily'): Promise<{
    mode: string
    calendar: PnlCalendarEntry[]
  }> {
    const yearFilter = year ? `AND EXTRACT(YEAR FROM exit_date) = ${year}` : ''

    const { rows } = await db.execute(sql`
      SELECT
        ${sql.raw(mode === 'monthly' ? "DATE_TRUNC('month', exit_date)::date as period" : "exit_date as period")},
        COUNT(*) as count,
        COALESCE(SUM(pnl), 0) as pnl,
        COALESCE(AVG(return_pct), 0) as avg_return
      FROM trade_journal
      WHERE user_id = ${userId} AND exit_date IS NOT NULL ${sql.raw(yearFilter)}
      GROUP BY period ORDER BY period
    `)

    return {
      mode,
      calendar: rows.map((r: any) => ({
        period: r.period,
        count: Number(r.count),
        pnl: Math.round(Number(r.pnl) * 100) / 100,
        avgReturn: Math.round(Number(r.avg_return) * 100) / 100,
      })),
    }
  }
}
