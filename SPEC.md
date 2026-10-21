# Mock Layer Infrastructure Spec

## Context

Test coverage is at 46.7%. The bottleneck is three infrastructure gaps:

1. **`requirePlan` routes are untestable** — every `pro`/`premium`-gated route (aiPredict, strategyOptimizer, screenerPro, tradeJournal, riskManagement, aiStrategy, marketAlerts, apiKeys, userStrategies) returns 403 in tests because `getUserPlan()` has no subscription row for the test user.
2. **External HTTP calls are not intercepted** — `fetchKlines`, `aiFetch`, and all adapter `fetch` calls hit real URLs, making tests non-deterministic and slow.
3. **Seed data is sparse for complex routes** — backtest and rankings routes query `strategy_backtest_runs`, `daily_metrics`, `user_strategies`, `ai_generated_strategies`, and `intraday_alerts` tables that have no seed rows.

---

## 1. Pro Plan Bypass Middleware

### Problem

`requirePlan(minPlan)` calls `getUserPlan(userId)` which queries `subscriptions` table. The test seed creates a `proUser` with an active subscription, but `testUser` (free tier) has no subscription row. Any test that needs a free-user request to pass `requirePlan('pro')` fails.

Current workaround (per-file, anti-pattern):
```ts
// Each test file manually stubs the middleware:
requirePlan: (_plan: string) => (_req: any, _res: any, next: () => void) => next()
```

### Implementation

**File**: `src/server/__tests__/helpers/mockPlanBypass.ts`

Two mechanisms, selected by a single env flag `TEST_BYPASS_PLANS=1`:

```ts
// Mechanism A — patch getUserPlan (preferred, surgical)
import { vi } from 'vitest'
import * as subscription from '../services/subscription.js'

export function installPlanBypass() {
  vi.spyOn(subscription, 'getUserPlan').mockResolvedTo('pro')
  // Also mock getUserPlan to return 'premium' when needed
}

// Mechanism B — set LICENSE_KEY (works but global, affects auth too)
// Set in vitest globalSetup: LICENSE_KEY=test-bypass
```

**Usage** in test files that need pro/premium routes:
```ts
import { installPlanBypass } from './helpers/mockPlanBypass.js'

beforeAll(() => { installPlanBypass() })
```

**Scope**: only `getUserPlan` is mocked — `getUsageToday`, `checkUsage`, and `checkWatchlistLimit` are NOT bypassed (they test real quota logic).

**Route-to-plan mapping** (from grep results):
| Route | Plan required |
|---|---|
| `aiPredict /run` | `pro` |
| `aiPredict /run-batch`, `/run-market` | `premium` |
| `strategyOptimizer` all endpoints | `pro` |
| `screenerPro` all | `pro` |
| `tradeJournal` all | `pro` |
| `riskManagement` all | `pro` |
| `aiStrategy /` | `pro` |
| `apiKeys /`, `POST /` | `premium` |
| `userStrategies POST /`, `PUT /:id` | `pro` |
| `marketAlerts` all | `pro` |

### Todo
- [ ] Create `mockPlanBypass.ts` with `installPlanBypass()` and `installPlanBypass('premium')`
- [ ] Update `globalMocks.ts` to export and call `installPlanBypass` in `beforeEach`
- [ ] Update `vitest.config.ts` to set `TEST_BYPASS_PLANS=1` in `setupFiles`

---

## 2. Comprehensive MockFetch Layer

### Problem

