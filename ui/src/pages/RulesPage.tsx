import { useEffect, useState, type ReactElement, type ReactNode } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { CheckIcon } from "@phosphor-icons/react/Check"
import { CoinsIcon } from "@phosphor-icons/react/Coins"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { ListNumbersIcon } from "@phosphor-icons/react/ListNumbers"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { LightbulbIcon } from "@phosphor-icons/react/Lightbulb"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { TextAaIcon } from "@phosphor-icons/react/TextAa"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { WalletIcon } from "@phosphor-icons/react/Wallet"
import { XIcon } from "@phosphor-icons/react/X"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import type { CategorySummary } from "../app/api-types"
import { useAuth } from "../app/auth"
import { useQueuedSave } from "../app/queued-save"
import { amountInput, parseAmountCents } from "../app/transactions"
import { confirmDialog } from "../components/confirm"
import { FormPopover, ValuePopover } from "../components/FormPopover"
import { TagPicker } from "../components/TagPicker"
import { Amount } from "../components/ui/Amount"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph, IconGlyph } from "../components/ui/CategoryGlyph"
import { Combobox } from "../components/ui/Combobox"
import { DayBand } from "../components/ui/DayBand"
import { EmptyState } from "../components/ui/EmptyState"
import { EntryChips, EntryDialog, EntryName, EntryPreview } from "../components/ui/EntryDialog"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, List, ListHead, Row, RowActions, type Columns } from "../components/ui/LedgerRow"
import { Menu, MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading } from "../components/ui/Panel"
import { Peek, PeekLayout, PeekSection } from "../components/ui/Peek"
import { Pill } from "../components/ui/Pill"
import { InlineText, Property, PropertyButton, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { Sheet } from "../components/ui/Sheet"
import { Switch } from "../components/ui/Switch"
import { TagChip } from "../components/ui/TagChip"
import { Field, FieldError, Select, TextField } from "../components/ui/TextField"
import { showToast } from "../components/ui/toast-store"
import { buildSearchParams } from "../lib/searchParams"

type MatchType = "contains" | "starts_with" | "equals" | "regex"
type AppliesTo = "any" | "expense" | "income"
type RuleField = "name" | "enabled" | "priority" | "type" | "title" | "amount" | "category" | "tags" | "budgets"

type RuleRow = {
  id: number
  name: string
  enabled: boolean
  priority: number
  match_type: MatchType
  match_value: string
  transaction_type: "income" | "expense" | null
  min_amount_cents: number | null
  max_amount_cents: number | null
  set_category_id: number | null
  set_category: CategorySummary | null
  add_tags: string[]
  budget_exclude_tag_id: number | null
  budget_exclude_tag: { id: number; name: string } | null
}

type RulesResponse = {
  rules: RuleRow[]
  categories: CategorySummary[]
  tags: Array<{ id: number; name: string; is_hidden_from_budget: boolean }>
}

// The body of POST /api/rules, PUT /api/rules/{id}, and POST /api/rules/preview.
type RulePayload = {
  name: string
  enabled: boolean
  priority: number
  match_type: MatchType
  match_value: string
  transaction_type: "income" | "expense" | null
  min_amount_cents: number | null
  max_amount_cents: number | null
  set_category_id: number | null
  add_tags: string[]
  budget_exclude_tag_id: number | null
}

type RulePreview = {
  matches_count: number
  sample: Array<{
    id: number
    title: string | null
    amount_cents: number
    type: string
    before_category: string
    after_category: string
    add_tags: string[]
  }>
}

type RuleSuggestion = {
  id: number
  name: string
  match_type: MatchType
  match_value: string
  transaction_type: string | null
  set_category_name: string | null
  add_tags: string[]
  confidence: number
}

const MATCH_TYPES: Array<{ value: MatchType; label: string; phrase: string }> = [
  { value: "contains", label: "Contains", phrase: "contains" },
  { value: "starts_with", label: "Starts with", phrase: "starts with" },
  { value: "equals", label: "Equals", phrase: "equals" },
  { value: "regex", label: "Regex", phrase: "matches" },
]
const RULE_COLUMNS: Columns = {
  columns: "32px minmax(0, 170px) minmax(0, 1fr) minmax(0, 240px) 32px",
  narrowColumns: "32px minmax(0, 1fr) minmax(0, 220px) 32px",
  mobileColumns: "32px minmax(0, 1fr) minmax(0, 130px) 28px",
}
const SUGGESTION_COLUMNS: Columns = {
  columns: "18px minmax(0, 1fr) minmax(0, 180px) 44px 64px",
  mobileColumns: "18px minmax(0, 1fr) minmax(0, 110px) 64px",
}
const MATCH_COLUMNS = "minmax(0, 1fr) auto auto"
// Category picker value for "leave the category unchanged".
const KEEP = 0

function rulePayload(rule: RuleRow): RulePayload {
  return {
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    match_type: rule.match_type,
    match_value: rule.match_value,
    transaction_type: rule.transaction_type,
    min_amount_cents: rule.min_amount_cents,
    max_amount_cents: rule.max_amount_cents,
    set_category_id: rule.set_category_id,
    add_tags: rule.add_tags,
    budget_exclude_tag_id: rule.budget_exclude_tag_id,
  }
}

function phrase(matchType: MatchType): string {
  return MATCH_TYPES.find((entry) => entry.value === matchType)?.phrase ?? matchType
}

// `contains "edeka"`
function titleCondition(matchType: MatchType, value: string): string {
  return `${phrase(matchType)} “${value}”`
}

function amountCondition(min: number | null, max: number | null): ReactNode {
  if (min !== null && max !== null) {
    return (
      <>
        <Amount cents={min} /> – <Amount cents={max} />
      </>
    )
  }
  if (min !== null) {
    return (
      <>
        at least <Amount cents={min} />
      </>
    )
  }
  if (max !== null) {
    return (
      <>
        at most <Amount cents={max} />
      </>
    )
  }
  return null
}

// `Title contains "amazon" · at most 30,00 € · expenses`
function whenText(rule: RulePayload): ReactNode {
  const amount = amountCondition(rule.min_amount_cents, rule.max_amount_cents)
  return (
    <>
      Title {titleCondition(rule.match_type, rule.match_value)}
      {amount ? <> · {amount}</> : null}
      {rule.transaction_type ? ` · ${rule.transaction_type === "income" ? "income" : "expenses"} only` : null}
    </>
  )
}

// The tags a rule adds, including the one that keeps matches out of budgets.
function addedTags(rule: RuleRow): string[] {
  return rule.budget_exclude_tag ? [...rule.add_tags, rule.budget_exclude_tag.name] : rule.add_tags
}

// Empty fields leave a bound open.
function parseBounds(min: string, max: string): { min: number | null; max: number | null } | { error: string } {
  const minCents = min.trim() ? parseAmountCents(min) : null
  const maxCents = max.trim() ? parseAmountCents(max) : null
  if (min.trim() && minCents === null) return { error: "Invalid min amount." }
  if (max.trim() && maxCents === null) return { error: "Invalid max amount." }
  return { min: minCents, max: maxCents }
}

function parsePriority(raw: string): number | null {
  const value = Number(raw.trim())
  return raw.trim() && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null
}

function useRulePreview(payload: RulePayload | null, key: unknown[]) {
  return useQuery({
    queryKey: ["rules", "preview", ...key],
    queryFn: () => apiFetch<RulePreview>("/api/rules/preview", { method: "POST", body: JSON.stringify(payload) }),
    enabled: payload !== null,
    placeholderData: keepPreviousData,
    retry: 0,
  })
}

function RuleCategoryPicker({
  categories,
  appliesTo,
  selectedId,
  onSelect,
  trigger,
}: {
  categories: CategorySummary[]
  appliesTo: "income" | "expense" | null
  selectedId: number | null
  onSelect: (categoryId: number | null) => void
  trigger: ReactElement
}) {
  const offered = appliesTo ? categories.filter((category) => category.type === appliesTo) : categories
  const ordered = [...offered.filter((entry) => entry.type !== "income"), ...offered.filter((entry) => entry.type === "income")]
  return (
    <Combobox
      label="Category"
      trigger={trigger}
      options={[
        { value: KEEP, label: "Keep category" },
        ...ordered.map((category) => ({
          value: category.id,
          label: category.name,
          leading: <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} />,
          group: appliesTo ? undefined : category.type === "income" ? "Income" : "Expense",
        })),
      ]}
      selected={[selectedId ?? KEEP]}
      onSelect={(value) => onSelect(value === KEEP ? null : value)}
    />
  )
}

