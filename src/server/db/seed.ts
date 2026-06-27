import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { stocks } from './schema.js'

const { Pool } = pg
const pool = new Pool({
  host: process.env.PG_HOST || '/var/run/postgresql',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DB || 'quant_ceo',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
})
const db = drizzle(pool)

const seedStocks = [
  { code: '600519', name: '贵州茅台', exchange: 'SH' },
  { code: '000858', name: '五粮液', exchange: 'SZ' },
  { code: '300750', name: '宁德时代', exchange: 'SZ' },
  { code: '000333', name: '美的集团', exchange: 'SZ' },
  { code: '601318', name: '中国平安', exchange: 'SH' },
  { code: '600036', name: '招商银行', exchange: 'SH' },
  { code: '000651', name: '格力电器', exchange: 'SZ' },
  { code: '000002', name: '万科A', exchange: 'SZ' },
  { code: '600887', name: '伊利股份', exchange: 'SH' },
  { code: '600900', name: '长江电力', exchange: 'SH' },
]

async function seed() {
  for (const s of seedStocks) {
    await db.insert(stocks).values({ ...s, status: 'active' }).onConflictDoNothing()
  }
  console.log(`Seeded ${seedStocks.length} stocks`)
  await pool.end()
}

seed()
