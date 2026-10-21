/**
 * 浏览器端 E2E（ADR-0013）：本机 Chrome + 自带的开发服务器（独立端口），读真实的 model/ 描述。
 * 运行：npm run test:e2e
 */
import { defineConfig } from '@playwright/test'

const PORT = 5393

export default defineConfig({
  testDir: 'e2e',
  // 首次打开项目时布局在 Worker 中计算、开发服务器按需编译，留足余量
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
