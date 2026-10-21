import { createRequire } from 'node:module'
import type { apiKeys } from '../db/schema.js'
import { eq, desc, and } from 'drizzle-orm'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface ApiKeyRow {
  id: number
  userId: number
  name: string
  keyPrefix: string
  keyHash: string
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

export interface ApiKeySummary {
  id: number
  name: string
  keyPrefix: string
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

export interface CreateApiKeyInput {
  userId: number
  name: string
  keyPrefix: string
  keyHash: string
  expiresAt?: Date
}

export interface IApiKeysRepository {
  create(input: CreateApiKeyInput): Promise<{ id: number; name: string; keyPrefix: string; createdAt: Date }>
  findByUserId(userId: number): Promise<ApiKeySummary[]>
  findByHash(hash: string): Promise<{ id: number; userId: number; expiresAt: Date | null } | null>
  delete(keyId: number, userId: number): Promise<void>
  updateLastUsed(keyId: number): Promise<void>
}

// Module-level singleton
let _repo: IApiKeysRepository | null = null

export function setApiKeysRepository(repo: IApiKeysRepository): void {
  _repo = repo
}

export function getApiKeysRepository(): IApiKeysRepository {
  if (!_repo) {
     
    const { DrizzleApiKeysRepository } = require('./DrizzleApiKeysRepository.js')
    _repo = new DrizzleApiKeysRepository()
  }
  return _repo!
}
