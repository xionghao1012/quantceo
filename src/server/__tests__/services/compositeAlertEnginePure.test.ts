import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// compositeAlertEngine.ts — pure logic extractions
// ---------------------------------------------------------------------------

const DEDUP_KEY = (code: string, type: string) => `composite_alert:${type}:${code}`
const DEDUP_TTL = 300
const STATE_KEY = (code: string) => `composite_state:${code}`

// State machine types (mirrored from source)
type CompositeState = 'IDLE' | 'WATCHING_INFLOW' | 'WATCHING_OUTFLOW' | 'CONFIRMED_INFLOW' | 'CONFIRMED_OUTFLOW' | 'RESONANCE_TRIGGERED'

interface StateEntry {
  state: CompositeState
  inflowMinutes: number
  outflowMinutes: number
  lastFlow: number
  lastUpdate: number
  resonanceTriggered: boolean
  resonanceTime?: number
}

// Pure function: compute next state from current state + flow
// Extracted from checkSustainedFlow
function computeNextState(
  entry: StateEntry,
  netInflowMain: number,
  sustainedMinutes: number,
  now: number,
  staleThresholdMs = 120_000
): { newState: CompositeState; inflowMins: number; outflowMins: number } {
  const stale = now - entry.lastUpdate > staleThresholdMs

  let newState: CompositeState = entry.state
  let inflowMins = entry.inflowMinutes
  let outflowMins = entry.outflowMinutes
  const isInflow = netInflowMain > 0
  const isOutflow = netInflowMain < 0

  if (stale) {
    inflowMins = 0
    outflowMins = 0
  }

  if (isInflow) {
    inflowMins = stale ? 1 : inflowMins + 1
    outflowMins = 0
    if (inflowMins >= sustainedMinutes) {
      newState = 'CONFIRMED_INFLOW'
    } else if (entry.state === 'IDLE' || entry.state === 'WATCHING_OUTFLOW') {
      newState = 'WATCHING_INFLOW'
    }
  } else if (isOutflow) {
    outflowMins = stale ? 1 : outflowMins + 1
    inflowMins = 0
    if (outflowMins >= sustainedMinutes) {
      newState = 'CONFIRMED_OUTFLOW'
    } else if (entry.state === 'IDLE' || entry.state === 'WATCHING_INFLOW') {
      newState = 'WATCHING_OUTFLOW'
    }
  } else {
    inflowMins = 0
    outflowMins = 0
    newState = 'IDLE'
  }

  return { newState, inflowMins, outflowMins }
}

// Pure function: determine sustained result from newState
function computeSustainedResult(newState: CompositeState): { sustained: boolean; direction: 'inflow' | 'outflow' } {
  const sustained = newState === 'CONFIRMED_INFLOW' || newState === 'CONFIRMED_OUTFLOW'
  return { sustained, direction: newState === 'CONFIRMED_INFLOW' ? 'inflow' : 'outflow' }
}

describe('DEDUP_KEY', () => {
  it('formats composite alert dedup key', () => {
    expect(DEDUP_KEY('000001', 'resonance')).toBe('composite_alert:resonance:000001')
  })
  it('handles different types', () => {
    expect(DEDUP_KEY('600519', 'sustained_inflow')).toBe('composite_alert:sustained_inflow:600519')
  })
})

describe('STATE_KEY', () => {
  it('formats state key', () => {
    expect(STATE_KEY('000001')).toBe('composite_state:000001')
  })
})

describe('DEDUP_TTL', () => {
  it('is 300 seconds', () => {
    expect(DEDUP_TTL).toBe(300)
  })
})

