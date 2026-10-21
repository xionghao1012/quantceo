// 集中管理所有定时任务
// 单例源：scheduler 服务使用此配置
// 各服务内部 scheduler.ts 引用此配置，但通过 USE_EXTERNAL_SCHEDULER 开关决定是否注册

import { SERVICE_URLS } from './ports.js'

/**
 * @typedef {{ cron: string, name: string, service: keyof typeof SERVICE_URLS, path: string, body?: object, note?: string }} SchedulerJob
 */

/** @type {SchedulerJob[]} */
export const SCHEDULER_JOBS = [
  // ========== 盘前 ==========
  {
    cron: '0 8 * * 1-5',
    name: '08:00 — AI 每日精选',
    service: 'quantAi',
    path: '/api/ai/predictions/trigger-daily-picks',
    note: '生成每日精选推荐',
  },
  {
    cron: '30 8 * * 1-5',
    name: '08:30 — 仓位预警',
    service: 'quantTrading',
    path: '/api/internal/position-alerts',
    note: '分析持仓股，推送卖出建议',
  },

  // ========== 盘中 ==========
  {
    cron: '25 9 * * 1-5',
    name: '09:25 — 推送 AI 预测摘要',
    service: 'quantAi',
    path: '/api/ai/predictions/run-market',
    body: { count: 20 },
    note: '推送 Top 20 预测到客户端',
  },

  // ========== 盘后 ==========
  {
    cron: '30 15 * * 1-5',
    name: '15:30 — 计算每日指标',
    service: 'quantTrading',
    path: '/api/internal/compute-metrics',
    note: 'RSI/MACD/MA/Bollinger/波动率/动量',
  },
  {
    cron: '32 15 * * 1-5',
    name: '15:32 — 评估 AI 历史预测',
    service: 'quantAi',
    path: '/api/ai/predictions/evaluate',
    note: '计算历史预测准确率',
  },
  {
    cron: '33 15 * * 1-5',
    name: '15:33 — 评估每日精选表现',
    service: 'quantAi',
    path: '/api/ai/predictions/evaluate-picks',
    note: '计算精选股后续表现',
  },
  {
    cron: '35 15 * * 1-5',
    name: '15:35 — AI 预测生成',
    service: 'quantAi',
    path: '/api/ai/predictions/run-market',
    body: { count: 50, concurrency: 3, daysAhead: 1 },
    note: '对精选股+持仓股生成 LLM 预测',
  },
  {
    cron: '35 15 * * 1-5',
    name: '15:35 — 策略回测',
    service: 'backtestEngine',
    path: '/api/internal/strategy-backtest',
    note: 'Python engine 计算各策略表现',
  },

  // ========== 收盘后数据更新 ==========
  {
    cron: '0 18 * * 1-5',
    name: '18:00 — 刷新日 K 线数据',
    service: 'marketData',
    path: '/api/data/klines/refresh-all',
    body: { limit: 100 },
    note: '收盘后更新全市场日 K 线',
  },
  {
    cron: '30 18 * * 1-5',
    name: '18:30 — 全市场信号扫描',
    service: 'scanEngine',
    path: '/api/scan/market',
    body: { limit: 200 },
    note: '扫描全市场产生交易信号',
  },

  // ========== 周末 ==========
  {
    cron: '5 18 * * 5',
    name: '周五 18:05 — 周报扫描',
    service: 'scanEngine',
    path: '/api/scan/market',
    body: { limit: 200 },
    note: '在日 K 线刷新+扫描后运行',
  },
]

/** 帮助函数：根据 job 配置发送 HTTP 请求 */
export async function runScheduledJob(job) {
  const baseUrl = SERVICE_URLS[job.service]
  const url = `${baseUrl}${job.path}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: job.body ? JSON.stringify(job.body) : undefined,
    })
    if (!res.ok) {
      console.warn(`[Scheduler] ${job.name} returned ${res.status}`)
    }
  } catch (e) {
    console.error(`[Scheduler] ${job.name} failed:`, e.message)
  }
}
