/**
 * 回测行情复权 — 长区间回测不能用于不复权数据（除权跳空会被当成真实涨跌）
 *
 * 覆盖：
 *  - 东财 fqt=0/2 两路合并成乘法前复权序列（收益率正确 + 价格量级与现价一致）
 *  - 复权序列出现非正价格时退回不复权
 *  - 复权接口失败时退回不复权，不抛异常
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  },
}))

vi.mock('../data/redis.js', () => ({
  cacheGetKlines: vi.fn(async () => null),
  cacheGetKlinesBulk: vi.fn(async () => ({})),
  cacheSetKlinesBulk: vi.fn(async () => undefined),
  cacheGetMinuteKlines: vi.fn(async () => null),
  cacheSetMinuteKlines: vi.fn(async () => undefined),
  cacheSetMinuteKlinesBulk: vi.fn(async () => undefined),
}))

import { getKlinesForBacktest } from '../data/cache.js'
import { fetchAdjustedKlines, fetchEastmoneyKlines } from '../data/eastmoney.js'

// 后复权序列（fqt=2）
const HFQ_ROWS = [
  '2020-01-02,30.00,30.40,30.60,29.80,100000,1379000',
  '2024-01-02,40.00,41.00,41.20,39.80,100000,2000000',
]
// 不复权序列（fqt=0），末日收盘 20.50 → 缩放因子 = 20.50 / 41.00 = 0.5
const RAW_ROWS = [
  '2020-01-02,15.00,15.20,15.30,14.90,100000,1379000',
  '2024-01-02,20.00,20.50,20.60,19.90,100000,2000000',
]
// 腾讯兜底接口返回的“不复权”数据
const TENCENT_PAYLOAD = {
  code: 0,
  data: { sz000001: { qfqday: [['2020-01-02', '99.00', '99.90', '100.10', '98.90', '90000', '1368000']] } },
}

const emPayload = (rows: string[]) => ({ rc: 0, data: { code: '000001', klines: rows } })
const ok = (body: any) => ({ ok: true, status: 200, json: async () => body })

function stubFetch(handler: (url: string) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => handler(String(url))))
}

// 按 fqt 参数返回不同序列
const emByFqt = (hfq: string[], raw: string[]) => (url: string) =>
  url.includes('push2his') ? ok(emPayload(url.includes('fqt=2') ? hfq : raw)) : ok(TENCENT_PAYLOAD)

beforeEach(() => {
  stubFetch(emByFqt(HFQ_ROWS, RAW_ROWS))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchEastmoneyKlines', () => {
  it('按东财字段顺序解析（日期/开/收/高/低/量/额）', async () => {
    const rows = await fetchEastmoneyKlines('000001', 0)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      code: '000001', date: '2020-01-02',
      open: 15, close: 15.2, high: 15.3, low: 14.9,
      volume: 100000, amount: 1379000,
    })
  })

  it('secid 按交易所前缀拼接，并透传 fqt', async () => {
    await fetchEastmoneyKlines('600519', 2)
    const url = (globalThis.fetch as any).mock.calls[0][0] as string
    expect(url).toContain('secid=1.600519')
    expect(url).toContain('fqt=2')
  })

  it('无数据时返回空数组', async () => {
    stubFetch(() => ok({ rc: 0, data: null }))
    expect(await fetchEastmoneyKlines('000001', 0)).toEqual([])
  })
})

describe('fetchAdjustedKlines', () => {
  it('后复权序列缩放回今日价位，末日价等于不复权末日价', async () => {
    const rows = await fetchAdjustedKlines('000001')

    expect(rows).toHaveLength(2)
    expect(rows[1].close).toBeCloseTo(20.5, 6) // 末日对齐真实价格
    expect(rows[0].close).toBeCloseTo(15.2, 6) // 30.40 × 0.5
    expect(rows[0].date).toBe('2020-01-02')
  })

  it('涨跌幅保持不变（复权只改量级）', async () => {
    const rows = await fetchAdjustedKlines('000001')
    const ret = rows[1].close / rows[0].close - 1
    expect(ret).toBeCloseTo(20.5 / 15.2 - 1, 6)
  })

  it('两路序列长度不一致时报错（交给上层退回不复权）', async () => {
    stubFetch(emByFqt(HFQ_ROWS, RAW_ROWS.slice(0, 1)))
    await expect(fetchAdjustedKlines('000001')).rejects.toThrow(/mismatch/)
  })
})

describe('getKlinesForBacktest', () => {
  it('复权可用时返回 adjusted=true', async () => {
    const { klines, adjusted } = await getKlinesForBacktest('000001')

    expect(adjusted).toBe(true)
    expect(klines).toHaveLength(2)
    expect(klines[1].close).toBeCloseTo(20.5, 6)
  })

  it('复权序列出现负价时退回不复权', async () => {
    stubFetch(emByFqt(
      ['2001-08-27,-312.68,-312.47,-312.03,-313.01,406318,1410347000'],
      ['2001-08-27,35.00,35.10,35.20,34.90,406318,1410347000'],
    ))

    const { klines, adjusted } = await getKlinesForBacktest('000001')

    expect(adjusted).toBe(false)
    expect(klines[0].open).toBe(99) // 腾讯不复权兜底数据
  })

  it('复权接口报错时退回不复权，不抛异常', async () => {
    stubFetch((url) => {
      if (url.includes('push2his')) throw new Error('network down')
      return ok(TENCENT_PAYLOAD)
    })

    const { klines, adjusted } = await getKlinesForBacktest('000001')

    expect(adjusted).toBe(false)
    expect(klines).toHaveLength(1)
  })
})
