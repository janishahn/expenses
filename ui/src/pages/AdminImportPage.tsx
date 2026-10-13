import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { WarningIcon } from "@phosphor-icons/react/Warning"
import { apiFetch, apiFetchFormData, getApiErrorMessage } from "../app/api"
import { formatDateRange, formatShortDate } from "../app/format"
import { Amount } from "../components/ui/Amount"
import { Button } from "../components/ui/Button"
import { CheckboxField, CheckGroup } from "../components/ui/Checkbox"
import { Status } from "../components/ui/EmptyState"
import { FileDrop } from "../components/ui/FileDrop"
import { AmountCell, Cell, List, ListHead, Row, type Columns } from "../components/ui/LedgerRow"
import { SettingRow, SettingsShell } from "../components/ui/SettingsShell"
import { MetricStrip, Sheet } from "../components/ui/Sheet"
import { FieldError, Select } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import { useSettingsGroups } from "./settings-nav"

type SqliteCategory = {
  id: number
  name: string
  type: string
}

type SqliteMappingRow = {
  idx: number
  legacy_type: string
  legacy_category: string
  transaction_count: number
  suggested_category_id: number | null
  suggested_category_name: string | null
}

type SqliteRecurringRow = {
  description: string
  legacy_type: string
  legacy_category: string
  amount_cents: number
  start_date: string
  recurrence_type: string
  interval: number
  last_processed_date: string | null
  computed_next_occurrence: string | null
}

type SqlitePreview = {
  transactions_count: number
  recurring_count: number
  min_transaction_date: string | null
  max_transaction_date: string | null
  non_midnight_transaction_times: number
  warnings: string[]
  mapping_rows: SqliteMappingRow[]
  recurring_rows: SqliteRecurringRow[]
}

type SqlitePreviewResponse = {
  token: string
  preview: SqlitePreview
  categories: SqliteCategory[]
}

type SqliteCommitResponse = {
  result: Record<string, number>
}

type ImportOptions = {
  import_recurring_rules: boolean
  recurring_auto_post: boolean
  link_recurring_transactions: boolean
  preserve_time_in_title: boolean
}

