/**
 * Realistic eastmoney API response fixtures.
 * Matches the actual JSON structure returned by eastmoney.com APIs.
 */

// ── Kline fixture ────────────────────────────────────────────────
function makeKlineRows(count = 30, basePrice = 1680) {
  const rows: string[][] = []
  let price = basePrice
  const baseDate = new Date('2024-01-02')
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() + i)
    const date = d.toISOString().slice(0, 10)
    const open = (price - 0.5).toFixed(2)
    const close = price.toFixed(2)
    const high = (price + 1).toFixed(2)
    const low = (price - 1).toFixed(2)
    const volume = (1000000 + i * 10000).toString()
    const amount = (price * 1000000).toString()
    rows.push([date, open, close, high, low, volume, amount])
    price += 0.3
  }
  return rows
}

export const mockEastmoneyKlineResponse = {
  code: 0,
  data: {
    'sh600519': { qfqday: makeKlineRows(30, 1680) },
    'sz000001': { qfqday: makeKlineRows(30, 12.5) },
    'sz300750': { qfqday: makeKlineRows(30, 225) },
    'sh688981': { qfqday: makeKlineRows(30, 48) },
    'sz002475': { qfqday: makeKlineRows(30, 28) },
  },
}

// ── Stock quote fixture ──────────────────────────────────────────
export const mockEastmoneyQuoteResponse = {
  '600519': { name: '贵州茅台', price: 1680, change_pct: 2.5, change_abs: 41.02, volume: 1250000, amount: 2100000000, high: 1695, low: 1645, open: 1650, close_prev: 1638.98 },
  '000001': { name: '平安银行', price: 12.5, change_pct: -0.3, change_abs: -0.04, volume: 3500000, amount: 43500000, high: 12.6, low: 12.4, open: 12.55, close_prev: 12.54 },
  '300750': { name: '宁德时代', price: 225, change_pct: 5.2, change_abs: 11.11, volume: 2800000, amount: 630000000, high: 228, low: 215, open: 218, close_prev: 213.89 },
  '688981': { name: '中芯国际', price: 48, change_pct: 3.1, change_abs: 1.44, volume: 1800000, amount: 86400000, high: 49, low: 47, open: 47.5, close_prev: 46.56 },
  '002475': { name: '立讯精密', price: 28, change_pct: -1.2, change_abs: -0.34, volume: 2200000, amount: 61600000, high: 28.5, low: 27.8, open: 28.4, close_prev: 28.34 },
}

// ── Money flow fixture ───────────────────────────────────────────
export const mockEastmoneyMoneyFlowResponse = {
  '600519': {
    netInflowMain: 50000000,
    netInflowLarge: 200000000,
    netInflowSuperLarge: 100000000,
    netInflowMedium: -150000000,
    netInflowSmall: -100000000,
    netInflowMainPct: 3.5,
    changePct: 2.5,
  },
  '000001': {
    netInflowMain: -20000000,
    netInflowLarge: -50000000,
    netInflowSuperLarge: -30000000,
    netInflowMedium: 20000000,
    netInflowSmall: 80000000,
    netInflowMainPct: -1.2,
    changePct: -0.3,
  },
}

// ── Search stocks fixture ────────────────────────────────────────
export const mockEastmoneySearchResponse = [
  { code: '600519', name: '贵州茅台', market: 'SH', type: 'stock' },
  { code: '000001', name: '平安银行', market: 'SZ', type: 'stock' },
  { code: '300750', name: '宁德时代', market: 'SZ', type: 'stock' },
]
