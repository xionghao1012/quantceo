// 集中管理所有服务端口
// 使用方式: import { PORTS } from './config/ports.js'
// 或在 .env / docker-compose.yml 中直接引用 PORT 值

/** @type {Record<string, number>} */
export const PORTS = {
  quantTrading:   4001,
  quantSso:      3002,
  quantAi:        4002,
  marketData:     4003,
  scanEngine:     4004,
  indicatorService: 4005,
  scheduler:      3010,
  backtestEngine: 4006,
}

/** Docker 网络内服务 URL（供 scheduler 等内部服务调用） */
export const SERVICE_URLS = {
  quantTrading:   process.env.QUANT_TRADING_URL   || `http://quant-trading:${PORTS.quantTrading}`,
  quantAi:        process.env.QUANT_AI_URL        || `http://quant-ai:${PORTS.quantAi}`,
  marketData:     process.env.MARKET_DATA_URL      || `http://market-data:${PORTS.marketData}`,
  scanEngine:     process.env.SCAN_ENGINE_URL      || `http://scan-engine:${PORTS.scanEngine}`,
  backtestEngine: process.env.BACKTEST_ENGINE_URL || `http://backtest-engine:${PORTS.backtestEngine}`,
}
