import { db } from '../db/db.js'
import { schedulerLog } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import type { ISchedulerLogRepository } from './ISchedulerLogRepository.js'

export class DrizzleSchedulerLogRepository implements ISchedulerLogRepository {
  async insertStart(taskName: string, execDate: string): Promise<void> {
    await db.insert(schedulerLog).values({
      taskName,
      execDate,
      status: 'running',
      startedAt: new Date(),
      completedAt: new Date(),
    }).onConflictDoNothing()
  }

  async upsertEnd(taskName: string, execDate: string, itemsProcessed: number, err?: string): Promise<void> {
    await db.insert(schedulerLog).values({
      taskName,
      execDate,
      status: err ? 'failed' : 'success',
      itemsProcessed,
      errorMessage: err || null,
      completedAt: new Date(),
    }).onConflictDoUpdate({
      target: [schedulerLog.taskName, schedulerLog.execDate],
      set: { status: err ? 'failed' : 'success', itemsProcessed, errorMessage: err || null, completedAt: new Date() },
    })
  }

  async findLastSuccess(taskName: string): Promise<string | null> {
    const rows = await db.select({ execDate: schedulerLog.execDate })
      .from(schedulerLog)
      .where(and(eq(schedulerLog.taskName, taskName), eq(schedulerLog.status, 'success')))
      .orderBy(desc(schedulerLog.execDate))
      .limit(1)
    return rows[0]?.execDate || null
  }
}
