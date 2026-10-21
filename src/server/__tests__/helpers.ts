import express from 'express'
import type { Express } from 'express'

export function createTestApp(): Express {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  return app
}

export const TEST_USER = { email: 'test@quantceo.dev', password: 'Test@123456', name: '测试用户' }