`globalMocks.ts` already has a global fetch stub, but it:
- Returns `{}` for any unmatched URL (silently swallows real calls)
- Has no per-source response fidelity (eastmoney responses don't look like real eastmoney responses)
- Doesn't cover the adapter layer (`src/server/data/adapters/`)
- Doesn't cover `aiFetch` which uses its own internal fetch

### Implementation

**File**: `src/server/__tests__/helpers/mockFetch.ts`

```ts
import { vi } from 'vitest'

// ── URL registries ────────────────────────────────────────────
const exactMap = new Map<string, unknown>()
const patternMap = new Map<RegExp, unknown>()

export function mockEastmoney(urlPattern: string, data: unknown) {
  patternMap.set(new RegExp('eastmoney\\.com|ifzq\\.gtimg'), data)
}
export function mockAkshare(urlPattern: string, data: unknown) { /* ... */ }
export function mockBaostock(urlPattern: string, data: unknown) { /* ... */ }
export function mockAI(url: string, data: unknown) {
  exactMap.set(`localhost:4002${url}`, data)
}

export function resetMocks() {
  exactMap.clear()
  patternMap.clear()
}
```

**Realistic response fixtures** (lives in `src/server/__tests__/fixtures/`):

```ts
// fixtures/eastmoney.ts
export const mockKlineResponse = {
  code: 0,
  data: {
    'sh600519': {
      qfqday: [
        ['2024-01-02', '1670', '1680', '1685', '1668', '1250000', '210000000'],
        // ... 30 rows
      ]
    }
  }
}

export const mockStockQuote = {
  '600519': { name: '贵州茅台', price: 1680, change_pct: 2.5 },
  '000001': { name: '平安银行', price: 12.5, change_pct: -0.3 },
}

// fixtures/akshare.ts
export const mockAkshareMinuteResponse = [
  { datetime: '2024-01-02 09:35', open: 1670, high: 1680, low: 1668, close: 1675, volume: 125000, amount: 210000000 },
]

// fixtures/baostock.ts
export const mockBaostockMinuteResponse = [
  { code: '600519', datetime: '2024-01-02 09:35:00', open: 1670, high: 1680, low: 1668, close: 1675, volume: 125000, amount: 210000000 },
]

// fixtures/ai.ts
export const mockAIResponse = {
  prediction: { direction: 'up', confidence: 75, targetPrice: 1700, stopLoss: 1600 },
  reasoning: 'Based on technical analysis',
  model: 'mock-llm',
}
```

**Fetch interceptor** (replaces current `installGlobalFetch` in `globalMocks.ts`):

```ts
let fetchInstalled = false
export function installGlobalFetch() {
  if (fetchInstalled) return
  fetchInstalled = true
  globalThis.fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const urlStr = String(url)
    // 1. exact match
    if (exactMap.has(urlStr)) return makeResponse(exactMap.get(urlStr))
    // 2. pattern match (eastmoney, akshare, baostock)
    for (const [re, data] of patternMap.entries()) {
      if (re.test(urlStr)) return makeResponse(data)
    }
    // 3. AI service
    if (urlStr.includes('localhost:4002')) return makeResponse({ prediction: { direction: 'up' } })
    // 4. Unknown → throw (strict mode, catches missed mocks)
    throw new Error(`[mockFetch] unmocked URL: ${urlStr}`)
  } as any)
}
```

### Integration with existing `installDataMocks`

The existing `installDataMocks` uses `vi.mock()` to replace module exports. The new approach adds a **parallel** fetch-level mock. Both can coexist: `vi.mock` replaces the function, `global fetch` catches any `fetch` calls that bypass the mocked functions.

### Todo
- [ ] Create `src/server/__tests__/fixtures/eastmoney.ts` with realistic kline/quote/moneyflow responses
- [ ] Create `src/server/__tests__/fixtures/akshare.ts` with minute-kline response
- [ ] Create `src/server/__tests__/fixtures/baostock.ts` with minute-kline response
- [ ] Create `src/server/__tests__/fixtures/ai.ts` with AI prediction response
- [ ] Refactor `mockFetch.ts` with pattern-map approach
- [ ] Update `installDataMocks` to also call `mockEastmoney(...)` with fixture data
- [ ] Add `mockAI('/v1/predict', mockAIResponse)` to `installAIMocks`

---

## 3. Test DB Seed Expansion

### Problem

Routes that query the following tables get empty results in tests:

| Table | Routes that need it |
|---|---|
| `strategy_backtest_runs` | `backtest.ts`, `rankings.ts`, `strategyOptimizer.ts` |
| `daily_metrics` | `rankings.ts`, `screener.ts` |
| `user_strategies` | `userStrategies.ts`, `strategyOptimizer.ts` |
| `ai_generated_strategies` | `aiStrategy.ts` |
| `intraday_alerts` | `intradayAlerts.ts` |
| `money_flow_realtime` | `moneyFlow.ts` (realtime endpoint) |
| `daily_picks` (only 1 row exists) | `recTracking.ts`, `rankings.ts` |
| `strategy_optimizations` | `strategyOptimizer.ts` |

### Implementation

**File**: `src/server/db/test-seed.ts` — add new seed sections.

**New seed blocks** (added before the `return` statement):

```ts
// ── user_strategies ────────────────────────────────────────────
const [strategy1] = await db.insert(userStrategies).values({
  userId: testUserRow.id,
  name: 'MA Cross 5/20',
  description: 'Moving average crossover strategy',
  config: JSON.stringify({ fastPeriod: 5, slowPeriod: 20, direction: 'long' }),
  isPublic: false,
}).returning()

const [strategy2] = await db.insert(userStrategies).values({
  userId: testUserRow.id,
  name: 'RSI Mean Reversion',
  description: 'RSI oversold mean reversion',
  config: JSON.stringify({ rsiPeriod: 14, rsiLower: 30, rsiUpper: 70 }),
  isPublic: true,
}).returning()

// ── strategy_backtest_runs ─────────────────────────────────────
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
  return_1d: '1.2', return_3d: '3.1', return_5d: '5.4', return_10d: '9.8',
  triggeredBy: 'scheduler' as const,
  computationMs: 3200,
}

await db.insert(strategyBacktestRuns).values([
  { ...backtestBase, holdingPeriods: [1, 3, 5, 10], topN: 5, allocation: 'score_weighted' },
  { ...backtestBase, strategyKey: 'rsi_reversion', strategyLabel: 'RSI Mean Reversion',
    totalReturn: '12.3', annualReturn: '6.1', sharpe: '0.98', maxDrawdown: '-8.1',
    winRate: '0.52', tradeCount: 63, topN: 3, allocation: 'equal_weight' },
  { ...backtestBase, strategyKey: 'ma_cross', strategyLabel: 'MA Cross 5/20',
    totalReturn: '25.1', annualReturn: '11.8', sharpe: '1.65', maxDrawdown: '-4.3',
    winRate: '0.61', tradeCount: 38, topN: 10, holdingPeriods: [3, 5, 10, 20] },
].map(s => ({
  ...s,
  trades: JSON.stringify([]),
  equityCurve: JSON.stringify([]),
})))

// ── daily_metrics ─────────────────────────────────────────────
const metricsStocks = ['600519', '000001', '300750', '600036']
const today = new Date().toISOString().split('T')[0]
for (const code of metricsStocks) {
  await db.insert(dailyMetrics).values({
    metricDate: today,
    code,
    name: code === '600519' ? '贵州茅台' : code === '000001' ? '平安银行' : code === '300750' ? '宁德时代' : '招商银行',
    exchange: code.startsWith('6') ? 'SH' : 'SZ',
    board: 'main',
    rsi: String((40 + Math.random() * 40).toFixed(2)),
    changePct: String((Math.random() * 10 - 3).toFixed(4)),
    volRatio: String((1 + Math.random()).toFixed(4)),
    macdSignal: String((Math.random() * 2 - 1).toFixed(4)),
    bbPosition: String((Math.random() * 100).toFixed(2)),
    maAlignment: Math.floor(Math.random() * 3),
    volatility: String((Math.random() * 0.05).toFixed(6)),
    momentum: String((Math.random() * 0.03 - 0.01).toFixed(6)),
  })
}

// ── intraday_alerts ────────────────────────────────────────────
await db.insert(intradayAlerts).values([
  { code: '600519', name: '贵州茅台', alertType: 'limit_up', price: '1680', changePct: '10', volumeRatio: '3.2', dayChangePct: '2.5' },
  { code: '300750', name: '宁德时代', alertType: 'volume_surge', price: '225', changePct: '5.2', volumeRatio: '4.1', dayChangePct: '3.1' },
])

// ── money_flow_realtime ────────────────────────────────────────
await db.insert(moneyFlowRealtime).values({
  code: '600519',
  name: '贵州茅台',
  updateTime: new Date(),
  closePrice: '1680',
  netInflowSuperLarge: 100000000,
  netInflowLarge: 200000000,
  netInflowMain: 50000000,
  netInflowMainPct: 3.5,
  isLimitUp: false,
  isAuctionAnomaly: false,
})

// ── ai_generated_strategies ────────────────────────────────────
await db.insert(aiGeneratedStrategies).values({
  userId: testUserRow.id,
  symbol: '600519',
  name: 'AI Generated: MA+RSI Combo',
  config: JSON.stringify({ maPeriods: [5, 10, 20], rsiPeriod: 14 }),
  status: 'active',
  confidence: 0.78,
  rationale: 'Combined momentum and mean reversion signals',
  modelUsed: 'gpt-4',
})
```

### TestSeed interface update

Add new fields to `TestSeed` interface:
```ts
export interface TestSeed {
  // ... existing
  strategies: { id: number; name: string }[]
  backtestRuns: { id: number }[]
}
```

### Todo
- [ ] Add `user_strategies` seed (2 strategies for testUser)
- [ ] Add `strategy_backtest_runs` seed (3 runs with varying metrics)
- [ ] Add `daily_metrics` seed (multiple stocks, today's date)
- [ ] Add `intraday_alerts` seed (2 alert rows)
- [ ] Add `money_flow_realtime` seed
- [ ] Add `ai_generated_strategies` seed
- [ ] Expand `daily_picks` to 5 rows (for rankings pagination)
- [ ] Update `TestSeed` interface with new typed fields
- [ ] Verify `rankings.ts` and `backtest.ts` queries work against new seed

---

## Prioritized Todo List

### Phase 1 — Unblock existing tests (P0)
1. [ ] Create `mockPlanBypass.ts` — makes all `requirePlan` routes testable
2. [ ] Update vitest config to set `TEST_BYPASS_PLANS=1`
3. [ ] Remove per-file `requirePlan` stubs from 6 test files (they become dead code)

### Phase 2 — Deterministic HTTP layer (P0)
4. [ ] Create `fixtures/eastmoney.ts`, `fixtures/akshare.ts`, `fixtures/baostock.ts`, `fixtures/ai.ts`
5. [ ] Refactor `mockFetch.ts` with pattern-map + strict-mode for unmocked URLs
6. [ ] Update `installDataMocks` + `installAIMocks` to register fixture data

### Phase 3 — Seed data expansion (P1)
7. [ ] Add `strategy_backtest_runs`, `daily_metrics`, `intraday_alerts`, `money_flow_realtime`, `ai_generated_strategies`, `daily_picks` (×5) seed rows
8. [ ] Update `TestSeed` interface

### Phase 4 — Coverage push (P2)
9. [ ] Write tests for `backtest.ts` (uses `strategy_backtest_runs` seed)
10. [ ] Write tests for `rankings.ts` (uses `daily_metrics`, `daily_picks` seed)
11. [ ] Write tests for `strategyOptimizer.ts` grid-search and walk-forward (uses `strategy_optimizations` seed — new table)
12. [ ] Write tests for `screenerPro.ts` (currently has stub `requirePlan` — now real middleware + mock data)

---

## Architecture Summary

```
globalMocks.ts
├── mockRedisModule          ← already exists, no change needed
├── installDataMocks()       ← vi.mock per-module (installDataMocks + installAdapterMocks)
├── installAIMocks()         ← vi.mock ai/client.ts
└── installGlobalFetch()     ← patch globalThis.fetch (NEW: pattern-map + strict)

mockPlanBypass.ts (NEW)
└── installPlanBypass(plan?) ← vi.spyOn getUserPlan → returns 'pro' or 'premium'

test-seed.ts (EXPANDED)
├── stocks + klines         ← existing
├── users + subscriptions   ← existing (testUser free, proUser has sub)
├── NEW: user_strategies     ← 2 strategies
├── NEW: strategy_backtest_runs ← 3 runs
├── NEW: daily_metrics       ← 4 stocks × today
├── NEW: intraday_alerts     ← 2 alerts
├── NEW: money_flow_realtime ← 1 stock
└── NEW: ai_generated_strategies ← 1 strategy

fixtures/ (NEW directory)
├── eastmoney.ts   ← kline/quote/moneyflow JSON as returned by real API
├── akshare.ts     ← minute kline response
├── baostock.ts    ← minute kline response
└── ai.ts          ← prediction response
```

### Key invariants
- `installPlanBypass` does NOT affect `checkUsage` (quota checking stays real)
- Mock fetch throws on unmocked URLs (strict mode catches missed coverage)
- Seed data uses `ON CONFLICT DO NOTHING` for all inserts (safe to re-run)
- No new dependencies — everything uses existing `vi` from vitest
