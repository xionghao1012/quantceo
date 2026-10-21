/**
 * Realistic baostock API response fixtures.
 */
function makeBaostockMinuteKlines(count = 50, basePrice = 1680) {
  const rows: Record<string, string | number>[] = []
  let price = basePrice
  const baseDate = new Date('2024-01-02 09:30:00')
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime() + i * 300000)
    const datetime = d.toISOString().replace('T', ' ').slice(0, 19)
    const open = price - 0.5
    const close = price
    const high = price + 1
    const low = price - 1
    const volume = 100000 + i * 1000
    rows.push({
      code: '600519.SH',
      datetime,
      open: open.toFixed(2),
      close: close.toFixed(2),
      high: high.toFixed(2),
      low: low.toFixed(2),
      volume: Math.round(volume),
      amount: Math.round(close * volume),
    })
    price += 0.3
  }
  return rows
}

export const mockBaostockMinuteKlineResponse = {
  '600519': makeBaostockMinuteKlines(50, 1680),
  '000001': makeBaostockMinuteKlines(50, 12.5),
}
