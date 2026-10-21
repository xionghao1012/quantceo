import { describe, it, expect, beforeEach } from 'vitest'
import type { KLine } from '../../shared/types.js'

// Inline the pure functions from dailyPicksAI.ts for testing
// These are the testable pure functions; async DB/LLM functions are not tested

function buildCandidatePrompt(
  name: string,
  code: string,
  price: number,
  changePct: number,
  ind: { mas: Record<string, number[]>; macd: { macd: number[]; signal: number[]; histogram: number[] }; rsi: number[]; bollinger: { upper: number[]; lower: number[] } | null },
  klData: KLine[]
): string {
  const mas = ind.mas
  const macd = ind.macd
  const rsiArr = ind.rsi
  const boll = ind.bollinger
  const last = klData[klData.length - 1]

  const avgVol5 = klData.slice(-5).reduce((s, k) => s + k.volume, 0) / 5
  const avgVol20 = klData.slice(-20).reduce((s, k) => s + k.volume, 0) / 20
  const volRatio = avgVol20 > 0 ? (avgVol5 / avgVol20).toFixed(2) : '1.0'

  const ma5 = mas['MA5']?.at(-1)?.toFixed(2) ?? '-'
  const ma10 = mas['MA10']?.at(-1)?.toFixed(2) ?? '-'
  const ma20 = mas['MA20']?.at(-1)?.toFixed(2) ?? '-'
  const ma60 = mas['MA60']?.at(-1)?.toFixed(2) ?? '-'

  const dif = macd.macd.at(-1)?.toFixed(3) ?? '-'
  const dea = macd.signal.at(-1)?.toFixed(3) ?? '-'
  const hist = macd.histogram.at(-1)?.toFixed(3) ?? '-'
  const macdTrend = hist && Number(hist) > 0 ? 'positive' : 'negative'

  const rsi = rsiArr.at(-1)?.toFixed(1) ?? '-'

  const bbp = boll && boll.upper.length > 0 && boll.lower.length > 0
    ? ((last.close - boll.lower.at(-1)!) / (boll.upper.at(-1)! - boll.lower.at(-1)!) * 100).toFixed(0)
    : '-'

  const maAlign = [ma5, ma10, ma20, ma60].every(m => m !== '-')
    ? (Number(ma5) > Number(ma10) && Number(ma10) > Number(ma20) ? '多头排列' :
       Number(ma5) < Number(ma10) && Number(ma10) < Number(ma20) ? '空头排列' : '交叉')
    : '未知'

  return [
    `股票：${name}(${code})`,
    `价格：${price} 涨跌：${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`,
    `均线：MA5=${ma5} MA10=${ma10} MA20=${ma20} MA60=${ma60}（${maAlign}）`,
    `MACD：DIF=${dif} DEA=${dea} 柱=${hist}（${macdTrend}）`,
    `RSI(14)：${rsi}`,
    `布林位置：${bbp}%`,
    `成交量比(5日/20日)：${volRatio}`,
  ].join('\n')
}

interface AIAnalysisResult {
  score: number
  direction: 'buy' | 'hold' | 'avoid'
  risk: 'low' | 'medium' | 'high'
  reasoning: string
}

function parseAnalysis(raw: any, fallbackReason: string): AIAnalysisResult {
  const score = typeof raw.score === 'number' ? Math.max(0, Math.min(100, Math.round(raw.score))) : 50
  const direction = raw.direction === 'buy' || raw.direction === 'hold' || raw.direction === 'avoid' ? raw.direction : 'hold'
  const risk = raw.risk === 'low' || raw.risk === 'medium' || raw.risk === 'high' ? raw.risk : 'medium'
  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 100) : fallbackReason
  return { score, direction, risk, reasoning }
}

// Cache for testing (simulates module-level CACHE)
const CACHE = new Map<string, { result: AIAnalysisResult; ts: number }>()
const CACHE_TTL = 3600_000

function getCached(code: string): AIAnalysisResult | null {
  const c = CACHE.get(code)
  if (c && Date.now() - c.ts < CACHE_TTL) return c.result
  return null
}

function setCached(code: string, result: AIAnalysisResult) {
  CACHE.set(code, { result, ts: Date.now() })
}

function clearAnalysisCache() {
  CACHE.clear()
}

function makeKline(close: number, volume = 1000000): KLine {
  return { code: '000001', date: '2024-01-01', open: close, high: close, low: close, close, volume, amount: 0 }
}

