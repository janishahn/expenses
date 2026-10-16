import { expect, type Locator, type Page } from "@playwright/test"
import { createCategory, createTransaction, ensureCategory, getCsrfToken } from "./helpers"

// Assistant journeys shared by assistant.spec.ts and assistant.mobile.spec.ts. The AI
// backend is tests/e2e_ai_provider.py, which scripts each turn from the question.

export const thread = (page: Page) => page.getByRole("log", { name: "Conversation" })
export const assistantTurns = (page: Page) => page.getByRole("article", { name: "Assistant" })
export const userTurns = (page: Page) => page.getByRole("article", { name: "You" })
export const composer = (page: Page) => page.getByRole("textbox", { name: "Message the Assistant" })

// Chats and data from earlier tests in the worker stay, so each question and record is
// unique. Write scenarios find their records by the question's last word.
const newToken = () => Math.random().toString(36).slice(2, 8)
export const unique = (text: string) => `${text} ${newToken()}`

export async function sendQuestion(page: Page, text: string) {
  const input = composer(page)
  await input.click()
  await input.fill(text)
  await page.getByRole("button", { name: "Send" }).click()
}

// Distance from the top of the conversation log to the top of an article.
export const offsetInThread = (turn: Locator) =>
  turn.evaluate((element) => element.getBoundingClientRect().top - element.closest('[role="log"]')!.getBoundingClientRect().top)

export const chatIdFrom = (page: Page) => new URL(page.url()).searchParams.get("chat")

async function transaction(page: Page, id: number) {
  return (await (await page.request.get(`/api/transactions/${id}`)).json()) as { tags: string[]; reimbursed_total_cents: number }
}

export async function followUpJourney(page: Page) {
  await page.goto("/assistant")
  await sendQuestion(page, unique("How much did I spend in May?"))
  await expect(assistantTurns(page).last()).toContainText("less than in April")
  const chatId = chatIdFrom(page)
  await sendQuestion(page, "And in April?")
  await expect(assistantTurns(page)).toHaveCount(2)
  await expect(assistantTurns(page).last()).toContainText("less than in April")
  expect(chatIdFrom(page)).toBe(chatId)

  // Only the last answer can be answered again.
  await expect(assistantTurns(page).first().getByRole("button", { name: "Retry" })).toHaveCount(0)
  await expect(assistantTurns(page).last().getByRole("button", { name: "Retry" })).toBeVisible()
}

export async function privacyJourney(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("ew.privacy", "on"))
  await page.goto("/assistant")
  await sendQuestion(page, unique("Did I spend more than 1 000 € in May?"))

  await expect(assistantTurns(page).last()).toContainText("You spent •••• in May.")
  await expect(userTurns(page).last()).toContainText("Did I spend more than •••• in May?")
  await expect(thread(page)).not.toContainText("1 234")
}

