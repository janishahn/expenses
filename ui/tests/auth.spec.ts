import { expect, freshInstanceTest as test, type Page } from "./fixtures"

const bootstrapUser = {
  username: "bootstrap-admin",
  password: "hunter22",
}

const secondUser = {
  username: "second-user",
  password: "hunter22",
}

async function submitAuthForm(
  page: Page,
  heading: "Create the admin account" | "Sign in" | "Create account",
  credentials: { username: string; password: string }
): Promise<void> {
  await expect(page.getByRole("heading", { name: heading })).toBeVisible()
  await page.getByLabel("Username").fill(credentials.username)
  await page.getByLabel("Password").fill(credentials.password)
  await page.getByRole("button", { name: heading === "Sign in" ? "Sign in" : "Create account" }).click()
}

test.describe.serial("Auth bootstrap and route guards", () => {
  test("fresh instance resolves to setup and guards deep links", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible()
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/transactions")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible()
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/admin")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible()

    await page.goto("/signup")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
  })

  test("setup bootstraps auth and authenticated users are redirected away from public auth routes", async ({
    page,
  }) => {
    await page.goto("/transactions")
    await expect(page).toHaveURL(/\/setup\?redirect=/)

    await submitAuthForm(page, "Create the admin account", bootstrapUser)
    await expect(page).toHaveURL(/\/transactions(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()

    for (const path of ["/setup", "/login", "/signup"]) {
      await page.goto(path)
      await expect(page).toHaveURL("/")
      await expect(page.locator("main h1")).toHaveText("Dashboard")
    }

    await page.reload()
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })

  test("logout enforces logged-out startup and login keeps deep-link intent", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)
    await expect(page.getByText("Expenses", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()

    await submitAuthForm(page, "Sign in", bootstrapUser)
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()

    await page.goto("/settings")
    await expect(page.locator("main h1")).toHaveText("Account")
    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.reload()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await submitAuthForm(page, "Sign in", {
      username: bootstrapUser.username,
      password: "wrong-password",
    })
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByRole("alert")).toHaveText("Invalid username or password")
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/budgets")
    await expect(page).toHaveURL(/\/login\?redirect=/)

    await submitAuthForm(page, "Sign in", bootstrapUser)
    await expect(page).toHaveURL(/\/budgets(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })

  test("signup is available post-bootstrap and created user can login", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)

    const username = `${secondUser.username}-${Date.now()}`
    await page.getByRole("link", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/signup(?:\?|$)/)

    await submitAuthForm(page, "Create account", { username, password: secondUser.password })
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByRole("status")).toHaveText("Account created. Sign in to continue.")
    await expect(page.getByLabel("Username")).toHaveValue(username)

    await page.getByLabel("Password").fill(secondUser.password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })
})
