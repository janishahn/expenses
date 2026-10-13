import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch } from "../app/api"
import type { CategoriesResponse } from "../app/api-types"
import { formatDateRange } from "../app/format"
import { Amount } from "../components/ui/Amount"
import { IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip } from "../components/ui/ChartCard"
import { BudgetBar, CardRow, ShareBar, type DonutItem } from "../components/ui/Charts"
import { EmptyState } from "../components/ui/EmptyState"
import { AmountCell, Cell, List, Row, type Columns } from "../components/ui/LedgerRow"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { WeekStepper } from "../components/ui/PeriodControl"
import { MetricStrip, Sheet } from "../components/ui/Sheet"
import { categoryColor } from "../components/ui/tokens"

type CategoryRef = { id: number; name: string; icon: string | null }

type DigestCategory = {
  category_id: number
  name: string
  icon: string | null
  amount_cents: number
  bar_percent: number
  trailing_weekly_avg_cents: number
  is_above_trailing_50: boolean
}

type DigestBudgetPulse = {
  scope_category_id: number | null
  scope_label: string
  amount_cents: number
  spent_cents: number
  days_left: number
  pace_state: "under" | "on" | "over"
}

type DigestUnusual = {
  id: number
  date: string
  title: string
  amount_cents: number
  trailing_avg_cents: number
  category: CategoryRef | null
}

type DigestRecurring = {
  transaction_id: number
  rule_id: number | null
  rule_name: string
  date: string
  type: "expense" | "income"
  amount_cents: number
  category: CategoryRef | null
}

type DigestResponse = {
  week_start: string
  week_end: string
  headline: {
    total_spent_cents: number
    vs_last_week_cents: number
    vs_four_week_avg_cents: number
    transaction_count: number
  }
  top_categories: DigestCategory[]
  budget_pulse: DigestBudgetPulse[]
  unusual_transactions: DigestUnusual[]
  recurring_postings: DigestRecurring[]
}

const TOP_COLUMNS: Columns = {
  columns: "18px 96px minmax(0, 1fr) 84px 96px",
  mobileColumns: "18px minmax(0, 1fr) 72px 84px",
}
const BUDGET_COLUMNS: Columns = {
  columns: "18px 110px minmax(0, 1fr) 110px",
  mobileColumns: "18px 92px minmax(0, 1fr) 84px",
}
const ROW_COLUMNS = "18px minmax(0, 1fr) auto auto"
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })
// en-US, because en-GB writes September as "Sept".
const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return `${WEEKDAY.format(date)} ${date.getUTCDate()} ${SHORT_MONTH.format(date)}`
}

function share(part: number, total: number): string {
  return `${total ? Math.round((part / total) * 100) : 0} %`
}

function DigestPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const weekOf = searchParams.get("week_of")
  const { data, isLoading, error } = useQuery({
    queryKey: ["digest", weekOf ?? ""],
    queryFn: () => apiFetch<DigestResponse>(weekOf ? `/api/digest?week_of=${weekOf}` : "/api/digest"),
  })
  // Budget rows carry no icon, so their glyphs come from the category list.
  const categories = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories?period=all"),
  })

  if (isLoading) return <PanelLoading title="Digest" label="Loading digest…" />
  if (error || !data) return <PanelError title="Digest" message="Unable to load digest." />

  const { headline } = data
  const openLedger = (categoryId: number) => {
    const params = new URLSearchParams({
      category: String(categoryId),
      period: "custom",
      start: data.week_start,
      end: data.week_end,
      from: "digest",
    })
    navigate(`/transactions?${params.toString()}`)
  }

  // The week's spending: the top categories, then everything else as Other.
  const topTotal = data.top_categories.reduce((sum, category) => sum + category.amount_cents, 0)
  const weekTotal = Math.max(headline.total_spent_cents, topTotal)
  const otherCents = weekTotal - topTotal
  const weekItems: DonutItem[] = [
    ...data.top_categories.map((category) => ({
      key: String(category.category_id),
      label: category.name,
      value: category.amount_cents,
      color: categoryColor(category.category_id),
      amount: <Amount cents={category.amount_cents} />,
      share: share(category.amount_cents, weekTotal),
    })),
    ...(otherCents > 0
      ? [{ key: "other", label: "Other", value: otherCents, color: categoryColor(null), amount: <Amount cents={otherCents} />, share: share(otherCents, weekTotal) }]
      : []),
  ]

  // Budgets of the month the week ends in, with even pace as of the week's last day.
  const weekEnd = new Date(`${data.week_end}T00:00:00Z`)
  const pace = weekEnd.getUTCDate() / new Date(Date.UTC(weekEnd.getUTCFullYear(), weekEnd.getUTCMonth() + 1, 0)).getUTCDate()
  const overPace = data.budget_pulse.filter((budget) => budget.pace_state === "over").length
  const categoryIcons = new Map((categories.data?.categories ?? []).map((category) => [category.id, category.icon]))

  return (
    <Panel
      title="Digest"
      viewRow={
        <ViewRow>
          <WeekStepper
            label={formatDateRange(data.week_start, data.week_end)}
            onStep={(direction) => {
              const params = new URLSearchParams(searchParams)
              params.set("week_of", shiftDays(data.week_start, direction * 7))
              setSearchParams(params)
            }}
          />
        </ViewRow>
      }
    >
      <MetricStrip
        metrics={[
          {
            label: "Spent",
            value: <Amount cents={headline.total_spent_cents} />,
            detail: headline.transaction_count === 1 ? "1 transaction" : `${headline.transaction_count} transactions`,
          },
          {
            label: "vs last week",
            value: <Amount cents={headline.vs_last_week_cents} kind="signed" />,
            detail: (
              <>
                <Amount cents={headline.total_spent_cents - headline.vs_last_week_cents} /> last week
              </>
            ),
          },
          {
            label: "vs 4-week average",
            value: <Amount cents={headline.vs_four_week_avg_cents} kind="signed" />,
            detail: (
              <>
                <Amount cents={headline.total_spent_cents - headline.vs_four_week_avg_cents} /> average
              </>
            ),
          },
          {
            label: "Budgets on pace",
            value: data.budget_pulse.length ? `${data.budget_pulse.length - overPace} of ${data.budget_pulse.length}` : "None",
            detail: data.budget_pulse.length ? `${overPace} over pace` : undefined,
          },
        ]}
      />
      <ChartCard
        title="Week"
        empty={weekItems.length ? undefined : "No spending this week."}
        table={
          <ChartTable
            label="Spending this week by category"
            columns={["Category", "Amount", "Share"]}
            rows={weekItems.map((item) => ({ key: item.key, cells: [item.label, item.amount, item.share] }))}
          />
        }
      >
        {(focus) => (
          <ShareBar
            focus={focus}
            items={weekItems}
            tooltip={(item) => <ChartTooltip rows={[{ key: item.key, label: item.label, value: item.amount, color: item.color }]} />}
            onSelect={(item) => {
              if (item.key !== "other") openLedger(Number(item.key))
            }}
          />
        )}
      </ChartCard>
      <CardRow>
        <Sheet title="Top categories">
          {data.top_categories.length ? (
            <List flat label="Top categories">
              {data.top_categories.map((category) => (
                <Row key={category.category_id} {...TOP_COLUMNS} label={category.name} onOpen={() => openLedger(category.category_id)}>
                  <CategoryGlyph categoryId={category.category_id} icon={category.icon} name={category.name} />
                  <Cell>{category.name}</Cell>
                  <Cell hide="mobile">
                    <BudgetBar ratio={category.bar_percent / 100} />
                  </Cell>
                  <AmountCell>
                    <Amount cents={category.amount_cents} decimals={false} />
                  </AmountCell>
                  <Cell align="right" tone="faint">
                    {category.is_above_trailing_50 ? <ArrowUpRightIcon size={12} role="img" aria-label="Above its average" /> : null} avg{" "}
                    <Amount cents={category.trailing_weekly_avg_cents} decimals={false} />
                  </Cell>
                </Row>
              ))}
            </List>
          ) : (
            <EmptyState inline>No spending this week.</EmptyState>
          )}
        </Sheet>
        <Sheet
          title="Budgets"
         
          actions={<IconButton icon={ArrowRightIcon} label="Open budgets" onClick={() => navigate("/budgets")} />}
        >
          {data.budget_pulse.length ? (
            <List flat label="Budgets">
              {data.budget_pulse.map((budget) => {
                const remaining = budget.amount_cents - budget.spent_cents
                return (
                  <Row
                    key={`${budget.scope_category_id ?? "overall"}-${budget.scope_label}`}
                    {...BUDGET_COLUMNS}
                    label={budget.scope_label}
                    onOpen={() => navigate("/budgets")}
                  >
                    <CategoryGlyph
                      categoryId={budget.scope_category_id}
                      icon={categoryIcons.get(budget.scope_category_id ?? 0)}
                      name={budget.scope_label}
                    />
                    <Cell>{budget.scope_label}</Cell>
                    <BudgetBar ratio={budget.spent_cents / budget.amount_cents} over={remaining < 0} pace={pace} />
                    <Cell align="right" tone="muted">
                      {remaining < 0 ? (
                        <>
                          <Amount cents={-remaining} decimals={false} tone="over" /> over
                        </>
                      ) : (
                        <>
                          <Amount cents={remaining} decimals={false} /> left
                        </>
                      )}
                    </Cell>
                  </Row>
                )
              })}
            </List>
          ) : (
            <EmptyState inline>No budgets this month.</EmptyState>
          )}
        </Sheet>
      </CardRow>
      <CardRow>
        <Sheet title="Unusual">
          {data.unusual_transactions.length ? (
            <List flat label="Unusual transactions">
              {data.unusual_transactions.map((item) => {
                const title = item.title || item.category?.name || "Untitled"
                return (
                  <Row key={item.id} columns={ROW_COLUMNS} label={title} onOpen={() => navigate(`/transactions/${item.id}`)}>
                    <CategoryGlyph categoryId={item.category?.id ?? null} icon={item.category?.icon} name={item.category?.name ?? "Uncategorized"} />
                    <Cell>{title}</Cell>
                    <Cell tone="faint">
                      avg <Amount cents={item.trailing_avg_cents} decimals={false} />
                    </Cell>
                    <AmountCell>
                      <Amount cents={item.amount_cents} kind="expense" />
                    </AmountCell>
                  </Row>
                )
              })}
            </List>
          ) : (
            <EmptyState inline>Nothing unusual this week.</EmptyState>
          )}
        </Sheet>
        <Sheet title="Auto-posted">
          {data.recurring_postings.length ? (
            <List flat label="Auto-posted transactions">
              {data.recurring_postings.map((item) => (
                <Row
                  key={item.transaction_id}
                  columns={ROW_COLUMNS}
                  label={item.rule_name || "Recurring"}
                  onOpen={() => navigate(item.rule_id ? `/recurring?peek=${item.rule_id}` : `/transactions/${item.transaction_id}`)}
                >
                  <CategoryGlyph categoryId={item.category?.id ?? null} icon={item.category?.icon} name={item.category?.name ?? "Uncategorized"} />
                  <Cell>{item.rule_name || "Recurring"}</Cell>
                  <Cell tone="faint">{dayLabel(item.date)}</Cell>
                  <AmountCell>
                    <Amount cents={item.amount_cents} kind={item.type} />
                  </AmountCell>
                </Row>
              ))}
            </List>
          ) : (
            <EmptyState inline>Nothing auto-posted this week.</EmptyState>
          )}
        </Sheet>
      </CardRow>
    </Panel>
  )
}

export default DigestPage