function AmountPopover({
  min,
  max,
  trigger,
  onSave,
}: {
  min: number | null
  max: number | null
  trigger: ReactElement
  onSave: (min: number | null, max: number | null) => void
}) {
  const [draft, setDraft] = useState({ min: "", max: "" })
  const [error, setError] = useState<string | null>(null)
  return (
    <FormPopover
      label="Amount"
      submitLabel="Done"
      trigger={trigger}
      error={error}
      onOpen={() => {
        setDraft({ min: min === null ? "" : amountInput(min), max: max === null ? "" : amountInput(max) })
        setError(null)
      }}
      onSubmit={() => {
        const bounds = parseBounds(draft.min, draft.max)
        if ("error" in bounds) {
          setError(bounds.error)
          return false
        }
        if (bounds.min !== min || bounds.max !== max) onSave(bounds.min, bounds.max)
        return true
      }}
    >
      <Field label="At least">
        <TextField
          autoFocus
          inputMode="decimal"
          placeholder="Any"
          value={draft.min}
          onChange={(event) => setDraft({ ...draft, min: event.target.value })}
        />
      </Field>
      <Field label="At most">
        <TextField
          inputMode="decimal"
          placeholder="Any"
          value={draft.max}
          onChange={(event) => setDraft({ ...draft, max: event.target.value })}
        />
      </Field>
    </FormPopover>
  )
}

