import { expect, test, type Page } from "./fixtures"
import {
  allocateJourney,
  archiveAndUndoJourney,
  assistantTurns,
  budgetAndUndoJourney,
  chatIdFrom,
  chatRetentionJourney,
  composer,
  editAndUndoJourney,
  endRecurringAndUndoJourney,
  failureJourney,
  followUpJourney,
  offsetInThread,
  privacyJourney,
  removeBudgetAndUndoJourney,
  sendQuestion,
  stopJourney,
  thread,
  trashAndUndoJourney,
  unique,
  userTurns,
} from "./assistant-journeys"

// tests/e2e_ai_provider.py scripts the AI backend from the question: "slow", "long",
// "fail once", "add lunch", the write scenarios, or the default turn with reasoning, a
// note, one ledger read, and this answer.
const ANSWER = "You spent **1 234,56 €** in May.\n\n- Groceries: 800,00 €\n- Rent: 434,56 €\n\nThat is less than in April. See [Budgets](page:budgets).\n\n![Chart](https://example.invalid/chart.png)"

const ledgerFooter = (page: Page) => page.getByText(/^\d+–\d+ of \d+$/)

// Loads Transactions, so its cached list has to refresh after a change, and returns its total.
async function ledgerTotal(page: Page): Promise<number> {
  await page.goto("/transactions")
  await expect(ledgerFooter(page).or(page.getByText("No transactions yet"))).toBeVisible()
  return (await ledgerFooter(page).count()) ? Number(/of (\d+)$/.exec(await ledgerFooter(page).innerText())![1]) : 0
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
    const recent = page.getByRole("region", { name: "Recent" })
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

  test("asks a follow-up in the same chat", async ({ page }) => {
    await followUpJourney(page)
  })

  test("applies an approved change, refreshes the ledger, links the new transaction, and dismisses a long card after listing every row", async ({ page }) => {
    const totalBefore = await ledgerTotal(page)
    await page.getByRole("link", { name: "Assistant", exact: true }).click()
    await sendQuestion(page, unique("Add lunch for 12,50"))

    // The proposal ends the turn with a card; nothing is saved yet.
    const assistant = assistantTurns(page).last()
    const card = assistant.getByRole("region", { name: "1 new transaction" })
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
    await expect(ledgerFooter(page)).toHaveText(new RegExp(` of ${totalBefore + 1}$`))
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
    await expect(assistantTurns(page).last().getByRole("region", { name: "1 new transaction" })).toContainText("Added")

    await sendQuestion(page, "Add ten lunches again")
    const second = assistantTurns(page).last().getByRole("region", { name: "10 new transactions" })
    await expect(second.getByText("Lunch", { exact: true })).toHaveCount(8)
    await second.getByRole("button", { name: "Show 2 more" }).click()
    await expect(second.getByText("Lunch", { exact: true })).toHaveCount(10)
    await second.getByRole("button", { name: "Dismiss" }).click()
    await expect(second).toContainText("Dismissed")
    await expect(assistantTurns(page).last()).toContainText("Okay, nothing changed.")
    await page.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(ledgerFooter(page)).toHaveText(new RegExp(` of ${totalBefore + 1}$`))
  })

  test("shows a change the server applied when the approval's stream was cut off", async ({ page }) => {
    const totalBefore = await ledgerTotal(page)
    await page.getByRole("link", { name: "Assistant", exact: true }).click()
    await sendQuestion(page, unique("Add lunch for 12,50"))
    const card = assistantTurns(page).last().getByRole("region", { name: "1 new transaction" })
    await expect(card).toContainText("Lunch")

    // The server applies the change, but the connection drops before any of its stream arrives.
    await page.route("**/approvals/stream", async (route) => {
      await route.fetch()
      await route.abort("connectionreset")
    })
    await card.getByRole("button", { name: "Add" }).click()
    await expect(card).toContainText("Added")
    await expect(card.getByRole("button")).toHaveCount(0)
    await page.unroute("**/approvals/stream")

    await page.getByRole("link", { name: "Transactions", exact: true }).click()
    await expect(ledgerFooter(page)).toHaveText(new RegExp(` of ${totalBefore + 1}$`))
  })

  test("tags transactions from a card and undoes it", async ({ page }) => {
    await editAndUndoJourney(page)
  })

  test("allocates a reimbursement from a card after a dismissed card left it unchanged", async ({ page }) => {
    await allocateJourney(page)
  })

  test("sets a budget from a card and undoes it", async ({ page }) => {
    await budgetAndUndoJourney(page)
  })

  test("removes a budget from a card and undoes it", async ({ page }) => {
    await removeBudgetAndUndoJourney(page)
  })

  test("moves transactions to Trash from a card and restores them with Undo", async ({ page }) => {
    await trashAndUndoJourney(page)
  })

  test("archives a category from a card and undoes it", async ({ page }) => {
    await archiveAndUndoJourney(page)
  })

  test("ends a recurring payment from a card and undoes it", async ({ page }) => {
    await endRecurringAndUndoJourney(page)
  })

  test("masks amounts in the conversation in privacy mode", async ({ page }) => {
    await privacyJourney(page)
  })

  test("stops an answer mid-stream and keeps what was written", async ({ page }) => {
    await stopJourney(page)
  })

  test("shows a backend failure and answers again with Retry", async ({ page }) => {
    await failureJourney(page)
  })

  test("sends a follow-up again with Retry when the server never received it", async ({ page }) => {
    await page.goto("/assistant")
    const question = unique("How much did I spend in May?")
    await sendQuestion(page, question)
    await expect(assistantTurns(page).last()).toContainText("less than in April")

    await page.route("**/api/assistant/messages/stream", (route) =>
      route.fulfill({ status: 503, json: { detail: "The Assistant is unavailable." } })
    )
    await sendQuestion(page, "And in April?")
    await expect(assistantTurns(page).last()).toContainText("The Assistant is unavailable.")
    await page.unroute("**/api/assistant/messages/stream")

    await assistantTurns(page).last().getByRole("button", { name: "Retry" }).click()
    await expect(assistantTurns(page)).toHaveCount(2)
    await expect(assistantTurns(page).last()).toContainText("less than in April")

    // The server kept the first answer and saved the follow-up after it.
    await page.reload()
    await expect(userTurns(page)).toHaveText([question, "And in April?"])
    await expect(assistantTurns(page)).toHaveCount(2)
  })

  test("sends on Enter and inserts a newline on Shift+Enter", async ({ page }) => {
    await page.goto("/assistant")
    const input = composer(page)
    const send = page.getByRole("button", { name: "Send" })
    await expect(send).toBeDisabled()
    await input.click()
    await input.pressSequentially("first line")
    await expect(send).toBeEnabled()
    await input.press("Shift+Enter")
    await input.pressSequentially("second line")

    expect(await input.inputValue()).toContain("\n")
    await expect(userTurns(page)).toHaveCount(0)

    await input.press("Enter")
    await expect(userTurns(page).last()).toContainText("first line")
    await expect(userTurns(page).last()).toContainText("second line")
    await expect(assistantTurns(page).last()).toContainText("You spent 1 234,56 € in May.")
    await expect(input).toHaveValue("")
  })

  test("keeps the reader's place during streaming and offers a return to the latest message", async ({ page }) => {
    await page.goto("/assistant")
    await sendQuestion(page, unique("Show me a long review"))

    // Sending pins the question near the top so the reply streams downward in reading position.
    await expect.poll(() => offsetInThread(userTurns(page).last())).toBeLessThan(48)
    const reserved = await page.evaluate(() => {
      const log = document.querySelector('[role="log"]')!
      const user = log.querySelector('[aria-label="You"]')!
      const assistant = log.querySelector('[aria-label="Assistant"]')!
      return { needed: log.clientHeight - user.clientHeight - 64, actual: assistant.getBoundingClientRect().height }
    })
    expect(reserved.actual).toBeGreaterThanOrEqual(reserved.needed - 1)

    // Streaming never drags the reader; the return control appears once the newest
    // content is below the viewport.
    await expect(thread(page).getByText("Spending detail 30.")).toBeAttached()
    const scrollToLatest = page.getByRole("button", { name: "Scroll to latest message" })
    await expect(scrollToLatest).toBeVisible()
    const scrollTopBefore = await thread(page).evaluate(async (element) => {
      let last = -1
      while (element.scrollTop !== last) {
        last = element.scrollTop
        await new Promise((resolve) => window.setTimeout(resolve, 100))
      }
      return last
    })
    await expect(thread(page).getByText("Spending detail 80.")).toBeAttached()
    expect(await thread(page).evaluate((element) => element.scrollTop)).toBe(scrollTopBefore)

    await scrollToLatest.click()
    await expect(thread(page).getByText("Spending detail 80.")).toBeInViewport()
    await expect(scrollToLatest).toHaveCount(0)
  })

  test("scrolls each sent question to the top with earlier turns above", async ({ page }) => {
    await page.goto("/assistant")
    await sendQuestion(page, unique("Show me a long review"))
    await expect(thread(page).getByText("Spending detail 80.")).toBeAttached()
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
    await sendQuestion(page, "And May?")

    await expect.poll(() => offsetInThread(userTurns(page).last())).toBeLessThan(48)
    await thread(page).evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(userTurns(page).first()).toBeInViewport()
  })

  test("saves how many days to keep chats in Settings", async ({ page }) => {
    await chatRetentionJourney(page)
  })
})
