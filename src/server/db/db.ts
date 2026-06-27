import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

const { Pool } = pg

const pool = new Pool({
  host: process.env.PG_HOST || '/var/run/postgresql',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB || 'quant_ceo',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
})

export const db = drizzle(pool)
export { pool }
