import cron from 'node-cron'
import http from 'http'
import { PORTS, SERVICE_URLS } from './config/ports.js'
import { SCHEDULER_JOBS, runScheduledJob } from './config/scheduler-jobs.js'

const PORT = Number(process.env.PORT) || PORTS.scheduler
const SERVICE_NAME = 'scheduler'

// Health endpoint (no Express dep — using http directly)
const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      service: SERVICE_NAME,
      uptime: process.uptime(),
      cronJobs: SCHEDULER_JOBS.length,
      jobs: SCHEDULER_JOBS.map(j => ({ time: j.cron, name: j.name })),
    }))
  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

// 注册所有定时任务（从集中配置读取）
for (const job of SCHEDULER_JOBS) {
  cron.schedule(job.cron, async () => {
    console.log(`[Scheduler] ${job.name}`)
    try {
      await runScheduledJob(job)
    } catch (e: any) {
      console.error(`[Scheduler] ${job.name} failed:`, e.message)
    }
  })
}

console.log(`[Scheduler] All ${SCHEDULER_JOBS.length} cron jobs registered.`)
console.log('[Scheduler] Services:', JSON.stringify(SERVICE_URLS))

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Scheduler] Health server on port ${PORT}`)
})
