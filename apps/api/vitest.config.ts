import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Model registration and the shared in-memory replica set are process-wide,
    // so test files run one at a time rather than in parallel workers.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/mizuki-test',
      JWT_SECRET: 'test-jwt-secret-that-is-long-enough-to-pass-validation',
      CRON_SECRET: 'test-cron-secret-value',
      WOO_WEBHOOK_SECRET: 'test-woo-webhook-secret',
      PUBLIC_API_URL: 'http://localhost:4000',
      PUBLIC_SITE_URL: 'http://localhost:8080',
      LOG_LEVEL: 'silent',
      // Set so the studio's "someone just booked" alert is exercised for real. Without an
      // alert channel configured there is nothing to queue, and the tests would pass while
      // proving nothing about the notification the client specifically asked for.
      ADMIN_ALERT_EMAIL: 'studio@example.com',
    },
  },
})
