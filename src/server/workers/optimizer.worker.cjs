const { parentPort } = require('worker_threads')

let klines, strategyType, paramRanges, populationSize, generations, taskId

parentPort.on('message', (msg) => {
  klines = msg.klines
  strategyType = msg.strategyType
  paramRanges = msg.paramRanges
  populationSize = msg.populationSize || 50
  generations = msg.generations || 30
  taskId = msg.taskId

function randomInRange(min, max) {
  return Math.random() * (max - min) + min
}

function roundToStep(value, step) {
  return Math.round(value / step) * step
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function createChromosome(ranges) {
  const genes = {}
  for (const range of ranges) {
    const value = randomInRange(range.min, range.max)
    genes[range.name] = roundToStep(value, range.step)
  }
  return genes
}

function createPopulation(ranges, size) {
  const population = []
  for (const range of ranges) {
    if (range.default !== undefined) {
      population.push({ [range.name]: range.default })
    }
  }
  while (population.length < size) {
    population.push(createChromosome(ranges))
  }
  return population
}

function crossover(parent1, parent2) {
  const child = {}
  const keys = Object.keys(parent1)
  for (const key of keys) {
    if (Math.random() < 0.5) {
      child[key] = parent1[key]
    } else {
      child[key] = parent2[key]
    }
  }
  return child
}

function mutate(genes, ranges) {
  const mutated = { ...genes }
  for (const range of ranges) {
    if (Math.random() < 0.15) {
      const delta = (range.max - range.min) * 0.2
      const change = randomInRange(-delta, delta)
      const newValue = roundToStep(mutated[range.name] + change, range.step)
      mutated[range.name] = clamp(newValue, range.min, range.max)
    }
  }
  return mutated
}

function tournamentSelection(population, tournamentSize = 3) {
  let best = null
  for (let i = 0; i < tournamentSize; i++) {
    const idx = Math.floor(Math.random() * population.length)
    const individual = population[idx]
    if (!best || individual.fitness > best.fitness) {
      best = individual
    }
  }
  return best.genes
}

function calcEMA(data, period) {
  const ema = new Array(data.length).fill(NaN)
  if (data.length < period) return ema
  const multiplier = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += data[i]
  ema[period - 1] = sum / period
  for (let i = period; i < data.length; i++) {
    ema[i] = (data[i] - ema[i - 1]) * multiplier + ema[i - 1]
  }
  return ema
}

function calcMAWithPeriod(klines, period) {
  const closes = klines.map(k => k.close)
  const ma = new Array(closes.length).fill(NaN)
  if (closes.length < period) return ma
  let sum = 0
  for (let i = 0; i < period; i++) sum += closes[i]
  ma[period - 1] = sum / period
  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period]
    ma[i] = sum / period
  }
  return ma
}

function calcRSIWithPeriod(klines, period) {
  const closes = klines.map(k => k.close)
  const rsi = new Array(closes.length).fill(NaN)
  if (closes.length < period + 1) return rsi

  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

function calcBollingerBands(klines, period, stdDev) {
  const closes = klines.map(k => k.close)
  const upper = new Array(closes.length).fill(NaN)
  const middle = new Array(closes.length).fill(NaN)
  const lower = new Array(closes.length).fill(NaN)

  if (closes.length < period) return { upper, middle, lower }

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]
    const sma = sum / period
    middle[i] = sma
    let sqSum = 0
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - sma) ** 2
    const sd = Math.sqrt(sqSum / period)
    upper[i] = sma + stdDev * sd
    lower[i] = sma - stdDev * sd
  }
  return { upper, middle, lower }
}

