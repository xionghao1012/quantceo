import { createRequire } from 'node:module'
import { eq, and } from 'drizzle-orm'
import type { recTracking } from '../db/schema.js'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface RecTrackingRow {
  id: number
  code: string
  name: string
  pickDate: string
  status: string
}

export interface IRecTrackingRepository {
  findByCodeAndDate(code: string, pickDate: string): Promise<RecTrackingRow | null>
  create(input: { code: string; name: string; pickDate: string; status: string }): Promise<void>
}

// Module-level singleton
let _repo: IRecTrackingRepository | null = null

export function setRecTrackingRepository(repo: IRecTrackingRepository): void {
  _repo = repo
}

export function getRecTrackingRepository(): IRecTrackingRepository {
  if (!_repo) {
     
    const { DrizzleRecTrackingRepository } = require('./DrizzleRecTrackingRepository.js')
    _repo = new DrizzleRecTrackingRepository()
  }
  return _repo!
}
