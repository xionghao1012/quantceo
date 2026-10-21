import { db } from '../db/db.js'
import { exportTasks } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import type { IExportTaskRepository, CreateExportTaskInput } from './IExportTaskRepository.js'

export class DrizzleExportTaskRepository implements IExportTaskRepository {
  async create(input: CreateExportTaskInput): Promise<{ id: number }> {
    const [row] = await db.insert(exportTasks).values({
      userId: input.userId,
      type: input.type,
      params: input.params,
      status: 'pending',
      progress: 0,
    } as any).returning()
    return { id: row.id }
  }

  async updateProgress(id: number, progress: number): Promise<void> {
    await db.update(exportTasks).set({ progress }).where(eq(exportTasks.id, id))
  }

  async complete(id: number, filePath: string): Promise<void> {
    await db.update(exportTasks).set({
      status: 'completed',
      filePath,
      progress: 100,
      completedAt: new Date(),
    }).where(eq(exportTasks.id, id))
  }

  async fail(id: number, error: string): Promise<void> {
    await db.update(exportTasks).set({ status: 'failed', error }).where(eq(exportTasks.id, id))
  }
}
