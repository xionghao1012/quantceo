import { db } from '../db/db.js'
import { sql } from 'drizzle-orm'
import type { Rule } from '../../shared/types.js'

/**
 * 策略擂台：每个策略 = 一套「选股口径 + 买卖规则」。
 *
 * 为什么要有这个文件：原来的「4 个智能体」只是同一个模型跑四遍，
 * 候选股永远是「主力资金 TOP5」——策略之间没有任何可比性。
 * 这里的差异来自**规则和候选股口径**，不来自模型；模型只负责在候选里做最终选择。
 *
 * 数据来源限制（生产实测）：
 * - money_flow_daily / money_flow_realtime 都是 0 行 → 不能用资金流做候选；
 * - bb_position 基本为 NULL → 不能用布林位置；
 * - 可用：daily_metrics（442k 行，含 rsi/macd/ma_alignment/vol_ratio/momentum）、
 *   limit_up_records（16 行，最新交易日）。
 */

export interface PaperCandidate {
  code: string
  name: string
  close: number
  changePct: number
  /** 是否站上 20 日均线（趋势策略的买入前提） */
  aboveMa20?: boolean
  /** 展示用的「为什么进候选」 */
  reason: string
}

export interface PaperStrategy {
  id: string
  name: string
  tagline: string
  /** llm = 模型在候选里选；rule = 纯机械执行（对照组，不调模型） */
  engine?: 'llm' | 'rule'
  /** 规则组的机械持有天数（对照组用） */
  holdDays?: number
  /** 自然语言规则，写进提示词，也直接显示给用户 */
  playbook: string[]
  /** 回测引擎能表达的规则（不能表达就是 null，页面不显示回测按钮） */
  backtestRules: Rule[] | null
  /** 回测口径与实盘不一致时的说明 */
  backtestNote?: string
  /** codes 传了就只在这些代码里筛（用于策略信号订阅） */
  candidates: (codes?: string[]) => Promise<PaperCandidate[]>
}

/** 最新日指标的日期（收盘后由 18:40 的任务更新；盘中用上一交易日） */
async function latestMetricDate(): Promise<string | null> {
  const r = await db.execute(sql`SELECT max(metric_date)::text AS d FROM daily_metrics`) as any
  return r?.rows?.[0]?.d || null
}

/** 从 daily_metrics 选候选，close 取该股最新 K 线 */
async function fromMetrics(where: string, orderBy: string, limit: number, reasonOf: (row: any) => string, codes?: string[]): Promise<PaperCandidate[]> {
  const d = await latestMetricDate()
  if (!d) return []
  // 只允许合法 6 位代码进 SQL（自选股来自用户输入）
  const safeCodes = (codes || []).filter(c => /^\d{6}$/.test(c))
  const codeFilter = safeCodes.length
    ? sql` AND m.code IN (${sql.join(safeCodes.map(c => sql`${c}`), sql`, `)})`
    : sql``
  const r = await db.execute(sql`
    SELECT m.code, m.name, m.change_pct::float8 AS change_pct,
           m.rsi::float8 AS rsi, m.vol_ratio::float8 AS vol_ratio,
           m.momentum::float8 AS momentum,
           k.close::float8 AS close,
           ma.ma20
    FROM daily_metrics m
    JOIN LATERAL (
      SELECT close, date FROM klines WHERE code = m.code ORDER BY date DESC LIMIT 1
    ) k ON TRUE
    -- 20 日均线单独用一个 lateral：嵌套子查询里的相关引用在 Postgres 里解析不到
    JOIN LATERAL (
      SELECT avg(close)::float8 AS ma20 FROM (
        SELECT close FROM klines WHERE code = m.code ORDER BY date DESC LIMIT 20
      ) t
    ) ma ON TRUE
    WHERE m.metric_date = ${d}
      AND m.name NOT LIKE '%ST%'
      AND m.name NOT LIKE '%退%'
      AND m.name NOT LIKE 'PT%'
      -- 停牌/退市：最近 5 天没有 K 线的直接排除，别让模型去研究一只买不了的票
      AND k.date >= (SELECT max(date) FROM klines) - INTERVAL '5 days'
      AND ${sql.raw(where)}
      ${codeFilter}
    ORDER BY ${sql.raw(orderBy)}
    LIMIT ${limit}
  `) as any
  return (r?.rows || []).map((row: any) => {
    const close = Number(row.close) || 0
    const ma20 = Number(row.ma20)
    const aboveMa20 = Number.isFinite(ma20) && ma20 > 0 ? close >= ma20 : undefined
    return {
      code: row.code,
      name: row.name || row.code,
      close,
      changePct: Number(row.change_pct) || 0,
      aboveMa20,
      reason: reasonOf(row) + (aboveMa20 === undefined ? '' : aboveMa20 ? '，站上 MA20' : '，跌破 MA20'),
    }
  })
}

