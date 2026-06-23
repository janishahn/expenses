import { defineConfig, devices } from "@playwright/test"

const authStorageStatePath = "/tmp/expenses-web-playwright-bootstrap-admin.json"
const backendPort = process.env.EXPENSES_E2E_BACKEND_PORT ?? "18180"
const backendUrl = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // All e2e projects share one backend and temp SQLite DB; serial execution avoids cross-spec write contention.
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "auth-bootstrap-chromium",
      testMatch: /(^|\/)auth\.spec\.ts$/,
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "authenticated-setup",
      testMatch: /.*authenticated\.setup\.ts/,
      dependencies: ["auth-bootstrap-chromium"],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "desktop-chromium",
      dependencies: ["authenticated-setup"],
      testIgnore: [/.*\.mobile\.spec\.ts/, /(^|\/)auth\.spec\.ts$/, /.*\.setup\.ts/],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        storageState: authStorageStatePath,
      },
    },
    {
      name: "mobile-webkit",
      dependencies: ["authenticated-setup"],
      testMatch: /.*\.mobile\.spec\.ts/,
      use: {
        browserName: "webkit",
        ...devices["iPhone 15"],
        storageState: authStorageStatePath,
      },
    },
  ],
  webServer: [
    {
      command:
        `cd .. && EXPENSES_DATA_DIR="$(mktemp -d)" && export EXPENSES_DATA_DIR && trap 'rm -rf "$EXPENSES_DATA_DIR"' EXIT INT TERM && uv run python -m alembic upgrade head && uv run python -m uvicorn expenses_web.app:app --host 127.0.0.1 --port ${backendPort}`,
      url: `${backendUrl}/api/csrf`,
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
    {
      command:
        `VITE_API_PROXY_TARGET=${backendUrl} npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`,
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
  ],
})
