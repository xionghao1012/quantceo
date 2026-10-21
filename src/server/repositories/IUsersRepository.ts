import { createRequire } from 'node:module'
import { eq } from 'drizzle-orm'
import type { users } from '../db/schema.js'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface UserRow {
  id: number
  role: string
  email: string
}

export interface IUsersRepository {
  findProUsers(): Promise<UserRow[]>
  findByIds(ids: number[]): Promise<UserRow[]>
}

// Module-level singleton
let _repo: IUsersRepository | null = null

export function setUsersRepository(repo: IUsersRepository): void {
  _repo = repo
}

export function getUsersRepository(): IUsersRepository {
  if (!_repo) {
     
    const { DrizzleUsersRepository } = require('./DrizzleUsersRepository.js')
    _repo = new DrizzleUsersRepository()
  }
  return _repo!
}
