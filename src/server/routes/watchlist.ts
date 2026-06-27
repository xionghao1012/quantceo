import { Router } from 'express'
import { eq, and, asc, sql } from 'drizzle-orm'
import { db } from '../db/db.js'
import { watchlist, watchlistGroups, stocks } from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/groups', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const groups = await db.select().from(watchlistGroups)
    .where(eq(watchlistGroups.userId, userId))
    .orderBy(asc(watchlistGroups.sortOrder))
  res.json(groups)
})

router.post('/groups', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const { name, color } = req.body as { name?: string; color?: string }

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: '分组名称不能为空' })
  }
  if (name.length > 50) {
    return res.status(400).json({ error: '分组名称不能超过50字符' })
  }

  const maxSort = await db.select({ v: watchlistGroups.sortOrder })
    .from(watchlistGroups)
    .where(eq(watchlistGroups.userId, userId))
    .orderBy(asc(watchlistGroups.sortOrder))
    .limit(1)

  const sortOrder = maxSort.length > 0 ? (maxSort[0].v ?? 0) + 1 : 0

  const result = await db.insert(watchlistGroups).values({
    userId,
    name: name.trim(),
    color: color || '#f59e0b',
    sortOrder,
  }).returning()

  res.status(201).json(result[0])
})

router.put('/groups/:id', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const id = Number(req.params.id)
  const { name, color, sortOrder } = req.body as {
    name?: string; color?: string; sortOrder?: number
  }

  if (!id) return res.status(400).json({ error: '无效的ID' })

  const existing = await db.select().from(watchlistGroups)
    .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
    .limit(1)
  if (existing.length === 0) {
    return res.status(404).json({ error: '分组不存在' })
  }

  const updateData: Record<string, any> = {}
  if (name !== undefined) {
    if (name.trim().length === 0) return res.status(400).json({ error: '分组名称不能为空' })
    if (name.length > 50) return res.status(400).json({ error: '分组名称不能超过50字符' })
    updateData.name = name.trim()
  }
  if (color !== undefined) updateData.color = color
  if (sortOrder !== undefined) updateData.sortOrder = sortOrder

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: '没有需要更新的字段' })
  }

  const result = await db.update(watchlistGroups)
    .set(updateData)
    .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
    .returning()

  res.json(result[0])
})

router.delete('/groups/:id', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的ID' })

  const existing = await db.select().from(watchlistGroups)
    .where(and(eq(watchlistGroups.id, id), eq(watchlistGroups.userId, userId)))
    .limit(1)
  if (existing.length === 0) {
    return res.status(404).json({ error: '分组不存在' })
  }

  await db.delete(watchlistGroups).where(eq(watchlistGroups.id, id))
  res.json({ success: true })
})

router.get('/', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const items = await db.select({
    id: watchlist.id,
    userId: watchlist.userId,
    groupId: watchlist.groupId,
    code: watchlist.code,
    note: watchlist.note,
    addedAt: watchlist.addedAt,
  }).from(watchlist)
    .where(eq(watchlist.userId, userId))
    .orderBy(asc(watchlist.addedAt))
  res.json(items)
})

router.post('/', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const { code, note, groupId } = req.body as { code?: string; note?: string; groupId?: number }

  if (!code) {
    return res.status(400).json({ error: '股票代码不能为空' })
  }

  const stock = await db.select().from(stocks).where(eq(stocks.code, code)).limit(1)
  if (stock.length === 0) {
    return res.status(404).json({ error: '股票不存在' })
  }

  const existing = await db.select().from(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.code, code)))
    .limit(1)
  if (existing.length > 0) {
    return res.status(409).json({ error: '该股票已在自选股中' })
  }

  if (groupId) {
    const group = await db.select().from(watchlistGroups)
      .where(and(eq(watchlistGroups.id, groupId), eq(watchlistGroups.userId, userId)))
      .limit(1)
    if (group.length === 0) {
      return res.status(400).json({ error: '指定的分组不存在' })
    }
  }

  const result = await db.insert(watchlist).values({
    userId, code, note: note || '', groupId: groupId || null,
  }).returning()

  res.status(201).json(result[0])
})

router.put('/:id', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的ID' })

  const { note, groupId } = req.body as { note?: string; groupId?: number | null }

  const item = await db.select().from(watchlist)
    .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
    .limit(1)
  if (item.length === 0) {
    return res.status(404).json({ error: '自选股不存在' })
  }

  const updateData: Record<string, any> = {}
  if (note !== undefined) updateData.note = note
  if (groupId !== undefined) {
    if (groupId !== null) {
      const group = await db.select().from(watchlistGroups)
        .where(and(eq(watchlistGroups.id, groupId), eq(watchlistGroups.userId, userId)))
        .limit(1)
      if (group.length === 0) {
        return res.status(400).json({ error: '指定的分组不存在' })
      }
    }
    updateData.groupId = groupId
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: '没有需要更新的字段' })
  }

  const result = await db.update(watchlist)
    .set(updateData)
    .where(eq(watchlist.id, id))
    .returning()

  res.json(result[0])
})

router.delete('/:id', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: '无效的ID' })

  const item = await db.select().from(watchlist)
    .where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)))
    .limit(1)
  if (item.length === 0) {
    return res.status(404).json({ error: '自选股不存在' })
  }

  await db.delete(watchlist).where(eq(watchlist.id, id))
  res.json({ success: true })
})

router.post('/batch', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const { codes, groupId } = req.body as { codes?: string[]; groupId?: number }
  if (!codes || !Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: '股票代码列表不能为空' })
  }
  if (codes.length > 100) {
    return res.status(400).json({ error: '单次最多添加100只股票' })
  }
  if (groupId) {
    const group = await db.select().from(watchlistGroups)
      .where(and(eq(watchlistGroups.id, groupId), eq(watchlistGroups.userId, userId)))
      .limit(1)
    if (group.length === 0) {
      return res.status(400).json({ error: '指定的分组不存在' })
    }
  }
  const validCodes = codes.filter(c => typeof c === 'string' && c.length > 0)
  const existing = await db.select({ code: watchlist.code }).from(watchlist)
    .where(and(eq(watchlist.userId, userId), sql`${watchlist.code} = ANY(${validCodes})`))
  const existingSet = new Set(existing.map(e => e.code))
  const toAdd = validCodes.filter(c => !existingSet.has(c))
  if (toAdd.length === 0) {
    return res.json({ added: 0, skipped: validCodes.length, message: '所有股票已在自选股中' })
  }
  const inserted = await db.insert(watchlist).values(
    toAdd.map(code => ({ userId, code, note: '', groupId: groupId || null }))
  ).returning()
  res.status(201).json({ added: inserted.length, skipped: validCodes.length - inserted.length, addedItems: inserted })
})

router.delete('/batch', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  const { codes } = req.body as { codes?: string[] }
  if (!codes || !Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: '股票代码列表不能为空' })
  }
  if (codes.length > 100) {
    return res.status(400).json({ error: '单次最多删除100只股票' })
  }
  const validCodes = codes.filter(c => typeof c === 'string' && c.length > 0)
  const result = await db.delete(watchlist)
    .where(and(eq(watchlist.userId, userId), sql`${watchlist.code} = ANY(${validCodes})`))
  res.json({ deleted: result.rowCount })
})

export default router
