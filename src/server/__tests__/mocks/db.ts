import { vi } from 'vitest'

// Creates a thenable query builder mock that supports chained methods
function makeQueryBuilder(rows: any[] = []) {
  const qb: any = {}
  qb.then = (_resolve: (v: any) => void) => resolveTo(rows)
  qb.execute = vi.fn().mockResolvedValue(rows)
  qb.from = vi.fn().mockReturnValue(qb)
  qb.where = vi.fn().mockReturnValue(qb)
  qb.innerJoin = vi.fn().mockReturnValue(qb)
  qb.leftJoin = vi.fn().mockReturnValue(qb)
  qb.limit = vi.fn().mockReturnValue(qb)
  qb.offset = vi.fn().mockReturnValue(qb)
  qb.orderBy = vi.fn().mockReturnValue(qb)
  qb.groupBy = vi.fn().mockReturnValue(qb)
  qb.having = vi.fn().mockReturnValue(qb)
  qb.returning = vi.fn().mockResolvedValue(rows)
  qb.and = vi.fn().mockReturnValue(qb)
  qb.or = vi.fn().mockReturnValue(qb)
  return qb
}

function resolveTo<T>(value: T): Promise<T> {
  return Promise.resolve(value)
}

export function createMockDb(initialRows: Record<string, any[]> = {}): any {
  const mockSelect = vi.fn(() => {
    const qb: any = {}
    qb.then = (_resolve: (v: any) => void) => resolveTo(initialRows[''] || [])
    qb.execute = vi.fn().mockResolvedValue(initialRows[''] || [])
    qb.from = vi.fn().mockReturnValue(qb)
    qb.where = vi.fn().mockReturnValue(qb)
    qb.innerJoin = vi.fn().mockReturnValue(qb)
    qb.leftJoin = vi.fn().mockReturnValue(qb)
    qb.limit = vi.fn().mockReturnValue(qb)
    qb.offset = vi.fn().mockReturnValue(qb)
    qb.orderBy = vi.fn().mockReturnValue(qb)
    qb.groupBy = vi.fn().mockReturnValue(qb)
    qb.having = vi.fn().mockReturnValue(qb)
    qb.returning = vi.fn().mockResolvedValue(initialRows[''] || [])
    return qb
  })

  const mockInsert = vi.fn(() => {
    const qb: any = {}
    qb.values = vi.fn().mockReturnValue(qb)
    qb.onConflictDoNothing = vi.fn().mockResolvedValue([])
    qb.onConflictDoUpdate = vi.fn().mockReturnValue(qb)
    qb.returning = vi.fn().mockResolvedValue([])
    qb.execute = vi.fn().mockResolvedValue([])
    return qb
  })

  const mockUpdate = vi.fn(() => {
    const qb: any = {}
    qb.set = vi.fn().mockReturnValue(qb)
    qb.where = vi.fn().mockReturnValue(qb)
    qb.returning = vi.fn().mockResolvedValue([])
    qb.execute = vi.fn().mockResolvedValue([])
    return qb
  })

  const mockDelete = vi.fn(() => {
    const qb: any = {}
    qb.where = vi.fn().mockReturnValue(qb)
    qb.returning = vi.fn().mockResolvedValue([])
    qb.execute = vi.fn().mockResolvedValue([])
    return qb
  })

  const mockExecute = vi.fn().mockResolvedValue([])

  return {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    execute: mockExecute,
  }
}

export { makeQueryBuilder, resolveTo }
