import { DrizzleExportTaskRepository } from './DrizzleExportTaskRepository.js'

export interface ExportTaskRow {
  id: number
  userId: string | null
  type: string
  status: string
  params: Record<string, any>
  progress: number
  filePath: string | null
  error: string | null
  createdAt: Date
  completedAt: Date | null
}

export interface CreateExportTaskInput {
  userId?: string
  type: string
  params: Record<string, any>
}

export interface IExportTaskRepository {
  create(input: CreateExportTaskInput): Promise<{ id: number }>
  updateProgress(id: number, progress: number): Promise<void>
  complete(id: number, filePath: string): Promise<void>
  fail(id: number, error: string): Promise<void>
}

// Module-level singleton
let _repo: IExportTaskRepository | null = null

export function setExportTaskRepository(repo: IExportTaskRepository): void {
  _repo = repo
}

export function getExportTaskRepository(): IExportTaskRepository {
  if (!_repo) {
    _repo = new DrizzleExportTaskRepository()
  }
  return _repo!
}
