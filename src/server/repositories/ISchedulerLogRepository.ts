import { createRequire } from 'node:module'
import { eq, and, desc } from 'drizzle-orm'
import type { schedulerLog } from '../db/schema.js'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface SchedulerLogRow {
  taskName: string
  execDate: string
  status: string
  itemsProcessed: number | null
  errorMessage: string | null
  startedAt: Date
  completedAt: Date
}

export interface ISchedulerLogRepository {
  insertStart(taskName: string, execDate: string): Promise<void>
  upsertEnd(taskName: string, execDate: string, itemsProcessed: number, err?: string): Promise<void>
  findLastSuccess(taskName: string): Promise<string | null>
}

// Module-level singleton
let _repo: ISchedulerLogRepository | null = null

export function setSchedulerLogRepository(repo: ISchedulerLogRepository): void {
  _repo = repo
}

export function getSchedulerLogRepository(): ISchedulerLogRepository {
  if (!_repo) {
     
    const { DrizzleSchedulerLogRepository } = require('./DrizzleSchedulerLogRepository.js')
    _repo = new DrizzleSchedulerLogRepository()
  }
  return _repo!
}
