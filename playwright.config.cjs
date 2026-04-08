const { defineConfig, devices } = require("@playwright/test");

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const isWindows = process.platform === "win32";

module.exports = defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: `${baseURL}/login`,
        cwd: __dirname,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
  projects: [
    isWindows
      ? {
          name: "edge",
          use: {
            browserName: "chromium",
            channel: "msedge",
          },
        }
      : {
          name: "chromium",
          use: {
            ...devices["Desktop Chrome"],
          },
        },
  ],
});