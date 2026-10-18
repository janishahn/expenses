import { expect, test } from "./fixtures"
import {
  allocateJourney,
  archiveAndUndoJourney,
  assistantTurns,
  budgetAndUndoJourney,
  chatRetentionJourney,
  composer,
  editAndUndoJourney,
  endRecurringAndUndoJourney,
  failureJourney,
  followUpJourney,
  missingChatJourney,
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

test.describe("Assistant (mobile)", () => {
  test("docks the composer above the tab bar and hides the tab bar while typing", async ({ page }) => {
    await page.goto("/assistant")
    await expect(page.locator("main h1")).toHaveText("Assistant")
    await expect(composer(page)).toBeVisible()
    await expect(page.getByRole("button", { name: "Add transaction" })).toHaveCount(0)

    // The composer docks just above the tab bar.
    const tabs = page.getByRole("navigation", { name: "Tabs" })
    const composerBounds = await page.locator("form").filter({ has: composer(page) }).boundingBox()
    const tabBarBounds = await tabs.boundingBox()
    expect(composerBounds).not.toBeNull()
    expect(tabBarBounds).not.toBeNull()
    if (composerBounds && tabBarBounds) {
      const gap = tabBarBounds.y - (composerBounds.y + composerBounds.height)
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThan(48)
    }

    // Typing gives the bottom edge to the keyboard.
    await composer(page).focus()
    await expect(tabs).toBeHidden()
    await composer(page).blur()
    await expect(tabs).toBeVisible()

    // The page action is route-specific: Add returns on other mobile pages.
    await page.goto("/transactions")
    await expect(page.getByRole("button", { name: "Add transaction", exact: true })).toBeVisible()
  })

  test("streams an answer without horizontal overflow and reopens the chat from a sheet", async ({ page }) => {
    const question = unique("How much did I spend in May?")
    await page.goto("/assistant")
    await sendQuestion(page, question)

    const assistant = assistantTurns(page).last()
    await expect(assistant).toContainText("You spent 1 234,56 € in May.")
    await expect(assistant.getByRole("button", { name: "Spending by category, May 2026" })).toBeVisible()
    // Touch layouts keep the copy affordances persistent instead of hover-revealed.
    await expect(assistant.getByRole("button", { name: "Copy response" })).toBeVisible()
    await expect(userTurns(page).last().getByRole("button", { name: "Copy message" })).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    // Recent chats open in a bottom sheet.
    await page.getByRole("button", { name: "New chat" }).click()
    await expect(userTurns(page)).toHaveCount(0)
    await page.getByRole("button", { name: "Recent chats" }).click()
    const sheet = page.getByRole("dialog", { name: "Recent chats" })
    await sheet.getByRole("menuitem").filter({ hasText: question }).click()
    await expect(sheet).toBeHidden()
    await expect(assistantTurns(page).last()).toContainText("You spent 1 234,56 € in May.")
  })

  test("fits a long change card to the phone width, lists every row, applies it, and opens the linked transaction", async ({ page }) => {
    await page.goto("/assistant")
    await sendQuestion(page, unique("Add ten lunches for 12,50"))

    const card = assistantTurns(page).last().getByRole("region", { name: "Add 10 transactions" })
    await expect(card.getByText("Lunch", { exact: true })).toHaveCount(8)
    await card.getByRole("button", { name: "Show 2 more" }).click()
    await expect(card.getByText("Lunch", { exact: true })).toHaveCount(10)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    await card.getByRole("button", { name: "Add" }).click()
    await expect(card).toContainText("Added")
    await expect(assistantTurns(page).last()).toContainText("Added Lunch.")

    // The peek replaces the conversation, and its back button returns to it.
    await assistantTurns(page).last().getByRole("link", { name: "Lunch" }).click()
    const peek = page.getByRole("complementary", { name: "Lunch" })
    await expect(peek).toContainText("12,50")
    await expect(composer(page)).toBeHidden()
    await peek.getByRole("button", { name: "Assistant" }).click()
    await expect(peek).toHaveCount(0)
    await expect(composer(page)).toBeVisible()
  })

  test("asks a follow-up in the same chat", async ({ page }) => {
    await followUpJourney(page)
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

  test("takes no message in a chat that couldn't be loaded", async ({ page }) => {
    await missingChatJourney(page)
  })

  test("saves how many days to keep chats in Settings", async ({ page }) => {
    await chatRetentionJourney(page)
  })

  test("pins the sent question to the top and offers a return to the newest content", async ({ page }) => {
    await page.goto("/assistant")
    await sendQuestion(page, unique("Show me a long review"))
    await expect(thread(page).getByText("Spending detail 80.")).toBeAttached()

    await expect.poll(() => offsetInThread(userTurns(page).last())).toBeLessThan(48)

    const scrollToLatest = page.getByRole("button", { name: "Scroll to latest message" })
    await expect(scrollToLatest).toBeVisible()
    await scrollToLatest.click()
    await expect(thread(page).getByText("Spending detail 80.")).toBeInViewport()
  })
})
