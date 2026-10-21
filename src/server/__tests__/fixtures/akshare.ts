/**
 * Realistic akshare API response fixtures.
 * Matches the actual JSON structure returned by akshare APIs.
 */

function makeMinuteKlines(count = 50, basePrice = 1680) {
  const rows: Record<string, string | number>[] = []
  let price = basePrice
  const baseDate = new Date('2024-01-02 09:30:00')
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime() + i * 300000) // 5-min intervals
    const datetime = d.toISOString().replace('T', ' ').slice(0, 19)
    const open = price - 0.5
    const close = price
    const high = price + 1
    const low = price - 1
    const volume = 100000 + i * 1000
    const amount = close * volume
    rows.push({
      datetime,
      open: open.toFixed(2),
      close: close.toFixed(2),
      high: high.toFixed(2),
      low: low.toFixed(2),
      volume: Math.round(volume),
      amount: Math.round(amount),
    })
    price += 0.3
  }
  return rows
}

export const mockAkshareMinuteKlineResponse = {
  '600519': makeMinuteKlines(50, 1680),
  '000001': makeMinuteKlines(50, 12.5),
  '300750': makeMinuteKlines(50, 225),
}

export const mockAkshareRealtimeQuote = {
  '600519': { symbol: '600519', name: '贵州茅台', price: 1680, change_pct: 2.5, volume: 1250000 },
  '000001': { symbol: '000001', name: '平安银行', price: 12.5, change_pct: -0.3, volume: 3500000 },
  '300750': { symbol: '300750', name: '宁德时代', price: 225, change_pct: 5.2, volume: 2800000 },
}
