import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import watchlistRoutes from '../routes/watchlist.js'
import authRoutes from '../routes/auth.js'

const app = createTestApp()
app.use('/api/auth', authRoutes)
app.use('/api/watchlist', watchlistRoutes)

let token = ''
const testUser = { email: `wl_${Date.now()}@quantceo.dev`, password: 'Test@123456' }

beforeAll(async () => {
  const res = await request(app).post('/api/auth/register').send(testUser)
  token = res.body.token
})

describe('Auth guard', () => {
  it('returns 401 without token for GET /api/watchlist', async () => {
    const res = await request(app).get('/api/watchlist')
    expect(res.status).toBe(401)
  })

  it('returns 401 without token for POST /api/watchlist', async () => {
    const res = await request(app).post('/api/watchlist').send({ code: '000001' })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/watchlist', () => {
  it('returns empty list for new user', async () => {
    const res = await request(app)
      .get('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('POST /api/watchlist', () => {
  it('adds a stock to watchlist', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000001', note: '测试股票' })
    expect(res.status).toBe(201)
    expect(res.body.code).toBe('000001')
    expect(res.body.note).toBe('测试股票')
  })

  it('rejects duplicate stock', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000001' })
    expect(res.status).toBe(409)
  })

  it('rejects missing code', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/watchlist/:id', () => {
  let itemId: number

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000002', note: 'temp' })
    itemId = res.body.id
  })

  it('deletes a watchlist item by id', async () => {
    const res = await request(app)
      .delete(`/api/watchlist/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('returns 404 for non-existent item', async () => {
    const res = await request(app)
      .delete('/api/watchlist/999999')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/watchlist (groupId validation)', () => {
  let groupId: number

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/watchlist/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '分组测试' })
    groupId = res.body.id
  })

  it('adds stock with valid groupId', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000007', note: 'in group', groupId })
    expect(res.status).toBe(201)
    expect(res.body.groupId).toBe(groupId)
  })

  it('rejects invalid groupId', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000008', groupId: 999999 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('指定的分组不存在')
  })
})

describe('Groups', () => {
  let groupId: number

  it('creates a group', async () => {
    const res = await request(app)
      .post('/api/watchlist/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '自选股', color: '#f59e0b' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('自选股')
    groupId = res.body.id
  })

  it('lists groups', async () => {
    const res = await request(app)
      .get('/api/watchlist/groups')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects empty group name', async () => {
    const res = await request(app)
      .post('/api/watchlist/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' })
    expect(res.status).toBe(400)
  })

  it('rejects group name exceeding 50 characters', async () => {
    const res = await request(app)
      .post('/api/watchlist/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'a'.repeat(51) })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('分组名称不能超过50字符')
  })

  it('deletes a group', async () => {
    const res = await request(app)
      .delete(`/api/watchlist/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/watchlist/batch', () => {
  it('adds multiple stocks at once', async () => {
    const res = await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000003', '000004', '000005'] })
    expect(res.status).toBe(201)
    expect(res.body.added).toBeGreaterThan(0)
  })

  it('rejects empty codes array', async () => {
    const res = await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: [] })
    expect(res.status).toBe(400)
  })

  it('rejects missing codes', async () => {
    const res = await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('rejects more than 100 codes', async () => {
    const codes = Array.from({ length: 101 }, (_, i) => `00000${i}`)
    const res = await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes })
    expect(res.status).toBe(400)
  })

  it('skips duplicate codes', async () => {
    const res = await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000003', '000003'] })
    expect(res.status).toBe(200)
    expect(res.body.added).toBe(0)
    expect(res.body.skipped).toBe(2)
  })
})

describe('DELETE /api/watchlist/batch', () => {
  it('validates empty codes array', async () => {
    const res = await request(app)
      .delete('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeTruthy()
  })

  it('validates missing codes', async () => {
    const res = await request(app)
      .delete('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('validates codes limit', async () => {
    const codes = Array.from({ length: 101 }, (_, i) => `00000${i}`)
    const res = await request(app)
      .delete('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/watchlist/:id', () => {
  let itemId: number

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000006', note: 'original' })
    itemId = res.body.id
  })

  it('updates note', async () => {
    const res = await request(app)
      .put(`/api/watchlist/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'updated note' })
    expect(res.status).toBe(200)
    expect(res.body.note).toBe('updated note')
  })

  it('returns 404 for non-existent item', async () => {
    const res = await request(app)
      .put('/api/watchlist/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'test' })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid id', async () => {
    const res = await request(app)
      .put('/api/watchlist/invalid')
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'test' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when no fields to update', async () => {
    const res = await request(app)
      .put(`/api/watchlist/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('allows empty note', async () => {
    const res = await request(app)
      .put(`/api/watchlist/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: '' })
    expect(res.status).toBe(200)
  })

  it('rejects invalid group id', async () => {
    const res = await request(app)
      .put(`/api/watchlist/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: 999999 })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/watchlist/groups/:id', () => {
  let groupId: number

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/watchlist/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '待改分组' })
    groupId = res.body.id
  })

  it('updates group name', async () => {
    const res = await request(app)
      .put(`/api/watchlist/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '新分组名' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('新分组名')
  })

  it('updates group color', async () => {
    const res = await request(app)
      .put(`/api/watchlist/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ color: '#ff0000' })
    expect(res.status).toBe(200)
    expect(res.body.color).toBe('#ff0000')
  })

  it('updates sortOrder', async () => {
    const res = await request(app)
      .put(`/api/watchlist/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sortOrder: 99 })
    expect(res.status).toBe(200)
    expect(res.body.sortOrder).toBe(99)
  })

  it('returns 404 for non-existent group', async () => {
    const res = await request(app)
      .put('/api/watchlist/groups/999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'test' })
    expect(res.status).toBe(404)
  })

  it('returns 400 for empty name', async () => {
    const res = await request(app)
      .put(`/api/watchlist/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for name exceeding 50 chars', async () => {
    const longName = 'a'.repeat(51)
    const res = await request(app)
      .put(`/api/watchlist/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: longName })
    expect(res.status).toBe(400)
  })

  it('returns 400 when no fields to update', async () => {
    const res = await request(app)
      .put(`/api/watchlist/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('POST /api/watchlist/batch (with groupId)', () => {
  let groupId: number

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/watchlist/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '批量分组' })
    groupId = res.body.id
  })

  it('batch adds stocks to a group', async () => {
    const res = await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000010', '000011'], groupId })
    expect(res.status).toBe(201)
    expect(res.body.added).toBeGreaterThan(0)
  })

  it('rejects batch with invalid groupId', async () => {
    const res = await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000012'], groupId: 999999 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('指定的分组不存在')
  })
})

describe('PUT /api/watchlist/:id (groupId=null)', () => {
  let itemId: number

  beforeAll(async () => {
    // Use 000001 which exists in stocks table
    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000001', note: 'has group' })
    // May be 409 if already added by another test — find an existing item instead
    if (res.status === 201) {
      itemId = res.body.id
    } else {
      // fetch the first watchlist item
      const list = await request(app)
        .get('/api/watchlist')
        .set('Authorization', `Bearer ${token}`)
      itemId = list.body[0]?.id
    }
  })

  it('sets groupId to null', async () => {
    if (!itemId) return
    const res = await request(app)
      .put(`/api/watchlist/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: null })
    expect(res.status).toBe(200)
    expect(res.body.groupId).toBeNull()
  })
})
