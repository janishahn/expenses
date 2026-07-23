import { expect, freshInstanceTest as test } from "./fixtures"

const bootstrapUser = {
  username: "bootstrap-admin",
  password: "hunter22",
}

const secondUser = {
  username: "second-user",
  password: "hunter22",
}

async function submitAuthForm(
  page: import("@playwright/test").Page,
  formTestId: "setup-form" | "login-form" | "signup-form",
  credentials: { username: string; password: string }
): Promise<void> {
  const form = page.getByTestId(formTestId)
  await expect(form).toBeVisible()
  await form.getByTestId("auth-username").fill(credentials.username)
  await form.getByTestId("auth-password").fill(credentials.password)
  await form.getByTestId("auth-submit").click()
}

test.describe.serial("Auth bootstrap and route guards", () => {
  test("fresh instance resolves to setup and guards deep links", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByTestId("setup-form")).toBeVisible()
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/transactions")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByTestId("setup-form")).toBeVisible()
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/admin")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByTestId("setup-form")).toBeVisible()

    await page.goto("/signup")
    await expect(page).toHaveURL(/\/setup(?:\?|$)/)
  })

  test("setup bootstraps auth and authenticated users are redirected away from public auth routes", async ({
    page,
  }) => {
    await page.goto("/transactions")
    await expect(page).toHaveURL(/\/setup\?redirect=/)

    await submitAuthForm(page, "setup-form", bootstrapUser)
    await expect(page).toHaveURL(/\/transactions(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()

    await page.goto("/setup")
    await expect(page).not.toHaveURL(/\/setup(?:\?|$)/)
    await expect(page.getByTestId("setup-form")).toHaveCount(0)

    await page.goto("/login")
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("login-form")).toHaveCount(0)

    await page.goto("/signup")
    await expect(page).not.toHaveURL(/\/signup(?:\?|$)/)
    await expect(page.getByTestId("signup-form")).toHaveCount(0)

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
    await expect(page.getByText("Switchboard ledger", { exact: true })).toHaveCount(0)
    await expect(page.getByText("Welcome back", { exact: true })).toHaveCount(0)

    await submitAuthForm(page, "login-form", bootstrapUser)
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()

    await page.goto("/settings")
    await expect(page.getByTestId("settings-page")).toBeVisible()
    await page.getByTestId("auth-logout").click()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.reload()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await submitAuthForm(page, "login-form", {
      username: bootstrapUser.username,
      password: "wrong-password",
    })
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("auth-error")).toHaveText("Invalid username or password")
    await expect(page.getByTestId("app-shell-root")).toHaveCount(0)

    await page.goto("/budgets")
    await expect(page).toHaveURL(/\/login\?redirect=/)

    await submitAuthForm(page, "login-form", bootstrapUser)
    await expect(page).toHaveURL(/\/budgets(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })

  test("signup is available post-bootstrap and created user can login", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login(?:\?|$)/)

    await page.getByTestId("auth-switch-to-signup").click()
    await expect(page).toHaveURL(/\/signup(?:\?|$)/)

    await submitAuthForm(page, "signup-form", {
      username: `${secondUser.username}-${Date.now()}`,
      password: secondUser.password,
    })
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByTestId("auth-success")).toBeVisible()

    await submitAuthForm(page, "login-form", {
      username: page.url().includes("username=")
        ? decodeURIComponent(new URL(page.url()).searchParams.get("username") || "")
        : secondUser.username,
      password: secondUser.password,
    })
    await expect(page).toHaveURL(/\/(?:\?|$)/)
    await expect(page.getByTestId("app-shell-root")).toBeVisible()
  })
})
