import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple"
import { FilePdfIcon } from "@phosphor-icons/react/FilePdf"
import { useSearchParams } from "react-router-dom"
import { apiFetch, apiFetchBlob, getApiErrorMessage } from "../app/api"
import type { CategoriesResponse } from "../app/api-types"
import { formatDateRange } from "../app/format"
import { FormPopover } from "../components/FormPopover"
import { Button } from "../components/ui/Button"
import { CheckboxField, CheckGroup } from "../components/ui/Checkbox"
import { Combobox } from "../components/ui/Combobox"
import { useIsDesktop } from "../components/ui/layout-state"
import { Menu, MenuItem } from "../components/ui/Menu"
import { Panel } from "../components/ui/Panel"
import { PeekSection } from "../components/ui/Peek"
import { Pill } from "../components/ui/Pill"
import { Property, PropertyButton, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { FileRow, FormCard } from "../components/ui/Sheet"
import { Switch } from "../components/ui/Switch"
import { Field, FieldError, TextArea, TextField } from "../components/ui/TextField"

type ReportTag = { id: number; name: string; is_hidden_from_filters: boolean; archived_at: string | null }
type SectionKey = "summary" | "category_breakdown" | "top_categories" | "trend" | "recent_transactions" | "recurring_upcoming"
type DateRange = { start: string; end: string }
type GeneratedFile = { url: string; filename: string; at: Date }

const SECTIONS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "category_breakdown", label: "Category breakdown" },
  { key: "top_categories", label: "Top categories" },
  { key: "trend", label: "Trend" },
  { key: "recent_transactions", label: "Transactions" },
  { key: "recurring_upcoming", label: "Upcoming recurring" },
]
const DEFAULT_SECTIONS: ReadonlyArray<SectionKey> = ["summary", "category_breakdown", "recent_transactions"]
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })

function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function isIsoDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

// This month, unless the link names a range (start and end).
function initialRange(params: URLSearchParams): DateRange {
  const start = params.get("start")
  const end = params.get("end")
  if (isIsoDate(start) && isIsoDate(end)) return { start, end }
  const today = new Date()
  return {
    start: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  }
}

function RangePopover({ value, onSave }: { value: DateRange; onSave: (next: DateRange) => void }) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  return (
    <FormPopover
      label="Date range"
      error={error}
      onOpen={() => {
        setDraft(value)
        setError(null)
      }}
      onSubmit={() => {
        if (!draft.start || !draft.end) {
          setError("Choose a start and an end date.")
          return false
        }
        if (draft.end < draft.start) {
          setError("The end must not be before the start.")
          return false
        }
        onSave(draft)
        return true
      }}
      trigger={<PropertyButton>{formatDateRange(value.start, value.end)}</PropertyButton>}
    >
      <Field label="From">
        <TextField type="date" autoFocus value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
      </Field>
      <Field label="Until">
        <TextField type="date" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
      </Field>
    </FormPopover>
  )
}

