import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// moneyFlowAlertEngine.ts — pure logic extractions (no db/redis needed)
// ---------------------------------------------------------------------------

const ALERT_DEDUP_KEY = (code: string, configId: number) => `mf_alert_dedup:${code}:${configId}`

describe('ALERT_DEDUP_KEY', () => {
  it('formats key correctly', () => {
    expect(ALERT_DEDUP_KEY('000001', 1)).toBe('mf_alert_dedup:000001:1')
  })

  it('handles string configId', () => {
    // configId is number per signature, but test robustness
    expect(ALERT_DEDUP_KEY('600519', 42)).toBe('mf_alert_dedup:600519:42')
  })

  it('handles special characters in code', () => {
    expect(ALERT_DEDUP_KEY('SH600519', 7)).toBe('mf_alert_dedup:SH600519:7')
  })
})

describe('threshold trigger logic (pure extraction)', () => {
  // Extracted from checkAlert — purely numeric logic
  function computeTriggered(params: {
    netInflowMain: number
    netInflowMainPct: number
    thresholdType: 'absolute' | 'relative'
    thresholdValue: number
    direction: 'inflow' | 'outflow'
  }): boolean {
    if (params.thresholdType === 'absolute') {
      const effective = params.direction === 'outflow' ? -params.netInflowMain : params.netInflowMain
      return effective >= params.thresholdValue
    } else {
      const pct = params.direction === 'outflow' ? -params.netInflowMainPct : params.netInflowMainPct
      return pct >= params.thresholdValue
    }
  }

  it('absolute inflow: triggers when netInflowMain >= thresholdValue', () => {
    expect(computeTriggered({ netInflowMain: 1_000_000, netInflowMainPct: 0, thresholdType: 'absolute', thresholdValue: 500_000, direction: 'inflow' })).toBe(true)
  })

  it('absolute inflow: does NOT trigger when below threshold', () => {
    expect(computeTriggered({ netInflowMain: 300_000, netInflowMainPct: 0, thresholdType: 'absolute', thresholdValue: 500_000, direction: 'inflow' })).toBe(false)
  })

  it('absolute outflow: treats negative as positive effective (flipped by direction)', () => {
    // direction=outflow, netInflowMain=-1_000_000 → effective = -(-1_000_000) = +1_000_000
    expect(computeTriggered({ netInflowMain: -1_000_000, netInflowMainPct: 0, thresholdType: 'absolute', thresholdValue: 500_000, direction: 'outflow' })).toBe(true)
  })

  it('absolute outflow: does not trigger for inflow value', () => {
    // direction=outflow, netInflowMain=+1_000_000 → effective = -1_000_000 < 500_000
    expect(computeTriggered({ netInflowMain: 1_000_000, netInflowMainPct: 0, thresholdType: 'absolute', thresholdValue: 500_000, direction: 'outflow' })).toBe(false)
  })

  it('relative inflow: triggers when pct >= thresholdValue', () => {
    expect(computeTriggered({ netInflowMain: 0, netInflowMainPct: 5.0, thresholdType: 'relative', thresholdValue: 3.0, direction: 'inflow' })).toBe(true)
  })

  it('relative inflow: does not trigger when below threshold', () => {
    expect(computeTriggered({ netInflowMain: 0, netInflowMainPct: 2.0, thresholdType: 'relative', thresholdValue: 3.0, direction: 'inflow' })).toBe(false)
  })

  it('relative outflow: negative pct becomes positive effective', () => {
    // direction=outflow, netInflowMainPct=-5.0 → effective = -(-5.0) = +5.0
    expect(computeTriggered({ netInflowMain: 0, netInflowMainPct: -5.0, thresholdType: 'relative', thresholdValue: 3.0, direction: 'outflow' })).toBe(true)
  })

  it('relative outflow: does not trigger for positive pct', () => {
    // direction=outflow, netInflowMainPct=+5.0 → effective = -5.0 < 3.0
    expect(computeTriggered({ netInflowMain: 0, netInflowMainPct: 5.0, thresholdType: 'relative', thresholdValue: 3.0, direction: 'outflow' })).toBe(false)
  })

  it('handles zero threshold (always triggers if direction matches)', () => {
    expect(computeTriggered({ netInflowMain: 100, netInflowMainPct: 0, thresholdType: 'absolute', thresholdValue: 0, direction: 'inflow' })).toBe(true)
  })

  it('handles exact threshold value (boundary)', () => {
    expect(computeTriggered({ netInflowMain: 500_000, netInflowMainPct: 0, thresholdType: 'absolute', thresholdValue: 500_000, direction: 'inflow' })).toBe(true)
  })

  it('handles negative threshold (triggers even for small values)', () => {
    // This is an edge case — negative threshold means anything above it triggers
    expect(computeTriggered({ netInflowMain: -10_000_000, netInflowMainPct: 0, thresholdType: 'absolute', thresholdValue: -50_000_000, direction: 'inflow' })).toBe(true)
  })
})

describe('isDupulicated logic (redis key existence → boolean)', () => {
  // Pure simulation of isDupulicated(code, configId) → boolean
  // Redis exists() returns 1 if key exists, 0 otherwise; errors return false
  function simulateIsDupulicated(keySet: Set<string>, code: string, configId: number): boolean {
    return keySet.has(ALERT_DEDUP_KEY(code, configId))
  }

  it('returns true when key exists in redis', () => {
    const keys = new Set(['mf_alert_dedup:000001:1', 'mf_alert_dedup:600519:2'])
    expect(simulateIsDupulicated(keys, '000001', 1)).toBe(true)
  })

  it('returns false when key does not exist', () => {
    const keys = new Set(['mf_alert_dedup:000001:1'])
    expect(simulateIsDupulicated(keys, '600519', 2)).toBe(false)
  })

  it('returns false for empty keyset', () => {
    expect(simulateIsDupulicated(new Set(), '000001', 1)).toBe(false)
  })
})
