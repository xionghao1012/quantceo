import { createRequire } from 'node:module'
import type { stocks } from '../db/schema.js'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface Stock {
  id: number
  code: string
  name: string
  exchange: string
  status: string
}

export interface IStocksRepository {
  findAll(): Promise<Stock[]>
}

// Module-level singleton
let _repo: IStocksRepository | null = null

export function setStocksRepository(repo: IStocksRepository): void {
  _repo = repo
}

export function getStocksRepository(): IStocksRepository {
  if (!_repo) {
     
    const { DrizzleStocksRepository } = require('./DrizzleStocksRepository.js')
    _repo = new DrizzleStocksRepository()
  }
  return _repo!
}