function PriorityPopover({ value, trigger, onSave }: { value: number; trigger: ReactElement; onSave: (value: number) => void }) {
  return (
    <ValuePopover
      label="Priority"
      inputMode="numeric"
      submitLabel="Done"
      value={String(value)}
      trigger={trigger}
      onSave={(raw) => {
        const next = parsePriority(raw)
        if (next === null) return "Enter a priority from 0 to 10000."
        onSave(next)
        return null
      }}
    />
  )
}

function TitlePopover({
  matchType,
  value,
  trigger,
  onSave,
}: {
  matchType: MatchType
  value: string
  trigger: ReactElement
  onSave: (matchType: MatchType, value: string) => void
}) {
  const [draft, setDraft] = useState({ matchType, value })
  const [error, setError] = useState<string | null>(null)
  return (
    <FormPopover
      label="Title"
      submitLabel="Done"
      trigger={trigger}
      error={error}
      onOpen={() => {
        setDraft({ matchType, value })
        setError(null)
      }}
      onSubmit={() => {
        if (!draft.value.trim()) {
          setError("Enter a match value.")
          return false
        }
        if (draft.matchType !== matchType || draft.value.trim() !== value) onSave(draft.matchType, draft.value.trim())
        return true
      }}
    >
      <Field label="Match">
        <Select value={draft.matchType} onChange={(event) => setDraft({ ...draft, matchType: event.target.value as MatchType })}>
          {MATCH_TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title text">
        <TextField autoFocus value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} />
      </Field>
    </FormPopover>
  )
}

function BudgetsMenu({
  tags,
  selectedId,
  trigger,
  onSelect,
}: {
  tags: RulesResponse["tags"]
  selectedId: number | null
  trigger: ReactElement
  onSelect: (tagId: number | null) => void
}) {
  return (
    <Menu label="Budgets" align="start" trigger={trigger}>
      <MenuItem checked={selectedId === null} onSelect={() => onSelect(null)}>
        Included
      </MenuItem>
      {tags.map((tag) => (
        <MenuItem key={tag.id} checked={selectedId === tag.id} onSelect={() => onSelect(tag.id)}>
          Excluded with {tag.name}
        </MenuItem>
      ))}
    </Menu>
  )
}

