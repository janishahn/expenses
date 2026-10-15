import { expect, test } from "./fixtures"
import type { APIRequestContext, Page } from "@playwright/test"
import {
  createIngestTransaction,
  createTransaction,
  createUncategorizedExpense,
  getCsrfToken,
  loginWithTrainedSuggestions,
  stubOsmTiles,
  uploadAttachment,
} from "./helpers"

test.describe.configure({ mode: "parallel" })

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pfdvK0AAAAASUVORK5CYII=",
  "base64"
)

async function createCategory(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const response = await request.post("/api/categories", {
    headers: { "X-CSRF-Token": token },
    data: { name, type: "expense", order: 0 },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function createTag(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function seed(
  request: APIRequestContext,
  token: string,
  title: string,
  overrides: Partial<Parameters<typeof createTransaction>[2]> = {}
): Promise<number> {
  const categoryId =
    overrides.category_id ??
    (await createCategory(request, token, `Mobile spec ${Date.now()}-${Math.random()}`))
  const today = new Date().toISOString().slice(0, 10)
  return createTransaction(request, token, {
    date: today,
    occurred_at: `${today}T12:00:00`,
    type: "expense",
    amount_cents: 1234,
    category_id: categoryId,
    title,
    tags: [],
    ...overrides,
  })
}

async function fetchTransaction(request: APIRequestContext, id: number) {
  const response = await request.get(`/api/transactions/${id}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as {
    title: string
    amount_cents: number
    category_id: number | null
    description: string | null
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(width.scroll).toBeLessThanOrEqual(width.client)
}

test.describe("Transactions Page (mobile)", () => {
  test("shows the compact header with Add, Search and More actions without overflow", async ({
    page,
  }) => {
    await page.goto("/transactions")

    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Add transaction", exact: true })).toHaveText(
      "Add"
    )
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole("button", { name: "More actions" }).tap()
    const menu = page.getByRole("dialog", { name: "More actions" })
    await expect(menu.getByRole("menuitem", { name: "Select" })).toBeVisible()
    await expect(menu.getByRole("link", { name: "Trash" })).toBeVisible()
    await expect(menu.getByRole("menuitem", { name: "Export CSV" })).toBeVisible()
  })

  test("prints the filtered ledger from More actions", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const marker = `Mobile print ${Date.now()}`
    await seed(request, token, `${marker} one`)
    await seed(request, token, `${marker} two`)
    await page.addInitScript(() => {
      window.print = () => {
        document.body.dataset.printed = String(Number(document.body.dataset.printed ?? 0) + 1)
      }
    })
    const print = async () => {
      await page.getByRole("button", { name: "More actions" }).tap()
      await page.getByRole("dialog", { name: "More actions" }).getByRole("menuitem", { name: "Print…" }).tap()
    }

    await page.goto(`/transactions?q=${encodeURIComponent(marker)}`)
    await print()
    await expect(page.locator("body")).toHaveAttribute("data-printed", "1")

    await page.emulateMedia({ media: "print" })
    await expect(page.getByRole("navigation", { name: "Tabs" })).toBeHidden()
    const ledger = page.getByRole("table")
    for (const name of ["one", "two"]) await expect(ledger).toContainText(`${marker} ${name}`)
    await expect(page.getByRole("term").filter({ hasText: "Spent" }).locator("..")).toContainText("24,68 €")

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")))
    await expect(ledger).toHaveCount(0)
    await page.emulateMedia({ media: "screen" })
    await print()
    await expect(page.locator("body")).toHaveAttribute("data-printed", "2")
  })

  test("sets type, category and tags in the Filter sheet and removes them again", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const marker = `Mobile filter ${stamp}`
    const categoryName = `Filter category ${stamp}`
    const tagName = `filter-tag-${stamp}`
    const categoryId = await createCategory(request, token, categoryName)
    const tagId = await createTag(request, token, tagName)
    const match = await seed(request, token, `${marker} match`, {
      category_id: categoryId,
      tags: [tagName],
    })
    const other = await seed(request, token, `${marker} other`)

    await page.goto(`/transactions?q=${encodeURIComponent(marker)}`)
    const list = page.getByRole("list", { name: "Transactions" })
    await expect(list.getByRole("listitem", { name: `${marker} match` })).toBeVisible()
    await expect(list.getByRole("listitem", { name: `${marker} other` })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear type filter" })).toHaveCount(0)

    await page.getByRole("button", { name: "Filter", exact: true }).tap()
    const sheet = page.getByRole("dialog", { name: "Filter" })
    await sheet.getByRole("radio", { name: "Expense" }).tap()
    await expect(page).toHaveURL(/type=expense/)
    await sheet.getByLabel("Category").selectOption(String(categoryId))
    await expect(page).toHaveURL(new RegExp(`category=${categoryId}`))
    await sheet.getByRole("checkbox", { name: tagName }).tap()
    await expect(page).toHaveURL(new RegExp(`tags=${tagId}`))
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()

    await expect(list.getByRole("listitem", { name: `${marker} match` })).toBeVisible()
    await expect(list.getByRole("listitem", { name: `${marker} other` })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Filter · 3" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear type filter" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear category filter" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Clear tag filter" })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole("button", { name: "Clear tag filter" }).tap()
    await expect(page).not.toHaveURL(/tags=/)
    await page.getByRole("button", { name: "Clear category filter" }).tap()
    await expect(page).not.toHaveURL(/category=/)
    await expect(list.getByRole("listitem", { name: `${marker} other` })).toBeVisible()
    await page.getByRole("button", { name: "Clear type filter" }).tap()
    await expect(page).not.toHaveURL(/type=/)
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible()
    expect(match).not.toBe(other)
  })

  test("expands search at the top of the page and closes it with Escape", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const title = `Mobile search ${stamp}`
    await seed(request, token, title, { description: "Warranty paperwork stored here" })
    await seed(request, token, `Plain lunch ${stamp}`)
    await page.goto("/transactions")

    const trigger = page.getByRole("button", { name: "Search", exact: true })
    await trigger.tap()
    const searchbox = page.getByRole("searchbox", { name: "Search transactions" })
    await expect(searchbox).toBeVisible()
    await expect(searchbox).toBeFocused()
    const box = await searchbox.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top, left: rect.left, right: rect.right }
    })
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(box.top).toBeLessThan(200)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(viewportWidth)
    await expectNoHorizontalOverflow(page)

    await searchbox.fill(String(stamp))
    await expect(page).toHaveURL(new RegExp(`q=${stamp}`))
    const list = page.getByRole("list", { name: "Transactions" })
    await expect(list.getByRole("listitem", { name: title })).toBeVisible()
    await expect(list.getByRole("listitem", { name: `Plain lunch ${stamp}` })).toBeVisible()

    await searchbox.fill("waranty paperwork")
    await expect(list.getByRole("listitem", { name: title })).toBeVisible()
    await expect(list.getByRole("listitem", { name: `Plain lunch ${stamp}` })).toHaveCount(0)

    await searchbox.press("Escape")
    await expect(searchbox).toHaveValue("")
    await expect(page).not.toHaveURL(/q=/)
    await searchbox.press("Escape")
    await expect(searchbox).toBeHidden()
  })

  test("selects rows from More actions and changes their category from the bulk bar", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const marker = `Mobile select ${stamp}`
    const targetName = `Select target ${stamp}`
    const targetId = await createCategory(request, token, targetName)
    const ids = [
      await seed(request, token, `${marker} one`),
      await seed(request, token, `${marker} two`),
      await seed(request, token, `${marker} three`),
    ]

    await page.goto(`/transactions?q=${encodeURIComponent(marker)}`)
    const tabs = page.getByRole("navigation", { name: "Tabs" })
    await expect(tabs).toBeVisible()
    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("menuitem", { name: "Select" }).tap()

    const bulk = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bulk).toBeVisible()
    await expect(tabs).toBeHidden()
    const list = page.getByRole("list", { name: "Transactions" })
    await list.getByRole("listitem", { name: `${marker} one` }).tap()
    await list.getByRole("listitem", { name: `${marker} two` }).tap()
    await expect(page).not.toHaveURL(/peek=/)
    await expect(bulk).toContainText("2 selected")
    await expect(list.getByRole("checkbox", { name: `Select ${marker} three` })).not.toBeChecked()

    await list.getByRole("listitem", { name: `${marker} two` }).tap()
    await expect(bulk).toContainText("1 selected")
    await list.getByRole("listitem", { name: `${marker} two` }).tap()
    await expect(bulk).toContainText("2 selected")

    await bulk.getByRole("button", { name: "Category" }).tap()
    await page.getByRole("combobox", { name: "Set category" }).fill(targetName)
    await page.getByRole("option", { name: targetName }).tap()
    const confirm = page.getByRole("dialog", { name: "Change the category of 2 transactions?" })
    await confirm.getByRole("button", { name: "Apply" }).tap()
    await expect(page.getByRole("status")).toContainText("Updated 2 transactions")
    await expect(bulk).toBeHidden()
    await expect(tabs).toBeVisible()

    expect((await fetchTransaction(request, ids[0])).category_id).toBe(targetId)
    expect((await fetchTransaction(request, ids[1])).category_id).toBe(targetId)
    expect((await fetchTransaction(request, ids[2])).category_id).not.toBe(targetId)
  })

  test("leaves selection mode with the bulk bar close button", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const marker = `Mobile deselect ${Date.now()}`
    await seed(request, token, `${marker} one`)

    await page.goto(`/transactions?q=${encodeURIComponent(marker)}`)
    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("menuitem", { name: "Select" }).tap()
    const bulk = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bulk).toContainText("0 selected")
    await page.getByRole("listitem", { name: `${marker} one` }).tap()
    await expect(bulk).toContainText("1 selected")

    await bulk.getByRole("button", { name: "Clear selection" }).tap()
    await expect(bulk).toBeHidden()
    await expect(page.getByRole("navigation", { name: "Tabs" })).toBeVisible()
    await page.getByRole("listitem", { name: `${marker} one` }).tap()
    await expect(page).toHaveURL(/peek=\d+/)
  })

  test("opens a full-screen peek from a row and returns to the same scroll position", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const marker = `Mobile scroll ${Date.now()}`
    for (let index = 10; index < 40; index += 1) {
      await seed(request, token, `${marker} ${index}`)
    }

    await page.goto(`/transactions?q=${encodeURIComponent(marker)}`)
    const list = page.getByRole("list", { name: "Transactions" })
    await expect(list.getByRole("listitem")).toHaveCount(30)

    const scrollTo = (top: number) =>
      list.evaluate((element, target) => {
        let node: HTMLElement | null = element
        while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement
        const scroller = node ?? document.scrollingElement!
        scroller.scrollTop = target
        return scroller.scrollTop
      }, top)
    const readScroll = () =>
      list.evaluate((element) => {
        let node: HTMLElement | null = element
        while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement
        return (node ?? document.scrollingElement!).scrollTop
      })
    const scrolled = await scrollTo(500)
    expect(scrolled).toBeGreaterThan(300)

    const row = list.getByRole("listitem").filter({ hasText: `${marker} 25` })
    await row.scrollIntoViewIfNeeded()
    const before = await readScroll()
    await row.tap()
    await expect(page).toHaveURL(/peek=\d+/)
    const peek = page.getByRole("complementary", { name: `${marker} 25` })
    await expect(peek).toBeVisible()
    await expect(list).toBeHidden()

    await peek.getByRole("button", { name: "Transactions", exact: true }).tap()
    await expect(page).not.toHaveURL(/peek=/)
    await expect(peek).toHaveCount(0)
    await expect(list).toBeVisible()
    expect(await readScroll()).toBe(before)
  })

  test("edits title, amount and category inline in the peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const title = `Mobile inline ${stamp}`
    const targetName = `Inline target ${stamp}`
    const targetId = await createCategory(request, token, targetName)
    const id = await seed(request, token, title, { amount_cents: 1234 })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })

    await peek.getByRole("button", { name: "Edit Title" }).tap()
    await peek.getByRole("textbox", { name: "Title" }).fill("")
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")
    await expect(peek.getByText("Enter a title.")).toBeVisible()
    await peek.getByRole("textbox", { name: "Title" }).fill(`${title} renamed`)
    await peek.getByRole("textbox", { name: "Title" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Title" })).toHaveText(`${title} renamed`)

    await peek.getByRole("button", { name: "Edit Amount" }).tap()
    for (const invalid of ["abc", "", "12,345"]) {
      await peek.getByRole("textbox", { name: "Amount" }).fill(invalid)
      await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
      await expect(peek.getByText("Enter a valid amount.")).toBeVisible()
    }
    await peek.getByRole("textbox", { name: "Amount" }).fill("45,60")
    await peek.getByRole("textbox", { name: "Amount" }).press("Enter")
    await expect(peek.getByRole("button", { name: "Edit Amount" })).toContainText("45,60")

    await peek.getByRole("button", { name: /^Category / }).tap()
    await page.getByRole("combobox", { name: "Category" }).fill(targetName)
    await page.getByRole("option", { name: targetName }).tap()
    await expect(peek.getByRole("button", { name: `Category ${targetName}` })).toBeVisible()

    await expect
      .poll(async () => {
        const saved = await fetchTransaction(request, id)
        return [saved.title, saved.amount_cents, saved.category_id]
      })
      .toEqual([`${title} renamed`, 4560, targetId])
  })

  test("round-trips Markdown notes in the peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const title = `Mobile notes ${Date.now()}`
    const id = await seed(request, token, title, { description: "**Original note**" })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.locator("strong")).toHaveText("Original note")

    await peek.getByRole("button", { name: "Edit notes" }).tap()
    const editor = peek.getByRole("textbox", { name: "Notes" })
    await expect(editor.locator("strong")).toHaveText("Original note")
    await editor.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End")
    await editor.pressSequentially(" updated")
    await editor.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")
    await expect(peek.getByRole("textbox", { name: "Notes" })).toHaveCount(0)
    await expect(peek.locator("strong")).toHaveText("Original note updated")
    await expect
      .poll(async () => (await fetchTransaction(request, id)).description)
      .toBe("**Original note updated**")

    await page.reload()
    await expect(page.getByRole("complementary", { name: title }).locator("strong")).toHaveText(
      "Original note updated"
    )
  })

  test("adds a note to an empty transaction in the peek", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const title = `Mobile empty notes ${Date.now()}`
    const id = await seed(request, token, title)

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })
    await peek.getByRole("button", { name: "Add notes" }).tap()
    await peek.getByRole("textbox", { name: "Notes" }).pressSequentially("Bought on sale")
    await peek.getByRole("heading", { name: "Notes" }).tap()
    await expect
      .poll(async () => (await fetchTransaction(request, id)).description)
      .toBe("Bought on sale")
    await expect(peek.getByText("Bought on sale")).toBeVisible()
  })

  test("shows an empty receipt section and uploads a receipt from the peek", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const title = `Mobile receipt ${Date.now()}`
    await seed(request, token, title)

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.getByRole("button", { name: "Add a receipt" })).toBeVisible()
    await expect(peek.getByRole("heading", { name: "Location" })).toHaveCount(0)

    const chooser = page.waitForEvent("filechooser")
    await peek.getByRole("button", { name: "Add a receipt" }).tap()
    const fileName = `mobile-receipt-${Date.now()}.png`
    await (await chooser).setFiles({ name: fileName, mimeType: "image/png", buffer: onePixelPng })
    await expect(peek.getByRole("button", { name: `Open ${fileName}` })).toBeVisible()
    await expect(peek.getByRole("button", { name: "Add a receipt" })).toHaveCount(0)

    await peek.getByRole("button", { name: `Open ${fileName}` }).tap()
    const viewer = page.getByRole("dialog", { name: fileName })
    await expect(viewer).toBeVisible()
    await viewer.getByRole("button", { name: "Close" }).tap()
    await expect(viewer).toBeHidden()
  })

  test("shows an existing receipt and a map for a located transaction in the peek", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)
    const token = await getCsrfToken(request)
    const title = `Mobile located ${Date.now()}`
    const id = await createIngestTransaction(request, {
      amount_cents: 1775,
      title,
      date: "2026-04-18",
      category: "Food",
      latitude: 52.520008,
      longitude: 13.404954,
    })
    const fileName = `mobile-located-${Date.now()}.png`
    await uploadAttachment(request, token, id, {
      name: fileName,
      mimeType: "image/png",
      buffer: onePixelPng,
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })

    await expect(peek.getByRole("heading", { name: "Location" })).toBeVisible()
    await expect(peek.getByText("52.520008, 13.404954").first()).toBeVisible()
    const map = peek.getByRole("group", { name: /^Map at / })
    await expect(map).toBeVisible()
    await expect(map.locator(".leaflet-marker-icon")).toBeVisible()
    await expect(peek.getByRole("button", { name: `Open ${fileName}` })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test("adds a transaction from the bottom sheet", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryName = `Add sheet category ${Date.now()}`
    await createCategory(request, token, categoryName)
    const title = `Mobile add ${Date.now()}`

    await page.goto("/transactions")
    await page.getByRole("button", { name: "Add transaction", exact: true }).tap()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeGreaterThan(viewport!.height - 4)

    const submit = dialog.getByRole("button", { name: "Add transaction" })
    await submit.tap()
    await expect(dialog.getByText("Enter an amount.")).toBeVisible()
    await expect(dialog.getByText("Enter a title.")).toBeVisible()
    await dialog.getByLabel("Amount").fill("abc")
    await submit.tap()
    await expect(dialog.getByText("Enter a valid amount.")).toBeVisible()

    await dialog.getByLabel("Amount").fill("12,34")
    await dialog.getByLabel("Title").fill(title)
    await dialog.getByRole("button", { name: "Category", exact: true }).tap()
    await page.getByRole("combobox", { name: "Category" }).fill(categoryName)
    await page.getByRole("option", { name: categoryName }).tap()
    await submit.tap()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole("status")).toContainText("Transaction added")
    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    const row = page.getByRole("listitem", { name: title })
    await expect(row).toBeVisible()
    await expect(row).toContainText("12,34")
    await expect(row).toContainText(categoryName)
  })

  test("deletes a transaction from the peek menu and restores it with Undo", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const title = `Mobile peek delete ${Date.now()}`
    const id = await seed(request, token, title)

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    const peek = page.getByRole("complementary", { name: title })
    await peek.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("menuitem", { name: "Delete" }).tap()
    await page
      .getByRole("dialog", { name: "Delete this transaction?" })
      .getByRole("button", { name: "Delete", exact: true })
      .tap()

    await expect(page.getByRole("status")).toContainText("Moved to Trash")
    await expect(page).not.toHaveURL(/peek=/)
    await expect(page.getByRole("listitem", { name: title })).toHaveCount(0)
    expect((await request.get(`/api/transactions/${id}`)).status()).toBe(404)

    await page.getByRole("status").getByRole("button", { name: "Undo" }).tap()
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()
    expect((await fetchTransaction(request, id)).title).toBe(title)
  })

  test("recategorizes a transaction from the mobile Inbox with Select", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const targetName = `Mobile inbox target ${Date.now()}`
    const targetId = await createCategory(request, token, targetName)
    const title = `Mobile inbox ${Date.now()}`
    const transactionId = await createUncategorizedExpense(request, token, title)

    await page.goto(`/transactions/inbox?q=${encodeURIComponent(title)}`)
    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("menuitem", { name: "Select" }).tap()
    const row = page.getByRole("listitem", { name: title })
    await row.tap()
    await expect(page).not.toHaveURL(/peek=/)
    const bulk = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bulk).toContainText("1 selected")
    await bulk.getByRole("button", { name: "Category" }).tap()
    await page.getByRole("combobox").fill(targetName)
    await page.getByRole("option", { name: targetName }).tap()
    await page
      .getByRole("dialog", { name: "Change the category of 1 transaction?" })
      .getByRole("button", { name: "Apply" })
      .tap()
    await expect(page.getByRole("status")).toContainText("Updated 1 transaction")
    await expect(row).toHaveCount(0)
    expect((await fetchTransaction(request, transactionId)).category_id).toBe(targetId)
  })

  test("accepts a category suggestion from the mobile Inbox peek", async ({ page }) => {
    const title = `Corner bakery mobile ${Date.now()}`
    const { request, bakeryId, uncategorizedIds } = await loginWithTrainedSuggestions(page, [title])
    try {
      await page.goto("/transactions/inbox")
      const row = page.getByRole("listitem", { name: title })
      await row.tap()
      await expect(page).toHaveURL(/peek=\d+/)
      const peek = page.getByRole("complementary", { name: title })
      await expect(peek).toContainText("Bakery")
      await peek.getByRole("button", { name: "Accept" }).tap()
      await expect(page.getByRole("status")).toContainText("Moved to Bakery")
      await expect(page).not.toHaveURL(/peek=/)
      await expect(row).toHaveCount(0)
      expect((await fetchTransaction(request, uncategorizedIds[0])).category_id).toBe(bakeryId)
    } finally {
      await request.dispose()
    }
  })

  test("deletes a transaction from its peek and permanently deletes it from Trash", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const title = `Mobile delete ${Date.now()}`
    await seed(request, token, title)

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page.getByRole("listitem", { name: title }).tap()
    await page
      .getByRole("complementary", { name: title })
      .getByRole("button", { name: "More actions" })
      .tap()
    await page.getByRole("menuitem", { name: "Delete" }).tap()
    await page
      .getByRole("dialog", { name: "Delete this transaction?" })
      .getByRole("button", { name: "Delete", exact: true })
      .tap()
    await expect(page.getByRole("listitem", { name: title })).toHaveCount(0)

    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("link", { name: "Trash" }).tap()
    await expect(page).toHaveURL(/\/transactions\/deleted$/)
    const list = page.getByRole("list", { name: "Deleted transactions" })
    const deletedRow = list.getByRole("listitem", { name: title })
    await expect(deletedRow).toBeVisible()

    await deletedRow.tap()
    const bulk = page.getByRole("toolbar", { name: "Selected rows" })
    await expect(bulk).toContainText("1 selected")
    await bulk.getByRole("button", { name: "Delete forever" }).tap()
    await page
      .getByRole("dialog", { name: "Delete 1 transaction forever?" })
      .getByRole("button", { name: "Delete forever" })
      .tap()
    await expect(page.getByRole("status")).toContainText("Deleted 1 transaction forever")
    await expect(deletedRow).toHaveCount(0)
  })

  test("restores a transaction from mobile Trash", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const title = `Mobile trash ${Date.now()}`
    const transactionId = await seed(request, token, title, { amount_cents: 1999 })
    const deleted = await request.delete(`/api/transactions/${transactionId}`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(deleted.ok()).toBeTruthy()

    await page.goto("/transactions")
    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("link", { name: "Trash" }).tap()
    await expect(page).toHaveURL(/\/transactions\/deleted$/)
    const row = page.getByRole("list", { name: "Deleted transactions" }).getByRole("listitem", { name: title })
    await expect(row).toBeVisible()
    await row.tap()
    await page
      .getByRole("toolbar", { name: "Selected rows" })
      .getByRole("button", { name: "Restore" })
      .tap()
    await expect(page.getByRole("status")).toContainText("Restored 1 transaction")
    await expect(row).toBeHidden()
    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await expect(page.getByRole("listitem", { name: title })).toBeVisible()
  })
})
