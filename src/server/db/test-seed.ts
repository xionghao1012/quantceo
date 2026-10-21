/**
 * Minimal test seed — creates schema and inserts fixture data.
 * Run once per test suite lifecycle (beforeAll).
 */
import pg from 'pg'
import jwt from 'jsonwebtoken'
const sign = jwt.sign
import { drizzle } from 'drizzle-orm/node-postgres'
import {
  stocks,
  klines,
  users,
  subscriptions,
  positions,
  watchlist,
  watchlistGroups,
  signals,
  userStrategies,
  dailyPicks,
  moneyFlowDaily,
  limitUpRecords,
  intradayAlerts,
  aiPredictions,
  pushSettings,
  aiGeneratedStrategies,
  dailyMetrics,
  moneyFlowRealtime,
  strategyBacktestRuns,
  strategies,
  backtests,
} from './schema.js'

const { Pool } = pg

export interface TestSeed {
  db: ReturnType<typeof drizzle>
  cleanup: () => Promise<void>
  testUser: { id: number; email: string; token: string }
  proUser: { id: number; email: string; token: string }
  adminUser: { id: number; email: string; token: string }
  stocks: { code: string; name: string; exchange: string }[]
  userStrategies: { id: number; name: string }[]
  backtestRuns: { id: number }[]
  dailyMetrics: { code: string; metricDate: string }[]
}

function makeKlines(n = 30, basePrice = 100, trend = 0) {
  const result: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = []
  const now = new Date()
  let price = basePrice
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
    price += Math.sin(i / 3) * 2 + trend * 0.3
    const open = Math.round((price - 0.5) * 100) / 100
    const close = Math.round((price + 0.3) * 100) / 100
    result.push({
      date: d.toISOString().split('T')[0],
      open,
      high: Math.round((price + 1) * 100) / 100,
      low: Math.round((price - 1) * 100) / 100,
      close,
      volume: Math.floor(1_000_000 + Math.random() * 2_000_000),
    })
  }
  return result
}