function backtest(klines, strategyType, params) {
  if (klines.length < 60) {
    return { sharpe: -999, maxDrawdown: 1, winRate: 0, totalReturn: -1, tradeCount: 0, equity: [10000] }
  }

  const closes = klines.map(k => k.close)
  let equity = [10000]
  let capital = 10000
  let position = 0
  let shares = 0
  const trades = []

  switch (strategyType) {
    case 'rsi': {
      const rsi = calcRSIWithPeriod(klines, Math.round(params.rsiPeriod || 14))
      const oversold = params.oversold || 30
      const overbought = params.overbought || 70

      for (let i = 1; i < closes.length; i++) {
        if (rsi[i] < oversold && position === 0) {
          shares = Math.floor(capital / closes[i])
          position = 1
          capital -= shares * closes[i]
        } else if (rsi[i] > overbought && position === 1) {
          capital += shares * closes[i]
          trades.push({ entry: 0, exit: closes[i], pnl: capital - 10000 })
          shares = 0
          position = 0
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) capital += shares * closes[closes.length - 1]
      break
    }
    case 'macd': {
      const fastEMA = calcEMA(closes, Math.round(params.fastPeriod || 12))
      const slowEMA = calcEMA(closes, Math.round(params.slowPeriod || 26))
      const macd = fastEMA.map((v, i) => v - slowEMA[i])
      const signal = calcEMA(macd.filter(v => !isNaN(v)), Math.round(params.signalPeriod || 9))
      let sigIdx = 0
      const signalFilled = macd.map(v => isNaN(v) ? NaN : signal[sigIdx++] ?? NaN)

      for (let i = 1; i < closes.length; i++) {
        if (!isNaN(macd[i]) && !isNaN(signalFilled[i]) && !isNaN(macd[i - 1]) && !isNaN(signalFilled[i - 1])) {
          if (macd[i] > signalFilled[i] && macd[i - 1] <= signalFilled[i - 1] && position === 0) {
            shares = Math.floor(capital / closes[i])
            position = 1
            capital -= shares * closes[i]
          } else if (macd[i] < signalFilled[i] && macd[i - 1] >= signalFilled[i - 1] && position === 1) {
            capital += shares * closes[i]
            trades.push({ entry: 0, exit: closes[i], pnl: capital - 10000 })
            shares = 0
            position = 0
          }
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) capital += shares * closes[closes.length - 1]
      break
    }
    case 'ma_cross': {
      const maFast = calcMAWithPeriod(klines, Math.round(params.maFast || 5))
      const maSlow = calcMAWithPeriod(klines, Math.round(params.maSlow || 20))

      for (let i = 1; i < closes.length; i++) {
        if (!isNaN(maFast[i]) && !isNaN(maSlow[i]) && !isNaN(maFast[i - 1]) && !isNaN(maSlow[i - 1])) {
          if (maFast[i] > maSlow[i] && maFast[i - 1] <= maSlow[i - 1] && position === 0) {
            shares = Math.floor(capital / closes[i])
            position = 1
            capital -= shares * closes[i]
          } else if (maFast[i] < maSlow[i] && maFast[i - 1] >= maSlow[i - 1] && position === 1) {
            capital += shares * closes[i]
            trades.push({ entry: 0, exit: closes[i], pnl: capital - 10000 })
            shares = 0
            position = 0
          }
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) capital += shares * closes[closes.length - 1]
      break
    }
    case 'bollinger': {
      const bb = calcBollingerBands(klines, Math.round(params.bbPeriod || 20), params.bbStdDev || 2)
      const { upper, lower } = bb

      for (let i = 1; i < closes.length; i++) {
        if (!isNaN(lower[i]) && closes[i] < lower[i] && position === 0) {
          shares = Math.floor(capital / closes[i])
          position = 1
          capital -= shares * closes[i]
        } else if (!isNaN(upper[i]) && closes[i] > upper[i] && position === 1) {
          capital += shares * closes[i]
          trades.push({ entry: 0, exit: closes[i], pnl: capital - 10000 })
          shares = 0
          position = 0
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) capital += shares * closes[closes.length - 1]
      break
    }
    default:
      equity = closes.map((c, i) => 10000 * (c / closes[0]))
      capital = equity[equity.length - 1]
  }

  const totalReturn = (capital - 10000) / 10000
  const tradeCount = trades.length
  const winningTrades = trades.filter(t => t.pnl > 0).length
  const winRate = tradeCount > 0 ? winningTrades / tradeCount : 0

  const returns = []
  for (let i = 1; i < equity.length; i++) {
    returns.push((equity[i] - equity[i - 1]) / equity[i - 1])
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length || 1))
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : -999

  let maxDrawdown = 0
  let peak = equity[0]
  for (const value of equity) {
    if (value > peak) peak = value
    const dd = (peak - value) / peak
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return {
    sharpe: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    winRate: Math.round(winRate * 10000) / 100,
    totalReturn: Math.round(totalReturn * 10000) / 100,
    tradeCount,
    equity: equity.map(Math.round),
  }
}

function fitnessFunction(metrics) {
  if (metrics.sharpe === -999) return -999
  return (
    metrics.sharpe * 2.0 +
    metrics.totalReturn * 1.5 -
    metrics.maxDrawdown * 3.0 +
    metrics.winRate * 0.5
  )
}

const POPULATION_SIZE = populationSize
const TOTAL_GENERATIONS = generations
const ELITE_SIZE = 5

const initialPop = createPopulation(paramRanges, POPULATION_SIZE)
let population = initialPop.map(genes => {
  const metrics = backtest(klines, strategyType, genes)
  return { genes, fitness: fitnessFunction(metrics) }
})

population.sort((a, b) => b.fitness - a.fitness)
const history = []

for (let gen = 0; gen < TOTAL_GENERATIONS; gen++) {
  const newPopulation = []

  for (let i = 0; i < ELITE_SIZE; i++) {
    newPopulation.push(population[i])
  }

  while (newPopulation.length < POPULATION_SIZE) {
    const parent1 = tournamentSelection(population)
    const parent2 = tournamentSelection(population)
    let child = Math.random() < 0.7 ? crossover(parent1, parent2) : { ...parent1 }
    child = mutate(child, paramRanges)
    const metrics = backtest(klines, strategyType, child)
    newPopulation.push({ genes: child, fitness: fitnessFunction(metrics) })
  }

  population = newPopulation
  population.sort((a, b) => b.fitness - a.fitness)

  const best = population[0]
  const bestMetrics = backtest(klines, strategyType, best.genes)

  parentPort.postMessage({
    taskId,
    type: 'progress',
    generation: gen + 1,
    totalGenerations: TOTAL_GENERATIONS,
    bestFitness: best.fitness,
    bestParams: best.genes,
    metrics: bestMetrics,
  })

  history.push({
    generation: gen + 1,
    fitness: best.fitness,
    params: { ...best.genes },
  })
}

const best = population[0]
const finalMetrics = backtest(klines, strategyType, best.genes)

parentPort.postMessage({
  taskId,
  type: 'complete',
  bestParams: best.genes,
  bestFitness: best.fitness,
  metrics: finalMetrics,
  history,
})
})