describe('computeNextState', () => {
  const baseEntry = (state: CompositeState = 'IDLE'): StateEntry => ({
    state,
    inflowMinutes: 0,
    outflowMinutes: 0,
    lastFlow: 0,
    lastUpdate: Date.now(),
    resonanceTriggered: false,
  })

  it('IDLE + positive inflow → WATCHING_INFLOW (sustainedMinutes=3, mins=1)', () => {
    const entry = baseEntry('IDLE')
    const { newState, inflowMins } = computeNextState(entry, 1_000_000, 3, Date.now())
    expect(newState).toBe('WATCHING_INFLOW')
    expect(inflowMins).toBe(1)
  })

  it('IDLE + negative outflow → WATCHING_OUTFLOW (sustainedMinutes=3, mins=1)', () => {
    const entry = baseEntry('IDLE')
    const { newState, outflowMins } = computeNextState(entry, -500_000, 3, Date.now())
    expect(newState).toBe('WATCHING_OUTFLOW')
    expect(outflowMins).toBe(1)
  })

  it('WATCHING_INFLOW + inflow for 3 mins → CONFIRMED_INFLOW', () => {
    const entry: StateEntry = { ...baseEntry('WATCHING_INFLOW'), inflowMinutes: 2, lastUpdate: Date.now() }
    const { newState } = computeNextState(entry, 1_000_000, 3, Date.now())
    expect(newState).toBe('CONFIRMED_INFLOW')
  })

  it('WATCHING_OUTFLOW + outflow for 3 mins → CONFIRMED_OUTFLOW', () => {
    const entry: StateEntry = { ...baseEntry('WATCHING_OUTFLOW'), outflowMinutes: 2, lastUpdate: Date.now() }
    const { newState } = computeNextState(entry, -500_000, 3, Date.now())
    expect(newState).toBe('CONFIRMED_OUTFLOW')
  })

  it('stale entry resets minutes to 1 (inflow)', () => {
    const entry: StateEntry = { ...baseEntry('WATCHING_INFLOW'), inflowMinutes: 5, lastUpdate: Date.now() - 200_000 }
    const { inflowMins, outflowMins } = computeNextState(entry, 1_000_000, 3, Date.now())
    expect(inflowMins).toBe(1) // stale → reset to 1
    expect(outflowMins).toBe(0)
  })

  it('zero inflow → IDLE', () => {
    const entry = baseEntry('WATCHING_INFLOW')
    const { newState, inflowMins, outflowMins } = computeNextState(entry, 0, 3, Date.now())
    expect(newState).toBe('IDLE')
    expect(inflowMins).toBe(0)
    expect(outflowMins).toBe(0)
  })

  it('inflow after WATCHING_OUTFLOW → WATCHING_INFLOW (reset)', () => {
    const entry: StateEntry = { ...baseEntry('WATCHING_OUTFLOW'), outflowMinutes: 2, lastUpdate: Date.now() }
    const { newState, inflowMins, outflowMins } = computeNextState(entry, 1_000_000, 3, Date.now())
    expect(newState).toBe('WATCHING_INFLOW')
    expect(inflowMins).toBe(1)
    expect(outflowMins).toBe(0)
  })

  it('outflow after WATCHING_INFLOW → WATCHING_OUTFLOW (reset)', () => {
    const entry: StateEntry = { ...baseEntry('WATCHING_INFLOW'), inflowMinutes: 2, lastUpdate: Date.now() }
    const { newState, inflowMins, outflowMins } = computeNextState(entry, -500_000, 3, Date.now())
    expect(newState).toBe('WATCHING_OUTFLOW')
    expect(inflowMins).toBe(0)
    expect(outflowMins).toBe(1)
  })

  it('confirmed state does not regress on further inflow', () => {
    const entry: StateEntry = { ...baseEntry('CONFIRMED_INFLOW'), inflowMinutes: 5, lastUpdate: Date.now() }
    const { newState } = computeNextState(entry, 1_000_000, 3, Date.now())
    expect(newState).toBe('CONFIRMED_INFLOW')
  })

  it('WATCHING_INFLOW with only 2 mins, more inflow needed', () => {
    const entry: StateEntry = { ...baseEntry('WATCHING_INFLOW'), inflowMinutes: 2, lastUpdate: Date.now() }
    // inflowMins = 2 + 1 = 3, sustainedMinutes = 3, so 3 >= 3 → CONFIRMED
    // To stay WATCHING, need inflowMins < sustainedMinutes
    const { newState } = computeNextState(entry, 500_000, 4, Date.now())
    expect(newState).toBe('WATCHING_INFLOW')
  })
})

describe('computeSustainedResult', () => {
  it('CONFIRMED_INFLOW → sustained=true, direction=inflow', () => {
    expect(computeSustainedResult('CONFIRMED_INFLOW')).toEqual({ sustained: true, direction: 'inflow' })
  })

  it('CONFIRMED_OUTFLOW → sustained=true, direction=outflow', () => {
    expect(computeSustainedResult('CONFIRMED_OUTFLOW')).toEqual({ sustained: true, direction: 'outflow' })
  })

  it('WATCHING_INFLOW → sustained=false', () => {
    expect(computeSustainedResult('WATCHING_INFLOW')).toEqual({ sustained: false, direction: 'outflow' })
  })

  it('WATCHING_OUTFLOW → sustained=false', () => {
    expect(computeSustainedResult('WATCHING_OUTFLOW')).toEqual({ sustained: false, direction: 'outflow' })
  })

  it('IDLE → sustained=false', () => {
    expect(computeSustainedResult('IDLE')).toEqual({ sustained: false, direction: 'outflow' })
  })
})