export async function createTestSeed(): Promise<TestSeed> {
  const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: Number(process.env.PG_PORT) || 5432,
    // 测试跑 quant_ceo_test；开发环境用 PG_DB=quant_ceo_dev 灌一遍样例数据
    database: process.env.PG_DB || 'quant_ceo_test',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  })

  const db = drizzle(pool)

  // Create schema via raw SQL
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stocks (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      exchange VARCHAR(4) NOT NULL,
      status VARCHAR(20) DEFAULT 'active' NOT NULL
    );
    CREATE TABLE IF NOT EXISTS klines (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      date DATE NOT NULL,
      open DECIMAL(12,2) NOT NULL,
      high DECIMAL(12,2) NOT NULL,
      low DECIMAL(12,2) NOT NULL,
      close DECIMAL(12,2) NOT NULL,
      volume INTEGER NOT NULL,
      amount DECIMAL(16,2) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      sso_user_id INTEGER UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL DEFAULT '',
      avatar VARCHAR(500) NOT NULL DEFAULT '',
      password_hash VARCHAR(255) NOT NULL DEFAULT '',
      role VARCHAR(20) NOT NULL DEFAULT 'free',
      is_admin BOOLEAN DEFAULT false NOT NULL,
      settings JSONB DEFAULT '{}' NOT NULL,
      usage JSONB DEFAULT '{}' NOT NULL,
      referral_code VARCHAR(50) NOT NULL DEFAULT '',
      referred_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token VARCHAR(500) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'trialing',
      provider VARCHAR(20) NOT NULL DEFAULT 'manual',
      provider_sub_id VARCHAR(100),
      provider_data JSONB,
      start_date DATE,
      end_date DATE,
      trial_ends_at TIMESTAMP,
      current_period_end TIMESTAMP NOT NULL,
      cancelled_at TIMESTAMP,
      external_order_id VARCHAR(100),
      external_platform VARCHAR(20),
      external_note TEXT,
      external_submitted_at TIMESTAMP,
      external_verified_at TIMESTAMP,
      external_verified_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS positions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      quantity INTEGER NOT NULL,
      entry_price NUMERIC(12,4) NOT NULL,
      stop_loss NUMERIC(12,4),
      take_profit NUMERIC(12,4),
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER,
      code VARCHAR(10) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      added_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist_groups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(50) NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#f59e0b',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signals (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL DEFAULT '',
      scan_date DATE NOT NULL,
      strategy_id INTEGER NOT NULL,
      strategy_name VARCHAR(100) NOT NULL,
      direction VARCHAR(10) NOT NULL,
      strength INTEGER NOT NULL,
      price DECIMAL(12,2),
      indicators JSONB NOT NULL DEFAULT '{}',
      reason VARCHAR(500) NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS user_strategies (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      config JSONB NOT NULL DEFAULT '{}',
      is_public BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_picks (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      pick_date DATE NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      change_pct NUMERIC(10,4) NOT NULL,
      reason TEXT,
      rsi NUMERIC(6,2),
      ai_score NUMERIC(6,2),
      ai_direction VARCHAR(10),
      ai_risk VARCHAR(10),
      return_1d NUMERIC(10,4), return_3d NUMERIC(10,4), return_5d NUMERIC(10,4),
      return_10d NUMERIC(10,4), return_20d NUMERIC(10,4),
      max_return NUMERIC(10,4), max_drawdown NUMERIC(10,4),
      evaluated BOOLEAN DEFAULT false, evaluated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS money_flow_daily (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      trade_date DATE NOT NULL,
      close_price NUMERIC(12,2),
      change_pct NUMERIC(8,4),
      net_inflow_super_large NUMERIC(16,2) DEFAULT 0,
      net_inflow_large NUMERIC(16,2) DEFAULT 0,
      net_inflow_medium NUMERIC(16,2) DEFAULT 0,
      net_inflow_small NUMERIC(16,2) DEFAULT 0,
      net_inflow_main NUMERIC(16,2) DEFAULT 0,
      net_inflow_main_pct NUMERIC(8,4) DEFAULT 0,
      turnover_rate NUMERIC(8,4),
      source VARCHAR(20) DEFAULT 'eastmoney' NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(code, trade_date)
    );
    CREATE TABLE IF NOT EXISTS money_flow_realtime (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      update_time TIMESTAMP NOT NULL,
      close_price NUMERIC(12,2),
      net_inflow_super_large NUMERIC(16,2) DEFAULT 0,
      net_inflow_large NUMERIC(16,2) DEFAULT 0,
      net_inflow_medium NUMERIC(16,2) DEFAULT 0,
      net_inflow_small NUMERIC(16,2) DEFAULT 0,
      net_inflow_main NUMERIC(16,2) DEFAULT 0,
      net_inflow_main_pct NUMERIC(8,4) DEFAULT 0,
      source VARCHAR(20) DEFAULT 'eastmoney' NOT NULL,
      is_limit_up BOOLEAN DEFAULT false NOT NULL,
      is_auction_anomaly BOOLEAN DEFAULT false NOT NULL,
      anomaly_reason VARCHAR(100)
    );
    CREATE TABLE IF NOT EXISTS limit_up_records (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      date DATE NOT NULL,
      prev_close NUMERIC(12,2) NOT NULL,
      close_price NUMERIC(12,2) NOT NULL,
      limit_up_price NUMERIC(12,2) NOT NULL,
      change_pct NUMERIC(10,4) NOT NULL,
      limit_ratio NUMERIC(4,2) NOT NULL,
      consecutive_days INTEGER NOT NULL,
      volume BIGINT,
      amount NUMERIC(16,2),
      is_first_board BOOLEAN DEFAULT false NOT NULL,
      board_tag VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(code, date)
    );
    CREATE TABLE IF NOT EXISTS price_alerts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      target_price NUMERIC(12,2),
      target_value NUMERIC(12,2),
      direction VARCHAR(10) NOT NULL DEFAULT 'above',
      condition VARCHAR(20) NOT NULL DEFAULT 'price',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      enabled BOOLEAN DEFAULT true NOT NULL,
      triggered_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS intraday_alerts (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      alert_type VARCHAR(30) NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      change_pct NUMERIC(6,2),
      volume_ratio NUMERIC(6,2),
      day_change_pct NUMERIC(6,2),
      detail JSONB,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      notified BOOLEAN DEFAULT false NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_predictions (
      id SERIAL PRIMARY KEY,
      stock_code VARCHAR(10) NOT NULL,
      stock_name VARCHAR(100),
      predict_date DATE NOT NULL,
      target_date DATE NOT NULL,
      direction VARCHAR(10) NOT NULL,
      confidence REAL NOT NULL,
      current_price NUMERIC(12,2),
      target_price NUMERIC(12,2),
      stop_loss NUMERIC(12,2),
      reasoning TEXT NOT NULL,
      model_used VARCHAR(50) NOT NULL,
      tokens_input INTEGER,
      tokens_output INTEGER,
      latency_ms INTEGER,
      actual_close NUMERIC(12,2),
      actual_high NUMERIC(12,2),
      actual_low NUMERIC(12,2),
      is_direction_correct BOOLEAN,
      is_target_reached BOOLEAN,
      evaluated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rec_tracking (
      id SERIAL PRIMARY KEY,
      daily_pick_id INTEGER,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      pick_date DATE NOT NULL,
      entry_date DATE,
      entry_price NUMERIC(12,2),
      exit_date DATE,
      exit_price NUMERIC(12,2),
      status VARCHAR(10) NOT NULL DEFAULT 'pending',
      pnl NUMERIC(12,2),
      pnl_percent NUMERIC(8,4),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name VARCHAR(100) NOT NULL,
      key VARCHAR(100) NOT NULL UNIQUE,
      key_prefix VARCHAR(20) NOT NULL,
      key_hash VARCHAR(255) NOT NULL,
      permissions JSONB DEFAULT '["read"]' NOT NULL,
      last_used_at TIMESTAMP,
      expires_at TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_settings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      channels JSONB NOT NULL DEFAULT '{"inApp":true,"wechat":false,"email":false}',
      triggers JSONB NOT NULL DEFAULT '{"onSignal":true,"dailyDigest":false,"weeklyReport":false}',
      filter JSONB NOT NULL DEFAULT '{"minStrength":50,"onlyBuy":false,"codes":[]}',
      server_chan_key VARCHAR(100) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel VARCHAR(20) NOT NULL,
      type VARCHAR(20) NOT NULL,
      title VARCHAR(200) NOT NULL,
      body TEXT NOT NULL,
      data JSONB DEFAULT '{}' NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'sent',
      read_at TIMESTAMP,
      sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_generated_strategies (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      symbol VARCHAR(10),
      name VARCHAR(100) NOT NULL,
      description TEXT,
      config JSONB NOT NULL DEFAULT '{}',
      rules JSONB,
      metrics JSONB,
      confidence REAL,
      rationale TEXT,
      analysis JSONB,
      preferences JSONB,
      start_date DATE, end_date DATE,
      expected_return NUMERIC(10,4),
      expected_sharpe NUMERIC(8,4),
      model_used VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id SERIAL PRIMARY KEY,
      metric_date DATE NOT NULL,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      exchange VARCHAR(10) NOT NULL,
      board VARCHAR(10) NOT NULL,
      rsi NUMERIC(8,2),
      change_pct NUMERIC(10,4),
      vol_ratio NUMERIC(8,4),
      macd_signal NUMERIC(10,4),
      bb_position NUMERIC(8,2),
      ma_alignment INTEGER DEFAULT 0,
      volatility NUMERIC(10,6),
      momentum NUMERIC(10,6),
      computed_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS money_flow_alerts (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      alert_type VARCHAR(30) NOT NULL,
      detail JSONB DEFAULT '{}' NOT NULL,
      notified BOOLEAN DEFAULT false NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_roles (
      id SERIAL PRIMARY KEY,
      code VARCHAR(32) NOT NULL UNIQUE,
      name_zh VARCHAR(64) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT true NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      name_zh VARCHAR(100) NOT NULL,
      module VARCHAR(32) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_user_roles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
      granted_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(user_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS admin_role_permissions (
      role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );
    CREATE TABLE IF NOT EXISTS money_flow_alert_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code VARCHAR(10),
      name VARCHAR(100),
      enabled BOOLEAN DEFAULT true NOT NULL,
      threshold_type VARCHAR(20) NOT NULL,
      threshold_value NUMERIC(16,2) NOT NULL,
      direction VARCHAR(10) NOT NULL DEFAULT 'inflow',
      tech_resonance_enabled BOOLEAN DEFAULT false NOT NULL,
      tech_resonance_macd BOOLEAN DEFAULT false NOT NULL,
      tech_resonance_ma BOOLEAN DEFAULT false NOT NULL,
      basic_filter_enabled BOOLEAN DEFAULT true NOT NULL,
      smart_filter_enabled BOOLEAN DEFAULT false NOT NULL,
      triggered_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id SERIAL PRIMARY KEY,
      referrer_id INTEGER NOT NULL,
      referee_id INTEGER NOT NULL,
      reward_type VARCHAR(50) NOT NULL DEFAULT 'trial',
      reward_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS export_tasks (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(50),
      type VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      params JSONB DEFAULT '{}' NOT NULL,
      progress INTEGER DEFAULT 0,
      file_path VARCHAR(500),
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      completed_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS scheduler_log (
      id SERIAL PRIMARY KEY,
      task_name VARCHAR(100) NOT NULL,
      exec_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'success',
      items_processed INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMP DEFAULT NOW() NOT NULL,
      completed_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategies (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      config JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backtests (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      strategy_id INTEGER NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      initial_capital DECIMAL(14,2) NOT NULL,
      result JSONB,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS minute_klines (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      datetime TIMESTAMP NOT NULL,
      period VARCHAR(5) NOT NULL DEFAULT 'm5',
      open DECIMAL(12,2) NOT NULL,
      high DECIMAL(12,2) NOT NULL,
      low DECIMAL(12,2) NOT NULL,
      close DECIMAL(12,2) NOT NULL,
      volume BIGINT NOT NULL,
      amount DECIMAL(16,2) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS strategy_optimizations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      strategy_key VARCHAR(50) NOT NULL,
      strategy_label VARCHAR(100) NOT NULL,
      strategy_type VARCHAR(50),
      symbol VARCHAR(10),
      start_date DATE,
      end_date DATE,
      params JSONB NOT NULL DEFAULT '{}',
      param_ranges JSONB,
      results JSONB NOT NULL DEFAULT '[]',
      best_params JSONB,
      best_fitness VARCHAR(50),
      metrics JSONB,
      history JSONB,
      generation INTEGER DEFAULT 0,
      total_generations INTEGER,
      population_size INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS money_flow_sources (
      id SERIAL PRIMARY KEY,
      source_name VARCHAR(50) NOT NULL UNIQUE,
      source_type VARCHAR(20) NOT NULL DEFAULT 'primary',
      is_active BOOLEAN DEFAULT true NOT NULL,
      last_success_at TIMESTAMP,
      last_fail_at TIMESTAMP,
      fail_count INTEGER DEFAULT 0 NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS strategy_backtest_runs (
      id SERIAL PRIMARY KEY,
      strategy_key VARCHAR(50) NOT NULL,
      strategy_label VARCHAR(100) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      trade_direction VARCHAR(10) DEFAULT 'long' NOT NULL,
      holding_periods INTEGER[] DEFAULT ARRAY[1,3,5,10],
      initial_capital NUMERIC(14,2) DEFAULT 1000000 NOT NULL,
      top_n INTEGER DEFAULT 5 NOT NULL,
      allocation VARCHAR(20) DEFAULT 'score_weighted' NOT NULL,
      commission_rate NUMERIC(6,4) DEFAULT 0.00025 NOT NULL,
      stamp_tax_rate NUMERIC(6,4) DEFAULT 0.001 NOT NULL,
      slippage NUMERIC(6,4) DEFAULT 0.001 NOT NULL,
      total_return NUMERIC(10,4),
      annual_return NUMERIC(10,4),
      sharpe NUMERIC(8,4),
      max_drawdown NUMERIC(8,4),
      win_rate NUMERIC(6,4),
      trade_count INTEGER,
      avg_hold_days NUMERIC(6,2),
      return_1d NUMERIC(10,4), return_3d NUMERIC(10,4), return_5d NUMERIC(10,4), return_10d NUMERIC(10,4),
      trades JSONB DEFAULT '[]' NOT NULL,
      equity_curve JSONB DEFAULT '[]' NOT NULL,
      triggered_by VARCHAR(20) DEFAULT 'scheduler' NOT NULL,
      computation_ms INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `)

  // Clear existing data
  for (const table of [
    'sessions','positions','watchlist','watchlist_groups','signals',
    'user_strategies','daily_picks','money_flow_daily','money_flow_realtime',
    'limit_up_records','price_alerts','intraday_alerts','ai_predictions',
    'rec_tracking','api_keys','push_settings','notification_logs',
    'ai_generated_strategies','daily_metrics','money_flow_alerts',
    'strategy_backtest_runs','subscriptions','users',
    'admin_user_roles','admin_role_permissions','admin_roles','permissions',
    'money_flow_alert_configs','referral_rewards','export_tasks','scheduler_log',
    'strategies','backtests','minute_klines','strategy_optimizations','money_flow_sources',
  ]) {
    try { await pool.query('DELETE FROM ' + table) } catch {}
  }

  // Users
  const bcrypt = await import('bcryptjs')
  const testHash = await bcrypt.hash('Test@123456', 10)
  const proHash = await bcrypt.hash('Pro@123456', 10)
  const adminHash = await bcrypt.hash('Admin@123456', 10)

  const [testUserRow] = await db.insert(users).values({
    email: 'test@quantceo.test',
    name: 'Test User',
    passwordHash: testHash,
    role: 'free',
    isAdmin: false,
  }).returning()
  const [proUserRow] = await db.insert(users).values({
    email: 'pro@quantceo.test',
    name: 'Pro User',
    passwordHash: proHash,
    role: 'pro',
    isAdmin: false,
  }).returning()
  const [adminUserRow] = await db.insert(users).values({
    email: 'admin@quantceo.test',
    name: 'Admin User',
    passwordHash: adminHash,
    role: 'admin',
    isAdmin: true,
  }).returning()

  // Token
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
  const makeToken = (userId: number, email: string): string =>
    sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' }) as string

  const testToken = makeToken(testUserRow.id, testUserRow.email)
  const proToken = makeToken(proUserRow.id, proUserRow.email)
  const adminToken = makeToken(adminUserRow.id, adminUserRow.email)

  // Subscription
  const now = new Date()
  const proEnd = new Date(now); proEnd.setMonth(proEnd.getMonth() + 1)
  await db.insert(subscriptions).values({
    userId: proUserRow.id,
    plan: 'pro',
    status: 'active',
    provider: 'manual',
    startDate: now.toISOString().split('T')[0],
    endDate: proEnd.toISOString().split('T')[0],
    currentPeriodEnd: proEnd,
  })

  // Positions
  await db.insert(positions).values({
    userId: testUserRow.id,
    code: '600519',
    name: '贵州茅台',
    quantity: 100,
    entryPrice: '160.0000',
    stopLoss: '150.0000',
    takeProfit: '180.0000',
    status: 'open',
  })

  // Watchlist
  const [group] = await db.insert(watchlistGroups).values({
    userId: testUserRow.id,
    name: 'Test Group',
    color: '#f59e0b',
    sortOrder: 0,
  }).returning()
  await db.insert(watchlist).values({
    userId: testUserRow.id,
    groupId: group.id,
    code: '600519',
    note: '茅台测试',
  })

  // Stocks
  const TEST_STOCKS = [
    { code: '600519', name: '贵州茅台', exchange: 'SH' },
    { code: '000001', name: '平安银行', exchange: 'SZ' },
    { code: '300750', name: '宁德时代', exchange: 'SZ' },
    { code: '688981', name: '中芯国际', exchange: 'SH' },
    { code: '002475', name: '立讯精密', exchange: 'SZ' },
    { code: '000002', name: '万科A', exchange: 'SZ' },
    { code: '000003', name: 'PT平能', exchange: 'SZ' },
    { code: '000004', name: '国华网安', exchange: 'SZ' },
    { code: '000005', name: 'ST星源', exchange: 'SZ' },
    { code: '000006', name: '深振业A', exchange: 'SZ' },
    { code: '000007', name: '全新好', exchange: 'SZ' },
    { code: '000008', name: '神州高铁', exchange: 'SZ' },
    { code: '000010', name: '美丽生态', exchange: 'SZ' },
    { code: '000011', name: '深物业A', exchange: 'SZ' },
    { code: '000012', name: '南玻A', exchange: 'SZ' },
    { code: '600036', name: '招商银行', exchange: 'SH' },
    { code: '600000', name: '浦发银行', exchange: 'SH' },
  ]
  for (const s of TEST_STOCKS) {
    await db.insert(stocks).values(s).onConflictDoNothing()
  }

  // Klines
  const klineFixtures: Record<string, { base: number; trend: number }> = {
    '600519': { base: 1680, trend: 0.5 },
    '000001': { base: 12.5, trend: -0.2 },
    '300750': { base: 215, trend: 1.0 },
    '688981': { base: 48, trend: 0.3 },
    '002475': { base: 32, trend: -0.1 },
    '000002': { base: 9.5, trend: 0.1 },
    '000003': { base: 3.2, trend: -0.05 },
    '000004': { base: 8.1, trend: 0.2 },
    '000005': { base: 2.1, trend: -0.1 },
    '000006': { base: 4.8, trend: 0.15 },
    '000007': { base: 5.5, trend: 0.3 },
    '000008': { base: 3.9, trend: -0.15 },
    '000010': { base: 2.8, trend: 0.1 },
    '000011': { base: 7.2, trend: 0.05 },
    '000012': { base: 6.4, trend: 0.2 },
    '600036': { base: 38, trend: 0.4 },
    '600000': { base: 8.5, trend: -0.1 },
  }
  for (const [code, fx] of Object.entries(klineFixtures)) {
    const bars = makeKlines(30, fx.base, fx.trend)
    for (const bar of bars) {
      await db.insert(klines).values({
        code,
        date: bar.date,
        open: String(bar.open),
        high: String(bar.high),
        low: String(bar.low),
        close: String(bar.close),
        volume: bar.volume,
        amount: String(Math.round(bar.close * bar.volume * 100) / 100),
      }).onConflictDoNothing()
    }
  }

  // Signals
  const today = new Date().toISOString().split('T')[0]
  await db.insert(signals).values({
    code: '600519',
    name: '贵州茅台',
    scanDate: today,
    strategyId: 1,
    strategyName: 'ma_cross',
    direction: 'BUY',
    strength: 85,
    price: '1680',
    indicators: JSON.stringify({ ma5: 1670, ma10: 1650 }),
    reason: 'MA5 crosses above MA10',
  })

  // Daily picks
  await db.insert(dailyPicks).values({
    code: '600519',
    name: '贵州茅台',
    pickDate: today,
    price: '1680',
    changePct: '2.5',
    reason: 'RSI oversold',
    rsi: '35',
    aiScore: '82',
    aiDirection: 'bullish',
    aiRisk: 'medium',
  })

  // Money flow
  await db.insert(moneyFlowDaily).values({
    code: '600519',
    name: '贵州茅台',
    tradeDate: today,
    closePrice: '1680',
    changePct: '2.5',
    netInflowSuperLarge: '100000000',
    netInflowLarge: '200000000',
    netInflowMain: '50000000',
    netInflowMainPct: '3.5',
    source: 'eastmoney',
  })

  // Limit up
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  await db.insert(limitUpRecords).values({
    code: '300750',
    name: '宁德时代',
    date: yesterday.toISOString().split('T')[0],
    prevClose: '205',
    closePrice: '225.5',
    limitUpPrice: '225.5',
    changePct: '10',
    limitRatio: '10',
    consecutiveDays: 1,
    isFirstBoard: false,
  })

  // AI predictions
  const targetDate = new Date(now); targetDate.setDate(targetDate.getDate() + 3)
  await db.insert(aiPredictions).values({
    stockCode: '600519',
    stockName: '贵州茅台',
    predictDate: today,
    targetDate: targetDate.toISOString().split('T')[0],
    direction: 'bullish',
    confidence: 0.82,
    currentPrice: '1680',
    targetPrice: '1720',
    stopLoss: '1650',
    reasoning: 'RSI oversold, MACD golden cross',
    modelUsed: 'gpt-4',
  })

  // Push settings
  await db.insert(pushSettings).values({
    userId: testUserRow.id,
    channels: { inApp: true, wechat: false, email: false },
    triggers: { onSignal: true, dailyDigest: false, weeklyReport: false },
    filter: { minStrength: 50, onlyBuy: false, codes: [] },
  })

  // ── User strategies ─────────────────────────────────────────────
  const [strategy1] = await db.insert(userStrategies).values({
    userId: testUserRow.id,
    name: 'MA Cross 5/20',
    description: 'Moving average crossover strategy',
    config: { fastPeriod: 5, slowPeriod: 20, direction: 'long' },
    isPublic: false,
  }).returning()

  const [strategy2] = await db.insert(userStrategies).values({
    userId: testUserRow.id,
    name: 'RSI Mean Reversion',
    description: 'RSI oversold mean reversion',
    config: { rsiPeriod: 14, rsiLower: 30, rsiUpper: 70 },
    isPublic: true,
  }).returning()

  // ── Scoring strategies ───────────────────────────────────────────
  await db.insert(strategies).values([
    {
      name: 'RSI 超跌策略',
      config: {
        type: 'scoring_strategy',
        key: 'oversold_reversal',
        label: 'RSI 超跌',
        desc: 'RSI 低于 30 反弹策略',
        conditions: [],
        scoreSQL: 'CASE WHEN rsi < 30 THEN (30 - rsi) * 3 ELSE 0 END',
        sort: 'desc',
      },
    },
    {
      name: '成交量突破策略',
      config: {
        type: 'scoring_strategy',
        key: 'volume_breakout',
        label: '成交量突破',
        desc: '成交量放大策略',
        conditions: [],
        scoreSQL: 'CASE WHEN vol_ratio > 2 THEN (vol_ratio - 2) * 20 ELSE 0 END',
        sort: 'desc',
      },
    },
    {
      name: '均线多头策略',
      config: {
        type: 'scoring_strategy',
        key: 'ma_alignment',
        label: '均线多头',
        desc: '均线排列多头策略',
        conditions: [],
        scoreSQL: 'CASE WHEN ma_alignment = 2 THEN 50 WHEN ma_alignment = 1 THEN 25 ELSE 0 END',
        sort: 'desc',
      },
    },
  ]).onConflictDoNothing()

  // ── Strategy backtest runs ──────────────────────────────────────
  const backtestBase = {
    strategyKey: 'ma_cross',
    strategyLabel: 'MA Cross 5/20',
    startDate: '2023-01-01',
    endDate: '2024-12-31',
    tradeDirection: 'long' as const,
    initialCapital: '1000000',
    totalReturn: '18.5',
    annualReturn: '8.9',
    sharpe: '1.42',
    maxDrawdown: '-6.2',
    winRate: '0.58',
    tradeCount: 47,
    avgHoldDays: '5.2',
    return1d: '1.2', return3d: '3.1', return5d: '5.4', return10d: '9.8',
    triggeredBy: 'scheduler' as const,
    computationMs: 3200,
  }

  await db.insert(strategyBacktestRuns).values([
    {
      ...backtestBase,
      holdingPeriods: [1, 3, 5, 10],
      topN: 5,
      allocation: 'score_weighted',
      trades: JSON.stringify([]),
      equityCurve: JSON.stringify([]),
    },
    {
      ...backtestBase,
      strategyKey: 'rsi_reversion',
      strategyLabel: 'RSI Mean Reversion',
      totalReturn: '12.3', annualReturn: '6.1', sharpe: '0.98', maxDrawdown: '-8.1',
      winRate: '0.52', tradeCount: 63, topN: 3, allocation: 'equal_weight',
      return1d: '0.9', return3d: '2.1', return5d: '3.8', return10d: '6.2',
      trades: JSON.stringify([]),
      equityCurve: JSON.stringify([]),
    },
    {
      ...backtestBase,
      strategyKey: 'ma_cross',
      strategyLabel: 'MA Cross 5/20',
      totalReturn: '25.1', annualReturn: '11.8', sharpe: '1.65', maxDrawdown: '-4.3',
      winRate: '0.61', tradeCount: 38, topN: 10, holdingPeriods: [3, 5, 10, 20],
      return1d: '1.5', return3d: '4.0', return5d: '7.2', return10d: '12.1',
      trades: JSON.stringify([]),
      equityCurve: JSON.stringify([]),
    },
  ]).onConflictDoNothing()

  // ── backtests (for /leaderboard, /history, /compare) ──────────────
  await db.insert(backtests).values([
    {
      code: '600519',
      strategyId: 1,
      startDate: '2023-01-01',
      endDate: '2024-12-31',
      initialCapital: '1000000',
      result: { totalReturn: 18.5, annualReturn: 8.9, sharpe: 1.42, maxDrawdown: -6.2, winRate: 0.58, tradeCount: 47 },
    },
    {
      code: '000001',
      strategyId: 2,
      startDate: '2023-01-01',
      endDate: '2024-12-31',
      initialCapital: '1000000',
      result: { totalReturn: 12.3, annualReturn: 6.1, sharpe: 0.98, maxDrawdown: -8.1, winRate: 0.52, tradeCount: 63 },
    },
    {
      code: '300750',
      strategyId: 1,
      startDate: '2023-01-01',
      endDate: '2024-12-31',
      initialCapital: '1000000',
      result: { totalReturn: 25.1, annualReturn: 11.8, sharpe: 1.65, maxDrawdown: -4.3, winRate: 0.61, tradeCount: 38 },
    },
  ]).onConflictDoNothing()

  // ── Daily metrics ────────────────────────────────────────────────
  const metricsStocks = [
    { code: '600519', name: '贵州茅台', exchange: 'SH' },
    { code: '000001', name: '平安银行', exchange: 'SZ' },
    { code: '300750', name: '宁德时代', exchange: 'SZ' },
    { code: '600036', name: '招商银行', exchange: 'SH' },
  ]
  const metricDate = today
  for (const s of metricsStocks) {
    await db.insert(dailyMetrics).values({
      metricDate,
      code: s.code,
      name: s.name,
      exchange: s.exchange,
      board: 'main',
      rsi: String((40 + Math.random() * 40).toFixed(2)),
      changePct: String((Math.random() * 10 - 3).toFixed(4)),
      volRatio: String((1 + Math.random()).toFixed(4)),
      macdSignal: String((Math.random() * 2 - 1).toFixed(4)),
      bbPosition: String((Math.random() * 100).toFixed(2)),
      maAlignment: Math.floor(Math.random() * 3),
      volatility: String((Math.random() * 0.05).toFixed(6)),
      momentum: String((Math.random() * 0.03 - 0.01).toFixed(6)),
    }).onConflictDoNothing()
  }

  // ── Intraday alerts ─────────────────────────────────────────────
  await db.insert(intradayAlerts).values([
    { code: '600519', name: '贵州茅台', alertType: 'limit_up', price: '1680', changePct: '10', volumeRatio: '3.2', dayChangePct: '2.5' },
    { code: '300750', name: '宁德时代', alertType: 'volume_surge', price: '225', changePct: '5.2', volumeRatio: '4.1', dayChangePct: '3.1' },
  ]).onConflictDoNothing()

  // ── Money flow realtime ─────────────────────────────────────────
  await db.insert(moneyFlowRealtime).values({
    code: '600519',
    name: '贵州茅台',
    updateTime: new Date(),
    closePrice: '1680',
    netInflowSuperLarge: '100000000',
    netInflowLarge: '200000000',
    netInflowMain: '50000000',
    netInflowMainPct: '3.5',
    isLimitUp: false,
    isAuctionAnomaly: false,
  }).onConflictDoNothing()

  // ── AI generated strategies ─────────────────────────────────────
  await db.insert(aiGeneratedStrategies).values({
    userId: testUserRow.id,
    symbol: '600519',
    name: 'AI Generated: MA+RSI Combo',
    config: JSON.stringify({ maPeriods: [5, 10, 20], rsiPeriod: 14 }),
    status: 'active',
    confidence: 0.78,
    rationale: 'Combined momentum and mean reversion signals',
    modelUsed: 'gpt-4',
  }).onConflictDoNothing()

  return {
    db,
    cleanup: async () => {
      await pool.end()
    },
    testUser: { id: testUserRow.id, email: testUserRow.email, token: testToken },
    proUser: { id: proUserRow.id, email: proUserRow.email, token: proToken },
    adminUser: { id: adminUserRow.id, email: adminUserRow.email, token: adminToken },
    stocks: TEST_STOCKS,
    userStrategies: strategy1 && strategy2
      ? [{ id: strategy1.id, name: strategy1.name }, { id: strategy2.id, name: strategy2.name }]
      : [],
    backtestRuns: [],
    dailyMetrics: metricsStocks.map(s => ({ code: s.code, metricDate })),
  }
}
