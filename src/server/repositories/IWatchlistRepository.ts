import {DrizzleWatchlistRepository} from './DrizzleWatchlistRepository.js';
export interface WatchlistItem {
  id: number
  userId: number
  groupId: number | null
  code: string
  note: string
  addedAt: Date
}

export interface WatchlistGroup {
  id: number
  userId: number
  name: string
  color: string
  sortOrder: number
  createdAt: Date
}

export interface CreateWatchlistInput {
  userId: number
  code: string
  note?: string
  groupId?: number | null
}

export interface UpdateWatchlistInput {
  note?: string
  groupId?: number | null
}

export interface CreateGroupInput {
  userId: number
  name: string
  color?: string
  sortOrder?: number
}

export interface UpdateGroupInput {
  name?: string
  color?: string
  sortOrder?: number
}

export interface IWatchlistRepository {
  // Watchlist items
  findItemsByUserId(userId: number): Promise<WatchlistItem[]>
  findItemById(id: number, userId: number): Promise<WatchlistItem | null>
  findItemByCode(userId: number, code: string): Promise<WatchlistItem | null>
  createItem(input: CreateWatchlistInput): Promise<WatchlistItem>
  updateItem(id: number, userId: number, input: UpdateWatchlistInput): Promise<WatchlistItem>
  deleteItem(id: number, userId: number): Promise<void>
  deleteItemsByCodes(userId: number, codes: string[]): Promise<number>

  // Watchlist groups
  findGroupsByUserId(userId: number): Promise<WatchlistGroup[]>
  findGroupById(id: number, userId: number): Promise<WatchlistGroup | null>
  getMaxSortOrder(userId: number): Promise<number>
  createGroup(input: CreateGroupInput): Promise<WatchlistGroup>
  updateGroup(id: number, userId: number, input: UpdateGroupInput): Promise<WatchlistGroup>
  deleteGroup(id: number, userId: number): Promise<void>
}

// Module-level repository instance
let _repo: IWatchlistRepository | null = null

export function setWatchlistRepository(repo: IWatchlistRepository): void {
  _repo = repo
}

export function getWatchlistRepository(): IWatchlistRepository {
  if (!_repo) {
    
    _repo = new DrizzleWatchlistRepository()
  }
  return _repo!
}