function AddRuleDialog({ data, onClose }: { data: RulesResponse; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("any")
  const [name, setName] = useState("")
  const [matchType, setMatchType] = useState<MatchType>("contains")
  const [matchValue, setMatchValue] = useState("")
  const [bounds, setBounds] = useState<{ min: number | null; max: number | null }>({ min: null, max: null })
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [excludeTagId, setExcludeTagId] = useState<number | null>(null)
  const [priority, setPriority] = useState(100)
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The preview follows the match text after a pause in typing.
  const [settledValue, setSettledValue] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledValue(matchValue.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [matchValue])

  const category = data.categories.find((entry) => entry.id === categoryId)
  const hiddenTags = data.tags.filter((tag) => tag.is_hidden_from_budget)
  const excludeTag = hiddenTags.find((tag) => tag.id === excludeTagId)
  const payload: RulePayload = {
    name: name.trim(),
    enabled,
    priority,
    match_type: matchType,
    match_value: matchValue.trim(),
    transaction_type: appliesTo === "any" ? null : appliesTo,
    min_amount_cents: bounds.min,
    max_amount_cents: bounds.max,
    set_category_id: categoryId,
    add_tags: tags,
    budget_exclude_tag_id: excludeTagId,
  }
  const previewPayload = settledValue ? { ...payload, name: payload.name || settledValue, match_value: settledValue } : null
  const preview = useRulePreview(previewPayload, [JSON.stringify(previewPayload)])

  const create = useMutation({
    mutationFn: (body: RulePayload) => apiFetch("/api/rules", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rules"] })
      onClose()
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "Unable to create rule.")),
  })

  const submit = () => {
    setError(null)
    if (!payload.name) return setError("Enter a rule name.")
    if (!payload.match_value) return setError("Enter a match value.")
    create.mutate(payload)
  }

  const amount = amountCondition(bounds.min, bounds.max)
  const matches = preview.data?.matches_count ?? 0

  return (
    <EntryDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add rule"
      direction={
        <SegmentedControl
          label="Applies to"
          value={appliesTo}
          options={[
            { value: "any", label: "Any" },
            { value: "expense", label: "Expenses" },
            { value: "income", label: "Income" },
          ]}
          onChange={(next) => {
            setAppliesTo(next)
            if (next !== "any" && category && category.type !== next) setCategoryId(null)
          }}
        />
      }
      submitLabel="Add rule"
      onSubmit={submit}
      pending={create.isPending}
      error={error}
    >
      <EntryName autoFocus aria-label="Name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <EntryName
        aria-label="Title text"
        placeholder={`Title ${phrase(matchType)}…`}
        value={matchValue}
        onChange={(event) => setMatchValue(event.target.value)}
      />
      <EntryChips>
        <Menu
          label="Match"
          align="start"
          trigger={
            <Pill icon={TextAaIcon} aria-label={`Match ${phrase(matchType)}`}>
              {MATCH_TYPES.find((entry) => entry.value === matchType)?.label}
            </Pill>
          }
        >
          {MATCH_TYPES.map((entry) => (
            <MenuItem key={entry.value} checked={entry.value === matchType} onSelect={() => setMatchType(entry.value)}>
              {entry.label}
            </MenuItem>
          ))}
        </Menu>
        <AmountPopover
          min={bounds.min}
          max={bounds.max}
          onSave={(min, max) => setBounds({ min, max })}
          trigger={
            <Pill
              icon={CoinsIcon}
              set={amount !== null}
              onClear={amount !== null ? () => setBounds({ min: null, max: null }) : undefined}
              clearLabel="Clear amount condition"
              aria-label="Amount condition"
            >
              {amount ?? "Any amount"}
            </Pill>
          }
        />
        <RuleCategoryPicker
          categories={data.categories}
          appliesTo={appliesTo === "any" ? null : appliesTo}
          selectedId={categoryId}
          onSelect={setCategoryId}
          trigger={
            <Pill
              icon={category ? undefined : ShapesIcon}
              leading={category ? <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} /> : undefined}
              set={Boolean(category)}
              aria-label={`Set category ${category?.name ?? "none"}`}
            >
              {category?.name ?? "Keep category"}
            </Pill>
          }
        />
        <TagPicker
          label="Add tags"
          options={data.tags.filter((tag) => !tag.is_hidden_from_budget).map((tag) => tag.name)}
          selected={tags}
          onChange={setTags}
          trigger={
            <Pill icon={TagIcon} set={tags.length > 0} aria-label={tags.length ? `Add tags ${tags.join(", ")}` : "Add tags"}>
              {tags.length ? tags.join(", ") : "Tags"}
            </Pill>
          }
        />
        {hiddenTags.length ? (
          <BudgetsMenu
            tags={hiddenTags}
            selectedId={excludeTagId}
            onSelect={setExcludeTagId}
            trigger={
              <Pill icon={WalletIcon} set={Boolean(excludeTag)} aria-label={`Budgets ${excludeTag ? "excluded" : "included"}`}>
                {excludeTag ? `Excluded with ${excludeTag.name}` : "In budgets"}
              </Pill>
            }
          />
        ) : null}
        <PriorityPopover
          value={priority}
          onSave={setPriority}
          trigger={
            <Pill icon={ListNumbersIcon} set={priority !== 100} aria-label={`Priority ${priority}`}>
              Priority {priority}
            </Pill>
          }
        />
        <Pill icon={CheckIcon} set={enabled} aria-pressed={enabled} onClick={() => setEnabled(!enabled)}>
          Enabled
        </Pill>
      </EntryChips>
      <EntryPreview>
        {!previewPayload
          ? null
          : preview.isError
            ? getApiErrorMessage(preview.error, "Preview unavailable")
            : preview.data
              ? matches
                ? `Matches ${matches} recent ${matches === 1 ? "transaction" : "transactions"}`
                : "No recent matches"
              : null}
      </EntryPreview>
    </EntryDialog>
  )
}

