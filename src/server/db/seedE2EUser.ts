import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { users } from './schema.js'
import { eq } from 'drizzle-orm'

const { Pool } = pg
const pool = new Pool({
  host: process.env.PG_HOST || '127.0.0.1',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB || 'quant_ceo',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
})
const db = drizzle(pool)

const E2E_USER = { email: '435541900@qq.com', password: 'quant123', name: 'E2E Test User' }

async function seed() {
  const existing = await db.select().from(users).where(eq(users.email, E2E_USER.email)).limit(1)
  if (existing.length > 0) {
    console.log(`E2E test user ${E2E_USER.email} already exists, skipping`)
    await pool.end()
    return
  }

  const passwordHash = await bcrypt.hash(E2E_USER.password, 10)
  await db.insert(users).values({
    email: E2E_USER.email,
    name: E2E_USER.name,
    passwordHash,
    role: 'free',
  })
  console.log(`Created E2E test user: ${E2E_USER.email}`)
  await pool.end()
}

seed().catch((err) => {
  console.error('Failed to seed E2E user:', err)
  process.exit(1)
})
