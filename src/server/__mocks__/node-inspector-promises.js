// Mock for node:inspector/promises (available only in Node 22+)
// Used by @vitest/coverage-v8
export class Session {
  async connect() {}
  async disconnect() {}
  post() { return Promise.resolve() }
}
export default { Session }
