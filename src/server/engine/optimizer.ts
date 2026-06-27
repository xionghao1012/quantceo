import type { KLine } from '../../shared/types.js'
import { calcRSI, calcMACD, calcMA, calcBollinger } from '../indicators/index.js'

export interface OptimizeParamRange {
  name: string
  min: number
  max: number
  step: number
  default?: number
}

export interface Chromosome {
  genes: Record<string, number>
  fitness: number
}

export interface BacktestMetrics {
  sharpe: number
  maxDrawdown: number
  winRate: number
  totalReturn: number
  tradeCount: number
  equity: number[]
}

export interface OptimizationProgress {
  generation: number
  bestFitness: number
  bestParams: Record<string, number>
  metrics: BacktestMetrics
}

const POPULATION_SIZE = 50
const ELITE_SIZE = 5
const MUTATION_RATE = 0.15
const CROSSOVER_RATE = 0.7

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function createChromosome(ranges: OptimizeParamRange[]): Record<string, number> {
  const genes: Record<string, number> = {}
  for (const range of ranges) {
    const value = randomInRange(range.min, range.max)
    genes[range.name] = roundToStep(value, range.step)
  }
  return genes
}

function createPopulation(ranges: OptimizeParamRange[], size: number): Record<string, number>[] {
  const population: Record<string, number>[] = []
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

function crossover(
  parent1: Record<string, number>,
  parent2: Record<string, number>,
): Record<string, number> {
  const child: Record<string, number> = {}
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

function mutate(genes: Record<string, number>, ranges: OptimizeParamRange[]): Record<string, number> {
  const mutated = { ...genes }
  for (const range of ranges) {
    if (Math.random() < MUTATION_RATE) {
      const delta = (range.max - range.min) * 0.2
      const change = randomInRange(-delta, delta)
      const newValue = roundToStep(mutated[range.name] + change, range.step)
      mutated[range.name] = clamp(newValue, range.min, range.max)
    }
  }
  return mutated
}

function tournamentSelection(
  population: { genes: Record<string, number>; fitness: number }[],
  tournamentSize = 3,
): Record<string, number> {
  let best: { genes: Record<string, number>; fitness: number } | null = null
  for (let i = 0; i < tournamentSize; i++) {
    const idx = Math.floor(Math.random() * population.length)
    const individual = population[idx]
    if (!best || individual.fitness > best.fitness) {
      best = individual
    }
  }
  return best!.genes
}

function backtest(
  klines: KLine[],
  strategyType: string,
  params: Record<string, number>,
): BacktestMetrics {
  if (klines.length < 60) {
    return { sharpe: -999, maxDrawdown: 1, winRate: 0, totalReturn: -1, tradeCount: 0, equity: [10000] }
  }

  const closes = klines.map(k => k.close)
  const equity: number[] = [10000]
  let capital = 10000
  let position = 0
  let shares = 0
  const trades: { entry: number; exit: number; pnl: number }[] = []

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
          trades.push({ entry: (capital - capital) / shares, exit: closes[i], pnl: capital - 10000 })
          shares = 0
          position = 0
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) {
        capital += shares * closes[closes.length - 1]
      }
      break
    }
    case 'macd': {
      const macdResult = calcMACDWithPeriods(
        klines,
        Math.round(params.fastPeriod || 12),
        Math.round(params.slowPeriod || 26),
        Math.round(params.signalPeriod || 9),
      )
      const { macd, signal } = macdResult

      for (let i = 1; i < closes.length; i++) {
        if (macd[i] > signal[i] && macd[i - 1] <= signal[i - 1] && position === 0) {
          shares = Math.floor(capital / closes[i])
          position = 1
          capital -= shares * closes[i]
        } else if (macd[i] < signal[i] && macd[i - 1] >= signal[i - 1] && position === 1) {
          capital += shares * closes[i]
          shares = 0
          position = 0
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) {
        capital += shares * closes[closes.length - 1]
      }
      break
    }
    case 'ma_cross': {
      const maFast = calcMAWithPeriod(klines, Math.round(params.maFast || 5))
      const maSlow = calcMAWithPeriod(klines, Math.round(params.maSlow || 20))

      for (let i = 1; i < closes.length; i++) {
        if (maFast[i] > maSlow[i] && maFast[i - 1] <= maSlow[i - 1] && position === 0) {
          shares = Math.floor(capital / closes[i])
          position = 1
          capital -= shares * closes[i]
        } else if (maFast[i] < maSlow[i] && maFast[i - 1] >= maSlow[i - 1] && position === 1) {
          capital += shares * closes[i]
          shares = 0
          position = 0
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) {
        capital += shares * closes[closes.length - 1]
      }
      break
    }
    case 'bollinger': {
      const bb = calcBollinger(klines, Math.round(params.bbPeriod || 20), params.bbStdDev || 2)
      const { upper, lower } = bb

      for (let i = 1; i < closes.length; i++) {
        if (closes[i] < lower[i] && position === 0) {
          shares = Math.floor(capital / closes[i])
          position = 1
          capital -= shares * closes[i]
        } else if (closes[i] > upper[i] && position === 1) {
          capital += shares * closes[i]
          shares = 0
          position = 0
        }
        capital += shares * (closes[i] - closes[i - 1])
        equity.push(capital)
      }
      if (position === 1) {
        capital += shares * closes[closes.length - 1]
      }
      break
    }
    default:
      equity.push(...closes.slice(1).map((c, i) => equity[i] * (c / closes[i])))
      capital = equity[equity.length - 1]
  }

  const totalReturn = (capital - 10000) / 10000
  const tradeCount = trades.length
  const winningTrades = trades.filter(t => t.pnl > 0).length
  const winRate = tradeCount > 0 ? winningTrades / tradeCount : 0

  const returns: number[] = []
  for (let i = 1; i < equity.length; i++) {
    returns.push((equity[i] - equity[i - 1]) / equity[i - 1])
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const stdReturn = Math.sqrt(
    returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length || 1)
  )
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

function calcRSIWithPeriod(klines: KLine[], period: number): number[] {
  const closes = klines.map(k => k.close)
  const rsi: number[] = new Array(closes.length).fill(NaN)
  if (closes.length < period + 1) return rsi

  let gains = 0
  let losses = 0
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

function calcMACDWithPeriods(
  klines: KLine[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const closes = klines.map(k => k.close)
  const emaFast = calcEMA(closes, fastPeriod)
  const emaSlow = calcEMA(closes, slowPeriod)
  const macd: number[] = new Array(closes.length).fill(NaN)
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
      macd[i] = emaFast[i] - emaSlow[i]
    }
  }
  const signal = calcEMA(macd.filter(v => !isNaN(v)), signalPeriod)
  const signalFilled: number[] = new Array(closes.length).fill(NaN)
  let sigIdx = 0
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(macd[i])) {
      signalFilled[i] = signal[sigIdx++] ?? NaN
    }
  }
  const histogram = macd.map((v, i) => v - signalFilled[i])
  return { macd, signal: signalFilled, histogram }
}