function RulePeek({ rule: stored, data, onClose }: { rule: RuleRow; data: RulesResponse; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const {
    view: rule,
    errors,
    setError,
    save,
  } = useQueuedSave<RuleRow, RulePayload, RuleField>({
    url: `/api/rules/${stored.id}`,
    source: stored,
    toPayload: rulePayload,
    onSaved: () => void queryClient.invalidateQueries({ queryKey: ["rules"] }),
    draftFields: ["name"],
  })
  const payload = rulePayload(rule)
  const preview = useRulePreview(payload, [rule.id, JSON.stringify(payload)])
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/rules/${rule.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onClose()
      void queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
  })
  const category =
    rule.set_category_id === null ? null : (data.categories.find((entry) => entry.id === rule.set_category_id) ?? rule.set_category)
  const budgetTag =
    rule.budget_exclude_tag_id === null ? null : (data.tags.find((tag) => tag.id === rule.budget_exclude_tag_id) ?? rule.budget_exclude_tag)
  const hiddenTags = data.tags.filter((tag) => tag.is_hidden_from_budget)
  const amount = amountCondition(rule.min_amount_cents, rule.max_amount_cents)
  const matches = preview.data

  return (
    <Peek
      parent="Rules"
      title={rule.name}
      onClose={onClose}
      menu={
        <MenuItem
          icon={TrashIcon}
          danger
          onSelect={async () => {
            if (await confirmDialog({ title: `Delete rule "${rule.name}"?`, confirmLabel: "Delete", tone: "danger" })) {
              remove.mutate()
            }
          }}
        >
          Delete rule
        </MenuItem>
      }
    >
      <InlineText
        variant="title"
        label="Name"
        value={rule.name}
        error={errors.name}
        onCancel={() => setError("name", null)}
        onSave={(next) => {
          if (!next.trim()) {
            setError("name", "Enter a rule name.")
            return false
          }
          return save("name", { name: next.trim() })
        }}
      />
      {remove.isError ? <FieldError>{getApiErrorMessage(remove.error, "Unable to delete the rule.")}</FieldError> : null}
      <PropertyList>
        <Property label="Enabled" error={errors.enabled}>
          <Switch label="Enabled" checked={rule.enabled} onCheckedChange={(checked) => void save("enabled", { enabled: checked })} />
        </Property>
        <Property label="Priority" editable error={errors.priority}>
          <PriorityPopover
            value={rule.priority}
            onSave={(next) => void save("priority", { priority: next })}
            trigger={<PropertyButton>{rule.priority}</PropertyButton>}
          />
        </Property>
      </PropertyList>
      <PeekSection title="When">
        <PropertyList>
          <Property label="Type" editable error={errors.type}>
            <Menu
              label="Type"
              align="start"
              trigger={
                <PropertyButton empty={!rule.transaction_type}>
                  {rule.transaction_type === "income" ? "Income" : rule.transaction_type === "expense" ? "Expense" : "Any"}
                </PropertyButton>
              }
            >
              {([null, "expense", "income"] as const).map((next) => (
                <MenuItem
                  key={next ?? "any"}
                  checked={rule.transaction_type === next}
                  onSelect={() => {
                    if (rule.transaction_type === next) return
                    // A category of the other type could never apply.
                    const keepsCategory = !next || !category || category.type === next
                    void save("type", { transaction_type: next, ...(keepsCategory ? {} : { set_category_id: null }) })
                  }}
                >
                  {next === "income" ? "Income" : next === "expense" ? "Expense" : "Any"}
                </MenuItem>
              ))}
            </Menu>
          </Property>
          <Property label="Title" editable error={errors.title}>
            <TitlePopover
              matchType={rule.match_type}
              value={rule.match_value}
              onSave={(matchType, value) => void save("title", { match_type: matchType, match_value: value })}
              trigger={<PropertyButton>{titleCondition(rule.match_type, rule.match_value)}</PropertyButton>}
            />
          </Property>
          <Property label="Amount" editable error={errors.amount}>
            <AmountPopover
              min={rule.min_amount_cents}
              max={rule.max_amount_cents}
              onSave={(min, max) => void save("amount", { min_amount_cents: min, max_amount_cents: max })}
              trigger={<PropertyButton empty={amount === null}>{amount ? <span>{amount}</span> : "Any"}</PropertyButton>}
            />
          </Property>
        </PropertyList>
      </PeekSection>
      <PeekSection title="Then">
        <PropertyList>
          <Property label="Category" editable error={errors.category}>
            <RuleCategoryPicker
              categories={data.categories}
              appliesTo={rule.transaction_type}
              selectedId={rule.set_category_id}
              onSelect={(categoryId) => {
                if (categoryId !== rule.set_category_id || errors.category) void save("category", { set_category_id: categoryId })
              }}
              trigger={
                <PropertyButton empty={!category}>
                  {category ? (
                    <>
                      <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} />
                      {category.name}
                    </>
                  ) : (
                    "Keep category"
                  )}
                </PropertyButton>
              }
            />
          </Property>
          <Property label="Add tags" error={errors.tags}>
            {rule.add_tags.map((name) => (
              <TagChip key={name} onRemove={() => void save("tags", { add_tags: rule.add_tags.filter((entry) => entry !== name) })}>
                {name}
              </TagChip>
            ))}
            <TagPicker
              label="Add tags"
              trigger={<IconButton icon={PlusIcon} label="Add tag" size="small" />}
              options={data.tags.filter((tag) => !tag.is_hidden_from_budget).map((tag) => tag.name)}
              selected={rule.add_tags}
              onChange={(tags) => void save("tags", { add_tags: tags })}
            />
          </Property>
          {hiddenTags.length || budgetTag ? (
            <Property label="Budgets" editable error={errors.budgets}>
              <BudgetsMenu
                tags={hiddenTags}
                selectedId={rule.budget_exclude_tag_id}
                onSelect={(tagId) => {
                  if (tagId !== rule.budget_exclude_tag_id || errors.budgets) void save("budgets", { budget_exclude_tag_id: tagId })
                }}
                trigger={
                  <PropertyButton empty={!budgetTag}>
                    {budgetTag ? `Excluded with ${budgetTag.name}` : "Included"}
                  </PropertyButton>
                }
              />
            </Property>
          ) : (
            <Property label="Budgets" empty>
              Included
            </Property>
          )}
        </PropertyList>
      </PeekSection>
      <PeekSection title="Matches" action={matches ? `${matches.matches_count} recent` : undefined}>
        {preview.isError ? (
          <FieldError>{getApiErrorMessage(preview.error, "Unable to preview this rule.")}</FieldError>
        ) : matches?.sample.length ? (
          <List flat label="Matches">
            {matches.sample.map((match) => (
              <Row
                key={match.id}
                columns={MATCH_COLUMNS}
                label={match.title ?? "Untitled"}
                onOpen={() => navigate(`/transactions/${match.id}`)}
              >
                <Cell>{match.title ?? "Untitled"}</Cell>
                <Cell tone="muted">
                  {match.before_category === match.after_category ? null : (
                    <>
                      {match.before_category} <ArrowRightIcon size={12} role="img" aria-label="to" /> {match.after_category}
                    </>
                  )}
                </Cell>
                <AmountCell>
                  <Amount cents={match.amount_cents} kind={match.type === "income" ? "income" : "expense"} />
                </AmountCell>
              </Row>
            ))}
          </List>
        ) : (
          <EmptyState inline>{preview.isLoading ? "Loading…" : "No recent matches"}</EmptyState>
        )}
      </PeekSection>
    </Peek>
  )
}

