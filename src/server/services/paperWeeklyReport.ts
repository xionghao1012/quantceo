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
  plainContent: string
}

interface ReportRow {
  name: string
  nav: number
  weekReturn: number
  maxDrawdown: number
  turnover: number
  trades: number
  days: number
  fills: any[]
}

interface ReportData {
  weekStart: string
  weekEnd: string
  sampleDays: number
  enough: boolean
  rows: ReportRow[]
  allFills: any[]
  pairs: Array<{ llm: ReportRow; rule: ReportRow }>
  initialCash: number
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

  // 关键调仓：本周成交里取前 6 笔（按金额）
  const allFills = rows.flatMap(r => r.fills.map((f: any) => ({ ...f, agent: r.name })))
    .sort((a, b) => Number(b.shares) * Number(b.price) - Number(a.shares) * Number(a.price))
    .slice(0, 6)

  // LLM 组 vs 同口径规则组（对照组）：这是这个擂台最有价值的数据
  const pairs = [
    { llm: '趋势跟随', rule: '趋势跟随·规则组' },
    { llm: '均值回归', rule: '均值回归·规则组' },
  ]
    .map(p => ({ llm: rows.find(r => r.name === p.llm), rule: rows.find(r => r.name === p.rule) }))
    .filter((p): p is { llm: typeof rows[number]; rule: typeof rows[number] } => !!p.llm && !!p.rule)

  const data: ReportData = {
    weekStart, weekEnd, sampleDays, enough, rows, allFills, pairs,
    initialCash,
  }
  const content = renderMarkdown(data)
  const plainContent = renderPlain(data)

  const [saved] = await db.insert(paperWeeklyReports).values({
    competitionId: comp.id,
    weekStart,
    weekEnd,
    content,
    plainContent,
  }).onConflictDoUpdate({
    target: [paperWeeklyReports.competitionId, paperWeeklyReports.weekEnd],
    set: { content, plainContent, weekStart },
  }).returning()

  return { id: saved.id, weekStart, weekEnd, content, plainContent }
}

/** markdown 版：给仓库/网页/能渲染 md 的平台 */
export function renderMarkdown(d: ReportData): string {
  const { weekStart, weekEnd, sampleDays, enough, rows, allFills, pairs } = d
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
    lines.push('| 策略 | 净值 | 本周 | 最大回撤 | 换手 | 成交 |')
    lines.push('|---|---|---|---|---|---|')
    for (const r of rows) {
      lines.push(`| ${r.name} | ${r.nav.toFixed(4)} | ${pct(r.weekReturn)} | ${r.maxDrawdown.toFixed(1)}% | ${r.turnover.toFixed(0)}% | ${r.trades} 笔 |`)
    }
  }

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

  if (pairs.length) {
    lines.push('')
    lines.push('## 对照：LLM 组 vs 纯规则组')
    lines.push('')
    lines.push('同一套候选口径，一边由模型从 8 只里挑 1 只，一边机械买第一只。')
    lines.push('')
    lines.push('| 策略 | 净值 | 本周 | 成交 |')
    lines.push('|---|---|---|---|')
    for (const p of pairs) {
      lines.push(`| ${p.llm.name} | ${p.llm.nav.toFixed(4)} | ${pct(p.llm.weekReturn)} | ${p.llm.trades} 笔 |`)
      lines.push(`| ${p.rule.name}（规则） | ${p.rule.nav.toFixed(4)} | ${pct(p.rule.weekReturn)} | ${p.rule.trades} 笔 |`)
    }
    lines.push('')
    lines.push('> 样本不足时这组对比也不能下结论，但这是唯一能回答「LLM 有没有增量」的公开数据。')
  }

  lines.push('')
  lines.push('## 一句话')
  lines.push(oneLine(d))
  return lines.join('\n')
}

/**
 * 纯文本版：直接粘贴到公众号/小红书，不带任何 markdown 符号。
 * 公众号编辑器不认 `#`、`|`、`**`，所以用【】分节、全角空格对齐。
 */
export function renderPlain(d: ReportData): string {
  const { weekStart, weekEnd, sampleDays, enough, rows, allFills, pairs } = d
  const lines: string[] = []
  lines.push(`策略擂台周报 · ${weekStart} ~ ${weekEnd}`)
  lines.push('')
  lines.push('模拟盘，每个策略 100 万虚拟资金，含手续费与滑点假设，不构成投资建议。')
  lines.push(`样本：${sampleDays} 个交易日${enough ? '' : '（不足 20 天，暂不排名）'}`)
  lines.push('')
  lines.push(enough ? '【本周排名】' : '【本周表现】')
  rows.forEach((r, i) => {
    const prefix = enough ? `${i + 1}. ` : '· '
    lines.push(`${prefix}${r.name}`)
    lines.push(`   净值 ${r.nav.toFixed(4)}　本周 ${pct(r.weekReturn)}　回撤 ${r.maxDrawdown.toFixed(1)}%　换手 ${r.turnover.toFixed(0)}%　成交 ${r.trades} 笔`)
  })

  lines.push('')
  lines.push('【本周关键调仓】')
  if (!allFills.length) {
    lines.push('本周无成交（策略条件未触发，或还在等建仓窗口）。')
  } else {
    allFills.forEach((f, i) => {
      const dir = f.direction === 'BUY' ? '买入' : '卖出'
      lines.push(`${i + 1}. ${f.agent} ${dir} ${f.name}(${f.code}) ${f.shares} 股，成交价 ${Number(f.price).toFixed(2)}`)
      const why = f.rule_hit || f.reason
      if (why) lines.push(`   依据：${why}`)
    })
  }

  if (pairs.length) {
    lines.push('')
    lines.push('【对照：AI 组 vs 规则组】')
    lines.push('同一套候选口径：一边由模型从 8 只里挑 1 只，一边机械买第一只。')
    for (const p of pairs) {
      lines.push(`· ${p.llm.name}　净值 ${p.llm.nav.toFixed(4)}（${p.llm.trades} 笔）`)
      lines.push(`  规则组　净值 ${p.rule.nav.toFixed(4)}（${p.rule.trades} 笔）`)
    }
  }

  lines.push('')
  lines.push('【一句话】')
  lines.push(oneLine(d))
  return lines.join('\n')
}

function oneLine(d: ReportData): string {
  if (!d.enough) {
    return `才 ${d.sampleDays} 个交易日，名次没有统计意义。看规则是否被严格执行、回撤是否可控，比看谁第一更有用。`
  }
  const best = d.rows[0]
  const worst = d.rows[d.rows.length - 1]
  return `领先：${best.name}（${pct(best.weekReturn)}）；落后：${worst.name}（${pct(worst.weekReturn)}）。策略差异要看 3 个月以上，单周波动不代表优劣。`
}

export async function listWeeklyReports(competitionId: number, limit = 4) {
  return db.select().from(paperWeeklyReports)
    .where(eq(paperWeeklyReports.competitionId, competitionId))
    .orderBy(desc(paperWeeklyReports.weekEnd))
    .limit(limit)
}
