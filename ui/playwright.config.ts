import { defineConfig, devices } from "@playwright/test"

const desktopViewport = { width: 1280, height: 800 }
const criticalDesktopMatch = /.*\.critical\.spec\.ts/
const criticalMobileMatch = /.*\.critical\.mobile\.spec\.ts/

// Backends are per-worker fixtures (see tests/fixtures.ts), so workers scale
// with CPU cores while each worker keeps serial access to its own database.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Browser launch and paint slow down when many workers share the machine;
  // WebKit especially can spend >20s starting a context under load.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  // Files are the distribution unit (fullyParallel: false), so a single long
  // spec file caps the whole run; surface anything that grows past two minutes.
  reportSlowTests: { max: 10, threshold: 120_000 },
  use: {
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "auth-bootstrap-chromium",
      testMatch: /(^|\/)auth\.spec\.ts$/,
      use: {
        browserName: "chromium",
        viewport: desktopViewport,
      },
    },
    {
      name: "desktop-chromium",
      testIgnore: [/.*\.mobile\.spec\.ts/, /(^|\/)auth\.spec\.ts$/],
      use: {
        browserName: "chromium",
        viewport: desktopViewport,
      },
    },
    {
      name: "auth-bootstrap-mobile-webkit",
      testMatch: /(^|\/)auth\.mobile\.spec\.ts$/,
      expect: { timeout: 15_000 },
      use: {
        browserName: "webkit",
        ...devices["iPhone 15"],
      },
    },
    {
      name: "mobile-webkit",
      testMatch: /.*\.mobile\.spec\.ts/,
      testIgnore: [/(^|\/)auth\.mobile\.spec\.ts$/],
      // WebKit paints slowest under parallel load; charts and screenshot
      // stabilization need a wider assertion budget than the other projects.
      expect: { timeout: 15_000 },
      use: {
        browserName: "webkit",
        ...devices["iPhone 15"],
      },
    },
    {
      name: "critical-desktop-firefox",
      testMatch: criticalDesktopMatch,
      use: {
        browserName: "firefox",
        viewport: desktopViewport,
      },
    },
    {
      name: "critical-desktop-webkit",
      testMatch: criticalDesktopMatch,
      use: {
        browserName: "webkit",
        viewport: desktopViewport,
      },
    },
    {
      name: "critical-mobile-chromium",
      testMatch: criticalMobileMatch,
      use: {
        browserName: "chromium",
        ...devices["Pixel 7"],
      },
    },
  ],
})
