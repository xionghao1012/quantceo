import { db } from '../db/db.js'
import { watchlist, watchlistGroups, stocks } from '../db/schema.js'
import { eq, and, asc, inArray } from 'drizzle-orm'
import type {
  IWatchlistRepository,
  WatchlistItem,
  WatchlistGroup,
  CreateWatchlistInput,
  UpdateWatchlistInput,
  CreateGroupInput,
  UpdateGroupInput,
} from './IWatchlistRepository.js'

export class DrizzleWatchlistRepository implements IWatchlistRepository {
  // Watchlist items
  async findItemsByUserId(userId: number): Promise<WatchlistItem[]> {
    return db.select({
      id: watchlist.id,
      userId: watchlist.userId,
      groupId: watchlist.groupId,
      code: watchlist.code,
      note: watchlist.note,
      addedAt: watchlist.addedAt,
    }).from(watchlist)
      .where(eq(watchlist.userId, userId))
      .orderBy(asc(watchlist.addedAt))
  }

  async findItemById(id: number, userId: number): Promise<WatchlistItem | null> {
    const rows = await db.select().from(watchlist)
      .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
      .limit(1)
    return rows[0] ?? null
  }

  async findItemByCode(userId: number, code: string): Promise<WatchlistItem | null> {
    const rows = await db.select().from(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.code, code)))
      .limit(1)
    return rows[0] ?? null
  }

  async createItem(input: CreateWatchlistInput): Promise<WatchlistItem> {
    const [row] = await db.insert(watchlist).values({
      userId: input.userId,
      code: input.code,
      note: input.note || '',
      groupId: input.groupId ?? null,
    }).returning()
    return row
  }

  async updateItem(id: number, userId: number, input: UpdateWatchlistInput): Promise<WatchlistItem> {
    const updateData: Record<string, any> = {}
    if (input.note !== undefined) updateData.note = input.note
    if (input.groupId !== undefined) updateData.groupId = input.groupId

    const [row] = await db.update(watchlist)
      .set(updateData)
      .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
      .returning()
    return row
  }

  async deleteItem(id: number, userId: number): Promise<void> {
    await db.delete(watchlist).where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
  }

  async deleteItemsByCodes(userId: number, codes: string[]): Promise<number> {
    const result = await db.delete(watchlist)
      .where(and(eq(watchlist.userId, userId), inArray(watchlist.code, codes)))
    return result.rowCount ?? 0
  }

  // Watchlist groups
  async findGroupsByUserId(userId: number): Promise<WatchlistGroup[]> {
    return db.select().from(watchlistGroups)
      .where(eq(watchlistGroups.userId, userId))
      .orderBy(asc(watchlistGroups.sortOrder))
  }

  async findGroupById(id: number, userId: number): Promise<WatchlistGroup | null> {
    const rows = await db.select().from(watchlistGroups)
      .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
      .limit(1)
    return rows[0] ?? null
  }

  async getMaxSortOrder(userId: number): Promise<number> {
    const rows = await db.select({ v: watchlistGroups.sortOrder })
      .from(watchlistGroups)
      .where(eq(watchlistGroups.userId, userId))
      .orderBy(asc(watchlistGroups.sortOrder))
      .limit(1)
    return rows.length > 0 ? (rows[0].v ?? 0) : -1
  }

  async createGroup(input: CreateGroupInput): Promise<WatchlistGroup> {
    const maxSort = await this.getMaxSortOrder(input.userId)
    const [row] = await db.insert(watchlistGroups).values({
      userId: input.userId,
      name: input.name,
      color: input.color || '#f59e0b',
      sortOrder: input.sortOrder ?? (maxSort + 1),
    }).returning()
    return row
  }

  async updateGroup(id: number, userId: number, input: UpdateGroupInput): Promise<WatchlistGroup> {
    const updateData: Record<string, any> = {}
    if (input.name !== undefined) updateData.name = input.name
    if (input.color !== undefined) updateData.color = input.color
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder

    const [row] = await db.update(watchlistGroups)
      .set(updateData)
      .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
      .returning()
    return row
  }

  async deleteGroup(id: number, userId: number): Promise<void> {
    await db.delete(watchlistGroups).where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
  }
}
