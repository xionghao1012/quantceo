import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 15000,
    setupFiles: ['vitest.setup.ts'],
    globalSetup: ['src/server/__tests__/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/server/routes/**/*.ts',
        'src/server/services/**/*.ts',
        'src/server/middleware/**/*.ts',
        'src/server/engine/**/*.ts',
        'src/server/ai/**/*.ts',
        'src/server/scan/**/*.ts',
        'src/server/backtest/**/*.ts',
      ],
      exclude: [
        // DB infrastructure - not business logic
        'src/server/db/schema.ts',
        'src/server/db/init.ts',
        'src/server/db/seed.ts',
        'src/server/db/seed*.ts',
        // External integrations - require live APIs / third-party bindings
        'src/server/data/**/*.ts',
        'src/server/services/payment/**/*.ts',
        'src/server/services/push/**/*.ts',
        'src/server/services/wsServer.ts',
        'src/server/services/scheduler.ts',
        'src/server/services/pdf.ts',
        'src/server/routes/push.ts',
        'src/server/ai/pythonRunner.ts',
        'src/server/ai/wechatHeat.ts',
        'src/server/ai/weiboSentiment.ts',
        // Complex algorithm - internal functions not exportable without deep refactor
        'src/server/scan/index.ts',
        // Long-running infra
        'src/server/workers/**/*.ts',
        // Test files
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
    },
    include: ['src/server/__tests__/**/*.test.ts'],
  },
})
