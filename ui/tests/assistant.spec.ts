import { expect, test, type Locator, type Page } from "./fixtures"

// tests/e2e_ai_provider.py scripts the AI backend from the question: "slow", "long",
// "fail once", "add lunch", or the default turn with reasoning, a note, one ledger read,
// and this answer.
const ANSWER = "You spent **1 234,56 €** in May.\n\n- Groceries: 800,00 €\n- Rent: 434,56 €\n\nThat is less than in April."

const thread = (page: Page) => page.getByRole("log", { name: "Conversation" })
const assistantTurns = (page: Page) => page.getByRole("article", { name: "Assistant" })
const userTurns = (page: Page) => page.getByRole("article", { name: "You" })
const composer = (page: Page) => page.getByRole("textbox", { name: "Message the Assistant" })

// Chats from earlier tests in the worker stay listed, so each question is unique.
const unique = (text: string) => `${text} ${Math.random().toString(36).slice(2, 8)}`

async function sendQuestion(page: Page, text: string) {
  const input = composer(page)
  await input.click()
  await input.fill(text)
  await page.getByRole("button", { name: "Send" }).click()
}

// Distance from the top of the conversation log to the top of an article.
const offsetInThread = (turn: Locator) =>
  turn.evaluate((element) => element.getBoundingClientRect().top - element.closest('[role="log"]')!.getBoundingClientRect().top)

const chatIdFrom = (page: Page) => new URL(page.url()).searchParams.get("chat")

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
  })

  test("applies an approved change, continues the answer, and keeps a dismissal", async ({ page }) => {
    await page.goto("/assistant")
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
    await expect(assistant).toContainText("Added it.")
    // An answer that changed data can't run again.
    await expect(assistant.getByRole("button", { name: "Retry" })).toHaveCount(0)

    await page.reload()
    await expect(assistantTurns(page).last().getByRole("region", { name: "1 new transaction" })).toContainText("Added")

    await sendQuestion(page, "Add lunch again")
    const second = assistantTurns(page).last().getByRole("region", { name: "1 new transaction" })
    await second.getByRole("button", { name: "Dismiss" }).click()
    await expect(second).toContainText("Dismissed")
    await expect(assistantTurns(page).last()).toContainText("Okay, nothing changed.")
  })

  test("masks amounts in the conversation in privacy mode", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("ew.privacy", "on"))
    await page.goto("/assistant")
    await sendQuestion(page, unique("Did I spend more than 1 000 € in May?"))

    await expect(assistantTurns(page).last()).toContainText("You spent •••• in May.")
    await expect(userTurns(page).last()).toContainText("Did I spend more than •••• in May?")
    await expect(thread(page)).not.toContainText("1 234")
  })

  test("stops an answer mid-stream and keeps what was written", async ({ page }) => {
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
  })

  test("shows a backend failure and answers again with Retry", async ({ page }) => {
    await page.goto("/assistant")
    await sendQuestion(page, unique("Fail once, then tell me about May"))

    const assistant = assistantTurns(page).last()
    await expect(assistant).toContainText("The AI backend rejected the server's credentials.")
    await expect(composer(page)).toBeEnabled()

    await assistant.getByRole("button", { name: "Retry" }).click()
    await expect(assistantTurns(page).last()).toContainText("You spent 1 234,56 € in May.")
    await expect(page.getByText("The AI backend rejected the server's credentials.")).toHaveCount(0)
    await expect(userTurns(page)).toHaveCount(1)
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

  test("keeps chats for the days chosen in Settings", async ({ page }) => {
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
  })
})
