import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { strategies } from './schema.js'

const { Pool } = pg
const pool = new Pool({
  host: process.env.PG_HOST || '/var/run/postgresql',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB || 'quant_ceo',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
})
const db = drizzle(pool)

const strategyDefs = [
  { name: '超卖反转', config: { type: 'scoring_strategy', key: 'oversold_reversal', label: '超卖反转', desc: 'RSI<30 + MACD金叉 + 跌幅大', scoreSQL: 'GREATEST(0, (30 - COALESCE(rsi, 30)) / 30.0 * 40) + GREATEST(0, LEAST(COALESCE(macd_signal, 0) / 2, 1) * 30) + GREATEST(0, LEAST(-COALESCE(momentum, 0) / 10, 1) * 30)', conditions: [{ sql: 'COALESCE(rsi, 100) < 30' }, { sql: 'COALESCE(macd_signal, -999) > 0' }, { sql: 'COALESCE(momentum, 0) < -3' }], sort: 'desc' } },
  { name: '放量突破', config: { type: 'scoring_strategy', key: 'volume_breakout', label: '放量突破', desc: '量比>1.5 + 涨幅>3% + 布林上轨', scoreSQL: 'GREATEST(0, LEAST((COALESCE(vol_ratio, 1) - 1) / 3, 1) * 35) + GREATEST(0, LEAST((COALESCE(change_pct, 0) - 3) / 7, 1) * 35) + GREATEST(0, COALESCE(bb_position, 0) / 100 * 30)', conditions: [{ sql: 'COALESCE(vol_ratio, 0) > 1.5' }, { sql: 'COALESCE(change_pct, 0) > 3' }, { sql: 'COALESCE(bb_position, 0) > 60' }], sort: 'desc' } },
  { name: '底部启动', config: { type: 'scoring_strategy', key: 'bottom_start', label: '底部启动', desc: 'RSI<35 + 放量 + 小幅上涨', scoreSQL: 'GREATEST(0, (35 - COALESCE(rsi, 35)) / 35.0 * 40) + GREATEST(0, LEAST((COALESCE(vol_ratio, 1) - 1) / 4, 1) * 30) + GREATEST(0, LEAST(COALESCE(change_pct, 0) / 5, 1) * 30)', conditions: [{ sql: 'COALESCE(rsi, 100) < 35' }, { sql: 'COALESCE(vol_ratio, 0) > 1' }, { sql: 'COALESCE(change_pct, 0) > 1' }], sort: 'desc' } },
  { name: '强势回调', config: { type: 'scoring_strategy', key: 'strong_pullback', label: '强势回调', desc: 'RSI>50 + 回调>2% + 放量', scoreSQL: 'GREATEST(0, (COALESCE(rsi, 50) - 50) / 50.0 * 30) + GREATEST(0, LEAST(-COALESCE(change_pct, 0) / 10, 1) * 40) + GREATEST(0, LEAST((COALESCE(vol_ratio, 1) - 1) / 3, 1) * 30)', conditions: [{ sql: 'COALESCE(rsi, 0) > 50' }, { sql: 'COALESCE(change_pct, 0) < -2' }, { sql: 'COALESCE(vol_ratio, 0) > 1' }], sort: 'desc' } },
  { name: '全面看多', config: { type: 'scoring_strategy', key: 'bullish_composite', label: '全面看多', desc: 'RSI>50 + MACD>0 + 均线多头 + 正动量', scoreSQL: 'GREATEST(0, (COALESCE(rsi, 50) - 50) / 50.0 * 25) + GREATEST(0, LEAST(COALESCE(macd_signal, 0) / 3, 1) * 25) + CASE WHEN COALESCE(ma_alignment, 0) > 0 THEN 25 ELSE 0 END + GREATEST(0, LEAST(COALESCE(momentum, 0) / 10, 1) * 25)', conditions: [{ sql: 'COALESCE(rsi, 0) > 50' }, { sql: 'COALESCE(macd_signal, -999) > 0' }, { sql: 'COALESCE(ma_alignment, 0) > 0' }, { sql: 'COALESCE(momentum, 0) > 0' }], sort: 'desc' } },
  { name: '极度超卖', config: { type: 'scoring_strategy', key: 'extreme_oversold', label: '极度超卖', desc: 'RSI<20 + 缩量', scoreSQL: 'GREATEST(0, (20 - COALESCE(rsi, 20)) / 20.0 * 60) + GREATEST(0, LEAST((0.6 - COALESCE(vol_ratio, 0)) / 0.5, 1) * 40)', conditions: [{ sql: 'COALESCE(rsi, 100) < 20' }, { sql: 'COALESCE(vol_ratio, 10) < 0.6' }], sort: 'desc' } },
]

async function seedStrategies() {
  for (const s of strategyDefs) {
    const existing = await db.select({ id: strategies.id }).from(strategies).where(sql`config->>'key' = ${s.config.key}`)
    if (existing.length === 0) {
      await db.insert(strategies).values({ name: s.name, config: s.config as any })
      console.log(`Inserted strategy: ${s.name}`)
    } else {
      console.log(`Strategy exists: ${s.name}`)
    }
  }
  console.log(`Seeded ${strategyDefs.length} strategies`)
  await pool.end()
}
seedStrategies()
