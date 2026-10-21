import { db } from '../db/db.js'
import { apiKeys } from '../db/schema.js'
import { eq, desc, and } from 'drizzle-orm'
import type { IApiKeysRepository, ApiKeySummary, CreateApiKeyInput } from './IApiKeysRepository.js'

export class DrizzleApiKeysRepository implements IApiKeysRepository {
  async create(input: CreateApiKeyInput): Promise<{ id: number; name: string; keyPrefix: string; createdAt: Date }> {
    const [row] = await db.insert(apiKeys).values({
      userId: input.userId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      keyHash: input.keyHash,
      expiresAt: input.expiresAt ?? undefined,
    } as any).returning()
    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt,
    }
  }

  async findByUserId(userId: number): Promise<ApiKeySummary[]> {
    return db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    }).from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt))
  }

  async findByHash(hash: string): Promise<{ id: number; userId: number; expiresAt: Date | null } | null> {
    const rows = await db.select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      expiresAt: apiKeys.expiresAt,
    }).from(apiKeys)
      .where(eq(apiKeys.keyHash, hash))
      .limit(1)
    return rows[0] ?? null
  }

  async delete(keyId: number, userId: number): Promise<void> {
    await db.delete(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
  }

  async updateLastUsed(keyId: number): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId))
  }
}
