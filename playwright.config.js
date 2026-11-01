const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT || 3000);

module.exports = defineConfig({
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: process.env.PW_REPORT_DIR || 'playwright-report', open: 'never' }],
    ['junit', { outputFile: `${process.env.PW_REPORT_DIR || 'playwright-report'}/junit.xml` }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    launchOptions: {
      slowMo: Number(process.env.SLOWMO || 0),
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'ru-RU',
  },
  projects: [
    { name: 'ui', testDir: './tests/lr3_ui', use: { ...devices['Desktop Chrome'] } },
    { name: 'api', testDir: './tests/lr4_api', use: { ...devices['Desktop Chrome'] } },
    { name: 'security', testDir: './tests/lr6_security', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