export const PAPER_STRATEGIES: PaperStrategy[] = [
  {
    id: 'trend',
    name: '趋势跟随',
    tagline: '只做多头趋势里的强势股，跌破均线就走',
    playbook: [
      '选股：MACD 柱为正（macd_signal > 0）且 10 日动量为正，按动量从高到低取前 8 只',
      '买入：从候选里选 1 只，要求它同时站在 MA20 上方（K 线确认）',
      '卖出：持仓跌破 MA20，或 MACD 柱转负，立即卖出',
      '仓位：单票不超过 30%，最多同时持有 3 只',
    ],
    backtestRules: [
      { type: 'cross', action: 'BUY', conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }] },
      { type: 'cross', action: 'SELL', conditions: [{ indicator: 'ma5', operator: 'cross_below', value: 'ma20' }] },
    ] as Rule[],
    candidates: (codes?: string[]) => fromMetrics(
      "m.macd_signal > 0 AND m.momentum > 0",
      'm.momentum DESC NULLS LAST',
      8,
      (r) => `动量 ${Number(r.momentum).toFixed(1)}，MACD 柱为正`,
      codes,
    ),
  },
  {
    id: 'reversion',
    name: '均值回归',
    tagline: '专挑超跌，反弹到均线附近就撤',
    playbook: [
      '选股：RSI(14) < 40 的股票，按 RSI 从低到高取前 8 只（越超跌越靠前）',
      '买入：从候选里选 1 只，且当日不能是跌停（跌停买不进）',
      '卖出：RSI 回到 55 以上，或持有满 5 个交易日仍亏损，卖出',
      '仓位：单票不超过 25%，最多同时持有 4 只',
    ],
    backtestRules: [
      { type: 'threshold', action: 'BUY', conditions: [{ indicator: 'rsi', operator: '<', value: 30 }] },
      { type: 'threshold', action: 'SELL', conditions: [{ indicator: 'rsi', operator: '>', value: 55 }] },
    ] as Rule[],
    candidates: (codes?: string[]) => fromMetrics(
      'm.rsi < 40',
      'm.rsi ASC NULLS LAST',
      8,
      (r) => `RSI ${Number(r.rsi).toFixed(0)}（超跌）`,
      codes,
    ),
  },
  {
    id: 'breakout',
    name: '量价突破',
    tagline: '放量拉升才上车，量能退潮就下车',
    playbook: [
      '选股：量比 > 1.5 且当日涨幅 > 2%，按量比从高到低取前 8 只',
      '买入：从候选里选 1 只，要求涨幅在 2%~9%（不追涨停）',
      '卖出：持仓量比跌破 1 或当日跌幅超过 5%，卖出',
      '仓位：单票不超过 20%，最多同时持有 3 只',
    ],
    backtestRules: [
      { type: 'threshold', action: 'BUY', conditions: [
        { indicator: 'volRatio', operator: '>', value: 1.5 },
        { indicator: 'changePct', operator: '>', value: 2 },
      ] },
      { type: 'threshold', action: 'SELL', conditions: [{ indicator: 'volRatio', operator: '<', value: 1 }] },
    ] as Rule[],
    candidates: (codes?: string[]) => fromMetrics(
      'm.vol_ratio > 1.5 AND m.change_pct BETWEEN 2 AND 9',
      'm.vol_ratio DESC NULLS LAST',
      8,
      (r) => `量比 ${Number(r.vol_ratio).toFixed(1)}，涨 ${Number(r.change_pct).toFixed(1)}%`,
      codes,
    ),
  },
  {
    id: 'limit-up',
    name: '涨停回封',
    tagline: '高风险对照组：只做昨日涨停的接力',
    playbook: [
      '选股：最近一个交易日涨停的股票（limit_up_records），取前 8 只',
      '买入：从候选里选 1 只，且今日未涨停（还能买进）',
      '卖出：次日不涨即走（持有不超过 2 个交易日）',
      '仓位：单票不超过 15%，最多同时持有 2 只 —— 这个策略是用来做对照的，亏了也正常',
    ],
    backtestRules: null,
    candidates: async (codes?: string[]) => {
      const safeCodes = (codes || []).filter(c => /^\d{6}$/.test(c))
      // 取「最近一个已收盘交易日」的涨停（不是今天）：今天的涨停买不进，
      // 规则也明确要求「今日未涨停」。changePct 留 0，避免模型误读成今天的涨幅。
      const r = await db.execute(sql`
        SELECT l.code, l.name, k.close::float8 AS close
        FROM limit_up_records l
        JOIN LATERAL (
          SELECT close, date FROM klines WHERE code = l.code ORDER BY date DESC LIMIT 1
        ) k ON TRUE
        WHERE l.date = (SELECT max(date) FROM limit_up_records)
          AND l.name NOT LIKE '%ST%'
          AND l.name NOT LIKE '%退%'
          AND k.date >= (SELECT max(date) FROM klines) - INTERVAL '5 days'
          ${safeCodes.length ? sql`AND l.code IN (${sql.join(safeCodes.map(c => sql`${c}`), sql`, `)})` : sql``}
        ORDER BY l.code
        LIMIT 8
      `) as any
      return (r?.rows || []).map((row: any) => ({
        code: row.code,
        name: row.name || row.code,
        close: Number(row.close) || 0,
        changePct: 0,
        reason: '上一交易日涨停（今日可接力，若今日已涨停则不能买）',
      }))
    },
  },
  {
    id: 'rotation',
    name: '低频轮动',
    tagline: '每月换一次，持有动量最强的一篮子',
    playbook: [
      '选股：10 日动量 > 0 的股票，按动量从高到低取前 10 只',
      '买入：每月第一个交易日调仓，从候选里最多买 5 只（等权）',
      '卖出：非调仓日只做止损（单票亏损超过 10%），不做主动换仓',
      '仓位：单票不超过 20%，始终留 20% 现金',
    ],
    // 原策略是组合轮动（每月在动量前 10 里等权），单票回测表达不了组合，
    // 这里用「动量阈值」做单票近似，页面上会标注口径不同。
    backtestRules: [
      { type: 'threshold', action: 'BUY', conditions: [{ indicator: 'momentum', operator: '>', value: 5 }] },
      { type: 'threshold', action: 'SELL', conditions: [{ indicator: 'momentum', operator: '<', value: 0 }] },
    ] as Rule[],
    backtestNote: '单票口径：原策略是每月组合轮动，这里用动量阈值近似',
    candidates: (codes?: string[]) => fromMetrics(
      'm.momentum > 0 AND m.momentum < 50',
      'm.momentum DESC NULLS LAST',
      10,
      (r) => `动量 ${Number(r.momentum).toFixed(1)}`,
      codes,
    ),
  },
]

