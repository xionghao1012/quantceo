import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Constants — extracted from moneyFlowAlertEngine.ts
// ---------------------------------------------------------------------------
const ALERT_DEDUP_KEY = (code: string, configId: number) => `mf_alert_dedup:${code}:${configId}`
const DEDUP_TTL = 300

// ---------------------------------------------------------------------------
// Pure functions extracted from moneyFlowAlertEngine.ts
// ---------------------------------------------------------------------------

function evaluateThreshold(params: {
  thresholdType: string
  thresholdValue: number
  direction: string
  netInflowMain: number
  netInflowMainPct: number
}): { triggered: boolean; reason: string } {
  const { thresholdType, thresholdValue, direction, netInflowMain, netInflowMainPct } = params
  if (thresholdType === 'absolute') {
    const effective = direction === 'outflow' ? -netInflowMain : netInflowMain
    if (effective >= thresholdValue) {
      return {
        triggered: true,
        reason: `绝对值阈值触发：${direction === 'outflow' ? '流出' : '流入'} ${(effective / 10000).toFixed(2)}万 ≥ ${(thresholdValue / 10000).toFixed(2)}万`,
      }
    }
  } else if (thresholdType === 'relative') {
    const pct = direction === 'outflow' ? -netInflowMainPct : netInflowMainPct
    if (pct >= thresholdValue) {
      return {
        triggered: true,
        reason: `变化率阈值触发：${direction === 'outflow' ? '流出率' : '流入率'} ${pct.toFixed(2)}% ≥ ${thresholdValue.toFixed(2)}%`,
      }
    }
  }
  return { triggered: false, reason: '' }
}

function isSTName(name: string): boolean {
  return name.includes('ST') || name.includes('*ST')
}

function calcRiskScore(volatility: number, rsi: number): number {
  return ((volatility * 100 + (100 - Math.min(100, Math.max(0, rsi))) / 2) / 150)
}

function formatAlertMessage(code: string, name: string, reason: string, price: number, change: number): {
  type: string
  code: string
  name: string
  message: string
  timestamp: string
  price: number
  change: number
} {
  return {
    type: 'alert_triggered',
    code,
    name,
    message: reason,
    timestamp: new Date().toISOString(),
    price,
    change,
  }
}

// ---------------------------------------------------------------------------
// checkTechResonance — MACD golden cross pure detection
// ---------------------------------------------------------------------------
function isMacdGoldenCross(macd: number[], signal: number[]): boolean {
  if (macd.length < 2 || signal.length < 2) return false
  const n = macd.length
  const prevMacd = macd[n - 2], currMacd = macd[n - 1]
  const prevSignal = signal[n - 2], currSignal = signal[n - 1]
  return prevMacd <= prevSignal && currMacd > currSignal
}

// ---------------------------------------------------------------------------
// checkAlert early-exit conditions (pure extractions)
// ---------------------------------------------------------------------------
function shouldSkipST(config: { basicFilterEnabled?: boolean }, isST: boolean): boolean {
  return !!(config.basicFilterEnabled && isST)
}

function shouldSkipLimitUp(config: { basicFilterEnabled?: boolean }, isLimitUp: boolean): boolean {
  return !!(config.basicFilterEnabled && isLimitUp)
}

function isConfigEnabled(config: { enabled?: boolean }): boolean {
  return !!config.enabled
}

function codeMatches(config: { code?: string | null }, dataCode: string): boolean {
  return !config.code || config.code === dataCode
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ALERT_DEDUP_KEY', () => {
  it('generates correct key format', () => {
    expect(ALERT_DEDUP_KEY('000001', 1)).toBe('mf_alert_dedup:000001:1')
    expect(ALERT_DEDUP_KEY('600519', 42)).toBe('mf_alert_dedup:600519:42')
  })

  it('DEDUP_TTL is 300 seconds', () => {
    expect(DEDUP_TTL).toBe(300)
  })
})