function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = new Array(data.length).fill(NaN)
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

function calcMAWithPeriod(klines: KLine[], period: number): number[] {
  const closes = klines.map(k => k.close)
  const ma: number[] = new Array(closes.length).fill(NaN)
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

function fitnessFunction(metrics: BacktestMetrics): number {
  const sharpeWeight = 2.0
  const returnWeight = 1.5
  const drawdownPenalty = 3.0
  const winRateWeight = 0.5

  if (metrics.sharpe === -999) return -999

  const score =
    metrics.sharpe * sharpeWeight +
    metrics.totalReturn * returnWeight -
    metrics.maxDrawdown * drawdownPenalty +
    metrics.winRate * winRateWeight

  return Math.round(score * 100) / 100
}

export async function optimize(
  klines: KLine[],
  strategyType: string,
  paramRanges: OptimizeParamRange[],
  options: {
    populationSize?: number
    generations?: number
    onProgress?: (progress: OptimizationProgress) => void
  } = {},
): Promise<{ bestParams: Record<string, number>; bestFitness: number; metrics: BacktestMetrics; history: OptimizationProgress[] }> {
  const populationSize = options.populationSize || POPULATION_SIZE
  const totalGenerations = options.generations || 30

  const initialPop = createPopulation(paramRanges, populationSize)
  let population: { genes: Record<string, number>; fitness: number }[] = initialPop.map(genes => {
    const metrics = backtest(klines, strategyType, genes)
    return { genes, fitness: fitnessFunction(metrics) }
  })

  population.sort((a, b) => b.fitness - a.fitness)
  const history: OptimizationProgress[] = []

  for (let gen = 0; gen < totalGenerations; gen++) {
    const newPopulation: { genes: Record<string, number>; fitness: number }[] = []

    for (let i = 0; i < ELITE_SIZE; i++) {
      newPopulation.push(population[i])
    }

    while (newPopulation.length < populationSize) {
      const parent1 = tournamentSelection(population)
      const parent2 = tournamentSelection(population)
      let child = Math.random() < CROSSOVER_RATE ? crossover(parent1, parent2) : { ...parent1 }
      child = mutate(child, paramRanges)
      const metrics = backtest(klines, strategyType, child)
      newPopulation.push({ genes: child, fitness: fitnessFunction(metrics) })
    }

    population = newPopulation
    population.sort((a, b) => b.fitness - a.fitness)

    const best = population[0]
    const bestMetrics = backtest(klines, strategyType, best.genes)
    const progress: OptimizationProgress = {
      generation: gen + 1,
      bestFitness: best.fitness,
      bestParams: best.genes,
      metrics: bestMetrics,
    }
    history.push(progress)

    if (options.onProgress) {
      options.onProgress(progress)
    }
  }

  const best = population[0]
  const finalMetrics = backtest(klines, strategyType, best.genes)

  return {
    bestParams: best.genes,
    bestFitness: best.fitness,
    metrics: finalMetrics,
    history,
  }
}
