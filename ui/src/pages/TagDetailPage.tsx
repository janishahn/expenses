import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { apiFetch, isApiErrorStatus } from "../app/api"
import type { TransactionListItem } from "../app/api-types"
import { formatShortDate } from "../app/format"
import { ValuePopover } from "../components/FormPopover"
import { Amount } from "../components/ui/Amount"
import { IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { ChartCard, ChartTable, ChartTooltip } from "../components/ui/ChartCard"
import { CardRow, CardStack, Donut } from "../components/ui/Charts"
import { EmptyState } from "../components/ui/EmptyState"
import { AmountCell, Cell, List, NetPrefix, Row, type Columns } from "../components/ui/LedgerRow"
import { Menu } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading, ViewRow } from "../components/ui/Panel"
import { PeriodControl } from "../components/ui/PeriodControl"
import { periodFromSearch, writePeriodToSearch, type PeriodSelection } from "../components/ui/period"
import { Property, PropertyButton } from "../components/ui/PropertyList"
import { MetricStrip, Sheet } from "../components/ui/Sheet"
import { showToast } from "../components/ui/toast-store"
import { categoryColor } from "../components/ui/tokens"
import { useTagLifecycle, useTagSave, type TagRecord } from "./tag-record"
import { TagMenuItems, TagMergeDialog, TagSettingsList } from "./TagSettings"

type BreakdownItem = { id: number; name: string; amount_cents: number; percent: number }

type TagDetailResponse = {
  tag: TagRecord
  period: { slug: string; start: string; end: string }
  kpis: { income: number; expenses: number; balance: number }
  donut: { expense_breakdown: BreakdownItem[]; income_breakdown: BreakdownItem[] }
  transactions: TransactionListItem[]
}

const DEFAULT_PERIOD: PeriodSelection = { slug: "all" }
const PARENTS = [{ label: "Tags", to: "/tags" }]
const TRANSACTION_COLUMNS: Columns = {
  columns: "18px minmax(0, 1fr) 96px auto",
  mobileColumns: "18px minmax(0, 1fr) 84px auto",
}

function BreakdownCard({ title, items, centerLabel, empty }: { title: string; items: BreakdownItem[]; centerLabel: string; empty: string }) {
  const total = items.reduce((sum, item) => sum + item.amount_cents, 0)
  return (
    <ChartCard
      title={title}
      empty={items.length ? undefined : empty}
      table={
        <ChartTable
          label={`${title} by category`}
          columns={["Category", "Amount", "Share"]}
          rows={items.map((item) => ({
            key: String(item.id),
            cells: [item.name, <Amount cents={item.amount_cents} />, `${Math.round(item.percent)} %`],
          }))}
        />
      }
    >
      {(focus) => (
        <Donut
          focus={focus}
          center={<Amount cents={total} decimals={false} />}
          centerLabel={centerLabel}
          items={items.map((item) => ({
            key: String(item.id),
            label: item.name,
            value: item.amount_cents,
            color: categoryColor(item.id),
            amount: <Amount cents={item.amount_cents} />,
            share: `${Math.round(item.percent)} %`,
          }))}
          tooltip={(item) => <ChartTooltip rows={[{ key: item.key, label: item.label, value: item.amount, color: item.color }]} />}
        />
      )}
    </ChartCard>
  )
}