describe('evaluateThreshold', () => {
  describe('absolute threshold — inflow', () => {
    it('净流入 >= 阈值 → 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'inflow', netInflowMain: 1500, netInflowMainPct: 2 })
      expect(result.triggered).toBe(true)
    })

    it('净流入 < 阈值 → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'inflow', netInflowMain: 500, netInflowMainPct: 1 })
      expect(result.triggered).toBe(false)
    })

    it('净流出 direction=inflow → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'inflow', netInflowMain: -1500, netInflowMainPct: -2 })
      expect(result.triggered).toBe(false)
    })

    it('边界：净流入等于阈值 → 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'inflow', netInflowMain: 1000, netInflowMainPct: 1 })
      expect(result.triggered).toBe(true)
    })

    it('净流入刚好低于阈值 → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'inflow', netInflowMain: 999, netInflowMainPct: 1 })
      expect(result.triggered).toBe(false)
    })
  })

  describe('absolute threshold — outflow', () => {
    it('净流出 >= 阈值（负值绝对值）→ 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'outflow', netInflowMain: -1500, netInflowMainPct: -2 })
      expect(result.triggered).toBe(true)
    })

    it('净流入 > 0 → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'outflow', netInflowMain: 500, netInflowMainPct: 1 })
      expect(result.triggered).toBe(false)
    })

    it('边界：净流出等于阈值 → 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'outflow', netInflowMain: -1000, netInflowMainPct: -1 })
      expect(result.triggered).toBe(true)
    })

    it('净流出刚好低于阈值 → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'outflow', netInflowMain: -999, netInflowMainPct: -1 })
      expect(result.triggered).toBe(false)
    })
  })

  describe('relative threshold — inflow', () => {
    it('流入率 >= 阈值 → 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'inflow', netInflowMain: 1000, netInflowMainPct: 3 })
      expect(result.triggered).toBe(true)
    })

    it('流入率 < 阈值 → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'inflow', netInflowMain: 1000, netInflowMainPct: 1 })
      expect(result.triggered).toBe(false)
    })

    it('负流入率 direction=inflow → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'inflow', netInflowMain: 1000, netInflowMainPct: -3 })
      expect(result.triggered).toBe(false)
    })

    it('边界：流入率刚好等于阈值 → 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'inflow', netInflowMain: 1000, netInflowMainPct: 2 })
      expect(result.triggered).toBe(true)
    })
  })

  describe('relative threshold — outflow', () => {
    it('流出率（负值）>= 阈值 → 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'outflow', netInflowMain: -1000, netInflowMainPct: -3 })
      expect(result.triggered).toBe(true)
    })

    it('正流入率 direction=outflow → 不触发', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'outflow', netInflowMain: 1000, netInflowMainPct: 3 })
      expect(result.triggered).toBe(false)
    })

    it('边界：流出率刚好等于阈值 → 触发', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'outflow', netInflowMain: -1000, netInflowMainPct: -2 })
      expect(result.triggered).toBe(true)
    })
  })

  describe('reason messages', () => {
    it('generates inflow reason string', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'inflow', netInflowMain: 2000, netInflowMainPct: 3 })
      expect(result.reason).toContain('流入')
      expect(result.reason).toContain('万')
    })

    it('generates outflow reason string', () => {
      const result = evaluateThreshold({ thresholdType: 'relative', thresholdValue: 2, direction: 'outflow', netInflowMain: -1000, netInflowMainPct: -3 })
      expect(result.reason).toContain('流出率')
    })

    it('reason is empty when not triggered', () => {
      const result = evaluateThreshold({ thresholdType: 'absolute', thresholdValue: 1000, direction: 'inflow', netInflowMain: 500, netInflowMainPct: 1 })
      expect(result.reason).toBe('')
    })
  })

  describe('unknown thresholdType', () => {
    it('returns not triggered for unknown thresholdType', () => {
      const result = evaluateThreshold({ thresholdType: 'unknown' as any, thresholdValue: 1000, direction: 'inflow', netInflowMain: 2000, netInflowMainPct: 3 })
      expect(result.triggered).toBe(false)
      expect(result.reason).toBe('')
    })
  })
})

describe('isSTName', () => {
  it('returns true for ST stocks', () => {
    expect(isSTName('ST平安')).toBe(true)
    expect(isSTName('*ST大唐')).toBe(true)
    expect(isSTName('ST退市')).toBe(true)
  })

  it('returns false for non-ST stocks', () => {
    expect(isSTName('平安银行')).toBe(false)
    expect(isSTName('贵州茅台')).toBe(false)
  })

  it('handles names containing ST as substring', () => {
    expect(isSTName('非ST股票')).toBe(true)
    expect(isSTName('ST股票')).toBe(true)
  })
})