function ReportBuilderPage() {
  const isDesktop = useIsDesktop()
  const [searchParams] = useSearchParams()
  const [range, setRange] = useState(() => initialRange(searchParams))
  const [sections, setSections] = useState<ReadonlyArray<SectionKey>>(DEFAULT_SECTIONS)
  const [transactionType, setTransactionType] = useState<"all" | "income" | "expense">("all")
  const [sort, setSort] = useState<"newest" | "oldest">("newest")
  const [runningBalance, setRunningBalance] = useState(false)
  const [categorySubtotals, setCategorySubtotals] = useState(false)
  const [includeCents, setIncludeCents] = useState(true)
  const [notes, setNotes] = useState("")
  const [categoryMode, setCategoryMode] = useState<"all" | "selected">("all")
  const [categoryIds, setCategoryIds] = useState<number[]>([])
  const [tagMode, setTagMode] = useState<"all" | "include" | "exclude">("all")
  const [tagIds, setTagIds] = useState<number[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<GeneratedFile | null>(null)

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories").then((response) => response.categories),
  })
  const tags = useQuery({
    queryKey: ["tags", "report-builder"],
    queryFn: () => apiFetch<{ tags: ReportTag[] }>("/api/tags?period=all&include_archived=1"),
  })
  useEffect(() => {
    return () => {
      if (file) URL.revokeObjectURL(file.url)
    }
  }, [file])

  const activeCategories = (categories.data ?? []).filter((category) => category.archived_at === null)
  // Archived tags stay choosable for past periods; they sort last.
  const filterTags = (tags.data?.tags ?? [])
    .filter((tag) => !tag.is_hidden_from_filters)
    .sort((a, b) => Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)) || a.name.localeCompare(b.name))
  const toggle = <T,>(values: ReadonlyArray<T>, value: T): T[] =>
    values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]

  const generate = async () => {
    setError(null)
    if (!sections.length) return setError("Select at least one report section.")
    const activeIds = activeCategories.map((category) => category.id)
    const chosenCategories = categoryIds.filter((id) => activeIds.includes(id))
    const chosenTags = tagIds.filter((id) => filterTags.some((tag) => tag.id === id))
    if (tagMode !== "all" && !chosenTags.length) return setError("Select at least one tag.")
    // Opened before the request so the browser treats it as a response to the click.
    const popup = window.open("about:blank", "_blank")
    if (popup) popup.opener = null
    setGenerating(true)
    try {
      const { blob, filename } = await apiFetchBlob("/api/reports/pdf", {
        method: "POST",
        body: JSON.stringify({
          start: range.start,
          end: range.end,
          sections: SECTIONS.map((section) => section.key).filter((key) => sections.includes(key)),
          include_cents: includeCents,
          notes: notes.trim() || null,
          transaction_type: transactionType === "all" ? null : transactionType,
          category_ids:
            categoryMode === "selected" && chosenCategories.length && chosenCategories.length < activeIds.length ? chosenCategories : null,
          tag_ids: tagMode === "include" ? chosenTags : [],
          excluded_tag_ids: tagMode === "exclude" ? chosenTags : [],
          transactions_sort: runningBalance ? "oldest" : sort,
          show_running_balance: runningBalance,
          include_category_subtotals: categorySubtotals,
        }),
      })
      const url = URL.createObjectURL(blob)
      setFile({ url, filename: filename ?? "expense_report.pdf", at: new Date() })
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
    } catch (failure) {
      popup?.close()
      setError(getApiErrorMessage(failure, "Unable to generate report."))
    } finally {
      setGenerating(false)
    }
  }

  const download = () => {
    if (!file) return
    const link = document.createElement("a")
    link.href = file.url
    link.download = file.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <Panel
      title="Reports"
      actions={
        <Button variant="primary" icon={FilePdfIcon} aria-label="Generate PDF" disabled={generating} onClick={() => void generate()}>
          {generating ? "Generating…" : isDesktop ? "Generate PDF" : "Generate"}
        </Button>
      }
    >
      <FormCard
        top={
          file || error ? (
            <>
              {file ? (
                <FileRow
                  icon={FilePdfIcon}
                  name={file.filename}
                  meta={`Generated ${TIME.format(file.at)}`}
                  action={
                    <Button variant="ghost" size="small" icon={DownloadSimpleIcon} onClick={download}>
                      Download
                    </Button>
                  }
                />
              ) : null}
              {error ? <FieldError>{error}</FieldError> : null}
            </>
          ) : undefined
        }
        main={
          <PropertyList wide>
            <Property label="Date range" editable>
              <RangePopover value={range} onSave={setRange} />
            </Property>
            <Property label="Type">
              <SegmentedControl
                label="Type"
                value={transactionType}
                options={[
                  { value: "all", label: "All" },
                  { value: "income", label: "Income" },
                  { value: "expense", label: "Expense" },
                ]}
                onChange={setTransactionType}
              />
            </Property>
            {runningBalance ? (
              <Property label="Sort">Oldest first, for the running balance</Property>
            ) : (
              <Property label="Sort" editable>
                <Menu label="Sort" align="start" trigger={<PropertyButton>{sort === "newest" ? "Newest first" : "Oldest first"}</PropertyButton>}>
                  <MenuItem checked={sort === "newest"} onSelect={() => setSort("newest")}>
                    Newest first
                  </MenuItem>
                  <MenuItem checked={sort === "oldest"} onSelect={() => setSort("oldest")}>
                    Oldest first
                  </MenuItem>
                </Menu>
              </Property>
            )}
            <Property label="Running balance">
              <Switch label="Running balance" checked={runningBalance} onCheckedChange={setRunningBalance} />
            </Property>
            <Property label="Category subtotals">
              <Switch label="Category subtotals" checked={categorySubtotals} onCheckedChange={setCategorySubtotals} />
            </Property>
            <Property label="Cents in tables">
              <Switch label="Cents in tables" checked={includeCents} onCheckedChange={setIncludeCents} />
            </Property>
          </PropertyList>
        }
        side={
          <>
            <PeekSection title="Sections">
              <CheckGroup label="Sections">
                {SECTIONS.map((section) => (
                  <CheckboxField
                    key={section.key}
                    checked={sections.includes(section.key)}
                    onCheckedChange={() => setSections(toggle(sections, section.key))}
                  >
                    {section.label}
                  </CheckboxField>
                ))}
              </CheckGroup>
            </PeekSection>
            <PeekSection title="Scope">
              <PropertyList wide>
                <Property label="Categories">
                  <SegmentedControl
                    label="Categories"
                    value={categoryMode}
                    options={[
                      { value: "all", label: "All" },
                      { value: "selected", label: "Selected" },
                    ]}
                    onChange={setCategoryMode}
                  />
                  {categoryMode === "selected" ? (
                    <Combobox
                      multiple
                      label="Categories"
                      selected={categoryIds}
                      onSelect={(id) => setCategoryIds(toggle(categoryIds, id))}
                      options={activeCategories.map((category) => ({
                        value: category.id,
                        label: category.name,
                        group: category.type === "income" ? "Income" : "Expense",
                      }))}
                      trigger={
                        <Pill set={categoryIds.length > 0} aria-label={`Choose categories, ${categoryIds.length} chosen`}>
                          {categoryIds.length ? `${categoryIds.length} chosen` : "Choose"}
                        </Pill>
                      }
                    />
                  ) : null}
                </Property>
                <Property label="Tags">
                  <SegmentedControl
                    label="Tags"
                    value={tagMode}
                    options={[
                      { value: "all", label: "All" },
                      { value: "include", label: "Only include" },
                      { value: "exclude", label: "Exclude" },
                    ]}
                    onChange={setTagMode}
                  />
                  {tagMode === "all" ? null : (
                    <Combobox
                      multiple
                      label="Tags"
                      selected={tagIds}
                      onSelect={(id) => setTagIds(toggle(tagIds, id))}
                      options={filterTags.map((tag) => ({ value: tag.id, label: tag.name, end: tag.archived_at ? "Archived" : undefined }))}
                      trigger={
                        <Pill set={tagIds.length > 0} aria-label={`Choose tags, ${tagIds.length} chosen`}>
                          {tagIds.length ? `${tagIds.length} chosen` : "Choose"}
                        </Pill>
                      }
                    />
                  )}
                </Property>
              </PropertyList>
            </PeekSection>
          </>
        }
        wide={
          <PeekSection title="Notes">
            <TextArea aria-label="Notes" placeholder="Shown at the top of the report" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </PeekSection>
        }
      />
    </Panel>
  )
}

export default ReportBuilderPage
