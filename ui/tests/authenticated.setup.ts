import { test as setup } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensureBootstrap } from "./auth-helpers"

const authFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "/tmp/expenses-web-playwright-bootstrap-admin.json"
)

setup("create authenticated storage state", async ({ request }) => {
  await ensureBootstrap(request)
  mkdirSync(dirname(authFile), { recursive: true })
  await request.storageState({ path: authFile })
})
