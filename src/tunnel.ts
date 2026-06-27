import { spawn, execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function startTunnel(): void {
  const tunnel = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-R', '80:localhost:3001',
    'serveo.net',
  ], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, https_proxy: '', http_proxy: '' },
  })

  tunnel.unref()

  tunnel.stdout.on('data', (data: Buffer) => {
    const text = data.toString()
    const match = text.match(/https:\/\/[^\s]*\.serveousercontent\.com/)
    if (match) {
      const url = match[0]
      console.log(`\n🌐 Public URL: ${url}`)
      writeFileSync('/tmp/quant_public_url.txt', url)
    }
    process.stdout.write(text)
  })

  tunnel.stderr.on('data', (data: Buffer) => {
    const text = data.toString()
    const match = text.match(/https:\/\/[^\s]*\.serveousercontent\.com/)
    if (match) {
      const url = match[0]
      console.log(`\n🌐 Public URL: ${url}`)
      writeFileSync('/tmp/quant_public_url.txt', url)
    }
    process.stderr.write(text)
  })

  tunnel.on('exit', (code) => {
    console.log(`Tunnel exited with code ${code}`)
  })

  console.log('🚇 Starting Serveo tunnel...')
}

startTunnel()
