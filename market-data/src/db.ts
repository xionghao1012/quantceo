import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { pgTable, serial, varchar, numeric, date, timestamp, text } from 'drizzle-orm/pg-core'

const { Pool } = pg

const poolConfig: any = {
  host: process.env.PG_HOST || '/var/run/postgresql',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB || 'quant_ceo',
  user: process.env.PG_USER || 'postgres',
}
if (process.env.PG_PASSWORD) poolConfig.password = process.env.PG_PASSWORD

const pool = new Pool(poolConfig)
export const db = drizzle(pool)
export { pool }

export const stocks = pgTable('stocks', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).unique().notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  exchange: varchar('exchange', { length: 10 }).notNull(),
  status: varchar('status', { length: 20 }).default('active'),
})

export const klines = pgTable('klines', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  date: date('date').notNull(),
  open: numeric('open', { precision: 10, scale: 4 }),
  high: numeric('high', { precision: 10, scale: 4 }),
  low: numeric('low', { precision: 10, scale: 4 }),
  close: numeric('close', { precision: 10, scale: 4 }),
  volume: numeric('volume', { precision: 20, scale: 0 }),
  amount: numeric('amount', { precision: 20, scale: 2 }),
})

export const minuteKlines = pgTable('minute_klines', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  period: varchar('period', { length: 10 }).notNull(),
  time: timestamp('time').notNull(),
  open: numeric('open', { precision: 10, scale: 4 }),
  high: numeric('high', { precision: 10, scale: 4 }),
  low: numeric('low', { precision: 10, scale: 4 }),
  close: numeric('close', { precision: 10, scale: 4 }),
  volume: numeric('volume', { precision: 20, scale: 0 }),
  amount: numeric('amount', { precision: 20, scale: 2 }),
})