export async function stopJourney(page: Page) {
  await page.goto("/assistant")
  await sendQuestion(page, unique("Give me a slow answer"))

  // Words render as they stream, before the answer ends.
  const assistant = assistantTurns(page).last()
  await expect(assistant.locator("p")).toContainText("Word30")
  await expect(assistant).not.toContainText("Word399")
  await page.getByRole("button", { name: "Stop" }).click()

  await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  await expect(assistant).toContainText("Stopped")
  await expect(assistant.getByRole("button", { name: "Retry" })).toBeVisible()

  // The server saves the stopped turn once its run has wound down.
  const chatId = chatIdFrom(page)
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/assistant/chats/${chatId}`)
      return response.ok() ? ((await response.json()) as { turns: { status: string }[] }).turns[0]?.status : null
    })
    .toBe("stopped")
  await page.reload()
  await expect(assistantTurns(page).last()).toContainText("Word30")
  await expect(assistantTurns(page).last()).toContainText("Stopped")
}

export async function failureJourney(page: Page) {
  await page.goto("/assistant")
  await sendQuestion(page, unique("Fail once, then tell me about May"))

  const assistant = assistantTurns(page).last()
  await expect(assistant).toContainText("The AI backend rejected the server's credentials.")
  await expect(composer(page)).toBeEnabled()

  await assistant.getByRole("button", { name: "Retry" }).click()
  await expect(assistantTurns(page).last()).toContainText("You spent 1 234,56 € in May.")
  await expect(page.getByText("The AI backend rejected the server's credentials.")).toHaveCount(0)
  await expect(userTurns(page)).toHaveCount(1)
}

export async function chatRetentionJourney(page: Page) {
  await page.goto("/settings")
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Assistant", exact: true }).click()
  await expect(page).toHaveURL("/settings/assistant")

  const keep = page.getByRole("radiogroup", { name: "Keep chats" })
  await expect(keep.getByRole("radio", { name: "14 days" })).toBeChecked()
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/assistant/settings") && response.request().method() === "PUT")
  await keep.getByRole("radio", { name: "30 days" }).click()
  await saved
  await page.reload()
  await expect(keep.getByRole("radio", { name: "30 days" })).toBeChecked()
  await keep.getByRole("radio", { name: "14 days" }).click()
  await expect(keep.getByRole("radio", { name: "14 days" })).toBeChecked()
}

export async function editAndUndoJourney(page: Page) {
  const token = newToken()
  const csrfToken = await getCsrfToken(page.request)
  const categoryId = await ensureCategory(page.request, csrfToken, "expense", "Assistant")
  const ids = await Promise.all(
    ["2021-03-02", "2021-03-09"].map((date) =>
      createTransaction(page.request, csrfToken, {
        date,
        occurred_at: `${date}T09:00:00`,
        type: "expense",
        amount_cents: 350,
        category_id: categoryId,
        title: `Coffee ${token}`,
        tags: [],
      })
    )
  )
  const tags = async () => Promise.all(ids.map(async (id) => (await transaction(page, id)).tags))

  await page.goto("/assistant")
  await sendQuestion(page, `Tag the coffees as work ${token}`)
  const card = assistantTurns(page).last().getByRole("region", { name: "Edit 2 transactions" })
  await expect(card).toContainText("Add work")
  await expect(card.getByText(`Coffee ${token}`, { exact: true })).toHaveCount(2)
  await expect(card).toContainText("+work")
  await card.getByRole("button", { name: "Apply" }).click()
  await expect(card).toContainText("Applied")
  await expect(assistantTurns(page).last()).toContainText("Done: Edited 2 transactions.")
  await expect.poll(tags).toEqual([["work"], ["work"]])

  // The undo card names the change it reverses and keeps its outcome after a reload.
  await sendQuestion(page, "Undo that")
  const undo = assistantTurns(page).last().getByRole("region", { name: "Undo: Edited 2 transactions" })
  await expect(undo.getByText(`Coffee ${token}`, { exact: true })).toHaveCount(2)
  await expect(undo).toContainText("−work")
  await undo.getByRole("button", { name: "Undo" }).click()
  await expect(undo).toContainText("Undone")
  await expect.poll(tags).toEqual([[], []])
  await page.reload()
  await expect(assistantTurns(page).last().getByRole("region", { name: "Undo: Edited 2 transactions" })).toContainText("Undone")
}

export async function allocateJourney(page: Page) {
  const token = newToken()
  const csrfToken = await getCsrfToken(page.request)
  const expenseCategory = await ensureCategory(page.request, csrfToken, "expense", "Assistant")
  const incomeCategory = await ensureCategory(page.request, csrfToken, "income", "Assistant")
  await createTransaction(page.request, csrfToken, {
    date: "2021-04-10",
    occurred_at: "2021-04-10T09:00:00",
    type: "income",
    amount_cents: 6000,
    category_id: incomeCategory,
    title: `Refund ${token}`,
    tags: [],
    is_reimbursement: true,
  })
  const dinners = await Promise.all(
    [
      { date: "2021-04-01", amount_cents: 4000 },
      { date: "2021-04-02", amount_cents: 2000 },
    ].map(({ date, amount_cents }) =>
      createTransaction(page.request, csrfToken, {
        date,
        occurred_at: `${date}T19:00:00`,
        type: "expense",
        amount_cents,
        category_id: expenseCategory,
        title: `Dinner ${token}`,
        tags: [],
      })
    )
  )
  const reimbursed = async () => Promise.all(dinners.map(async (id) => (await transaction(page, id)).reimbursed_total_cents))
  const question = `Pay back half of each dinner from the refund ${token}`
  const title = new RegExp(`^Allocate 30,00\\s€ from Refund ${token}$`)

  // Dismissing the card leaves both dinners as they were, also after a reload.
  await page.goto("/assistant")
  await sendQuestion(page, question)
  const dismissed = assistantTurns(page).last().getByRole("region", { name: title })
  await expect(dismissed).toContainText("20,00 € of 40,00 €")
  await expect(dismissed).toContainText("10,00 € of 20,00 €")
  await expect(dismissed).toContainText("30,00 € of 60,00 €")
  await dismissed.getByRole("button", { name: "Dismiss" }).click()
  await expect(dismissed).toContainText("Dismissed")
  await expect(assistantTurns(page).last()).toContainText("Okay, nothing changed.")
  await page.reload()
  await expect(assistantTurns(page).last().getByRole("region", { name: title })).toContainText("Dismissed")
  expect(await reimbursed()).toEqual([0, 0])

  await sendQuestion(page, question)
  const card = assistantTurns(page).last().getByRole("region", { name: title })
  await card.getByRole("button", { name: "Allocate" }).click()
  await expect(card).toContainText("Allocated")
  await expect(assistantTurns(page).last()).toContainText(`Done: Allocated 30,00 € from Refund ${token}.`)
  await expect.poll(reimbursed).toEqual([2000, 1000])
}

export async function budgetAndUndoJourney(page: Page) {
  const token = newToken()
  const csrfToken = await getCsrfToken(page.request)
  const categoryId = await createCategory(page.request, csrfToken, "expense", `Hobbies ${token}`)
  // This month's budget for the category, or null without one.
  const budget = async () => {
    const { budgets } = (await (await page.request.get("/api/budgets")).json()) as {
      budgets: { scope_category_id: number | null; amount_cents: number }[]
    }
    return budgets.find((row) => row.scope_category_id === categoryId)?.amount_cents ?? null
  }

  await page.goto("/assistant")
  await sendQuestion(page, `Budget 300 € a month for hobbies ${token}`)
  const card = assistantTurns(page).last().getByRole("region", { name: "Set 1 budget" })
  await expect(card).toContainText(`Hobbies ${token}`)
  await expect(card).toContainText(/From \w{3} \d{4} · new/)
  await expect(card).toContainText("300,00 €")
  await card.getByRole("button", { name: "Save" }).click()
  await expect(card).toContainText("Saved")
  await expect.poll(budget).toBe(30_000)

  await sendQuestion(page, "Undo that")
  const undo = assistantTurns(page).last().getByRole("region", { name: `Undo: Set the Hobbies ${token} budget` })
  await expect(undo).toContainText(/From \w{3} \d{4} · removed/)
  await undo.getByRole("button", { name: "Undo" }).click()
  await expect(undo).toContainText("Undone")
  await expect.poll(budget).toBeNull()
}
