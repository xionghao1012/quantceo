import { db } from '../db/db.js'
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm'
import { paperCompetitions, paperAccounts, paperOrders, paperNavSnapshots, paperWeeklyReports } from '../db/schema.js'
import { todayCN, addDaysCN } from '../utils/date.js'

/**
 * 策略擂台周报：直接从数据生成 markdown，可直接复制到公众号/小红书。
 *
 * 为什么需要它：0 真实用户时，擂台页面没有观众。唯一可行的分发是内容 ——
 * 每周一篇「谁领先、关键调仓、回撤多少」，这是给财经博主用的素材，
 * 也是这个功能对业务产生价值的唯一通道。
 */

function pct(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

/** 从净值序列算最大回撤（%） */
export function maxDrawdownOf(navs: number[]): number {
  let peak = -Infinity
  let maxDd = 0
  for (const v of navs) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = (peak - v) / peak * 100
      if (dd > maxDd) maxDd = dd
    }
  }
  return maxDd
}

export interface WeeklyReportResult {
  id: number
  weekStart: string
  weekEnd: string
  content: string
}

export async function generateWeeklyReport(opts: {
  competitionId?: number
  weekEnd?: string
} = {}): Promise<WeeklyReportResult | null> {
  const weekEnd = opts.weekEnd || todayCN()
  const weekStart = addDaysCN(weekEnd, -6)

  const comp = opts.competitionId
    ? (await db.select().from(paperCompetitions).where(eq(paperCompetitions.id, opts.competitionId)).limit(1))[0]
    : (await db.select().from(paperCompetitions)
        .where(eq(paperCompetitions.status, 'running'))
        .orderBy(desc(paperCompetitions.id)).limit(1))[0]
  if (!comp) return null

  const accounts = await db.select().from(paperAccounts).where(eq(paperAccounts.competitionId, comp.id))
  if (!accounts.length) return null

  const initialCash = Number(comp.initialCash)

  // 本周净值序列（用于回撤与周涨跌）
  const snaps = await db.execute(sql`
    SELECT account_id, snapshot_date::text AS d, nav::float8 AS nav
    FROM paper_nav_snapshots
    WHERE competition_id = ${comp.id} AND snapshot_date BETWEEN ${weekStart} AND ${weekEnd}
    ORDER BY snapshot_date
  `) as any
  const series = new Map<number, Array<{ d: string; nav: number }>>()
  for (const row of snaps?.rows || []) {
    const list = series.get(row.account_id) || []
    list.push({ d: row.d, nav: Number(row.nav) })
    series.set(row.account_id, list)
  }

  // 本周成交（用于换手与关键调仓）
  const fills = await db.execute(sql`
    SELECT o.account_id, o.code, o.name, o.direction, o.shares, o.filled_price::float8 AS price,
           o.reason, o.rule_hit, o.filled_at::text AS at
    FROM paper_orders o
    WHERE o.competition_id = ${comp.id}
      AND o.status = 'FILLED'
      AND o.filled_at >= ${weekStart}::date
      AND o.filled_at < (${weekEnd}::date + INTERVAL '1 day')
    ORDER BY o.filled_at
  `) as any
  const fillsByAccount = new Map<number, any[]>()
  for (const row of fills?.rows || []) {
    const list = fillsByAccount.get(row.account_id) || []
    list.push(row)
    fillsByAccount.set(row.account_id, list)
  }

  // 排名：按净值
  const rows = accounts.map(a => {
    const s = series.get(a.id) || []
    const navs = s.map(x => x.nav)
    const lastNav = navs.length ? navs[navs.length - 1] : 1
    const firstNav = navs.length ? navs[0] : 1
    const weekReturn = firstNav > 0 ? (lastNav / firstNav - 1) * 100 : 0
    const myFills = fillsByAccount.get(a.id) || []
    const turnover = myFills.reduce((sum, f) => sum + Number(f.shares) * Number(f.price), 0) / initialCash * 100
    return {
      name: a.agentName,
      nav: lastNav,
      weekReturn,
      maxDrawdown: maxDrawdownOf(navs),
      turnover,
      trades: myFills.length,
      days: navs.length,
      fills: myFills,
    }
  }).sort((x, y) => y.nav - x.nav)

  const sampleDays = Math.max(...rows.map(r => r.days), 0)
  const enough = sampleDays >= 20

  const lines: string[] = []
  lines.push(`# 策略擂台周报 · ${weekStart} ~ ${weekEnd}`)
  lines.push('')
  lines.push(`> 模拟盘（每个策略 100 万虚拟资金），含手续费与滑点假设，**不构成投资建议**。`)
  lines.push(`> 样本：${sampleDays} 个交易日${enough ? '' : '，**样本不足，暂不排名**（满 20 个交易日后排名才有意义）'}。`)
  lines.push('')
  lines.push('## 本周排名')
  lines.push('')
  if (enough) {
    lines.push('| # | 策略 | 净值 | 本周 | 最大回撤 | 换手 | 成交 |')
    lines.push('|---|---|---|---|---|---|---|')
    rows.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${r.name} | ${r.nav.toFixed(4)} | ${pct(r.weekReturn)} | ${r.maxDrawdown.toFixed(1)}% | ${r.turnover.toFixed(0)}% | ${r.trades} 笔 |`)
    })
  } else {
    // 样本不足时不排名，只列过程指标
    lines.push('| 策略 | 净值 | 本周 | 最大回撤 | 换手 | 成交 |')
    lines.push('|---|---|---|---|---|---|')
    for (const r of rows) {
      lines.push(`| ${r.name} | ${r.nav.toFixed(4)} | ${pct(r.weekReturn)} | ${r.maxDrawdown.toFixed(1)}% | ${r.turnover.toFixed(0)}% | ${r.trades} 笔 |`)
    }
  }

  // 关键调仓：本周成交里取前 6 笔（按金额）
  const allFills = rows.flatMap(r => r.fills.map((f: any) => ({ ...f, agent: r.name })))
    .sort((a, b) => Number(b.shares) * Number(b.price) - Number(a.shares) * Number(a.price))
    .slice(0, 6)
  lines.push('')
  lines.push('## 本周关键调仓')
  lines.push('')
  if (!allFills.length) {
    lines.push('本周无成交（策略条件未触发，或还在等建仓窗口）。')
  } else {
    for (const f of allFills) {
      const dir = f.direction === 'BUY' ? '买入' : '卖出'
      const why = f.rule_hit ? ` —— ${f.rule_hit}` : (f.reason ? ` —— ${f.reason}` : '')
      lines.push(`- **${f.agent}** ${dir} ${f.name}(${f.code}) ${f.shares} 股 @${Number(f.price).toFixed(2)}${why}`)
    }
  }

  lines.push('')
  lines.push('## 一句话')
  if (!enough) {
    lines.push(`才 ${sampleDays} 个交易日，本周的名次没有统计意义。看规则是否被严格执行、回撤是否可控，比看谁第一更有用。`)
  } else {
    const best = rows[0]
    const worst = rows[rows.length - 1]
    lines.push(`领先：${best.name}（${pct(best.weekReturn)}）；落后：${worst.name}（${pct(worst.weekReturn)}）。策略差异要看 3 个月以上，单周波动不代表优劣。`)
  }

  const content = lines.join('\n')

  const [saved] = await db.insert(paperWeeklyReports).values({
    competitionId: comp.id,
    weekStart,
    weekEnd,
    content,
  }).onConflictDoUpdate({
    target: [paperWeeklyReports.competitionId, paperWeeklyReports.weekEnd],
    set: { content, weekStart },
  }).returning()

  return { id: saved.id, weekStart, weekEnd, content }
}

export async function listWeeklyReports(competitionId: number, limit = 4) {
  return db.select().from(paperWeeklyReports)
    .where(eq(paperWeeklyReports.competitionId, competitionId))
    .orderBy(desc(paperWeeklyReports.weekEnd))
    .limit(limit)
}
