import { pgTable, serial, varchar, decimal, date, integer, jsonb, timestamp, text, boolean, numeric, real, unique, bigint } from 'drizzle-orm/pg-core'

export const stocks = pgTable('stocks', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  exchange: varchar('exchange', { length: 4 }).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
})

export const klines = pgTable('klines', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  date: date('date').notNull(),
  open: decimal('open', { precision: 12, scale: 2 }).notNull(),
  high: decimal('high', { precision: 12, scale: 2 }).notNull(),
  low: decimal('low', { precision: 12, scale: 2 }).notNull(),
  close: decimal('close', { precision: 12, scale: 2 }).notNull(),
  volume: integer('volume').notNull(),
  amount: decimal('amount', { precision: 16, scale: 2 }).notNull(),
})

export const minuteKlines = pgTable('minute_klines', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  datetime: timestamp('datetime').notNull(),
  period: varchar('period', { length: 5 }).notNull().default('m5'),
  open: decimal('open', { precision: 12, scale: 2 }).notNull(),
  high: decimal('high', { precision: 12, scale: 2 }).notNull(),
  low: decimal('low', { precision: 12, scale: 2 }).notNull(),
  close: decimal('close', { precision: 12, scale: 2 }).notNull(),
  volume: bigint('volume', { mode: 'number' }).notNull(),
  amount: decimal('amount', { precision: 16, scale: 2 }).notNull(),
})

