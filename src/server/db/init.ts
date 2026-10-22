import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  host: process.env.PG_HOST || '/var/run/postgresql',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB || 'quant_ceo',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
})

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
      name VARCHAR(100) NOT NULL DEFAULT '',
      scan_date DATE NOT NULL,
      strategy_id INTEGER NOT NULL DEFAULT 0,
      strategy_name VARCHAR(100) NOT NULL DEFAULT '',
      direction VARCHAR(10) NOT NULL,
      strength INTEGER NOT NULL,
      price NUMERIC(12,2),
      indicators JSONB NOT NULL DEFAULT '{}',
      reason VARCHAR(500) NOT NULL DEFAULT ''
    );

    ALTER TABLE signals ADD COLUMN IF NOT EXISTS name VARCHAR(100) NOT NULL DEFAULT '';
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS scan_date DATE;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS strategy_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS strategy_name VARCHAR(100) NOT NULL DEFAULT '';
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);
    ALTER TABLE signals ADD COLUMN IF NOT EXISTS indicators JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE signals ALTER COLUMN indicators SET DEFAULT '{}';
    ALTER TABLE signals ALTER COLUMN reason SET DEFAULT '';
    -- 老版本遗留的 date 列（NOT NULL 且无默认值），现在的代码只写 scan_date，
    -- 留着它会让每一次插入都违反非空约束 → 信号扫描天天 0 产出且被记成 success
    ALTER TABLE signals DROP COLUMN IF EXISTS date;

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL DEFAULT '',
      avatar VARCHAR(500) NOT NULL DEFAULT '',
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'free',
      is_admin BOOLEAN DEFAULT FALSE NOT NULL,
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

    CREATE TABLE IF NOT EXISTS watchlist_groups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(50) NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#f59e0b',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER REFERENCES watchlist_groups(id) ON DELETE SET NULL,
      code VARCHAR(10) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      added_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES watchlist_groups(id) ON DELETE SET NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE NOT NULL;

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
      return_1d NUMERIC(10,4),
      return_3d NUMERIC(10,4),
      return_5d NUMERIC(10,4),
      return_10d NUMERIC(10,4),
      return_20d NUMERIC(10,4),
      max_return NUMERIC(10,4),
      max_drawdown NUMERIC(10,4),
      evaluated BOOLEAN DEFAULT false,
      evaluated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_daily_picks_date ON daily_picks(pick_date DESC);

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

    CREATE TABLE IF NOT EXISTS trade_journal (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100),
      direction VARCHAR(10) NOT NULL,
      entry_date DATE NOT NULL,
      exit_date DATE,
      entry_price NUMERIC(12,4) NOT NULL,
      exit_price NUMERIC(12,4),
      shares INTEGER NOT NULL,
      pnl NUMERIC(14,2),
      return_pct NUMERIC(10,4),
      tags VARCHAR(200)[] DEFAULT '{}',
      notes TEXT,
      strategy VARCHAR(100),
      rating INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trade_journal_user ON trade_journal(user_id);
    CREATE INDEX IF NOT EXISTS idx_trade_journal_date ON trade_journal(entry_date DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_journal_status ON trade_journal(user_id, exit_date) WHERE exit_date IS NULL;

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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_log_task_date ON scheduler_log(task_name, exec_date);

    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      code VARCHAR(64) UNIQUE NOT NULL,
      name_zh VARCHAR(100) NOT NULL,
      module VARCHAR(32) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_roles (
      id SERIAL PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      name_zh VARCHAR(64) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_role_permissions (
      role_id INT NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
      permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS admin_user_roles (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INT NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
      granted_by INT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(user_id, role_id)
    );

    INSERT INTO permissions (code, name_zh, module) VALUES
      ('user.view', '查看用户', 'user'),
      ('user.upgrade', '用户升降级', 'user'),
      ('order.approve', '订单审核', 'order'),
      ('order.view', '查看订单', 'order'),
      ('stats.view', '查看统计', 'stats'),
      ('oauth.manage', 'OAuth 管理', 'oauth'),
      ('system.config', '系统配置', 'system'),
      ('apikey.manage', 'API Keys 管理', 'apikey'),
      ('role.manage', '角色管理', 'role')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO admin_roles (code, name_zh, description) VALUES
      ('operator', '运营', '日常运营管理'),
      ('ops', '运维', '系统运维'),
      ('support', '客服', '客服支持'),
      ('admin', '管理', '全面管理'),
      ('sales', '销售', '销售管理')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO admin_role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM admin_roles r, permissions p WHERE r.code = 'operator' AND p.code IN ('stats.view', 'user.upgrade', 'order.approve', 'order.view', 'apikey.manage')
    ON CONFLICT DO NOTHING;

    INSERT INTO admin_role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM admin_roles r, permissions p WHERE r.code = 'ops' AND p.code IN ('stats.view', 'oauth.manage', 'system.config', 'apikey.manage')
    ON CONFLICT DO NOTHING;

    INSERT INTO admin_role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM admin_roles r, permissions p WHERE r.code = 'support' AND p.code IN ('order.approve', 'order.view')
    ON CONFLICT DO NOTHING;

    INSERT INTO admin_role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM admin_roles r, permissions p WHERE r.code = 'admin' AND p.code IN ('user.view', 'user.upgrade', 'order.approve', 'order.view', 'stats.view', 'oauth.manage', 'system.config', 'apikey.manage', 'role.manage')
    ON CONFLICT DO NOTHING;

    INSERT INTO admin_role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM admin_roles r, permissions p WHERE r.code = 'sales' AND p.code IN ('stats.view')
    ON CONFLICT DO NOTHING;

    INSERT INTO admin_user_roles (user_id, role_id, granted_by)
    SELECT u.id, r.id, u.id FROM users u, admin_roles r WHERE u.is_admin = true AND r.code = 'admin'
    ON CONFLICT DO NOTHING;

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
      is_first_board BOOLEAN DEFAULT FALSE NOT NULL,
      board_tag VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(code, date)
    );

    CREATE INDEX IF NOT EXISTS idx_limit_up_date ON limit_up_records(date);
    CREATE INDEX IF NOT EXISTS idx_limit_up_consecutive ON limit_up_records(consecutive_days DESC);
    CREATE INDEX IF NOT EXISTS idx_limit_up_code ON limit_up_records(code);

    CREATE TABLE IF NOT EXISTS money_flow_daily (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      trade_date DATE NOT NULL,
      close_price DECIMAL(12,2),
      change_pct DECIMAL(8,4),
      net_inflow_super_large DECIMAL(16,2) DEFAULT 0,
      net_inflow_large DECIMAL(16,2) DEFAULT 0,
      net_inflow_medium DECIMAL(16,2) DEFAULT 0,
      net_inflow_small DECIMAL(16,2) DEFAULT 0,
      net_inflow_main DECIMAL(16,2) DEFAULT 0,
      net_inflow_main_pct DECIMAL(8,4) DEFAULT 0,
      turnover_rate DECIMAL(8,4),
      source VARCHAR(20) DEFAULT 'eastmoney' NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(code, trade_date)
    );
    CREATE INDEX IF NOT EXISTS idx_moneyflow_code ON money_flow_daily(code);
    CREATE INDEX IF NOT EXISTS idx_moneyflow_date ON money_flow_daily(trade_date);

    CREATE TABLE IF NOT EXISTS money_flow_realtime (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      update_time TIMESTAMP NOT NULL,
      close_price DECIMAL(12,2),
      net_inflow_super_large DECIMAL(16,2) DEFAULT 0,
      net_inflow_large DECIMAL(16,2) DEFAULT 0,
      net_inflow_medium DECIMAL(16,2) DEFAULT 0,
      net_inflow_small DECIMAL(16,2) DEFAULT 0,
      net_inflow_main DECIMAL(16,2) DEFAULT 0,
      net_inflow_main_pct DECIMAL(8,4) DEFAULT 0,
      source VARCHAR(20) DEFAULT 'eastmoney' NOT NULL,
      is_limit_up BOOLEAN DEFAULT FALSE NOT NULL,
      is_auction_anomaly BOOLEAN DEFAULT FALSE NOT NULL,
      anomaly_reason VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_moneyflow_rt_code_time ON money_flow_realtime(code, update_time DESC);

    CREATE TABLE IF NOT EXISTS money_flow_alerts (
      id SERIAL PRIMARY KEY,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      alert_type VARCHAR(30) NOT NULL,
      detail JSONB DEFAULT '{}' NOT NULL,
      notified BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS money_flow_alert_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code VARCHAR(10),
      name VARCHAR(100),
      enabled BOOLEAN DEFAULT TRUE NOT NULL,
      threshold_type VARCHAR(20) NOT NULL,
      threshold_value DECIMAL(16,2) NOT NULL,
      direction VARCHAR(10) NOT NULL DEFAULT 'inflow',
      tech_resonance_enabled BOOLEAN DEFAULT FALSE NOT NULL,
      tech_resonance_macd BOOLEAN DEFAULT FALSE NOT NULL,
      tech_resonance_ma BOOLEAN DEFAULT FALSE NOT NULL,
      basic_filter_enabled BOOLEAN DEFAULT TRUE NOT NULL,
      smart_filter_enabled BOOLEAN DEFAULT FALSE NOT NULL,
      triggered_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mf_config_user ON money_flow_alert_configs(user_id);
    CREATE INDEX IF NOT EXISTS idx_mf_config_code ON money_flow_alert_configs(code);

    CREATE TABLE IF NOT EXISTS export_tasks (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(50),
      type VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      params JSONB NOT NULL DEFAULT '{}',
      progress INTEGER DEFAULT 0,
      file_path VARCHAR(500),
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      completed_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_export_user ON export_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_export_status ON export_tasks(status);

    CREATE TABLE IF NOT EXISTS money_flow_sources (
      id SERIAL PRIMARY KEY,
      source_name VARCHAR(50) NOT NULL UNIQUE,
      source_type VARCHAR(20) NOT NULL DEFAULT 'primary',
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      last_success_at TIMESTAMP,
      last_fail_at TIMESTAMP,
      fail_count INTEGER DEFAULT 0 NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_competitions (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending' NOT NULL,
      initial_cash DECIMAL(16,2) DEFAULT 1000000 NOT NULL,
      max_position_ratio DECIMAL(4,2) DEFAULT 0.30 NOT NULL,
      daily_trade_limit INTEGER DEFAULT 3 NOT NULL,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_accounts (
      id SERIAL PRIMARY KEY,
      competition_id INTEGER REFERENCES paper_competitions(id),
      agent_id VARCHAR(50) UNIQUE NOT NULL,
      agent_name VARCHAR(200) NOT NULL,
      api_key VARCHAR(100) UNIQUE NOT NULL,
      cash DECIMAL(16,2) DEFAULT 1000000 NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_account_competition ON paper_accounts(competition_id);

    CREATE TABLE IF NOT EXISTS paper_positions (
      id SERIAL PRIMARY KEY,
      account_id INTEGER REFERENCES paper_accounts(id) NOT NULL,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100),
      shares INTEGER NOT NULL,
      avg_cost DECIMAL(12,4) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(account_id, code)
    );

    CREATE TABLE IF NOT EXISTS paper_orders (
      id SERIAL PRIMARY KEY,
      account_id INTEGER REFERENCES paper_accounts(id) NOT NULL,
      competition_id INTEGER REFERENCES paper_competitions(id) NOT NULL,
      code VARCHAR(10) NOT NULL,
      name VARCHAR(100),
      direction VARCHAR(4) NOT NULL,
      price DECIMAL(12,4) NOT NULL,
      shares INTEGER NOT NULL,
      filled_price DECIMAL(12,4),
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      reject_reason TEXT,
      filled_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paper_order_account ON paper_orders(account_id);
    CREATE INDEX IF NOT EXISTS idx_paper_order_competition ON paper_orders(competition_id);
    CREATE INDEX IF NOT EXISTS idx_paper_order_status ON paper_orders(status);

    CREATE TABLE IF NOT EXISTS paper_nav_snapshots (
      id SERIAL PRIMARY KEY,
      account_id INTEGER REFERENCES paper_accounts(id) NOT NULL,
      competition_id INTEGER REFERENCES paper_competitions(id) NOT NULL,
      nav DECIMAL(12,6) NOT NULL,
      total_value DECIMAL(16,4) NOT NULL,
      snapshot_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(account_id, snapshot_date)
    );
  `)
  console.log('Database tables created.')
  await pool.end()
}

init()
