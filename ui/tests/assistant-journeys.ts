import { expect, type Page } from "@playwright/test"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

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

export const chatIdFrom = (page: Page) => new URL(page.url()).searchParams.get("chat")

async function transaction(page: Page, id: number) {
  return (await (await page.request.get(`/api/transactions/${id}`)).json()) as { tags: string[]; reimbursed_total_cents: number }
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
  // The saved turn can't tell Stop from a closed page, so a reopened chat says Interrupted.
  await page.reload()
  await expect(assistantTurns(page).last()).toContainText("Word30")
  await expect(assistantTurns(page).last()).toContainText("Interrupted")

  // Reloading mid-answer ends the run the same way, and the reloaded chat shows what was written.
  await page.getByRole("button", { name: "New chat" }).click()
  await sendQuestion(page, unique("Give me a slow answer"))
  await expect(assistantTurns(page).last().locator("p")).toContainText("Word30")
  await expect(page).toHaveURL(/[?&]chat=[0-9a-f]+/)
  await page.reload()
  await expect(assistantTurns(page).last()).toContainText("Word30")
  await expect(assistantTurns(page).last()).not.toContainText("Word399")
  await expect(assistantTurns(page).last()).toContainText("Interrupted")
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
  const card = assistantTurns(page).last().getByRole("region", { name: "Update 2 transactions" })
  await expect(card).toContainText("Add work")
  await expect(card.getByText(`Coffee ${token}`, { exact: true })).toHaveCount(2)
  await expect(card).toContainText("+work")
  await card.getByRole("button", { name: "Update" }).click()
  await expect(card).toContainText("Updated")
  await expect(assistantTurns(page).last()).toContainText("Done: Updated 2 transactions.")
  await expect.poll(tags).toEqual([["work"], ["work"]])

  // The undo card names the change it reverses and keeps its outcome after a reload.
  await sendQuestion(page, "Undo that")
  const undo = assistantTurns(page).last().getByRole("region", { name: "Undo: Updated 2 transactions" })
  await expect(undo.getByText(`Coffee ${token}`, { exact: true })).toHaveCount(2)
  await expect(undo).toContainText("−work")
  await undo.getByRole("button", { name: "Undo" }).click()
  await expect(undo).toContainText("Undone")
  await expect.poll(tags).toEqual([[], []])
  await page.reload()
  await expect(assistantTurns(page).last().getByRole("region", { name: "Undo: Updated 2 transactions" })).toContainText("Undone")
}
