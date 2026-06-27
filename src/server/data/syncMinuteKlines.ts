import { db } from '../db/db.js'
import { minuteKlines as minuteKlinesTable } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { fetchAkshareMinuteKlinesBatch } from './akshareMinute.js'
import { cacheSetMinuteKlinesBulk } from './redis.js'
import type { MinutePeriod, MinuteKLine } from '../../shared/types.js'
import { appendFileSync } from 'fs'

const PERIODS: MinutePeriod[] = ['m1', 'm5', 'm15', 'm30', 'm60']
const BATCH_SIZE = 10
const START_DATE = '2024-01-01'
const LOG = '/tmp/sync-batch.log'

function log(msg: string) {
  console.log(msg)
  appendFileSync(LOG, msg + '\n')
}

async function getExistingCodes(period: MinutePeriod): Promise<Set<string>> {
  const rows = await db.execute<{ code: string }>(
    `SELECT DISTINCT code FROM minute_klines WHERE period = '${period}'`
  )
  return new Set(rows.rows.map(r => r.code))
}

async function getAllCodes(): Promise<string[]> {
  const rows = await db.execute<{ code: string }>('SELECT code FROM stocks ORDER BY code')
  return rows.rows.map(r => r.code)
}

async function main() {
  log(`=== Minute klines batch sync ===`)
  log(`PID: ${process.pid}`)

  const allCodes = await getAllCodes()
  log(`Total stocks: ${allCodes.length}`)

  for (const period of PERIODS) {
    const existing = await getExistingCodes(period)
    const todo = allCodes.filter(c => !existing.has(c))
    log(`\n${period}: existing=${existing.size}, todo=${todo.length}`)
    if (todo.length === 0) continue

    let synced = 0
    let errors = 0

    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
      const batch = todo.slice(i, i + BATCH_SIZE)
      try {
        const result = await fetchAkshareMinuteKlinesBatch(batch, period, 600000)

        for (const code of batch) {
          const klines = result[code]
          if (!klines || klines.length === 0) {
            synced++
            continue
          }

          const withPeriod = klines.map((k: MinuteKLine) => ({ ...k, period }))
          const values = withPeriod.map((k: MinuteKLine & { period: MinutePeriod }) => ({
            code: k.code,
            datetime: new Date(k.datetime),
            period,
            open: String(k.open),
            high: String(k.high),
            low: String(k.low),
            close: String(k.close),
            volume: k.volume,
            amount: String(k.amount),
          }))

          for (let j = 0; j < values.length; j += 500) {
            await db.insert(minuteKlinesTable)
              .values(values.slice(j, j + 500))
              .onConflictDoNothing()
          }
          cacheSetMinuteKlinesBulk({ [`${period}:${code}`]: JSON.stringify(klines) })
            .catch(() => {})
          synced++
        }
      } catch (e: any) {
        errors += batch.length
        log(`  ERROR batch ${Math.floor(i / BATCH_SIZE) + 1} (codes ${batch[0]}-${batch[batch.length-1]}): ${e.message?.slice(0, 150)}`)
      }

      const pct = ((synced + errors) / todo.length * 100).toFixed(1)
      log(`  ${period}: ${synced}/${todo.length} done, ${errors} err (${pct}%)`)
    }

    log(`\n${period} done: ${synced} synced, ${errors} errors`)
  }

  log(`\nAll complete!`)
}

main().catch(e => {
  log(`FATAL: ${e?.stack || e?.message || e}`)
  process.exit(1)
})
