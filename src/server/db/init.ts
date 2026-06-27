import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  host: process.env.PG_HOST || '/var/run/postgresql',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB || 'quant_ceo',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
})

const db = drizzle(pool)

async function init() {
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

    CREATE TABLE IF NOT EXISTS strategy_backtest_runs (
      id SERIAL PRIMARY KEY,
      strategy_key VARCHAR(50) NOT NULL,
      strategy_label VARCHAR(100) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      trade_direction VARCHAR(10) DEFAULT 'long' NOT NULL,
      holding_periods INTEGER[] DEFAULT '{1,3,5,10}',
      initial_capital DECIMAL(14,2) DEFAULT 1000000 NOT NULL,
      top_n INTEGER DEFAULT 5 NOT NULL,
      allocation VARCHAR(20) DEFAULT 'score_weighted' NOT NULL,
      commission_rate DECIMAL(6,4) DEFAULT 0.00025 NOT NULL,
      stamp_tax_rate DECIMAL(6,4) DEFAULT 0.001 NOT NULL,
      slippage DECIMAL(6,4) DEFAULT 0.001 NOT NULL,
      total_return DECIMAL(10,4),
      annual_return DECIMAL(10,4),
      sharpe DECIMAL(8,4),
      max_drawdown DECIMAL(8,4),
      win_rate DECIMAL(6,4),
      trade_count INTEGER,
      avg_hold_days DECIMAL(6,2),
      return_1d DECIMAL(10,4),
      return_3d DECIMAL(10,4),
      return_5d DECIMAL(10,4),
      return_10d DECIMAL(10,4),
      trades JSONB DEFAULT '[]' NOT NULL,
      equity_curve JSONB DEFAULT '[]' NOT NULL,
      triggered_by VARCHAR(20) DEFAULT 'scheduler' NOT NULL,
      computation_ms INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_backtest_runs_unique ON strategy_backtest_runs(strategy_key, start_date, end_date, top_n);

    CREATE INDEX IF NOT EXISTS idx_klines_code_date ON klines(code, date);

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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_minute_klines_code_period_datetime ON minute_klines(code, period, datetime);

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

    CREATE TABLE IF NOT EXISTS signals (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      date DATE NOT NULL,
      direction VARCHAR(10) NOT NULL,
      strength INTEGER NOT NULL,
      indicators JSONB NOT NULL,
      reason VARCHAR(500) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL DEFAULT '',
      avatar VARCHAR(500) NOT NULL DEFAULT '',
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'free',
      settings JSONB NOT NULL DEFAULT '{}',
      usage JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token VARCHAR(500) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      code VARCHAR(10) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      added_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token);

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
      evaluated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_predictions_code_date ON ai_predictions(stock_code, predict_date DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_predictions_target_date ON ai_predictions(target_date);
    CREATE INDEX IF NOT EXISTS idx_ai_predictions_pending_eval ON ai_predictions(target_date) WHERE evaluated_at IS NULL;

    CREATE TABLE IF NOT EXISTS rec_tracking (
      id SERIAL PRIMARY KEY,
      daily_pick_id INTEGER REFERENCES daily_picks(id),
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      pick_date DATE NOT NULL,
      entry_date DATE,
      entry_price NUMERIC(12,2),
      exit_date DATE,
      exit_price NUMERIC(12,2),
      status VARCHAR(10) DEFAULT 'pending' NOT NULL,
      pnl NUMERIC(12,2),
      pnl_percent NUMERIC(8,4),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rec_tracking_pick_date ON rec_tracking(pick_date DESC);
    CREATE INDEX IF NOT EXISTS idx_rec_tracking_status ON rec_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_rec_tracking_code ON rec_tracking(code);
  `)
  console.log('Database tables created.')
  await pool.end()
}

init()
