import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// 只测校验逻辑：DB 用 mock，避免依赖真实表
const insertValues = vi.fn()
vi.mock('../../db/db.js', () => ({
  db: { insert: () => ({ values: insertValues }) },
}))
vi.mock('../../db/schema.js', () => ({
  appEvents: {},
  users: {},
}))
vi.mock('../../middleware/auth.js', () => ({
  optionalAuth: (req: any, _res: any, next: any) => { req.user = { userId: 7 }; next() },
}))

const { default: eventsRoutes } = await import('../../routes/events.js')

function app() {
  const a = express()
  a.use(express.json())
  a.use('/api/events', eventsRoutes)
  return a
}

beforeEach(() => { insertValues.mockReset(); insertValues.mockResolvedValue([{ id: 1 }]) })

describe('POST /api/events', () => {
  it('记录合法事件并带上 userId', async () => {
    const res = await request(app()).post('/api/events')
      .send({ event: 'preset_clicked', props: { preset: 'surge' }, path: '/screener' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      event: 'preset_clicked',
      path: '/screener',
    }))
  })

  it('拒绝非法事件名（防任意字符串进索引列）', async () => {
    for (const event of ['', 'Has Space', 'UPPER', 'a'.repeat(51), '事件']) {
      const res = await request(app()).post('/api/events').send({ event })
      expect(res.status, `event=${event}`).toBe(400)
    }
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('props 超过 2KB 拒绝', async () => {
    const res = await request(app()).post('/api/events')
      .send({ event: 'screener_ran', props: { blob: 'x'.repeat(3000) } })
    expect(res.status).toBe(413)
  })

  it('写入失败不影响调用方（返回 200）', async () => {
    insertValues.mockRejectedValueOnce(new Error('db down'))
    const res = await request(app()).post('/api/events').send({ event: 'screener_ran' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
  })
})