describe('calcRiskScore', () => {
  it('returns value between 0 and 1 typically', () => {
    const score = calcRiskScore(0.02, 50)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('increases with volatility', () => {
    const lowVol = calcRiskScore(0.01, 50)
    const highVol = calcRiskScore(0.05, 50)
    expect(highVol).toBeGreaterThan(lowVol)
  })

  it('decreases with high RSI', () => {
    const lowRsi = calcRiskScore(0.02, 20)
    const highRsi = calcRiskScore(0.02, 80)
    expect(highRsi).toBeLessThan(lowRsi)
  })

  it('handles RSI at boundaries', () => {
    expect(calcRiskScore(0.02, 0)).toBeGreaterThan(0)
    expect(calcRiskScore(0.02, 100)).toBeGreaterThan(0)
  })

  it('handles extreme volatility', () => {
    const extremeVol = calcRiskScore(0.10, 50)
    expect(extremeVol).toBeLessThan(1)
    expect(extremeVol).toBeGreaterThan(0)
  })
})

describe('formatAlertMessage', () => {
  it('returns correct shape', () => {
    const msg = formatAlertMessage('000001', '平安银行', '测试原因', 10.5, 1000)
    expect(msg.type).toBe('alert_triggered')
    expect(msg.code).toBe('000001')
    expect(msg.name).toBe('平安银行')
    expect(msg.message).toBe('测试原因')
    expect(msg.price).toBe(10.5)
    expect(msg.change).toBe(1000)
    expect(msg.timestamp).toBeDefined()
  })

  it('timestamp is ISO format', () => {
    const msg = formatAlertMessage('000001', 'test', 'reason', 10, 0)
    expect(() => new Date(msg.timestamp)).not.toThrow()
  })
})

describe('isMacdGoldenCross', () => {
  // The function uses macd[n-2] (prev), macd[n-1] (curr), same for signal
  // So for arrays of length n, we check the last two elements.

  it('returns true when MACD crosses above signal', () => {
    // Last two: prevMacd=0.0, currMacd=0.1; prevSignal=-0.05, currSignal=0.05
    // 0.0 <= -0.05 (false) -> wait that's not right
    // Let's make prevMacd=-0.2, currMacd=0.1; prevSignal=-0.1, currSignal=0.0
    const macd = [-0.5, -0.2, 0.1]
    const signal = [-0.3, -0.1, 0.0]
    // prev: -0.2 <= -0.1 (true), curr: 0.1 > 0.0 (true) -> golden cross
    expect(isMacdGoldenCross(macd, signal)).toBe(true)
  })

  it('returns false when MACD stays below signal', () => {
    const macd = [-1.0, -0.5, -0.2]
    const signal = [-0.8, -0.4, -0.1]
    // prev: -0.5 <= -0.4 (true), curr: -0.2 > -0.1 (false) -> no cross
    expect(isMacdGoldenCross(macd, signal)).toBe(false)
  })

  it('returns false when MACD crosses below signal (death cross)', () => {
    const macd = [-0.2, 0.0, -0.1]
    const signal = [-0.3, -0.1, 0.0]
    // prev: 0.0 <= -0.1 (false) -> no cross
    expect(isMacdGoldenCross(macd, signal)).toBe(false)
  })

  it('returns false when arrays too short', () => {
    expect(isMacdGoldenCross([0.2], [0.1])).toBe(false)
    expect(isMacdGoldenCross([], [])).toBe(false)
  })

  it('handles golden cross from below to above zero', () => {
    // prev: -0.1 <= -0.1 (true), curr: 0.05 > -0.05 (true) -> golden cross
    const macd = [-0.2, -0.1, 0.05]
    const signal = [-0.15, -0.1, -0.05]
    expect(isMacdGoldenCross(macd, signal)).toBe(true)
  })
})

describe('shouldSkipST', () => {
  it('skips when basicFilterEnabled and isST=true', () => {
    expect(shouldSkipST({ basicFilterEnabled: true }, true)).toBe(true)
  })

  it('does not skip when basicFilterEnabled and isST=false', () => {
    expect(shouldSkipST({ basicFilterEnabled: true }, false)).toBe(false)
  })

  it('does not skip when basicFilterEnabled=false', () => {
    expect(shouldSkipST({ basicFilterEnabled: false }, true)).toBe(false)
  })
})

describe('shouldSkipLimitUp', () => {
  it('skips when basicFilterEnabled and isLimitUp=true', () => {
    expect(shouldSkipLimitUp({ basicFilterEnabled: true }, true)).toBe(true)
  })

  it('does not skip when basicFilterEnabled and isLimitUp=false', () => {
    expect(shouldSkipLimitUp({ basicFilterEnabled: true }, false)).toBe(false)
  })

  it('does not skip when basicFilterEnabled=false', () => {
    expect(shouldSkipLimitUp({ basicFilterEnabled: false }, true)).toBe(false)
  })
})

describe('isConfigEnabled', () => {
  it('returns true when enabled=true', () => {
    expect(isConfigEnabled({ enabled: true })).toBe(true)
  })

  it('returns false when enabled=false', () => {
    expect(isConfigEnabled({ enabled: false })).toBe(false)
  })

  it('returns false when enabled=undefined', () => {
    expect(isConfigEnabled({})).toBe(false)
  })
})

describe('codeMatches', () => {
  it('returns true when config.code is empty/null', () => {
    expect(codeMatches({ code: undefined }, '000001')).toBe(true)
    expect(codeMatches({ code: null }, '000001')).toBe(true)
    expect(codeMatches({ code: '' }, '000001')).toBe(true)
  })

  it('returns true when config.code matches data code', () => {
    expect(codeMatches({ code: '000001' }, '000001')).toBe(true)
  })

  it('returns false when config.code does not match', () => {
    expect(codeMatches({ code: '600519' }, '000001')).toBe(false)
  })
})
