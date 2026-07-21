import { request, test as base } from "@playwright/test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensureBootstrap } from "./auth-helpers"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

type Backend = {
  url: string
  dataDir: string
  process: ChildProcess
}

async function startBackend(): Promise<Backend> {
  const dataDir = mkdtempSync(join(tmpdir(), "expenses-e2e-"))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EXPENSES_DATA_DIR: dataDir,
    EXPENSES_AUTH_SIGNUP_ENABLED: "true",
    EXPENSES_LLM_ENABLED: "true",
    EXPENSES_LLM_BASE_URL: "http://127.0.0.1:1/v1",
  }
  delete env.EXPENSES_DATABASE_URL

  const migrate = spawnSync("uv", ["run", "python", "-m", "alembic", "upgrade", "head"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  })
  if (migrate.status !== 0) {
    rmSync(dataDir, { recursive: true, force: true })
    throw new Error(`alembic upgrade failed:\n${migrate.stdout}${migrate.stderr}`)
  }

  // The child binds port 0 itself and reports the kernel-assigned port before
  // uvicorn starts, so concurrent workers can never race each other for the
  // same probed-then-released port. Uvicorn's own startup log line is not
  // usable for this: the app's setup_logging() reroutes it away from stderr.
  const serverScript = [
    "import socket",
    "import uvicorn",
    'sock = socket.create_server(("127.0.0.1", 0))',
    'print(f"EXPENSES_E2E_PORT={sock.getsockname()[1]}", flush=True)',
    'uvicorn.run("expenses.app:app", fd=sock.fileno(), access_log=False)',
  ].join("\n")
  const child = spawn("uv", ["run", "python", "-c", serverScript], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output: Buffer[] = []
  child.stdout!.on("data", (chunk: Buffer) => output.push(chunk))
  child.stderr!.on("data", (chunk: Buffer) => output.push(chunk))

  const deadline = Date.now() + 120_000
  let url: string | undefined
  for (;;) {
    if (child.exitCode !== null) {
      rmSync(dataDir, { recursive: true, force: true })
      throw new Error(`backend exited during startup:\n${Buffer.concat(output).toString()}`)
    }
    if (!url) {
      const bound = Buffer.concat(output).toString().match(/EXPENSES_E2E_PORT=(\d+)/)
      if (bound) {
        url = `http://127.0.0.1:${bound[1]}`
      }
    }
    if (url) {
      try {
        const response = await fetch(`${url}/api/csrf`)
        if (response.ok) {
          break
        }
      } catch {
        // not listening yet
      }
    }
    if (Date.now() > deadline) {
      child.kill()
      rmSync(dataDir, { recursive: true, force: true })
      throw new Error(`backend not ready after 120s:\n${Buffer.concat(output).toString()}`)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  return { url, dataDir, process: child }
}

async function stopBackend(backend: Backend): Promise<void> {
  if (backend.process.exitCode === null && backend.process.signalCode === null) {
    const exited = new Promise((resolveExit) => backend.process.once("exit", resolveExit))
    if (backend.process.kill()) {
      await exited
    }
  }
  rmSync(backend.dataDir, { recursive: true, force: true })
}

// Every worker gets its own migrated temporary database and FastAPI server, so
// workers can run concurrently while tests within a worker stay serial.
const backendTest = base.extend<object, { backend: Backend }>({
  backend: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const backend = await startBackend()
      await use(backend)
      await stopBackend(backend)
    },
    { scope: "worker" },
  ],
  baseURL: async ({ backend }, use) => {
    await use(backend.url)
  },
})

// For auth.spec.ts: a pristine instance where first-run setup has not happened.
export const freshInstanceTest = backendTest

export const test = backendTest.extend<object, { workerStorageState: string }>({
  workerStorageState: [
    async ({ backend }, use) => {
      const statePath = join(backend.dataDir, "storage-state.json")
      const context = await request.newContext({ baseURL: backend.url })
      await ensureBootstrap(context)
      await context.storageState({ path: statePath })
      await context.dispose()
      await use(statePath)
    },
    { scope: "worker" },
  ],
  storageState: async ({ workerStorageState }, use) => {
    await use(workerStorageState)
  },
})

export * from "@playwright/test"
