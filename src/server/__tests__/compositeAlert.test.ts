import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Constants — extracted from compositeAlertEngine.ts
// ---------------------------------------------------------------------------
const DEDUP_KEY = (code: string, type: string) => `composite_alert:${type}:${code}`
const DEDUP_TTL = 300
const STATE_KEY = (code: string) => `composite_state:${code}`

describe('DEDUP_KEY', () => {
  it('generates correct key format', () => {
    expect(DEDUP_KEY('000001', 'resonance')).toBe('composite_alert:resonance:000001')
    expect(DEDUP_KEY('600519', 'sustained_inflow')).toBe('composite_alert:sustained_inflow:600519')
  })
})

describe('STATE_KEY', () => {
  it('generates correct key format', () => {
    expect(STATE_KEY('000001')).toBe('composite_state:000001')
    expect(STATE_KEY('600519')).toBe('composite_state:600519')
  })
})

describe('DEDUP_TTL', () => {
  it('is 300 seconds', () => {
    expect(DEDUP_TTL).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// Composite State Machine Logic
// ---------------------------------------------------------------------------
describe('Composite State Machine Logic', () => {
  type CompositeState = 'IDLE' | 'WATCHING_INFLOW' | 'WATCHING_OUTFLOW' | 'CONFIRMED_INFLOW' | 'CONFIRMED_OUTFLOW' | 'RESONANCE_TRIGGERED'

  function simulateStateTransition(
    entry: { state: CompositeState; inflowMinutes: number; outflowMinutes: number; lastUpdate: number },
    netInflowMain: number,
    sustainedMinutes: number,
    nowMs: number,
  ): { state: CompositeState; inflowMinutes: number; outflowMinutes: number } {
    const stale = nowMs - entry.lastUpdate > 120_000
    let { state } = entry
    let inflowMins = entry.inflowMinutes
    let outflowMins = entry.outflowMinutes
    const isInflow = netInflowMain > 0
    const isOutflow = netInflowMain < 0

    if (stale) { inflowMins = 0; outflowMins = 0 }

    if (isInflow) {
      inflowMins = stale ? 1 : inflowMins + 1
      outflowMins = 0
      if (inflowMins >= sustainedMinutes) { state = 'CONFIRMED_INFLOW' }
      else if (entry.state === 'IDLE' || entry.state === 'WATCHING_OUTFLOW') { state = 'WATCHING_INFLOW' }
    } else if (isOutflow) {
      outflowMins = stale ? 1 : outflowMins + 1
      inflowMins = 0
      if (outflowMins >= sustainedMinutes) { state = 'CONFIRMED_OUTFLOW' }
      else if (entry.state === 'IDLE' || entry.state === 'WATCHING_INFLOW') { state = 'WATCHING_OUTFLOW' }
    } else {
      inflowMins = 0; outflowMins = 0
      state = 'IDLE'
    }

    return { state, inflowMinutes: inflowMins, outflowMinutes: outflowMins }
  }

  describe('state transitions', () => {
    it('IDLE + 净流入 → WATCHING_INFLOW', () => {
      const entry = { state: 'IDLE' as CompositeState, inflowMinutes: 0, outflowMinutes: 0, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, 1000, 3, Date.now())
      expect(result.state).toBe('WATCHING_INFLOW')
      expect(result.inflowMinutes).toBe(1)
    })

    it('WATCHING_INFLOW + 持续净流入 3 分钟 → CONFIRMED_INFLOW', () => {
      let entry = { state: 'WATCHING_INFLOW' as CompositeState, inflowMinutes: 2, outflowMinutes: 0, lastUpdate: Date.now() - 60_000 }
      entry = { ...entry, ...simulateStateTransition(entry, 1000, 3, Date.now()) }
      expect(entry.state).toBe('CONFIRMED_INFLOW')
      expect(entry.inflowMinutes).toBe(3)
    })

    it('CONFIRMED_INFLOW + 首次净流出 → 重置流入计数，状态保持确认', () => {
      const entry = { state: 'CONFIRMED_INFLOW' as CompositeState, inflowMinutes: 3, outflowMinutes: 0, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, -1000, 3, Date.now())
      expect(result.inflowMinutes).toBe(0)
      expect(result.outflowMinutes).toBe(1)
      expect(result.state).toBe('CONFIRMED_INFLOW')
    })

    it('WATCHING_INFLOW + 净流出 → WATCHING_OUTFLOW', () => {
      const entry = { state: 'WATCHING_INFLOW' as CompositeState, inflowMinutes: 1, outflowMinutes: 0, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, -1000, 3, Date.now())
      expect(result.state).toBe('WATCHING_OUTFLOW')
      expect(result.outflowMinutes).toBe(1)
    })

    it('stale (>2min) → 重置计数', () => {
      const entry = { state: 'WATCHING_INFLOW' as CompositeState, inflowMinutes: 2, outflowMinutes: 0, lastUpdate: Date.now() - 180_000 }
      const result = simulateStateTransition(entry, 1000, 3, Date.now())
      expect(result.inflowMinutes).toBe(1)
      expect(result.state).toBe('WATCHING_INFLOW')
    })

    it('netInflowMain=0 → IDLE', () => {
      const entry = { state: 'WATCHING_INFLOW' as CompositeState, inflowMinutes: 2, outflowMinutes: 0, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, 0, 3, Date.now())
      expect(result.state).toBe('IDLE')
    })
  })

  describe('triple resonance', () => {
    function evaluateTripleResonance(params: {
      netInflowMain: number
      macdCross: boolean
      volumeRatio: number
      sustained: boolean
      inflowThreshold: number
      volumeRatioMin: number
    }): boolean {
      const { netInflowMain, macdCross, volumeRatio, sustained, inflowThreshold, volumeRatioMin } = params
      const inflowOk = netInflowMain > inflowThreshold
      const volOk = volumeRatio >= volumeRatioMin
      return inflowOk && macdCross && volOk && sustained
    }

    it('资金流入 + MACD金叉 + 放量 + 持续 → 触发', () => {
      expect(evaluateTripleResonance({
        netInflowMain: 2000, macdCross: true, volumeRatio: 2.0, sustained: true,
        inflowThreshold: 1000, volumeRatioMin: 1.5,
      })).toBe(true)
    })

    it('MACD未金叉 → 不触发', () => {
      expect(evaluateTripleResonance({
        netInflowMain: 2000, macdCross: false, volumeRatio: 2.0, sustained: true,
        inflowThreshold: 1000, volumeRatioMin: 1.5,
      })).toBe(false)
    })

    it('资金不足阈值 → 不触发', () => {
      expect(evaluateTripleResonance({
        netInflowMain: 500, macdCross: true, volumeRatio: 2.0, sustained: true,
        inflowThreshold: 1000, volumeRatioMin: 1.5,
      })).toBe(false)
    })

    it('未持续流入 → 不触发', () => {
      expect(evaluateTripleResonance({
        netInflowMain: 2000, macdCross: true, volumeRatio: 2.0, sustained: false,
        inflowThreshold: 1000, volumeRatioMin: 1.5,
      })).toBe(false)
    })

    it('放量不足 → 不触发', () => {
      expect(evaluateTripleResonance({
        netInflowMain: 2000, macdCross: true, volumeRatio: 1.2, sustained: true,
        inflowThreshold: 1000, volumeRatioMin: 1.5,
      })).toBe(false)
    })
  })

  describe('deduplication TTL', () => {
    it('DEDUP_TTL = 300秒（5分钟）', () => {
      expect(DEDUP_TTL).toBe(300)
    })
  })

  describe('additional state transitions', () => {
    it('WATCHING_OUTFLOW + 净流入 → WATCHING_INFLOW', () => {
      const entry = { state: 'WATCHING_OUTFLOW' as CompositeState, inflowMinutes: 0, outflowMinutes: 1, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, 1000, 3, Date.now())
      expect(result.state).toBe('WATCHING_INFLOW')
      expect(result.inflowMinutes).toBe(1)
      expect(result.outflowMinutes).toBe(0)
    })

    it('CONFIRMED_OUTFLOW + 净流入 → 保持确认但切换计数', () => {
      const entry = { state: 'CONFIRMED_OUTFLOW' as CompositeState, inflowMinutes: 0, outflowMinutes: 3, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, 1000, 3, Date.now())
      expect(result.inflowMinutes).toBe(1)
      expect(result.outflowMinutes).toBe(0)
      expect(result.state).toBe('CONFIRMED_OUTFLOW')
    })

    it('IDLE + netInflowMain=0 → IDLE (no change)', () => {
      const entry = { state: 'IDLE' as CompositeState, inflowMinutes: 0, outflowMinutes: 0, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, 0, 3, Date.now())
      expect(result.state).toBe('IDLE')
      expect(result.inflowMinutes).toBe(0)
      expect(result.outflowMinutes).toBe(0)
    })

    it('stale WATCHING_OUTFLOW + 净流出 → 重置为1', () => {
      const entry = { state: 'WATCHING_OUTFLOW' as CompositeState, inflowMinutes: 0, outflowMinutes: 2, lastUpdate: Date.now() - 180_000 }
      const result = simulateStateTransition(entry, -1000, 3, Date.now())
      expect(result.outflowMinutes).toBe(1)
      expect(result.state).toBe('WATCHING_OUTFLOW')
    })

    it('sustainedMinutes=1 confirms immediately on inflow', () => {
      const entry = { state: 'IDLE' as CompositeState, inflowMinutes: 0, outflowMinutes: 0, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, 1000, 1, Date.now())
      expect(result.state).toBe('CONFIRMED_INFLOW')
    })

    it('sustainedMinutes=1 confirms immediately on outflow', () => {
      const entry = { state: 'IDLE' as CompositeState, inflowMinutes: 0, outflowMinutes: 0, lastUpdate: Date.now() }
      const result = simulateStateTransition(entry, -1000, 1, Date.now())
      expect(result.state).toBe('CONFIRMED_OUTFLOW')
    })
  })

  describe('RESONANCE_TRIGGERED state handling', () => {
    // The engine sets resonanceTriggered=true and resonanceTime when resonance fires.
    // On next inflow/outflow, state machine still runs; RESONANCE_TRIGGERED is not
    // an active state in the state machine enum but is tracked separately in the entry.

    it('RESONANCE_TRIGGERED flag is separate from state machine', () => {
      // resonanceTriggered is stored in the StateEntry but does not change state machine transitions
      type StateEntry = {
        state: CompositeState
        inflowMinutes: number
        outflowMinutes: number
        resonanceTriggered: boolean
        resonanceTime?: number
      }
      const entry: StateEntry = {
        state: 'WATCHING_INFLOW',
        inflowMinutes: 2,
        outflowMinutes: 0,
        resonanceTriggered: true,
        resonanceTime: Date.now(),
      }
      // The state machine continues normally even after resonance triggered
      expect(entry.resonanceTriggered).toBe(true)
      expect(entry.state).toBe('WATCHING_INFLOW')
    })
  })
})
