import { expect, test, type Locator, type Page } from "./fixtures"

// tests/e2e_ai_provider.py scripts the AI backend; see assistant.spec.ts.
const thread = (page: Page) => page.getByRole("log", { name: "Conversation" })
const assistantTurns = (page: Page) => page.getByRole("article", { name: "Assistant" })
const userTurns = (page: Page) => page.getByRole("article", { name: "You" })
const composer = (page: Page) => page.getByRole("textbox", { name: "Message the Assistant" })
const unique = (text: string) => `${text} ${Math.random().toString(36).slice(2, 8)}`

async function sendQuestion(page: Page, text: string) {
  const input = composer(page)
  await input.click()
  await input.fill(text)
  await page.getByRole("button", { name: "Send" }).click()
}

const offsetInThread = (turn: Locator) =>
  turn.evaluate((element) => element.getBoundingClientRect().top - element.closest('[role="log"]')!.getBoundingClientRect().top)

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