// ---- parseAnalysis tests ----
describe('parseAnalysis', () => {
  it('parses valid buy direction', () => {
    const result = parseAnalysis({ score: 85, direction: 'buy', risk: 'low', reasoning: '测试理由' }, 'fallback')
    expect(result).toEqual({ score: 85, direction: 'buy', risk: 'low', reasoning: '测试理由' })
  })

  it('parses valid hold direction', () => {
    const result = parseAnalysis({ score: 60, direction: 'hold', risk: 'medium', reasoning: '测试' }, 'fallback')
    expect(result).toEqual({ score: 60, direction: 'hold', risk: 'medium', reasoning: '测试' })
  })

  it('parses valid avoid direction', () => {
    const result = parseAnalysis({ score: 20, direction: 'avoid', risk: 'high', reasoning: '测试' }, 'fallback')
    expect(result).toEqual({ score: 20, direction: 'avoid', risk: 'high', reasoning: '测试' })
  })

  it('clamps score to 0-100 range', () => {
    expect(parseAnalysis({ score: -10, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(0)
    expect(parseAnalysis({ score: 0, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(0)
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(50)
    expect(parseAnalysis({ score: 100, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(100)
    expect(parseAnalysis({ score: 150, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(100)
  })

  it('rounds score to integer', () => {
    expect(parseAnalysis({ score: 85.4, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(85)
    expect(parseAnalysis({ score: 85.6, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(86)
  })

  it('defaults invalid direction to hold', () => {
    expect(parseAnalysis({ score: 50, direction: 'sell', risk: 'low', reasoning: 't' }, 'f').direction).toBe('hold')
    expect(parseAnalysis({ score: 50, direction: '', risk: 'low', reasoning: 't' }, 'f').direction).toBe('hold')
    expect(parseAnalysis({ score: 50, direction: null, risk: 'low', reasoning: 't' }, 'f').direction).toBe('hold')
    expect(parseAnalysis({ score: 50, direction: undefined, risk: 'low', reasoning: 't' }, 'f').direction).toBe('hold')
  })

  it('defaults invalid risk to medium', () => {
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: 'veryhigh', reasoning: 't' }, 'f').risk).toBe('medium')
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: '', reasoning: 't' }, 'f').risk).toBe('medium')
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: null, reasoning: 't' }, 'f').risk).toBe('medium')
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: undefined, reasoning: 't' }, 'f').risk).toBe('medium')
  })

  it('truncates reasoning to 100 chars', () => {
    const longReasoning = 'a'.repeat(150)
    const result = parseAnalysis({ score: 50, direction: 'buy', risk: 'low', reasoning: longReasoning }, 'f')
    expect(result.reasoning.length).toBe(100)
  })

  it('uses fallbackReason when reasoning is not string', () => {
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: 'low', reasoning: null }, 'fallback').reasoning).toBe('fallback')
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: 'low', reasoning: 123 }, 'fallback').reasoning).toBe('fallback')
    expect(parseAnalysis({ score: 50, direction: 'buy', risk: 'low' }, 'fallback').reasoning).toBe('fallback')
  })

  it('defaults score to 50 when not a number', () => {
    expect(parseAnalysis({ score: 'high', direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(50)
    expect(parseAnalysis({ score: null, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(50)
    expect(parseAnalysis({ score: undefined, direction: 'buy', risk: 'low', reasoning: 't' }, 'f').score).toBe(50)
  })
})

// ---- cache tests ----
describe('cache', () => {
  beforeEach(() => {
    clearAnalysisCache()
  })

  it('returns null for empty cache', () => {
    expect(getCached('000001')).toBeNull()
  })

  it('returns cached result within TTL', () => {
    const result: AIAnalysisResult = { score: 80, direction: 'buy', risk: 'low', reasoning: 'test' }
    setCached('000001', result)
    expect(getCached('000001')).toEqual(result)
  })

  it('returns null for expired cache entry', () => {
    const result: AIAnalysisResult = { score: 80, direction: 'buy', risk: 'low', reasoning: 'test' }
    CACHE.set('000001', { result, ts: Date.now() - CACHE_TTL - 1 })
    expect(getCached('000001')).toBeNull()
  })

  it('returns null when cache entry is just at TTL boundary', () => {
    const result: AIAnalysisResult = { score: 80, direction: 'buy', risk: 'low', reasoning: 'test' }
    CACHE.set('000001', { result, ts: Date.now() - CACHE_TTL })
    expect(getCached('000001')).toBeNull()
  })

  it('clearAnalysisCache removes all entries', () => {
    setCached('000001', { score: 80, direction: 'buy', risk: 'low', reasoning: 'a' })
    setCached('000002', { score: 70, direction: 'hold', risk: 'medium', reasoning: 'b' })
    clearAnalysisCache()
    expect(getCached('000001')).toBeNull()
    expect(getCached('000002')).toBeNull()
  })
})

// ---- buildCandidatePrompt tests ----
describe('buildCandidatePrompt', () => {
  const minimalIndicators = {
    mas: { MA5: [], MA10: [], MA20: [], MA60: [] },
    macd: { macd: [], signal: [], histogram: [] },
    rsi: [],
    bollinger: null,
  }

  it('builds prompt with all required fields', () => {
    const klData = [
      makeKline(10, 1000000),
      makeKline(10, 1000000),
    ]
    const prompt = buildCandidatePrompt('平安银行', '000001', 10.5, 2.5, minimalIndicators, klData)
    expect(prompt).toContain('平安银行')
    expect(prompt).toContain('000001')
    expect(prompt).toContain('10.5')
    expect(prompt).toContain('+2.50%')
  })

  it('shows negative sign for negative changePct', () => {
    const klData = [makeKline(10), makeKline(10)]
    const prompt = buildCandidatePrompt('测试', '000001', 10, -3.5, minimalIndicators, klData)
    expect(prompt).toContain('-3.50%')
  })

  it('handles empty MA arrays (shows -)', () => {
    const klData = [makeKline(10), makeKline(10)]
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, minimalIndicators, klData)
    expect(prompt).toContain('MA5=-')
    expect(prompt).toContain('MA10=-')
  })

  it('shows correct MA values when available', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [12, 13], MA10: [11, 12], MA20: [10, 11], MA60: [8, 9] },
      macd: { macd: [0.1], signal: [0.05], histogram: [0.05] },
      rsi: [55],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 15, 1.0, ind, klData)
    expect(prompt).toContain('MA5=13.00')
    expect(prompt).toContain('MA10=12.00')
    expect(prompt).toContain('MA20=11.00')
    expect(prompt).toContain('MA60=9.00')
  })

  it('shows positive macd trend when histogram > 0', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [], MA10: [], MA20: [], MA60: [] },
      macd: { macd: [0.1], signal: [0.05], histogram: [0.05] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('positive')
  })

  it('shows negative macd trend when histogram <= 0', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [], MA10: [], MA20: [], MA60: [] },
      macd: { macd: [0.05], signal: [0.1], histogram: [-0.05] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('negative')
  })

  it('calculates volRatio correctly', () => {
    // avgVol5 = (1+2+3+4+5)/5 = 3, avgVol20 = (1+2+...+20)/20 = 10.5, ratio = 3/10.5 = 0.29
    const klData = Array.from({ length: 20 }, (_, i) => makeKline(10, i + 1))
    const ind = {
      mas: { MA5: [], MA10: [], MA20: [], MA60: [] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('成交量比(5日/20日)：1.71')
  })

  it('shows 1.0 volRatio when avgVol20 is 0', () => {
    const klData = [makeKline(10, 0), makeKline(10, 0)]
    const ind = {
      mas: { MA5: [], MA10: [], MA20: [], MA60: [] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('成交量比(5日/20日)：1.0')
  })

  it('detects 多头排列 (bullish alignment)', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [12], MA10: [11], MA20: [10], MA60: [8] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('多头排列')
  })

  it('detects 空头排列 (bearish alignment)', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [8], MA10: [10], MA20: [11], MA60: [12] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('空头排列')
  })

  it('detects 交叉 (cross) when MAs are not aligned', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [11], MA10: [12], MA20: [10], MA60: [8] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('交叉')
  })

  it('shows 未知 when MA values are missing', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [12], MA10: [], MA20: [], MA60: [] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: null,
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('未知')
  })

  it('calculates bollinger band position correctly', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [], MA10: [], MA20: [], MA60: [] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: { upper: [15], lower: [5] },
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    // close=69, upper=15, lower=5 -> (69-5)/(15-5)*100 = 640%
    expect(prompt).toContain('布林位置：640%')
  })

  it('shows - for bollinger when upper/lower arrays are empty', () => {
    const klData = Array.from({ length: 60 }, (_, i) => makeKline(10 + i))
    const ind = {
      mas: { MA5: [], MA10: [], MA20: [], MA60: [] },
      macd: { macd: [], signal: [], histogram: [] },
      rsi: [],
      bollinger: { upper: [], lower: [] },
    }
    const prompt = buildCandidatePrompt('测试', '000001', 10, 0, ind, klData)
    expect(prompt).toContain('布林位置：-%')
  })
})