/**
 * 对照组：同样的候选口径，但**不调模型**，机械执行「买候选第一只、持有 N 天」。
 * 用来回答一个行业里没人公开回答的问题：LLM 在「从 8 只里选 1 只」这件事上到底有没有增量。
 */
PAPER_STRATEGIES.push(
  {
    id: 'rule-trend',
    name: '趋势跟随·规则组',
    tagline: '对照组：不调模型，机械买候选第一只，持有 5 个交易日',
    engine: 'rule',
    holdDays: 7, // 约 5 个交易日
    playbook: [
      '选股：与「趋势跟随」完全相同的口径（MACD 柱为正 + 动量为正）',
      '买入：机械买入候选第一只，不经过模型判断',
      '卖出：持有满 5 个交易日后卖出',
      '用途：和「趋势跟随」对照，检验模型选股有没有增量',
    ],
    backtestRules: null,
    candidates: (codes?: string[]) => fromMetrics(
      "m.macd_signal > 0 AND m.momentum > 0 AND m.momentum < 50",
      'm.momentum DESC NULLS LAST',
      8,
      (r) => `动量 ${Number(r.momentum).toFixed(1)}，MACD 柱为正`,
      codes,
    ),
  },
  {
    id: 'rule-reversion',
    name: '均值回归·规则组',
    tagline: '对照组：不调模型，机械买候选第一只，持有 5 个交易日',
    engine: 'rule',
    holdDays: 7,
    playbook: [
      '选股：与「均值回归」完全相同的口径（RSI < 40，按超跌排序）',
      '买入：机械买入候选第一只，不经过模型判断',
      '卖出：持有满 5 个交易日后卖出',
      '用途：和「均值回归」对照，检验模型选股有没有增量',
    ],
    backtestRules: null,
    candidates: (codes?: string[]) => fromMetrics(
      'm.rsi < 40',
      'm.rsi ASC NULLS LAST',
      8,
      (r) => `RSI ${Number(r.rsi).toFixed(0)}（超跌）`,
      codes,
    ),
  },
)

export function getPaperStrategy(agentId: string): PaperStrategy {
  // agentId 在 paper_accounts 上是全局唯一的，所以第二届要用 trend-2 这种后缀。
  // 按最长前缀匹配，避免 'limit-up-2' 被 'limit' 之类的短 id 抢走。
  const sorted = [...PAPER_STRATEGIES].sort((a, b) => b.id.length - a.id.length)
  return sorted.find(s => agentId === s.id || agentId.startsWith(s.id + '-')) || PAPER_STRATEGIES[0]
}

/** 给前端用的展示结构（不含函数） */
export function strategyCatalog() {
  return PAPER_STRATEGIES.map(s => ({
    id: s.id,
    name: s.name,
    tagline: s.tagline,
    playbook: s.playbook,
    backtestRules: s.backtestRules,
    backtestNote: s.backtestNote,
    engine: s.engine || 'llm',
    canBacktest: !!s.backtestRules,
  }))
}
