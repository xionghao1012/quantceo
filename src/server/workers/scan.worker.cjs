const { parentPort } = require('worker_threads')

function sma(values, period) {
  const result = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    result.push(sum / period)
  }
  return result
}

function ema(values, period) {
  const result = []
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(values[0]); continue }
    result.push(values[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function rma(values, period) {
  const result = []
  const alpha = 1 / period
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(values[0]); continue }
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1])
  }
  return result
}

function calcMA(klines, periods) {
  periods = periods || [5, 10, 20, 60]
  const closes = klines.map(k => k.close)
  const result = {}
  for (const p of periods) result[`MA${p}`] = sma(closes, p)
  return result
}

function calcMACD(klines) {
  const closes = klines.map(k => k.close)
  const fastEma = ema(closes, 12)
  const slowEma = ema(closes, 26)
  const macdLine = fastEma.map((v, i) => v - slowEma[i])
  const signalLine = ema(macdLine, 9)
  const histogram = macdLine.map((v, i) => v - signalLine[i])
  return { macd: macdLine, signal: signalLine, histogram }
}

function calcRSI(klines, period) {
  period = period || 14
  const closes = klines.map(k => k.close)
  const changes = [0]
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1])
  const gains = changes.map(c => c > 0 ? c : 0)
  const losses = changes.map(c => c < 0 ? -c : 0)
  const avgGain = rma(gains, period)
  const avgLoss = rma(losses, period)
  return avgGain.map((g, i) => {
    if (avgLoss[i] === 0) return 100
    return 100 - (100 / (1 + g / avgLoss[i]))
  })
}

function evaluateCondition(val, prevVal, threshold, prevThreshold, operator) {
  switch (operator) {
    case '>': return val > threshold
    case '<': return val < threshold
    case '==': return Math.abs(val - threshold) < 0.001
    case 'cross_above': return prevVal <= prevThreshold && val > threshold
    case 'cross_below': return prevVal >= prevThreshold && val < threshold
    default: return false
  }
}

function resolveVal(val, values) {
  if (typeof val === 'number') return val
  return values[val] ?? NaN
}

function extractNeededIndicators(rules) {
  const needed = new Set()
  for (const rule of rules) {
    for (const c of rule.conditions) {
      needed.add(c.indicator.toLowerCase())
      if (typeof c.value === 'string') needed.add(c.value.toLowerCase())
    }
  }
  return needed
}

function scanStock(code, name, klines, customRules, customRuleName, needed) {
  if (klines.length < 100) return null

  const closes = klines.map(k => k.close)
  let mas = {}, macd, rsi

  if (needed && needed.size > 0) {
    const periods = []
    for (const ind of needed) {
      const m = ind.match(/^ma(\d+)$/i)
      if (m) periods.push(Number(m[1]))
    }
    mas = calcMA(klines, periods.length ? [...new Set(periods)] : [])
    macd = calcMACD(klines)
    rsi = calcRSI(klines)
  } else {
    mas = calcMA(klines)
    macd = calcMACD(klines)
    rsi = calcRSI(klines)
  }

  const lastIdx = klines.length - 1
  const prevIdx = lastIdx - 1
  if (lastIdx < 0 || prevIdx < 0) return null

  function valuesAt(i) {
    return {
      ma5: mas['MA5']?.[i] ?? NaN,
      ma10: mas['MA10']?.[i] ?? NaN,
      ma20: mas['MA20']?.[i] ?? NaN,
      ma60: mas['MA60']?.[i] ?? NaN,
      macd: macd.macd[i] ?? NaN,
      macdSignal: macd.signal[i] ?? NaN,
      macdHistogram: macd.histogram[i] ?? NaN,
      rsi: rsi[i] ?? NaN,
      close: closes[i] ?? NaN,
    }
  }

  const v = valuesAt(lastIdx)
  const p = valuesAt(prevIdx)
  const signals = []

  if (customRules && customRules.length > 0) {
    for (const rule of customRules) {
      const triggered = rule.conditions.every(c => {
        const val = v[c.indicator]
        const prev = p[c.indicator]
        if (isNaN(val) || isNaN(prev)) return false
        const threshold = resolveVal(c.value, v)
        const prevThreshold = resolveVal(c.value, p)
        if (isNaN(threshold) || isNaN(prevThreshold)) return false
        return evaluateCondition(val, prev, threshold, prevThreshold, c.operator)
      })
      if (triggered) {
        signals.push({
          strategyId: 999,
          strategyName: customRuleName || '自定义策略',
          direction: rule.action,
          strength: 75,
        })
      }
    }
  } else {
    const strategies = [
      { id: 1, name: 'MA5/20 金叉', check: (vv, pp) => !isNaN(vv.ma5) && !isNaN(vv.ma20) && pp.ma5 <= pp.ma20 && vv.ma5 > vv.ma20, strength: 70 },
      { id: 1, name: 'MA5/20 死叉', check: (vv, pp) => !isNaN(vv.ma5) && !isNaN(vv.ma20) && pp.ma5 >= pp.ma20 && vv.ma5 < vv.ma20, strength: 70 },
      { id: 2, name: 'MA10/60 金叉', check: (vv, pp) => !isNaN(vv.ma10) && !isNaN(vv.ma60) && pp.ma10 <= pp.ma60 && vv.ma10 > vv.ma60, strength: 80 },
      { id: 2, name: 'MA10/60 死叉', check: (vv, pp) => !isNaN(vv.ma10) && !isNaN(vv.ma60) && pp.ma10 >= pp.ma60 && vv.ma10 < vv.ma60, strength: 80 },
      { id: 3, name: 'MACD 金叉', check: (vv, pp) => !isNaN(vv.macd) && !isNaN(vv.macdSignal) && pp.macd <= pp.macdSignal && vv.macd > vv.macdSignal, strength: 60 },
      { id: 3, name: 'MACD 死叉', check: (vv, pp) => !isNaN(vv.macd) && !isNaN(vv.macdSignal) && pp.macd >= pp.macdSignal && vv.macd < vv.macdSignal, strength: 60 },
      { id: 4, name: 'RSI 超卖', check: (vv) => !isNaN(vv.rsi) && vv.rsi < 30, strength: 50 },
      { id: 4, name: 'RSI 超买', check: (vv) => !isNaN(vv.rsi) && vv.rsi > 70, strength: 50 },
    ]
    for (const strat of strategies) {
      if (strat.check(v, p)) {
        const direction = strat.name.includes('金叉') || strat.name.includes('超卖') ? 'BUY' : 'SELL'
        signals.push({ strategyId: strat.id, strategyName: strat.name, direction, strength: strat.strength })
      }
    }
  }

  if (signals.length === 0) return null
  const totalStrength = signals.reduce((s, sig) => s + (sig.direction === 'BUY' ? sig.strength : -sig.strength), 0)
  return { code, name, price: klines[lastIdx].close, signals, totalStrength }
}

parentPort.on('message', (msg) => {
  const { id, code, name, klines, customRules, customRuleName, neededIndicators } = msg
  try {
    const needed = neededIndicators ? new Set(neededIndicators) : null
    const result = scanStock(code, name, klines, customRules, customRuleName, needed)
    parentPort.postMessage({ id, code, result })
  } catch (e) {
    parentPort.postMessage({ id, code, result: null, error: e.message })
  }
})