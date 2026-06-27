import type { Rule, Condition } from '../../shared/types.js'
import type { MACDResult } from '../indicators/index.js'

export function extractNeededIndicators(rules: Rule[]): Set<string> {
  const needed = new Set<string>()
  for (const rule of rules) {
    for (const c of rule.conditions) {
      needed.add(c.indicator.toLowerCase())
      if (typeof c.value === 'string') needed.add(c.value.toLowerCase())
    }
  }
  return needed
}

export function evaluateCondition(
  val: number,
  prevVal: number,
  threshold: number,
  prevThreshold: number,
  operator: Condition['operator'],
): boolean {
  switch (operator) {
    case '>': return val > threshold
    case '<': return val < threshold
    case '==': return Math.abs(val - threshold) < 0.001
    case 'cross_above': return prevVal <= prevThreshold && val > threshold
    case 'cross_below': return prevVal >= prevThreshold && val < threshold
    default: return false
  }
}

export function getIndicatorValues(
  i: number,
  mas: Record<string, number[]>,
  macd: MACDResult,
  rsi: number[],
  closes: number[],
): Record<string, number> {
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

export function resolveVal(val: number | string, values: Record<string, number>): number {
  if (typeof val === 'number') return val
  return values[val] ?? NaN
}

export function evaluateRules(
  values: Record<string, number>,
  prevValues: Record<string, number>,
  rules: Rule[],
  resolve: (val: number | string, values: Record<string, number>) => number,
): string[] {
  const signals: string[] = []
  for (const rule of rules) {
    const triggered = rule.conditions.every(c => {
      const val = values[c.indicator]
      const prev = prevValues[c.indicator]
      if (isNaN(val) || isNaN(prev)) return false
      const threshold = resolve(c.value, values)
      const prevThreshold = resolve(c.value, prevValues)
      if (isNaN(threshold) || isNaN(prevThreshold)) return false
      return evaluateCondition(val, prev, threshold, prevThreshold, c.operator)
    })
    if (triggered) signals.push(rule.action)
  }
  return signals
}
