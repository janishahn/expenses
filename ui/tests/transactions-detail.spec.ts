import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

type StoredTransaction = {
  title: string
  amount_cents: number
}

async function fetchTransaction(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/transactions/${id}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as StoredTransaction
}

async function createCategory(
  request: APIRequestContext,
  token: string,
  type: "income" | "expense",
  name: string,
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": token },
    data: { name, type, order: 0 },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function seedExpense(request: APIRequestContext, label: string) {
  const token = await getCsrfToken(request)
  const categoryId = await ensureCategory(request, token, "expense", `E2E ${label}`)
  const title = `E2E ${label} ${Date.now()}`
  const id = await createTransaction(request, token, {
    date: "2026-04-18",
    occurred_at: "2026-04-18T09:30:00",
    type: "expense",
    amount_cents: 1234,
    category_id: categoryId,
    title,
    tags: [],
  })
  return { token, title, id }
}

const peekUrl = (title: string, id: number) =>
  `/transactions?q=${encodeURIComponent(title)}&peek=${id}`

test.describe("Transaction peek and full view", () => {
  test("saves the title and amount inline with Enter and discards them with Esc", async ({
    page,
    request,
  }) => {
    const { title, id } = await seedExpense(request, "Inline Edit")
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    const newTitle = `${title} renamed`
    await peek.getByRole("button", { name: "Edit Title" }).click()
    await peek.getByRole("textbox", { name: "Title" }).fill(newTitle)
    const titleSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/transactions/${id}`) &&
        response.request().method() === "PUT" &&
        response.ok(),
    )
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")
    await titleSaved
    await expect(peek.getByRole("button", { name: "Edit Title" })).toContainText(newTitle)
    expect((await fetchTransaction(request, id)).title).toBe(newTitle)

    await peek.getByRole("button", { name: "Edit Amount" }).click()
    await peek.getByRole("textbox", { name: "Amount" }).fill("45,67")
    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("45,67")
    await expect.poll(async () => (await fetchTransaction(request, id)).amount_cents).toBe(4567)

    await peek.getByRole("button", { name: "Edit Title" }).click()
    await peek.getByRole("textbox", { name: "Title" }).fill("Discarded title")
    await peek.getByRole("textbox", { name: "Title" }).press("Escape")
    await expect(peek.getByRole("button", { name: "Edit Title" })).toContainText(newTitle)
    // Esc leaves the editor first; the peek stays open.
    await expect(peek).toBeVisible()
    expect((await fetchTransaction(request, id)).title).toBe(newTitle)
  })

  test("shows the server error and keeps the entered value when a save fails", async ({
    page,
    request,
  }) => {
    const { token, title, id } = await seedExpense(request, "Save Failure")
    const targetName = `E2E Failure Target ${Date.now()}`
    await createCategory(request, token, "expense", targetName)
    const failure = "Save failed from test"
    await page.route(`**/api/transactions/${id}`, async (route, routed) => {
      if (routed.method() !== "PUT") {
        await route.continue()
        return
      }
      await route.fulfill({ status: 500, json: { detail: failure } })
    })

    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "Edit Title" }).click()
    const titleField = peek.getByRole("textbox", { name: "Title" })
    await titleField.fill(`${title} edited`)
    await titleField.press("Enter")
    await expect(peek.getByRole("alert")).toHaveText(failure)
    await expect(titleField).toHaveValue(`${title} edited`)
    await titleField.press("Escape")

    await peek.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("option", { name: targetName }).click()
    await expect(peek.getByRole("alert")).toHaveText(failure)
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()
    expect((await fetchTransaction(request, id)).title).toBe(title)
  })

})
