import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

type StoredTransaction = {
  title: string
  amount_cents: number
  type: string
  category_id: number | null
  category: { name: string } | null
  date: string
  occurred_at: string
  description: string | null
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

async function seedExpense(
  request: APIRequestContext,
  label: string,
  extra: { description?: string; amount_cents?: number; tags?: string[]; date?: string } = {},
) {
  const token = await getCsrfToken(request)
  const categoryId = await ensureCategory(request, token, "expense", `E2E ${label}`)
  const title = `E2E ${label} ${Date.now()}`
  const date = extra.date ?? "2026-04-18"
  const id = await createTransaction(request, token, {
    date,
    occurred_at: `${date}T09:30:00`,
    type: "expense",
    amount_cents: extra.amount_cents ?? 1234,
    category_id: categoryId,
    title,
    description: extra.description,
    tags: extra.tags ?? [],
  })
  return { token, categoryId, title, id }
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

  test("keeps the booking date and the exact time when another field changes", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Keep Date")
    const title = `E2E Keep Date ${Date.now()}`
    const id = await createTransaction(request, token, {
      date: "2026-03-20",
      occurred_at: "2026-04-18T10:05:37.250731",
      type: "expense",
      amount_cents: 1234,
      category_id: categoryId,
      title,
      tags: [],
    })
    const before = await fetchTransaction(request, id)

    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })
    await peek.getByRole("button", { name: "Edit Title" }).click()
    await peek.getByRole("textbox", { name: "Title" }).fill(`${title} renamed`)
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")
    await expect.poll(async () => (await fetchTransaction(request, id)).title).toBe(`${title} renamed`)
    const after = await fetchTransaction(request, id)
    expect(after.date).toBe("2026-03-20")
    expect(after.occurred_at).toBe(before.occurred_at)
  })

  test("refuses a save over a newer version and saves the kept entry on retry", async ({ page, request }) => {
    const { token, title, id } = await seedExpense(request, "Stale Save", { amount_cents: 1000 })
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("10,00")

    // Another tab changes the amount after this one loaded the record.
    const stored = await fetchTransaction(request, id)
    const elsewhere = await request.put(`/api/transactions/${id}`, {
      headers: { "X-CSRF-Token": token },
      data: {
        date: stored.date,
        occurred_at: stored.occurred_at,
        type: stored.type,
        amount_cents: 1200,
        category_id: stored.category_id,
        title: stored.title,
        description: stored.description,
        is_reimbursement: false,
        tags: [],
      },
    })
    expect(elsewhere.ok()).toBeTruthy()

    await peek.getByRole("button", { name: "Edit Title" }).click()
    const titleField = peek.getByRole("textbox", { name: "Title" })
    await titleField.fill(`${title} stale`)
    await titleField.press("Enter")
    await expect(peek.getByRole("alert")).toBeVisible()
    await expect(titleField).toHaveValue(`${title} stale`)
    // The newer version loads under the kept entry.
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("12,00")
    expect((await fetchTransaction(request, id)).title).toBe(title)
    expect((await fetchTransaction(request, id)).amount_cents).toBe(1200)

    // Leaving the field does not send the refused entry again.
    await titleField.press("Tab")
    await expect(titleField).not.toBeFocused()
    expect((await fetchTransaction(request, id)).title).toBe(title)

    await titleField.focus()
    await titleField.press("Enter")
    const renamed = page.getByRole("complementary", { name: `${title} stale` })
    await expect(renamed.getByRole("button", { name: "Edit Title" })).toBeVisible()
    await expect(renamed.getByRole("alert")).toHaveCount(0)
    await expect.poll(async () => (await fetchTransaction(request, id)).title).toBe(`${title} stale`)
    expect((await fetchTransaction(request, id)).amount_cents).toBe(1200)
  })

  test("sends an amount once when Enter is followed by Tab and the save is refused", async ({ page, request }) => {
    const { token, title, id } = await seedExpense(request, "Enter Then Tab", { amount_cents: 1000 })
    await page.goto(peekUrl(title, id))
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("10,00")

    const stored = await fetchTransaction(request, id)
    const elsewhere = await request.put(`/api/transactions/${id}`, {
      headers: { "X-CSRF-Token": token },
      data: {
        date: stored.date,
        occurred_at: stored.occurred_at,
        type: stored.type,
        amount_cents: 1200,
        category_id: stored.category_id,
        title: stored.title,
        description: "Changed elsewhere",
        is_reimbursement: false,
        tags: [],
      },
    })
    expect(elsewhere.ok()).toBeTruthy()

    let puts = 0
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(`**/api/transactions/${id}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue()
      puts += 1
      await held
      await route.continue()
    })
    await peek.getByRole("button", { name: "Edit Amount" }).click()
    const amount = peek.getByRole("textbox", { name: "Amount" })
    await amount.fill("15,00")
    await amount.press("Enter")
    await amount.press("Tab")
    release()

    // The refused save is over once the newer version shows.
    await expect(peek.getByText("Changed elsewhere")).toBeVisible()
    await expect(peek.getByRole("alert")).toBeVisible()
    await expect(amount).toHaveValue("15,00")
    expect((await fetchTransaction(request, id)).amount_cents).toBe(1200)
    expect(puts).toBe(1)

    // Entered again and left, the field sends the kept amount.
    await amount.focus()
    await amount.press("Tab")
    await expect.poll(async () => (await fetchTransaction(request, id)).amount_cents).toBe(1500)
    expect(puts).toBe(2)
  })
})
