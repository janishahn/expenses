import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const auditArtifactRoot = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve(repoRoot, process.env.UI_POLISH_AUDIT_ARTIFACT_DIR)
  : null
const artifactDirectory = auditArtifactRoot
  ? resolve(auditArtifactRoot, "desktop-chromium", "light")
  : null

function persist(name: string, payload: unknown) {
  if (!artifactDirectory) return
  mkdirSync(artifactDirectory, { recursive: true })
  writeFileSync(
    resolve(artifactDirectory, `${name}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
  )
}

function persistIn(directory: string | null, name: string, payload: unknown) {
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    resolve(directory, `${name}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
  )
}

async function useLightReducedMotion(page: Page) {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(() => {
    window.localStorage.setItem("ew.theme.preference", "light")
  })
}

async function activeElement(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element) return null
    return {
      tag: element.tagName.toLowerCase(),
      text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) ?? "",
      ariaLabel: element.getAttribute("aria-label"),
      role: element.getAttribute("role"),
      testId: element.getAttribute("data-testid"),
      insideDialog: Boolean(element.closest('[role="dialog"]')),
      hiddenAncestor: Boolean(element.closest('[aria-hidden="true"]')),
    }
  })
}

test.describe("Desktop interaction audit evidence", () => {
  test("records search, dialog, and confirmation focus return", async ({
    page,
    request,
  }) => {
    await useLightReducedMotion(page)
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      `Audit desktop focus ${Date.now()}`,
    )
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 1_234,
      category_id: categoryId,
      title: `Audit desktop focus transaction ${Date.now()}`,
      tags: [],
    })

    await page.goto("/transactions")
    const searchTrigger = page.getByRole("button", { name: "Search transactions" })
    await searchTrigger.focus()
    await searchTrigger.click()
    const searchInput = page.getByRole("searchbox", { name: "Search transactions" })
    await expect(searchInput).toBeVisible()
    const searchAfterOpen = await activeElement(page)
    const searchFocusEntered = await searchInput.evaluate(
      (element) => document.activeElement === element,
    )
    await searchInput.focus()
    await searchInput.press("Escape")
    await expect(searchTrigger).toHaveAttribute("aria-expanded", "false")
    const searchAfterEscape = await activeElement(page)

    const addTrigger = page
      .getByTestId("app-shell-utility")
      .getByRole("button", { name: "Add transaction", exact: true })
    await addTrigger.focus()
    await addTrigger.click()
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(addDialog).toBeVisible()
    const addAfterOpen = await activeElement(page)
    await page.keyboard.press("Escape")
    await expect(addDialog).toBeHidden()
    const addAfterEscape = await activeElement(page)

    await page.goto("/categories")
    const categoryTrigger = page.getByRole("button", { name: "Add category" }).first()
    await categoryTrigger.focus()
    await categoryTrigger.click()
    const categoryDialog = page.getByRole("dialog", { name: "Add category" })
    await expect(categoryDialog).toBeVisible()
    const categoryAfterOpen = await activeElement(page)
    await page.keyboard.press("Escape")
    await expect(categoryDialog).toBeHidden()
    const categoryAfterEscape = await activeElement(page)

    await page.goto(`/transactions/${transactionId}`)
    const deleteTrigger = page.getByRole("button", { name: "Delete transaction" })
    await deleteTrigger.focus()
    await deleteTrigger.click()
    const confirmDialog = page.getByRole("dialog", {
      name: "Delete this transaction?",
    })
    await expect(confirmDialog).toBeVisible()
    const confirmAfterOpen = await activeElement(page)
    await confirmDialog.getByRole("button", { name: "Cancel" }).click()
    await expect(confirmDialog).toBeHidden()
    const confirmAfterCancel = await activeElement(page)

    if (artifactDirectory) {
      await page.screenshot({
        path: resolve(artifactDirectory, "desktop-confirm-focus-return.png"),
        fullPage: true,
      })
    }
    persist("desktop-overlay-focus-behavior", {
      viewport: page.viewportSize(),
      search: {
        afterOpen: searchAfterOpen,
        focusEntered: searchFocusEntered,
        afterEscape: searchAfterEscape,
      },
      globalAdd: { afterOpen: addAfterOpen, afterEscape: addAfterEscape },
      categoryEditor: {
        afterOpen: categoryAfterOpen,
        afterEscape: categoryAfterEscape,
      },
      confirmation: {
        afterOpen: confirmAfterOpen,
        afterCancel: confirmAfterCancel,
      },
    })
  })

  test("reorders templates with the keyboard drag handle", async ({
    page,
    request,
  }) => {
    await useLightReducedMotion(page)
    const token = await getCsrfToken(request)
    const suffix = `${Date.now()}`
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      `Audit keyboard reorder ${suffix}`,
    )
    const names = [
      `Audit keyboard A ${suffix}`,
      `Audit keyboard B ${suffix}`,
    ]
    for (const name of names) {
      const response = await request.post("/api/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          name,
          type: "expense",
          category_id: categoryId,
          default_amount_cents: null,
          title: null,
          tags: [],
        },
      })
      expect(response.ok()).toBeTruthy()
    }

    await page.goto("/templates")
    const rows = page.getByTestId("template-row")
    const firstHandle = page.getByRole("button", { name: `Reorder ${names[0]}` })
    await expect(firstHandle).toBeVisible()
    const before = await rows.allTextContents()
    await firstHandle.focus()
    if (artifactDirectory) {
      await page.screenshot({
        path: resolve(artifactDirectory, "template-keyboard-reorder-focus.png"),
      })
    }
    const reorderRequests: string[] = []
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/templates/reorder" &&
        request.method() === "POST"
      ) {
        reorderRequests.push(request.postData() ?? "")
      }
    })
    const keyboardStates: Array<{
      step: string
      activeElement: Awaited<ReturnType<typeof activeElement>>
      liveRegion: string
    }> = []
    const recordState = async (step: string) => {
      keyboardStates.push({
        step,
        activeElement: await activeElement(page),
        liveRegion: await page
          .locator('[role="status"]')
          .allTextContents()
          .then((values) => values.join(" | ")),
      })
    }
    await firstHandle.press("Space")
    await page.waitForTimeout(100)
    await recordState("Space to lift")
    await firstHandle.press("ArrowDown")
    await page.waitForTimeout(100)
    await recordState("ArrowDown")
    await firstHandle.press("Space")
    await page.waitForTimeout(100)
    await recordState("Space to drop")
    await page.waitForTimeout(1_000)
    const after = await rows.allTextContents()
    const moved =
      after.findIndex((text) => text.includes(names[1])) <
      after.findIndex((text) => text.includes(names[0]))
    if (artifactDirectory) {
      await page.screenshot({
        path: resolve(artifactDirectory, "template-keyboard-reorder-after.png"),
      })
    }
    persist("template-keyboard-reorder", {
      before,
      after,
      moved,
      reorderRequests,
      keyboardStates,
      activeElement: await activeElement(page),
    })
  })

  for (const theme of ["light", "dark"] as const) {
    test(`records 200 percent reflow drawer and dialog keyboard behavior in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 640, height: 400 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem("ew.theme.preference", selectedTheme)
      }, theme)
      const directory = auditArtifactRoot
        ? resolve(
            auditArtifactRoot,
            "desktop-200-percent-reflow",
            theme,
          )
        : null
      if (directory) mkdirSync(directory, { recursive: true })
      await page.goto("/transactions")

      const menuTrigger = page.getByRole("button", { name: "Open menu" })
      await menuTrigger.focus()
      await menuTrigger.click()
      const menu = page.getByRole("complementary", { name: "Application menu" })
      await expect(menu).toBeVisible()
      await page.waitForTimeout(300)
      if (directory) {
        await page.screenshot({
          path: resolve(directory, "interactive-drawer-focus.png"),
        })
      }
      const lastMenuLink = menu.getByRole("link", { name: "Admin" })
      await lastMenuLink.scrollIntoViewIfNeeded()
      await expect(lastMenuLink).toBeVisible()
      if (directory) {
        await page.screenshot({
          path: resolve(directory, "interactive-drawer-end.png"),
        })
      }
      const menuAfterOpen = await activeElement(page)
      const menuTabs = []
      for (let index = 0; index < 6; index += 1) {
        await page.keyboard.press("Tab")
        menuTabs.push(await activeElement(page))
      }
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      const menuAfterEscape = await activeElement(page)

      const addTrigger = page.getByRole("button", {
        name: "Add transaction",
        exact: true,
      })
      await addTrigger.focus()
      await addTrigger.click()
      const dialog = page.getByRole("dialog", { name: "Add transaction" })
      await expect(dialog).toBeVisible()
      const dialogAfterOpen = await activeElement(page)
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      const dialogAfterEscape = await activeElement(page)

      persistIn(directory, "interactive-focus-behavior", {
        viewport: page.viewportSize(),
        menu: {
          afterOpen: menuAfterOpen,
          tabs: menuTabs,
          afterEscape: menuAfterEscape,
        },
        dialog: {
          afterOpen: dialogAfterOpen,
          afterEscape: dialogAfterEscape,
        },
      })
    })
  }
})