function TagDetail({ data, period, onPeriodChange }: { data: TagDetailResponse; period: PeriodSelection; onPeriodChange: (next: PeriodSelection) => void }) {
  const navigate = useNavigate()
  const { tag, kpis, donut, transactions } = data
  const [merging, setMerging] = useState(false)
  const { view, errors, setError, save } = useTagSave(tag)
  const { archive, restore, confirmDelete } = useTagLifecycle(tag, () => navigate("/tags", { replace: true }))
  const tags = useQuery({
    queryKey: ["tags", "all"],
    queryFn: () => apiFetch<{ tags: TagRecord[] }>("/api/tags?period=all"),
    enabled: merging,
  })

  return (
    <Panel
      title={tag.name}
      parents={PARENTS}
      actions={
        <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
          <TagMenuItems
            archived={Boolean(tag.archived_at)}
            onMerge={() => setMerging(true)}
            onArchive={archive}
            onRestore={restore}
            onDelete={() => void confirmDelete()}
          />
        </Menu>
      }
      viewRow={
        <ViewRow>
          <PeriodControl value={period} onChange={onPeriodChange} />
        </ViewRow>
      }
    >
      <MetricStrip
        metrics={[
          { label: "Expenses", value: <Amount cents={kpis.expenses} /> },
          { label: "Income", value: <Amount cents={kpis.income} /> },
          { label: "Balance", value: <Amount cents={kpis.balance} /> },
        ]}
      />
      <CardRow wide>
        {transactions.length ? (
          <List scroll={false} label="Transactions">
            {transactions.map((item) => {
              const title = item.title || item.category?.name || "Untitled"
              const isExpense = item.type === "expense"
              return (
                <Row key={item.id} {...TRANSACTION_COLUMNS} label={title} onOpen={() => navigate(`/transactions/${item.id}`)}>
                  <CategoryGlyph categoryId={item.category?.id ?? null} icon={item.category?.icon} name={item.category?.name ?? "Uncategorized"} />
                  <Cell strong>{title}</Cell>
                  <Cell tone="muted">{formatShortDate(item.date)}</Cell>
                  <AmountCell>
                    {isExpense && item.reimbursed_total_cents > 0 ? (
                      <NetPrefix>
                        <Amount cents={item.net_amount_cents} kind="expense" />
                      </NetPrefix>
                    ) : null}
                    <Amount cents={item.amount_cents} kind={isExpense ? "expense" : "income"} />
                  </AmountCell>
                </Row>
              )
            })}
          </List>
        ) : (
          <Sheet>
            <EmptyState inline>No transactions in this period.</EmptyState>
          </Sheet>
        )}
        <CardStack>
          <Sheet title="Settings">
            <TagSettingsList
              tag={view}
              errors={errors}
              save={save}
              lead={
                <Property label="Name" editable error={errors.name}>
                  <ValuePopover
                    label="Name"
                    value={view.name}
                    onSave={(next) => {
                      if (!next.trim()) return "Enter a tag name."
                      setError("name", null)
                      void save("name", { name: next.trim() })
                      return null
                    }}
                    trigger={<PropertyButton>{view.name}</PropertyButton>}
                  />
                </Property>
              }
            >
              <Property label="Created">{formatShortDate(tag.created_at)}</Property>
              {tag.archived_at ? <Property label="Archived">{formatShortDate(tag.archived_at)}</Property> : null}
            </TagSettingsList>
          </Sheet>
          <BreakdownCard title="Expenses" items={donut.expense_breakdown} centerLabel={tag.name} empty="No spending in this period." />
          {donut.income_breakdown.length ? (
            <BreakdownCard title="Income" items={donut.income_breakdown} centerLabel={tag.name} empty="No income in this period." />
          ) : null}
        </CardStack>
      </CardRow>
      {merging && tags.data ? (
        <TagMergeDialog
          source={tag}
          targets={tags.data.tags.filter((entry) => entry.id !== tag.id)}
          onClose={() => setMerging(false)}
          onMerged={(target) => {
            setMerging(false)
            showToast({ message: `Merged ${tag.name} into ${target.name}.` })
            navigate(`/tags/${target.id}`, { replace: true })
          }}
        />
      ) : null}
    </Panel>
  )
}

function TagDetailPage() {
  const { tagId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const period = periodFromSearch(searchParams, DEFAULT_PERIOD)
  const queryString = writePeriodToSearch(new URLSearchParams(), period).toString()
  const { data, isLoading, error } = useQuery({
    queryKey: ["tag", Number(tagId), queryString],
    queryFn: () => apiFetch<TagDetailResponse>(`/api/tags/${tagId}?${queryString}`),
    enabled: Boolean(tagId),
  })

  if (!tagId || isApiErrorStatus(error, 404)) {
    return <PanelError title="Tag" parents={PARENTS} message="Tag not found." returnTo={{ label: "Back to tags", to: "/tags" }} />
  }
  if (isLoading) return <PanelLoading title="Tag" parents={PARENTS} label="Loading tag…" />
  if (error || !data) return <PanelError title="Tag" parents={PARENTS} message="Unable to load tag." />

  return (
    <TagDetail
      key={data.tag.id}
      data={data}
      period={period}
      onPeriodChange={(next) => setSearchParams(writePeriodToSearch(searchParams, next))}
    />
  )
}

export default TagDetailPage
