import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { apiFetch, apiFetchBlob } from "../app/api"
import type { CategoriesResponse } from "../app/api-types"
import { formatEuroDate } from "../app/format"
import { Toggle } from "../components/Toggle"
import PageIntro from "../components/PageIntro"
import TransactionDateTimeField from "../components/TransactionDateTimeField"
import { FinancialPanel } from "../components/product/ProductSurfaces"
import { AppButton } from "../components/ui/product-button"
import { AppFieldLabel, AppNativeSelect } from "../components/ui/product-fields"

function toLocalDateInputValue(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isIsoDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function ReportBuilderPage() {
  const [searchParams] = useSearchParams()
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

  const defaultStartDate = toLocalDateInputValue(firstOfMonth)
  const defaultEndDate = toLocalDateInputValue(lastOfMonth)
  const queryStartDate = searchParams.get("start")
  const queryEndDate = searchParams.get("end")

  const [startDate, setStartDate] = useState(
    isIsoDate(queryStartDate) ? queryStartDate : defaultStartDate
  )
  const [endDate, setEndDate] = useState(
    isIsoDate(queryEndDate) ? queryEndDate : defaultEndDate
  )
  const [sections, setSections] = useState<Record<string, boolean>>({
    summary: true,
    category_breakdown: true,
    top_categories: false,
    trend: false,
    recent_transactions: true,
    recurring_upcoming: false,
  })
  const [transactionType, setTransactionType] = useState("")
  const [transactionsSort, setTransactionsSort] = useState<"newest" | "oldest">(
    "newest"
  )
  const [showRunningBalance, setShowRunningBalance] = useState(false)
  const [includeCategorySubtotals, setIncludeCategorySubtotals] = useState(false)
  const [includeCents, setIncludeCents] = useState(true)
  const [notes, setNotes] = useState("")
  const [categoryMode, setCategoryMode] = useState<"all" | "selected">("all")
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState("")
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null)
  const [lastPdfFilename, setLastPdfFilename] = useState<string | null>(null)

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      apiFetch<CategoriesResponse>("/api/categories").then((res) => res.categories),
  })

  const activeCategories = useMemo(
    () => (categoriesData || []).filter((category) => category.archived_at === null),
    [categoriesData]
  )

  const categoriesByType = useMemo(() => {
    return {
      income: activeCategories.filter((category) => category.type === "income"),
      expense: activeCategories.filter((category) => category.type === "expense"),
    }
  }, [activeCategories])

  const handleSectionToggle = (section: string) => {
    setSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const handleCategoryToggle = (categoryId: number) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  useEffect(() => {
    return () => {
      if (lastPdfUrl) {
        URL.revokeObjectURL(lastPdfUrl)
      }
    }
  }, [lastPdfUrl])

  const handleGenerate = async () => {
    setGenerateError("")
    if (!startDate || !endDate) {
      setGenerateError("Select a start and end date.")
      return
    }
    if (endDate < startDate) {
      setGenerateError("End date must be after start date.")
      return
    }

    const enabledSections = Object.entries(sections)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)

    if (!enabledSections.length) {
      setGenerateError("Select at least one report section.")
      return
    }

    const sort = showRunningBalance ? "oldest" : transactionsSort
    const activeCategoryIds = activeCategories.map((category) => category.id)
    const selectedActiveCategoryIds = selectedCategoryIds.filter((id) =>
      activeCategoryIds.includes(id)
    )
    const categoryIds =
      categoryMode === "selected" &&
      selectedActiveCategoryIds.length > 0 &&
      selectedActiveCategoryIds.length < activeCategoryIds.length
        ? selectedActiveCategoryIds
        : null

    const popup = window.open("about:blank", "_blank")
    if (popup) {
      popup.opener = null
    }
    setGenerating(true)
    try {
      const { blob, filename } = await apiFetchBlob("/api/reports/pdf", {
        method: "POST",
        body: JSON.stringify({
          start: startDate,
          end: endDate,
          sections: enabledSections,
          include_cents: includeCents,
          notes: notes.trim() || null,
          transaction_type: transactionType || null,
          category_ids: categoryIds && categoryIds.length ? categoryIds : null,
          transactions_sort: sort,
          show_running_balance: showRunningBalance,
          include_category_subtotals: includeCategorySubtotals,
        }),
      })

      if (lastPdfUrl) {
        URL.revokeObjectURL(lastPdfUrl)
      }

      const url = URL.createObjectURL(blob)
      setLastPdfUrl(url)
      setLastPdfFilename(filename)

      if (popup) {
        popup.location.href = url
      } else {
        const link = document.createElement("a")
        link.href = url
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        document.body.appendChild(link)
        link.click()
        link.remove()
      }
    } catch (error) {
      popup?.close()
      setGenerateError(String(error))
    } finally {
      setGenerating(false)
    }
  }

  const sectionLabels: Record<string, string> = {
    summary: "Summary",
    category_breakdown: "Category breakdown",
    top_categories: "Top categories",
    trend: "Trend",
    recent_transactions: "Transactions",
    recurring_upcoming: "Recurring upcoming",
  }

  return (
    <section className="space-y-4">
      <PageIntro title="PDF Report Builder" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <FinancialPanel role="inspector" className="divide-y divide-border overflow-hidden">
          <section className="p-5">
            <h2 className="mb-4 font-head text-lg font-bold">Date range</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TransactionDateTimeField
                label="Start date"
                type="date"
                value={startDate}
                onChange={setStartDate}
              />
              <TransactionDateTimeField
                label="End date"
                type="date"
                value={endDate}
                onChange={setEndDate}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              Period: {formatEuroDate(startDate)} - {formatEuroDate(endDate)}
            </p>
          </section>

          <section className="p-5">
            <h2 className="mb-4 font-head text-lg font-bold">Transactions</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <AppFieldLabel>
                Type
                <AppNativeSelect
                  value={transactionType}
                  onChange={(event) => setTransactionType(event.target.value)}
                  className="mt-1"
                >
                  <option value="">All</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </AppNativeSelect>
              </AppFieldLabel>

              <AppFieldLabel>
                Sort
                <AppNativeSelect
                  value={showRunningBalance ? "oldest" : transactionsSort}
                  onChange={(event) =>
                    setTransactionsSort(event.target.value as "newest" | "oldest")
                  }
                  className="mt-1"
                  disabled={showRunningBalance}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </AppNativeSelect>
              </AppFieldLabel>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <label className="flex items-start gap-3 rounded-md bg-surface-hi/65 px-3 py-2.5 text-xs text-muted">
                <Toggle on={showRunningBalance} onChange={setShowRunningBalance} />
                <span>
                  <span className="font-semibold">Show running balance</span>
                  <span className="mt-1 block text-[11px] text-muted">
                    Forces oldest-first sorting.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-md bg-surface-hi/65 px-3 py-2.5 text-xs text-muted">
                <Toggle on={includeCategorySubtotals} onChange={setIncludeCategorySubtotals} />
                <span>
                  <span className="font-semibold">Include category subtotals</span>
                  <span className="mt-1 block text-[11px] text-muted">
                    Adds a totals table after transactions.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="p-5">
            <h2 className="mb-4 font-head text-lg font-bold">Report sections</h2>
            <div className="space-y-2">
              {Object.entries(sections).map(([section, enabled]) => (
                <label
                  key={section}
                  className="flex items-center gap-3 rounded-md bg-surface-hi/65 px-3 py-2.5 text-sm text-muted"
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => handleSectionToggle(section)}
                    className="control-check"
                  />
                  {sectionLabels[section] ||
                    section
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                </label>
              ))}
            </div>
          </section>

          {activeCategories.length > 0 ? (
            <section className="p-5">
              <h2 className="mb-4 font-head text-lg font-bold">Categories</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-muted">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="categoryMode"
                    checked={categoryMode === "all"}
                    onChange={() => setCategoryMode("all")}
                    className="control-check"
                  />
                  All
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="categoryMode"
                    checked={categoryMode === "selected"}
                    onChange={() => setCategoryMode("selected")}
                    className="control-check"
                  />
                  Selected
                </label>
              </div>

              {categoryMode === "selected" ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Income
                    </p>
                    <div className="grid gap-2">
                      {categoriesByType.income.map((category) => (
                        <label
                          key={category.id}
                          className="flex items-center gap-3 rounded-md bg-surface-hi/65 px-3 py-2.5 text-sm text-muted"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCategoryIds.includes(category.id)}
                            onChange={() => handleCategoryToggle(category.id)}
                            className="control-check"
                          />
                          {category.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Expense
                    </p>
                    <div className="grid gap-2">
                      {categoriesByType.expense.map((category) => (
                        <label
                          key={category.id}
                          className="flex items-center gap-3 rounded-md bg-surface-hi/65 px-3 py-2.5 text-sm text-muted"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCategoryIds.includes(category.id)}
                            onChange={() => handleCategoryToggle(category.id)}
                            className="control-check"
                          />
                          {category.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">
                  All categories are included.
                </p>
              )}
            </section>
          ) : null}

          <section className="p-5">
            <h2 className="mb-4 font-head text-lg font-bold">Notes</h2>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full field"
              placeholder="Optional notes to include in the report..."
            />
          </section>
        </FinancialPanel>

        <FinancialPanel role="inspector" className="self-start p-5 lg:sticky lg:top-20">
          <h2 className="mb-4 font-head text-lg font-bold">Generate</h2>
          <p className="mb-4 text-sm text-muted">
            Click below to generate your PDF report with the selected
            configuration. The report will open in a new tab.
          </p>

          <label className="mb-4 flex items-center gap-3 rounded-md bg-surface-hi/65 px-3 py-2.5 text-xs text-muted">
            <Toggle on={includeCents} onChange={setIncludeCents} />
            Include cents in tables
          </label>

          {generateError ? (
            <p className="mb-4 text-xs text-semantic-red">{generateError}</p>
          ) : null}

          <AppButton
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="w-full px-4 py-3"
          >
            {generating ? "Generating..." : "Generate PDF Report"}
          </AppButton>

          {lastPdfUrl ? (
            <div className="mt-3 space-y-2">
              <AppButton
                tone="ghost"
                asChild
                className="block w-full px-4 py-2 text-center"
              >
                <a href={lastPdfUrl} download={lastPdfFilename || "expense_report.pdf"}>
                  Download latest PDF
                </a>
              </AppButton>
              <p
                data-testid="report-latest-pdf"
                className="rounded-md bg-surface-hi/65 px-3 py-2 text-xs text-muted"
              >
                Latest PDF ready:{" "}
                <span className="font-semibold text-text">
                  {lastPdfFilename || "expense_report.pdf"}
                </span>
              </p>
            </div>
          ) : null}

          <div className="mt-6 space-y-2 border-t border-border pt-4 text-xs text-muted">
            <p>
              <strong>Note:</strong> PDF generation may take a few seconds
              depending on the date range and number of transactions.
            </p>
            <p>
              Reports include KPIs, category breakdowns, trends, and
              transaction details based on your selections.
            </p>
          </div>
        </FinancialPanel>
      </div>
    </section>
  )
}

export default ReportBuilderPage