function SuggestionRows({ suggestions, categories }: { suggestions: RuleSuggestion[]; categories: CategorySummary[] }) {
  const queryClient = useQueryClient()
  const accept = useMutation({
    mutationFn: (id: number) => apiFetch<{ id: number }>(`/api/ai/rules/suggestions/${id}/accept`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai", "rule-suggestions"] })
      void queryClient.invalidateQueries({ queryKey: ["rules"] })
    },
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to accept the suggestion.") }),
  })
  const reject = useMutation({
    mutationFn: (id: number) => apiFetch<{ id: number }>(`/api/ai/rules/suggestions/${id}/reject`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ai", "rule-suggestions"] }),
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to reject the suggestion.") }),
  })
  return (
    <>
      <DayBand label="Suggestions" end={suggestions.length} />
      {suggestions.map((suggestion) => {
        const category = categories.find(
          (entry) =>
            entry.name === suggestion.set_category_name &&
            (!suggestion.transaction_type || entry.type === suggestion.transaction_type)
        )
        return (
          <Row key={suggestion.id} {...SUGGESTION_COLUMNS} label={suggestion.name}>
            <IconGlyph icon={LightbulbIcon} />
            <Cell>Title {titleCondition(suggestion.match_type, suggestion.match_value)}</Cell>
            <Cell>
              {category ? <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} inline /> : null}
              {suggestion.set_category_name ?? <Cell tone="faint">Keep category</Cell>}
            </Cell>
            <Cell align="right" tone="faint" hide="mobile">
              {Math.round(suggestion.confidence * 100)} %
            </Cell>
            <RowActions>
              <IconButton
                icon={CheckIcon}
                label={`Accept ${suggestion.name}`}
                disabled={accept.isPending || reject.isPending}
                onClick={() => accept.mutate(suggestion.id)}
              />
              <IconButton
                icon={XIcon}
                label={`Reject ${suggestion.name}`}
                disabled={accept.isPending || reject.isPending}
                onClick={() => reject.mutate(suggestion.id)}
              />
            </RowActions>
          </Row>
        )
      })}
    </>
  )
}

