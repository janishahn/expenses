import { expect, test, type Page } from "./fixtures"
import {
  assistantTurns,
  chatIdFrom,
  composer,
  editAndUndoJourney,
  sendQuestion,
  stopJourney,
  unique,
  userTurns,
} from "./assistant-journeys"

// tests/e2e_ai_provider.py scripts the AI backend from the question: "slow", "long",
// "fail once", "add lunch", the write scenarios, or the default turn with reasoning, a
// note, one ledger read, and this answer.
const ANSWER = "You spent **1 234,56 €** in May.\n\n- Groceries: 800,00 €\n- Rent: 434,56 €\n\nThat is less than in April. See [Budgets](page:budgets).\n\n![Chart](https://example.invalid/chart.png)"

// The ledger footer shows "1–50 of 120" across pages, or only "3 transactions" on one page.
const ledgerFooter = (page: Page) => page.getByText(/^(\d+–\d+ of \d+|\d+ transactions?)$/)
const ledgerCount = (total: number) => new RegExp(`(^| of )${total}( transactions?)?$`)

// Loads Transactions, so its cached list has to refresh after a change, and returns its total.
async function ledgerTotal(page: Page): Promise<number> {
  await page.goto("/transactions")
  await expect(ledgerFooter(page).or(page.getByText("No transactions yet"))).toBeVisible()
  return (await ledgerFooter(page).count()) ? Number(/(\d+)( transactions?)?$/.exec(await ledgerFooter(page).innerText())![1]) : 0
}

test.describe("Assistant", () => {
  test("streams a turn with its activity, keeps the chat, and reopens it", async ({ page }) => {
    const question = unique("How much did I spend in May?")
    await page.goto("/assistant")
    await expect(page.getByRole("heading", { name: "Assistant", level: 1 })).toBeVisible()
    await expect(composer(page)).toHaveAttribute("placeholder", "Ask anything")
    await sendQuestion(page, question)

    const assistant = assistantTurns(page).last()
    await expect(userTurns(page).last()).toContainText(question)
    await expect(assistant).toContainText("You spent 1 234,56 € in May.")
    await expect(assistant.locator("strong")).toHaveText("1 234,56 €")
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
    await expect(page).toHaveURL(/\?chat=[0-9a-f]{32}$/)

    // The finished activity folds into the one ledger read; opening it lists every step.
    const activity = assistant.getByRole("button", { name: "Spending by category, May 2026" })
    await expect(activity).toHaveAttribute("aria-expanded", "false")
    await activity.click()
    await expect(activity).toHaveAttribute("aria-expanded", "true")
    await expect(assistant.getByText("I'll check May's spending.")).toBeVisible()
    await expect(assistant.getByRole("img", { name: "Done" })).toHaveCount(2)
    const reasoning = assistant.getByRole("button", { name: /^Thought for \d+s$/ })
    await reasoning.click()
    await expect(assistant.getByText("Checking May by category.")).toBeVisible()

    // Copy keeps the answer's Markdown source.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await assistant.getByRole("button", { name: "Copy response" }).click()
    await expect(assistant.getByRole("button", { name: "Copied" })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ANSWER)

    // The chat lives on the server: a reload shows it again.
    await page.reload()
    await expect(userTurns(page)).toHaveCount(1)
    await expect(assistantTurns(page).last()).toContainText("You spent 1 234,56 € in May.")
    await expect(assistantTurns(page).last().getByRole("button", { name: "Spending by category, May 2026" })).toBeVisible()

    // New chat clears the thread and lists the chat under Recent.
    await page.getByRole("button", { name: "New chat" }).click()
    await expect(userTurns(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/assistant$/)
    const recent = page.getByRole("region", { name: "Recent chats" })
    await expect(recent.getByRole("button").filter({ hasText: question })).toContainText("Today")
    await recent.getByRole("button").filter({ hasText: question }).click()
    await expect(assistantTurns(page).last()).toContainText("You spent 1 234,56 € in May.")

    // The header menu opens the same chats from inside another chat.
    const chatId = chatIdFrom(page)
    await page.getByRole("button", { name: "New chat" }).click()
    await page.getByRole("button", { name: "Recent chats" }).click()
    await page.getByRole("menuitem").filter({ hasText: question }).click()
    await expect(userTurns(page).last()).toContainText(question)
    expect(chatIdFrom(page)).toBe(chatId)
  })

  test("applies an approved change, refreshes the ledger, links the new transaction, and dismisses a long card after listing every row", async ({ page }) => {
    const totalBefore = await ledgerTotal(page)
    await page.getByRole("link", { name: "Assistant", exact: true }).click()
    await sendQuestion(page, unique("Add lunch for 12,50"))

    // The proposal ends the turn with a card; nothing is saved yet.
    const assistant = assistantTurns(page).last()
    const card = assistant.getByRole("region", { name: "Add 1 transaction" })
    await expect(card).toContainText("Lunch")
    await expect(card).toContainText("Uncategorized")
    await expect(card).toContainText("12,50 €")
    await expect(composer(page)).toBeEnabled()

    await card.getByRole("button", { name: "Add" }).click()
    await expect(card).toContainText("Added")
    await expect(card.getByRole("button")).toHaveCount(0)
    await expect(assistant).toContainText("Added Lunch.")
    // An answer that changed data can't run again.
    await expect(assistant.getByRole("button", { name: "Retry" })).toHaveCount(0)

    await page.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(ledgerFooter(page)).toHaveText(ledgerCount(totalBefore + 1))
    await page.goBack()
    await expect(assistant).toContainText("Added Lunch.")

    // The linked transaction opens in a peek beside the chat, and its full view returns to the chat.
    await assistant.getByRole("link", { name: "Lunch" }).click()
    const peek = page.getByRole("complementary", { name: "Lunch" })
    await expect(peek).toContainText("12,50")
    await expect(composer(page)).toBeVisible()
    await peek.getByRole("button", { name: "Open full view" }).click()
    await expect(page.locator("main h1")).toHaveText("Lunch")
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Assistant" }).click()
    await expect(assistantTurns(page).last()).toContainText("Added Lunch.")
    await expect(page.getByRole("complementary", { name: "Lunch" })).toHaveCount(0)

    await page.reload()
    await expect(assistantTurns(page).last().getByRole("region", { name: "Add 1 transaction" })).toContainText("Added")

    await sendQuestion(page, "Add ten lunches again")
    const second = assistantTurns(page).last().getByRole("region", { name: "Add 10 transactions" })
    await expect(second.getByText("Lunch", { exact: true })).toHaveCount(8)
    await second.getByRole("button", { name: "Show 2 more" }).click()
    await expect(second.getByText("Lunch", { exact: true })).toHaveCount(10)
    await second.getByRole("button", { name: "Dismiss" }).click()
    await expect(second).toContainText("Dismissed")
    await expect(assistantTurns(page).last()).toContainText("Okay, nothing changed.")
    await page.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(ledgerFooter(page)).toHaveText(ledgerCount(totalBefore + 1))
  })

  test("tags transactions from a card and undoes it", async ({ page }) => {
    await editAndUndoJourney(page)
  })

  test("stops an answer mid-stream and keeps what was written", async ({ page }) => {
    await stopJourney(page)
  })
})
