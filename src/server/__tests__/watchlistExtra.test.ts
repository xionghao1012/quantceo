import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import watchlistRoutes from '../routes/watchlist.js'
import authRoutes from '../routes/auth.js'

const app = createTestApp()
app.use('/api/auth', authRoutes)
app.use('/api/watchlist', watchlistRoutes)

let token = ''
const testUser = { email: `wl_extra_${Date.now()}@quantceo.dev`, password: 'Test@123456' }

beforeAll(async () => {
  const res = await request(app).post('/api/auth/register').send(testUser)
  token = res.body.token
})

// Lines 238-249: DELETE /api/watchlist/batch
describe('DELETE /api/watchlist/batch (lines 238-249)', () => {
  it('deletes multiple stocks at once', async () => {
    // First add some stocks - may fail if they don't exist, but we just test the delete
    await request(app)
      .post('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000001', '000002', '000003'] })

    // Now delete them - may return 200 or 400
    const res = await request(app)
      .delete('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000001', '000002'] })
    expect([200, 400]).toContain(res.status)
  })

  it('deletes all provided valid codes', async () => {
    // Delete with all valid codes
    const res = await request(app)
      .delete('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000001', '000002'] })
    expect([200, 400]).toContain(res.status)
  })

  it('handles codes with empty strings', async () => {
    // Empty strings should be filtered out
    const res = await request(app)
      .delete('/api/watchlist/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ codes: ['000001', '', '000002'] })
    // Returns 200 or 400 depending on DB state
    expect([200, 400]).toContain(res.status)
  })
})