// Rules set a category or tags on new and imported transactions, in priority order.
function RulesPage() {
  const ruleSuggestionsOn = useAuth().aiFeatures.includes("rule_mining")
  const isDesktop = useIsDesktop()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const peekId = Number(searchParams.get("peek")) || null

  const { data, isLoading, error } = useQuery({
    queryKey: ["rules"],
    queryFn: () => apiFetch<RulesResponse>("/api/rules"),
  })
  const suggestionsQuery = useQuery({
    queryKey: ["ai", "rule-suggestions"],
    queryFn: () => apiFetch<RuleSuggestion[]>("/api/ai/rules/suggestions"),
    enabled: ruleSuggestionsOn,
  })
  const mine = useMutation({
    mutationFn: () => apiFetch<RuleSuggestion[]>("/api/ai/rules/mine", { method: "POST" }),
    onSuccess: (found) => {
      if (!found.length) showToast({ message: "No rule suggestions found." })
      void queryClient.invalidateQueries({ queryKey: ["ai", "rule-suggestions"] })
    },
    onError: (failure) => showToast({ message: getApiErrorMessage(failure, "Unable to find rule suggestions.") }),
  })

  if (isLoading) return <PanelLoading title="Rules" label="Loading rules…" />
  if (error || !data) return <PanelError title="Rules" message="Unable to load rules." />

  const suggestions = ruleSuggestionsOn ? (suggestionsQuery.data ?? []) : []
  const peekRule = data.rules.find((rule) => rule.id === peekId)
  const closePeek = () => setSearchParams(buildSearchParams(searchParams, { peek: null }), { replace: true })
  const peek = peekRule ? <RulePeek key={peekRule.id} rule={peekRule} data={data} onClose={closePeek} /> : null

  const main =
    data.rules.length || suggestions.length ? (
      <List label="Rules">
        {suggestions.length ? <SuggestionRows suggestions={suggestions} categories={data.categories} /> : null}
        {suggestions.length ? <DayBand label="Rules" end={data.rules.length} /> : null}
        <ListHead {...RULE_COLUMNS}>
          <Cell align="right">#</Cell>
          <span>Name</span>
          <Cell hide="narrow">When</Cell>
          <span>Then</span>
          <span />
        </ListHead>
        {data.rules.map((rule) => {
          const tags = addedTags(rule)
          return (
            <Row
              key={rule.id}
              {...RULE_COLUMNS}
              label={rule.name}
              dim={!rule.enabled}
              selected={rule.id === peekId}
              onOpen={() => setSearchParams(buildSearchParams(searchParams, { peek: String(rule.id) }))}
            >
              <Cell align="right" tone="faint">
                {rule.priority}
              </Cell>
              <Cell strong>{rule.name}</Cell>
              <Cell tone="muted" hide="narrow">
                {whenText(rule)}
              </Cell>
              <Cell>
                {rule.set_category ? (
                  <>
                    <CategoryGlyph
                      categoryId={rule.set_category.id}
                      icon={rule.set_category.icon}
                      name={rule.set_category.name}
                      inline
                    />
                    {rule.set_category.name}
                  </>
                ) : (
                  <Cell tone="faint">Keep category</Cell>
                )}
                {tags.length ? <Cell tone="faint"> + {tags.join(", ")}</Cell> : null}
              </Cell>
              <Cell align="right" tone="faint">
                {rule.enabled ? null : "Off"}
              </Cell>
            </Row>
          )
        })}
      </List>
    ) : (
      <Sheet>
        <EmptyState
          inline
          action={
            <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>
              Add rule
            </Button>
          }
        >
          No rules yet.
        </EmptyState>
      </Sheet>
    )

  return (
    <Panel
      title="Rules"
      layout="fill"
      peekOpen={peek !== null}
      actions={
        <>
          <Button variant="primary" icon={PlusIcon} aria-label="Add rule" onClick={() => setAdding(true)}>
            {isDesktop ? "Add rule" : "Add"}
          </Button>
          {ruleSuggestionsOn ? (
            <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
              <MenuItem icon={LightbulbIcon} disabled={mine.isPending} onSelect={() => mine.mutate()}>
                {mine.isPending ? "Finding rule suggestions…" : "Find rule suggestions"}
              </MenuItem>
            </Menu>
          ) : null}
        </>
      }
    >
      <PeekLayout peek={peek} main={main} />
      {adding ? <AddRuleDialog data={data} onClose={() => setAdding(false)} /> : null}
    </Panel>
  )
}

export default RulesPage
