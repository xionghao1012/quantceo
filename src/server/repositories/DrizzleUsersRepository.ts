import { db } from '../db/db.js'
import { users } from '../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import type { IUsersRepository, UserRow } from './IUsersRepository.js'

export class DrizzleUsersRepository implements IUsersRepository {
  async findProUsers(): Promise<UserRow[]> {
    return db.select({ id: users.id, role: users.role, email: users.email })
      .from(users)
      .where(eq(users.role, 'premium'))
  }

  async findByIds(ids: number[]): Promise<UserRow[]> {
    if (ids.length === 0) return []
    return db.select({ id: users.id, role: users.role, email: users.email })
      .from(users)
      .where(inArray(users.id, ids))
  }
}