const MAPPING_COLUMNS: Columns = {
  columns: "minmax(0, 1fr) 72px 110px minmax(0, 260px)",
  mobileColumns: "minmax(0, 1fr) minmax(0, 1fr)",
}
// The settings column is narrower than a list's narrow breakpoint, so cells drop only on mobile.
const RECURRING_COLUMNS: Columns = {
  columns: "minmax(0, 1fr) minmax(0, 120px) 84px 96px 96px 100px",
  mobileColumns: "minmax(0, 1fr) auto",
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function AdminImportPage() {
  const groups = useSettingsGroups()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [mapping, setMapping] = useState<Record<number, string>>({})
  const [options, setOptions] = useState<ImportOptions>({
    import_recurring_rules: true,
    recurring_auto_post: false,
    link_recurring_transactions: true,
    preserve_time_in_title: false,
  })

  const preview = useMutation({
    mutationFn: (chosen: File) => {
      const form = new FormData()
      form.append("file", chosen)
      return apiFetchFormData<SqlitePreviewResponse>("/api/import/sqlite/preview", { method: "POST", body: form })
    },
    onSuccess: (data) => {
      setOptions({
        import_recurring_rules: data.preview.recurring_count > 0,
        recurring_auto_post: false,
        link_recurring_transactions: true,
        preserve_time_in_title: data.preview.non_midnight_transaction_times > 0,
      })
      setMapping(
        Object.fromEntries(
          data.preview.mapping_rows.map((row) => [row.idx, row.suggested_category_id ? `existing:${row.suggested_category_id}` : "create"])
        )
      )
    },
  })
  const commit = useMutation({
    mutationFn: (data: SqlitePreviewResponse) =>
      apiFetch<SqliteCommitResponse>("/api/import/sqlite/commit", {
        method: "POST",
        body: JSON.stringify({
          token: data.token,
          options,
          mapping_targets: data.preview.mapping_rows.map((row) => {
            const value = mapping[row.idx] || "create"
            const base = { legacy_type: row.legacy_type, legacy_category: row.legacy_category }
            if (value === "discard") return { ...base, target: "discard" as const, existing_category_id: null }
            if (value.startsWith("existing:")) {
              return { ...base, target: "existing" as const, existing_category_id: Number(value.split(":", 2)[1]) }
            }
            return { ...base, target: "create" as const, existing_category_id: null }
          }),
        }),
      }),
    onSuccess: (data) => {
      const entries = Object.entries(data.result)
      showToast({
        message: entries.length ? `Imported. ${entries.map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`).join(" · ")}` : "Import completed.",
      })
      setFile(null)
      preview.reset()
      void queryClient.invalidateQueries()
    },
  })
  const data = preview.data
  const error = preview.error
    ? getApiErrorMessage(preview.error, "Unable to inspect the SQLite database.")
    : commit.error
      ? getApiErrorMessage(commit.error, "Unable to import the SQLite database.")
      : null
  const setOption = (key: keyof ImportOptions) => (checked: boolean) => setOptions((previous) => ({ ...previous, [key]: checked }))

  return (
    <SettingsShell
      title="Admin"
      groups={groups}
      current="maintenance"
      page="Legacy SQLite import"
      actions={
        data ? (
          <Button variant="primary" disabled={commit.isPending} onClick={() => commit.mutate(data)}>
            {commit.isPending ? "Importing…" : "Import"}
          </Button>
        ) : undefined
      }
    >
      <Sheet title="Database" meta={file?.name}>
        <FileDrop
          accept=".db"
          label="SQLite database file"
          disabled={preview.isPending || commit.isPending}
          onFile={(chosen) => {
            setFile(chosen)
            commit.reset()
            preview.mutate(chosen)
          }}
        >
          {preview.isPending ? "Reading the database…" : file ? "Drop another .db file or choose one" : "Drop a .db file or choose one"}
        </FileDrop>
        {error ? <FieldError>{error}</FieldError> : null}
      </Sheet>
      {data ? (
        <>
          <MetricStrip
            metrics={[
              {
                label: "Transactions",
                value: data.preview.transactions_count,
                detail: data.preview.non_midnight_transaction_times
                  ? `${data.preview.non_midnight_transaction_times} with a time of day`
                  : undefined,
              },
              { label: "Recurring rules", value: data.preview.recurring_count },
              {
                label: "Dates",
                value:
                  data.preview.min_transaction_date && data.preview.max_transaction_date
                    ? formatDateRange(data.preview.min_transaction_date, data.preview.max_transaction_date)
                    : "None",
              },
              { label: "Categories", value: data.preview.mapping_rows.length },
            ]}
          />
          {data.preview.warnings.length ? (
            <Sheet title="Warnings" body="flush">
              {data.preview.warnings.map((warning) => (
                <SettingRow
                  key={warning}
                  label={
                    <Status icon={WarningIcon} tone="bad" wrap>
                      {warning}
                    </Status>
                  }
                />
              ))}
            </Sheet>
          ) : null}
          <Sheet title="Options">
            <CheckGroup label="Options">
              <CheckboxField checked={options.import_recurring_rules} onCheckedChange={setOption("import_recurring_rules")}>
                Import recurring rules
              </CheckboxField>
              <CheckboxField checked={options.recurring_auto_post} onCheckedChange={setOption("recurring_auto_post")}>
                Post imported rules automatically
              </CheckboxField>
              <CheckboxField checked={options.link_recurring_transactions} onCheckedChange={setOption("link_recurring_transactions")}>
                Link “(Recurring)” transactions to rules
              </CheckboxField>
              <CheckboxField checked={options.preserve_time_in_title} onCheckedChange={setOption("preserve_time_in_title")}>
                Add the time of day to titles
              </CheckboxField>
            </CheckGroup>
            <Status icon={WarningIcon}>Running the import again can duplicate one-time transactions.</Status>
          </Sheet>
          <Sheet title="Category mapping" body="flush">
            <List flat label="Category mapping">
              {data.preview.mapping_rows.map((row) => (
                <Row key={`${row.legacy_type}-${row.legacy_category}`} {...MAPPING_COLUMNS} label={row.legacy_category} controls>
                  <Cell strong>{row.legacy_category}</Cell>
                  <Cell tone="muted" hide="mobile">
                    {row.legacy_type === "income" ? "Income" : "Expense"}
                  </Cell>
                  <Cell tone="muted">{plural(row.transaction_count, "transaction")}</Cell>
                  <Select
                    aria-label={`Map ${row.legacy_category}`}
                    value={mapping[row.idx] || "create"}
                    onChange={(event) => setMapping((previous) => ({ ...previous, [row.idx]: event.target.value }))}
                  >
                    <option value="discard">Discard all</option>
                    <option value="create">Create “{row.legacy_category}”</option>
                    {data.categories
                      .filter((category) => category.type === row.legacy_type)
                      .map((category) => (
                        <option key={category.id} value={`existing:${category.id}`}>
                          {category.name}
                          {category.id === row.suggested_category_id ? " (suggested)" : ""}
                        </option>
                      ))}
                  </Select>
                </Row>
              ))}
            </List>
          </Sheet>
          {data.preview.recurring_rows.length ? (
            <Sheet title="Recurring rules" meta={plural(data.preview.recurring_rows.length, "rule")} body="flush">
              <List flat label="Recurring rules">
                <ListHead {...RECURRING_COLUMNS}>
                  <span>Name</span>
                  <Cell hide="mobile">Category</Cell>
                  <Cell hide="mobile">Repeats</Cell>
                  <Cell hide="mobile">Starts</Cell>
                  <Cell hide="mobile">Next</Cell>
                  <span />
                </ListHead>
                {data.preview.recurring_rows.map((row) => (
                  <Row key={`${row.description}-${row.legacy_type}-${row.legacy_category}-${row.amount_cents}`} {...RECURRING_COLUMNS}>
                    <Cell>{row.description}</Cell>
                    <Cell tone="muted" hide="mobile">
                      {row.legacy_category}
                    </Cell>
                    <Cell tone="muted" hide="mobile">
                      {row.interval === 1 ? row.recurrence_type : `${row.recurrence_type} / ${row.interval}`}
                    </Cell>
                    <Cell tone="muted" hide="mobile">
                      {formatShortDate(row.start_date)}
                    </Cell>
                    <Cell tone="muted" hide="mobile">
                      {row.computed_next_occurrence ? formatShortDate(row.computed_next_occurrence) : "None"}
                    </Cell>
                    <AmountCell>
                      <Amount cents={row.amount_cents} kind={row.legacy_type === "income" ? "income" : "expense"} />
                    </AmountCell>
                  </Row>
                ))}
              </List>
            </Sheet>
          ) : null}
        </>
      ) : null}
    </SettingsShell>
  )
}

export default AdminImportPage
