/**
 * Global setup — runs once before all tests.
 * Seeds the test DB (quant_ceo_test) with all fixture data.
 */
import pg from 'pg'
import { createTestSeed } from '../db/test-seed.js'

async function resetDb() {
  const { Pool } = pg
  const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    database: 'quant_ceo_test',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  })
  const client = await pool.connect()
  try {
    await client.query(`TRUNCATE TABLE users, sessions, subscriptions, positions, watchlist, watchlist_groups, signals, user_strategies, daily_picks, money_flow_daily, limit_up_records, price_alerts, intraday_alerts, ai_predictions, rec_tracking, api_keys, push_settings, ai_generated_strategies, daily_metrics, money_flow_realtime, money_flow_alerts, strategy_backtest_runs, strategies, backtests RESTART IDENTITY CASCADE`)
    await client.query(`SELECT setval('users_id_seq', 1, false)`)
  } finally {
    client.release()
    await pool.end()
  }
}

async function ensureSchema() {
  const { Pool } = pg
  const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    database: 'quant_ceo_test',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  })
  const extraCols = [
    ['money_flow_realtime', 'created_at', 'TIMESTAMP DEFAULT NOW()'],
    // 预测价格基准日：用于判断「1 日预测」实际跨了几个交易日
    ['ai_predictions', 'basis_date', 'DATE'],
  ]
  const client = await pool.connect()
  try {
    for (const [table, col, def] of extraCols) {
      try {
        await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${def}`)
      } catch {}
    }
  } finally {
    client.release()
    await pool.end()
  }
}

export default async function globalSetup() {
  try {
    console.log('[globalSetup] Resetting DB...')
    await resetDb()
    console.log('[globalSetup] DB reset complete')

    console.log('[globalSetup] Ensuring schema...')
    await ensureSchema()
    console.log('[globalSetup] Schema ensured')

    console.log('[globalSetup] Running seed...')
    const seed = await createTestSeed()
    console.log('[globalSetup] Seed complete, test user id:', seed.testUser.id)

    await seed.cleanup()
    console.log('[globalSetup] Cleanup complete')
  } catch (err) {
    console.error('[globalSetup] Error:', err)
  }
}
