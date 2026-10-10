import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Served from a sub-path, like a GitHub Pages project site.
    baseURL: `http://localhost:${PORT}/rankup-chess/`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Serve the staged site, the exact files GitHub Pages publishes, so a file
    // missing from the deploy fails the tests instead of only the live app.
    command: `node tools/stage-site.mjs .e2e-site && node tools/serve.mjs --port ${PORT} --base /rankup-chess/ --root .e2e-site`,
    url: `http://localhost:${PORT}/rankup-chess/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
    // The wider device matrix runs in CI, where every browser is installed.
    ...(process.env.PW_ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: /@mobile/ },
          { name: 'safari', use: { ...devices['Desktop Safari'] }, grepInvert: /@mobile/ },
          { name: 'iphone', use: { ...devices['iPhone 14'] }, grep: /@mobile/ },
          { name: 'ipad', use: { ...devices['iPad (gen 7)'] }, grep: /@mobile/ },
        ]
      : []),
  ],
});