export const dailyMetrics = pgTable('daily_metrics', {
  id: serial('id').primaryKey(),
  metricDate: date('metric_date').notNull(),
  code: varchar('code', { length: 10 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  exchange: varchar('exchange', { length: 10 }).notNull(),
  board: varchar('board', { length: 10 }).notNull(),
  rsi: numeric('rsi', { precision: 8, scale: 2 }),
  changePct: numeric('change_pct', { precision: 10, scale: 4 }),
  volRatio: numeric('vol_ratio', { precision: 8, scale: 4 }),
  macdSignal: numeric('macd_signal', { precision: 10, scale: 4 }),
  bbPosition: numeric('bb_position', { precision: 8, scale: 2 }),
  maAlignment: integer('ma_alignment').default(0),
  volatility: numeric('volatility', { precision: 10, scale: 6 }),
  momentum: numeric('momentum', { precision: 10, scale: 6 }),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
})

export const strategies = pgTable('strategies', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const backtests = pgTable('backtests', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  strategyId: integer('strategy_id').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  initialCapital: decimal('initial_capital', { precision: 14, scale: 2 }).notNull(),
  result: jsonb('result'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const signals = pgTable('signals', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  name: varchar('name', { length: 100 }).notNull().default(''),
  scanDate: date('scan_date').notNull(),
  strategyId: integer('strategy_id').notNull(),
  strategyName: varchar('strategy_name', { length: 100 }).notNull(),
  direction: varchar('direction', { length: 10 }).notNull(),
  strength: integer('strength').notNull(),
  price: decimal('price', { precision: 12, scale: 2 }),
  indicators: jsonb('indicators').notNull().default('{}'),
  reason: varchar('reason', { length: 500 }).notNull().default(''),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  ssoUserId: integer('sso_user_id').unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull().default(''),
  avatar: varchar('avatar', { length: 500 }).notNull().default(''),
  passwordHash: varchar('password_hash', { length: 255 }).notNull().default(''),
  role: varchar('role', { length: 20 }).notNull().default('free'),
  settings: jsonb('settings').default('{}').notNull(),
  usage: jsonb('usage').default('{}').notNull(),
  referralCode: varchar('referral_code', { length: 50 }).notNull().default(''),
  referredBy: integer('referred_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshToken: varchar('refresh_token', { length: 500 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const watchlist = pgTable('watchlist', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  groupId: integer('group_id').references(() => watchlistGroups.id, { onDelete: 'set null' }),
  code: varchar('code', { length: 10 }).notNull(),
  note: text('note').notNull().default(''),
  addedAt: timestamp('added_at').defaultNow().notNull(),
})

export const watchlistGroups = pgTable('watchlist_groups', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 50 }).notNull(),
  color: varchar('color', { length: 20 }).notNull().default('#f59e0b'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const pushSettings = pgTable('push_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  channels: jsonb('channels').notNull().default('{"inApp":true,"wechat":false,"email":false}'),
  triggers: jsonb('triggers').notNull().default('{"onSignal":true,"dailyDigest":false,"weeklyReport":false}'),
  filter: jsonb('filter').notNull().default('{"minStrength":50,"onlyBuy":false,"codes":[]}'),
  serverChanKey: varchar('server_chan_key', { length: 100 }).notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const notificationLogs = pgTable('notification_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 20 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body').notNull(),
  data: jsonb('data').default('{}').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('sent'),
  readAt: timestamp('read_at'),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  plan: varchar('plan', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('trialing'),
  provider: varchar('provider', { length: 20 }).notNull().default('manual'),
  providerSubId: varchar('provider_sub_id', { length: 100 }),
  providerData: jsonb('provider_data'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const paymentLogs = pgTable('payment_logs', {
  id: serial('id').primaryKey(),
  subscriptionId: integer('subscription_id').references(() => subscriptions.id),
  userId: integer('user_id').references(() => users.id),
  provider: varchar('provider', { length: 50 }).notNull(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  amount: integer('amount'),
  currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
  status: varchar('status', { length: 20 }).notNull(),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const userStrategies = pgTable('user_strategies', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }).notNull().default(''),
  config: jsonb('config').notNull().default('{}'),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const aiPredictions = pgTable('ai_predictions', {
  id: serial('id').primaryKey(),
  stockCode: varchar('stock_code', { length: 10 }).notNull(),
  stockName: varchar('stock_name', { length: 100 }),
  predictDate: date('predict_date').notNull(),
  targetDate: date('target_date').notNull(),
  direction: varchar('direction', { length: 10 }).notNull(),
  confidence: real('confidence').notNull(),
  currentPrice: numeric('current_price', { precision: 12, scale: 2 }),
  targetPrice: numeric('target_price', { precision: 12, scale: 2 }),
  stopLoss: numeric('stop_loss', { precision: 12, scale: 2 }),
  reasoning: text('reasoning').notNull(),
  modelUsed: varchar('model_used', { length: 50 }).notNull(),
  tokensInput: integer('tokens_input'),
  tokensOutput: integer('tokens_output'),
  latencyMs: integer('latency_ms'),
  actualClose: numeric('actual_close', { precision: 12, scale: 2 }),
  actualHigh: numeric('actual_high', { precision: 12, scale: 2 }),
  actualLow: numeric('actual_low', { precision: 12, scale: 2 }),
  isDirectionCorrect: boolean('is_direction_correct'),
  isTargetReached: boolean('is_target_reached'),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const priceAlerts = pgTable('price_alerts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  code: varchar('code', { length: 10 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  targetPrice: numeric('target_price', { precision: 12, scale: 2 }),
  targetValue: numeric('target_value', { precision: 12, scale: 2 }),
  direction: varchar('direction', { length: 10 }).notNull().default('above'),
  condition: varchar('condition', { length: 20 }).notNull().default('price'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  enabled: boolean('enabled').default(true).notNull(),
  triggeredAt: timestamp('triggered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const dailyPicks = pgTable('daily_picks', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  pickDate: date('pick_date').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  changePct: numeric('change_pct', { precision: 10, scale: 4 }).notNull(),
  reason: text('reason'),
  rsi: numeric('rsi', { precision: 6, scale: 2 }),
  aiScore: numeric('ai_score', { precision: 6, scale: 2 }),
  aiDirection: varchar('ai_direction', { length: 10 }),
  aiRisk: varchar('ai_risk', { length: 10 }),
  return1d: numeric('return_1d', { precision: 10, scale: 4 }),
  return3d: numeric('return_3d', { precision: 10, scale: 4 }),
  return5d: numeric('return_5d', { precision: 10, scale: 4 }),
  return10d: numeric('return_10d', { precision: 10, scale: 4 }),
  return20d: numeric('return_20d', { precision: 10, scale: 4 }),
  maxReturn: numeric('max_return', { precision: 10, scale: 4 }),
  maxDrawdown: numeric('max_drawdown', { precision: 10, scale: 4 }),
  evaluated: boolean('evaluated').default(false),
  evaluatedAt: timestamp('evaluated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const recTracking = pgTable('rec_tracking', {
  id: serial('id').primaryKey(),
  dailyPickId: integer('daily_pick_id').references(() => dailyPicks.id),
  code: varchar('code', { length: 10 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  pickDate: date('pick_date').notNull(),
  entryDate: date('entry_date'),
  entryPrice: numeric('entry_price', { precision: 12, scale: 2 }),
  exitDate: date('exit_date'),
  exitPrice: numeric('exit_price', { precision: 12, scale: 2 }),
  status: varchar('status', { length: 10 }).notNull().default('pending'),
  pnl: numeric('pnl', { precision: 12, scale: 2 }),
  pnlPercent: numeric('pnl_percent', { precision: 8, scale: 4 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const aiGeneratedStrategies = pgTable('ai_generated_strategies', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  symbol: varchar('symbol', { length: 10 }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  config: jsonb('config').notNull().default('{}'),
  rules: jsonb('rules'),
  metrics: jsonb('metrics'),
  confidence: real('confidence'),
  rationale: text('rationale'),
  analysis: jsonb('analysis'),
  preferences: jsonb('preferences'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  expectedReturn: numeric('expected_return'),
  expectedSharpe: numeric('expected_sharpe'),
  modelUsed: varchar('model_used', { length: 50 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const strategyBacktestRuns = pgTable('strategy_backtest_runs', {
  id: serial('id').primaryKey(),
  strategyKey: varchar('strategy_key', { length: 50 }).notNull(),
  strategyLabel: varchar('strategy_label', { length: 100 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  tradeDirection: varchar('trade_direction', { length: 10 }).default('long').notNull(),
  holdingPeriods: integer('holding_periods').array().default([1, 3, 5, 10]),
  initialCapital: numeric('initial_capital', { precision: 14, scale: 2 }).default('1000000').notNull(),
  topN: integer('top_n').default(5).notNull(),
  allocation: varchar('allocation', { length: 20 }).default('score_weighted').notNull(),
  commissionRate: numeric('commission_rate', { precision: 6, scale: 4 }).default('0.00025').notNull(),
  stampTaxRate: numeric('stamp_tax_rate', { precision: 6, scale: 4 }).default('0.001').notNull(),
  slippage: numeric('slippage', { precision: 6, scale: 4 }).default('0.001').notNull(),
  totalReturn: numeric('total_return', { precision: 10, scale: 4 }),
  annualReturn: numeric('annual_return', { precision: 10, scale: 4 }),
  sharpe: numeric('sharpe', { precision: 8, scale: 4 }),
  maxDrawdown: numeric('max_drawdown', { precision: 8, scale: 4 }),
  winRate: numeric('win_rate', { precision: 6, scale: 4 }),
  tradeCount: integer('trade_count'),
  avgHoldDays: numeric('avg_hold_days', { precision: 6, scale: 2 }),
  return1d: numeric('return_1d', { precision: 10, scale: 4 }),
  return3d: numeric('return_3d', { precision: 10, scale: 4 }),
  return5d: numeric('return_5d', { precision: 10, scale: 4 }),
  return10d: numeric('return_10d', { precision: 10, scale: 4 }),
  trades: jsonb('trades').default('[]').notNull(),
  equityCurve: jsonb('equity_curve').default('[]').notNull(),
  triggeredBy: varchar('triggered_by', { length: 20 }).default('scheduler').notNull(),
  computationMs: integer('computation_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueRun: unique('strategy_backtest_runs_unique').on(table.strategyKey, table.startDate, table.endDate, table.topN),
}))

export const strategyOptimizations = pgTable('strategy_optimizations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  strategyKey: varchar('strategy_key', { length: 50 }).notNull(),
  strategyLabel: varchar('strategy_label', { length: 100 }).notNull(),
  strategyType: varchar('strategy_type', { length: 50 }),
  symbol: varchar('symbol', { length: 10 }),
  startDate: date('start_date'),
  endDate: date('end_date'),
  params: jsonb('params').notNull().default('{}'),
  paramRanges: jsonb('param_ranges'),
  results: jsonb('results').notNull().default('[]'),
  bestParams: jsonb('best_params'),
  bestFitness: varchar('best_fitness', { length: 50 }),
  metrics: jsonb('metrics'),
  history: jsonb('history'),
  generation: integer('generation').default(0),
  totalGenerations: integer('total_generations'),
  populationSize: integer('population_size'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  progress: integer('progress').default(0),
  error: text('error'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const referralRewards = pgTable('referral_rewards', {
  id: serial('id').primaryKey(),
  referrerId: integer('referrer_id').notNull(),
  refereeId: integer('referee_id').notNull(),
  rewardType: varchar('reward_type', { length: 50 }).notNull().default('trial'),
  rewardAmount: numeric('reward_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  permissions: jsonb('permissions').default('["read"]').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const intradayAlerts = pgTable('intraday_alerts', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  alertType: varchar('alert_type', { length: 30 }).notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  changePct: numeric('change_pct', { precision: 6, scale: 2 }),
  volumeRatio: numeric('volume_ratio', { precision: 6, scale: 2 }),
  dayChangePct: numeric('day_change_pct', { precision: 6, scale: 2 }),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  notified: boolean('notified').default(false).notNull(),
})

export const positions = pgTable('positions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 10 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  quantity: integer('quantity').notNull(),
  entryPrice: numeric('entry_price', { precision: 12, scale: 4 }).notNull(),
  stopLoss: numeric('stop_loss', { precision: 12, scale: 4 }),
  takeProfit: numeric('take_profit', { precision: 12, scale: 4 }),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
