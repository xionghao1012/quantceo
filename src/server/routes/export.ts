import { Router } from 'express'
import { db } from '../db/db.js'
import { exportTasks, moneyFlowDaily, stocks } from '../db/schema.js'
import { eq, desc, and, gte, lte, inArray } from 'drizzle-orm'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { getExportTaskRepository } from '../repositories/IExportTaskRepository.js'

const router = Router()

const CSV_HEADERS = ['股票代码', '股票名称', '交易日期', '收盘价', '涨跌幅', '超大单净流入', '大单净流入', '中单净流入', '小单净流入', '主力净流入', '主力净流入率', '换手率']
const CSV_FIELDS = ['code', 'name', 'tradeDate', 'closePrice', 'changePct', 'netInflowSuperLarge', 'netInflowLarge', 'netInflowMedium', 'netInflowSmall', 'netInflowMain', 'netInflowMainPct', 'turnoverRate']

export function toCSV(rows: any[]): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const r of rows) {
    const values = CSV_FIELDS.map(f => {
      let v = r[f]
      if (v == null) v = ''
      if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
        v = `"${v.replace(/"/g, '""')}"`
      }
      return v
    })
    lines.push(values.join(','))
  }
  return '\uFEFF' + lines.join('\n')
}

export async function buildExcelBuffer(data: { summary: any[], details: any[], trends: any[] }) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const summaryWs = XLSX.utils.json_to_sheet(data.summary.map(r => ({
    '股票代码': r.code,
    '股票名称': r.name,
    '最新主力净流入': r.netInflowMain,
    '5日累计净流入': r.mainNetInflow5d,
    '最新价': r.closePrice,
    '涨跌幅': r.changePct,
  })))
  XLSX.utils.book_append_sheet(wb, summaryWs, '汇总')

  const detailsWs = XLSX.utils.json_to_sheet(data.details.map(r => ({
    '股票代码': r.code,
    '股票名称': r.name,
    '交易日期': r.tradeDate,
    '收盘价': r.closePrice,
    '涨跌幅': r.changePct,
    '超大单净流入': r.netInflowSuperLarge,
    '大单净流入': r.netInflowLarge,
    '中单净流入': r.netInflowMedium,
    '小单净流入': r.netInflowSmall,
    '主力净流入': r.netInflowMain,
    '主力净流入率': r.netInflowMainPct,
    '换手率': r.turnoverRate,
  })))
  XLSX.utils.book_append_sheet(wb, detailsWs, '明细')

  const trendsWs = XLSX.utils.json_to_sheet(data.trends.map(r => ({
    '日期': r.tradeDate,
    '主力净流入总额': r.totalNetInflowMain,
    '超大单净流入总额': r.totalSuperLarge,
    '大单净流入总额': r.totalLarge,
    '中单净流入总额': r.totalMedium,
    '小单净流入总额': r.totalSmall,
    '股票数量': r.stockCount,
  })))
  XLSX.utils.book_append_sheet(wb, trendsWs, '趋势')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

router.post('/create', async (req, res) => {
  const repo = getExportTaskRepository()
  try {
    const { type, params } = req.body
    if (!type || !['csv', 'excel'].includes(type)) {
      return res.status(400).json({ error: 'type required: csv or excel' })
    }

    const { id: taskId } = await repo.create({ type, params })

    const codes = params.codes as string[] | undefined
    const startDate = params.startDate ? new Date(params.startDate) : null
    const endDate = params.endDate ? new Date(params.endDate) : new Date()
    const scope = params.scope || 'market'

    let rows: any[] = []
    const conditions = []
    if (codes?.length) conditions.push(inArray(moneyFlowDaily.code, codes))
    if (startDate) conditions.push(gte(moneyFlowDaily.tradeDate, startDate.toISOString().split('T')[0]))
    conditions.push(lte(moneyFlowDaily.tradeDate, endDate.toISOString().split('T')[0]))

    const query = db.select().from(moneyFlowDaily)
    rows = await (conditions.length
      ? query.where(and(...conditions))
      : query
    ).orderBy(desc(moneyFlowDaily.tradeDate))

    await repo.updateProgress(taskId, 50)

    if (scope === 'sector' && codes?.length) {
      rows = rows.filter(r => codes.includes(r.code))
    }

    const exportDir = join(process.cwd(), 'exports')
    if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true })

    if (type === 'csv') {
      const csv = toCSV(rows)
      const filePath = join(exportDir, `moneyflow_${taskId}_${Date.now()}.csv`)
      writeFileSync(filePath, csv, 'utf-8')
      await repo.complete(taskId, filePath)
      return res.json({ id: taskId, status: 'completed', downloadUrl: `/api/export/download/${taskId}` })
    } else {
      const trends: any[] = []
      const dateMap = new Map<string, any>()
      for (const r of rows) {
        const d = r.tradeDate
        if (!dateMap.has(d)) dateMap.set(d, { tradeDate: d, totalNetInflowMain: 0, totalSuperLarge: 0, totalLarge: 0, totalMedium: 0, totalSmall: 0, stockCount: 0 })
        const entry = dateMap.get(d)!
        entry.totalNetInflowMain += Number(r.netInflowMain || 0)
        entry.totalSuperLarge += Number(r.netInflowSuperLarge || 0)
        entry.totalLarge += Number(r.netInflowLarge || 0)
        entry.totalMedium += Number(r.netInflowMedium || 0)
        entry.totalSmall += Number(r.netInflowSmall || 0)
        entry.stockCount++
      }
      trends.push(...Array.from(dateMap.values()).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)))

      const latestByCode = new Map<string, any>()
      for (const r of rows) {
        if (!latestByCode.has(r.code) || r.tradeDate > latestByCode.get(r.code).tradeDate) {
          latestByCode.set(r.code, r)
        }
      }
      const summary = Array.from(latestByCode.values())

      await repo.updateProgress(taskId, 80)
      const buf = await buildExcelBuffer({ summary, details: rows, trends })

      const filePath = join(exportDir, `moneyflow_${taskId}_${Date.now()}.xlsx`)
      writeFileSync(filePath, buf)
      await repo.complete(taskId, filePath)
      return res.json({ id: taskId, status: 'completed', downloadUrl: `/api/export/download/${taskId}` })
    }
  } catch (e: any) {
    await repo.fail(0, e.message)
    res.status(500).json({ error: e.message })
  }
})

router.get('/tasks', async (req, res) => {
  const userId = req.query.userId as string | undefined
  const rows = await db.select().from(exportTasks)
    .where(userId ? eq(exportTasks.userId, userId) : undefined)
    .orderBy(desc(exportTasks.createdAt))
    .limit(50)
  res.json(rows)
})

router.get('/tasks/:id', async (req, res) => {
  const [task] = await db.select().from(exportTasks).where(eq(exportTasks.id, parseInt(req.params.id)))
  if (!task) return res.status(404).json({ error: 'Not found' })
  res.json(task)
})

router.get('/download/:id', async (req, res) => {
  const [task] = await db.select().from(exportTasks).where(eq(exportTasks.id, parseInt(req.params.id)))
  if (!task || task.status !== 'completed' || !task.filePath) {
    return res.status(404).json({ error: 'File not found' })
  }
  const ext = task.type === 'excel' ? 'xlsx' : 'csv'
  const filename = `资金流向_${task.id}.${ext}`
  res.download(task.filePath, filename)
})

export default router
