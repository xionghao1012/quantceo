process.env.PG_HOST = process.env.PG_HOST || '127.0.0.1'
process.env.PG_DB = 'quant_ceo_test'   // dedicated test DB
process.env.PG_USER = process.env.PG_USER || 'postgres'
process.env.PG_PASSWORD = process.env.PG_PASSWORD || 'postgres'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

// Polyfill globals needed by Node 18 / undici
if (typeof globalThis.File === 'undefined') {
  // @ts-ignore -- Node 18 缺少 File polyfill
  globalThis.File = class File {
    constructor(parts, filename) {
      this.name = filename
      this.size = parts.reduce((a, p) => a + (p.byteLength ?? p.length ?? 0), 0)
    }
  }
}
if (typeof globalThis.ReadableStream === 'undefined') {
  // @ts-ignore -- Node 18 缺少 ReadableStream polyfill
  globalThis.ReadableStream = class ReadableStream {}
}
if (typeof globalThis.FormData === 'undefined') {
  // @ts-ignore -- Node 18 缺少 FormData polyfill
  globalThis.FormData = class FormData {}
}
if (typeof globalThis.Headers === 'undefined') {
  // @ts-ignore -- Node 18 缺少 Headers polyfill
  globalThis.Headers = class Headers {}
}
