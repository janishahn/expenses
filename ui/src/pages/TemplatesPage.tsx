import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { LightningIcon } from "@phosphor-icons/react/Lightning"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ShapesIcon } from "@phosphor-icons/react/Shapes"
import { TagIcon } from "@phosphor-icons/react/Tag"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { useSearchParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { useQueuedSave } from "../app/queued-save"
import type { CategoriesResponse, CategorySummary, TagsResponse, TemplateRow, TemplatesResponse } from "../app/api-types"
import { amountInput, parseAmountCents } from "../app/transactions"
import { CategoryPicker } from "../components/CategoryPicker"
import { ValuePopover } from "../components/FormPopover"
import { confirmDialog } from "../components/confirm"
import { TagPicker } from "../components/TagPicker"
import { Amount } from "../components/ui/Amount"
import { Button, IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { EmptyState } from "../components/ui/EmptyState"
import { EntryAmount, EntryChips, EntryDialog, EntryName } from "../components/ui/EntryDialog"
import { useIsDesktop } from "../components/ui/layout-state"
import { AmountCell, Cell, type Columns } from "../components/ui/LedgerRow"
import { SortableList, SortableRow } from "../components/ui/Sortable"
import { Menu, MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading } from "../components/ui/Panel"
import { Peek, PeekLayout } from "../components/ui/Peek"
import { Pill } from "../components/ui/Pill"
import { InlineText, Property, PropertyButton, PropertyList } from "../components/ui/PropertyList"
import { SegmentedControl } from "../components/ui/SegmentedControl"
import { Sheet } from "../components/ui/Sheet"
import { TagChip, TagChips } from "../components/ui/TagChip"
import { FieldError } from "../components/ui/TextField"
import { buildSearchParams } from "../lib/searchParams"

type TemplateType = "expense" | "income"
type TemplateField = "name" | "type" | "category" | "amount" | "title" | "tags"
// The body of POST /api/templates and PUT /api/templates/{id}.
type TemplatePayload = {
  name: string
  type: string
  category_id: number
  default_amount_cents: number | null
  title: string | null
  tags: string[]
}

const TEMPLATE_COLUMNS: Columns = {
  columns: "16px 18px minmax(0, 140px) minmax(0, 1fr) minmax(0, 180px) 100px",
  narrowColumns: "16px 18px minmax(0, 1fr) 100px",
  mobileColumns: "16px 18px minmax(0, 1fr) auto",
}
const AMOUNT_ERROR = "Default amount must be a valid number."

function templatePayload(template: TemplateRow): TemplatePayload {
  return {
    name: template.name,
    type: template.type,
    category_id: template.category_id,
    default_amount_cents: template.default_amount_cents,
    title: template.title,
    tags: template.tags,
  }
}

// An empty amount keeps the template variable.
function parseDefaultAmount(raw: string): number | null | "invalid" {
  if (!raw.trim()) return null
  return parseAmountCents(raw) ?? "invalid"
}

function useTemplateData() {
  const categories = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => apiFetch<CategoriesResponse>("/api/categories?period=all"),
  })
  const tags = useQuery({
    queryKey: ["tags", "all"],
    queryFn: () => apiFetch<TagsResponse>("/api/tags?period=all"),
  })
  return {
    categories: (categories.data?.categories ?? []).filter((category) => !category.archived_at),
    tagOptions: (tags.data?.tags ?? []).map((tag) => tag.name),
  }
}

function invalidateTemplates(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["templates"] })
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
}

function AddTemplateDialog({
  categories,
  tagOptions,
  onClose,
}: {
  categories: CategorySummary[]
  tagOptions: string[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<TemplateType>("expense")
  const [amount, setAmount] = useState("")
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(
    () => categories.find((category) => category.type === "expense")?.id ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const options = categories.filter((category) => category.type === type)
  const category = options.find((entry) => entry.id === categoryId)

  const create = useMutation({
    mutationFn: (payload: TemplatePayload) =>
      apiFetch<TemplateRow>("/api/templates", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      invalidateTemplates(queryClient)
      onClose()
    },
    onError: (failure) => setError(getApiErrorMessage(failure, "Unable to create template.")),
  })

  const submit = () => {
    setError(null)
    if (!name.trim()) return setError("Name is required.")
    if (categoryId === null) return setError("Category is required.")
    const cents = parseDefaultAmount(amount)
    if (cents === "invalid") return setError(AMOUNT_ERROR)
    create.mutate({
      name: name.trim(),
      type,
      category_id: categoryId,
      default_amount_cents: cents,
      title: title.trim() || null,
      tags,
    })
  }

  return (
    <EntryDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Add template"
      direction={
        <SegmentedControl
          label="Type"
          value={type}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
          onChange={(next) => {
            setType(next)
            setCategoryId(categories.find((entry) => entry.type === next)?.id ?? null)
          }}
        />
      }
      submitLabel="Add template"
      onSubmit={submit}
      pending={create.isPending}
      error={error}
    >
      <EntryAmount
        aria-label="Default amount"
        income={type === "income"}
        placeholder="Variable amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <EntryName autoFocus aria-label="Name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <EntryName
        aria-label="Transaction title"
        placeholder="Transaction title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <EntryChips>
        <CategoryPicker
          categories={options}
          selectedId={categoryId}
          onSelect={setCategoryId}
          trigger={
            <Pill
              icon={category ? undefined : ShapesIcon}
              leading={category ? <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} /> : undefined}
              set={Boolean(category)}
              aria-label={`Category ${category?.name ?? "none"}`}
            >
              {category?.name ?? "Category"}
            </Pill>
          }
        />
        <TagPicker
          options={tagOptions}
          selected={tags}
          onChange={setTags}
          trigger={
            <Pill icon={TagIcon} set={tags.length > 0} aria-label={tags.length ? `Tags ${tags.join(", ")}` : undefined}>
              {tags.length ? tags.join(", ") : "Tags"}
            </Pill>
          }
        />
      </EntryChips>
    </EntryDialog>
  )
}

function TemplatePeek({
  template,
  categories,
  tagOptions,
  onClose,
}: {
  template: TemplateRow
  categories: CategorySummary[]
  tagOptions: string[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { errors, setError, save } = useQueuedSave<TemplateRow, TemplatePayload, TemplateField>({
    url: `/api/templates/${template.id}`,
    source: template,
    toPayload: templatePayload,
    onSaved: () => invalidateTemplates(queryClient),
  })
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/templates/${template.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onClose()
      invalidateTemplates(queryClient)
    },
  })
  const category = categories.find((entry) => entry.id === template.category_id) ?? template.category

  return (
    <Peek
      parent="Templates"
      title={template.name}
      onClose={onClose}
      menu={
        <MenuItem
          icon={TrashIcon}
          danger
          onSelect={async () => {
            if (await confirmDialog({ title: `Delete template "${template.name}"?`, confirmLabel: "Delete", tone: "danger" })) {
              remove.mutate()
            }
          }}
        >
          Delete template
        </MenuItem>
      }
    >
      <InlineText
        variant="title"
        label="Name"
        value={template.name}
        error={errors.name}
        onCancel={() => setError("name", null)}
        onSave={(next) => {
          if (!next.trim()) {
            setError("name", "Name is required.")
            return false
          }
          return save("name", { name: next.trim() })
        }}
      />
      {remove.isError ? <FieldError>{getApiErrorMessage(remove.error, "Unable to delete template.")}</FieldError> : null}
      <PropertyList>
        <Property label="Type" editable error={errors.type}>
          <Menu label="Type" align="start" trigger={<PropertyButton>{template.type === "income" ? "Income" : "Expense"}</PropertyButton>}>
            {(["expense", "income"] as const).map((next) => (
              <MenuItem
                key={next}
                checked={template.type === next}
                onSelect={() => {
                  if (template.type === next) return
                  const fallback = categories.find((entry) => entry.type === next)
                  if (!fallback) {
                    setError("type", `Add an ${next} category first.`)
                    return
                  }
                  void save("type", { type: next, category_id: fallback.id })
                }}
              >
                {next === "expense" ? "Expense" : "Income"}
              </MenuItem>
            ))}
          </Menu>
        </Property>
        <Property label="Category" editable error={errors.category}>
          <CategoryPicker
            categories={categories.filter((entry) => entry.type === template.type)}
            selectedId={template.category_id}
            onSelect={(categoryId) => {
              if (categoryId !== null && categoryId !== template.category_id) void save("category", { category_id: categoryId })
            }}
            trigger={
              <PropertyButton empty={!category}>
                {category ? (
                  <>
                    <CategoryGlyph categoryId={category.id} icon={category.icon} name={category.name} />
                    {category.name}
                  </>
                ) : (
                  "Unknown category"
                )}
              </PropertyButton>
            }
          />
        </Property>
        <Property label="Amount" editable error={errors.amount}>
          <ValuePopover
            label="Default amount"
            inputMode="decimal"
            value={template.default_amount_cents === null ? "" : amountInput(template.default_amount_cents)}
            onSave={(next) => {
              const cents = parseDefaultAmount(next)
              if (cents === "invalid") return AMOUNT_ERROR
              void save("amount", { default_amount_cents: cents })
              return null
            }}
            trigger={
              <PropertyButton empty={template.default_amount_cents === null}>
                {template.default_amount_cents === null ? (
                  "Variable"
                ) : (
                  <Amount cents={template.default_amount_cents} kind={template.type === "income" ? "income" : "expense"} />
                )}
              </PropertyButton>
            }
          />
        </Property>
        <Property label="Title" editable error={errors.title}>
          <ValuePopover
            label="Transaction title"
            value={template.title ?? ""}
            onSave={(next) => {
              void save("title", { title: next.trim() || null })
              return null
            }}
            trigger={<PropertyButton empty={!template.title}>{template.title ?? "None"}</PropertyButton>}
          />
        </Property>
        <Property label="Tags" error={errors.tags}>
          {template.tags.map((name) => (
            <TagChip key={name} onRemove={() => void save("tags", { tags: template.tags.filter((entry) => entry !== name) })}>
              {name}
            </TagChip>
          ))}
          <TagPicker
            trigger={<IconButton icon={PlusIcon} label="Add tag" size="small" />}
            options={tagOptions}
            selected={template.tags}
            onChange={(tags) => void save("tags", { tags })}
          />
        </Property>
      </PropertyList>
    </Peek>
  )
}

// Quick-add shortcuts for the add dialog, in the order they appear there.
function TemplatesPage() {
  const isDesktop = useIsDesktop()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const peekId = Number(searchParams.get("peek")) || null
  const { categories, tagOptions } = useTemplateData()

  const { data, isLoading, error } = useQuery({
    queryKey: ["templates"],
    queryFn: () => apiFetch<TemplatesResponse>("/api/templates"),
  })

  const reorder = useMutation({
    mutationFn: (templateIds: number[]) =>
      apiFetch<{ status: string }>("/api/templates/reorder", {
        method: "POST",
        body: JSON.stringify({ template_ids: templateIds }),
      }),
    onMutate: async (templateIds) => {
      await queryClient.cancelQueries({ queryKey: ["templates"] })
      const previous = queryClient.getQueryData<TemplatesResponse>(["templates"])
      queryClient.setQueryData<TemplatesResponse>(["templates"], (current) => {
        if (!current) return current
        const byId = new Map(current.templates.map((template) => [template.id, template]))
        return {
          ...current,
          templates: templateIds
            .map((templateId) => byId.get(templateId))
            .filter((template): template is TemplateRow => Boolean(template)),
        }
      })
      return { previous }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    },
    onError: (_error, _templateIds, context) => {
      if (context?.previous) queryClient.setQueryData(["templates"], context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["templates"] })
    },
  })

  if (isLoading) return <PanelLoading title="Templates" label="Loading templates…" />
  if (error || !data) return <PanelError title="Templates" message="Unable to load templates." />

  const templates = data.templates
  const peekTemplate = templates.find((template) => template.id === peekId)
  const closePeek = () => setSearchParams(buildSearchParams(searchParams, { peek: null }), { replace: true })
  const peek = peekTemplate ? (
    <TemplatePeek
      key={peekTemplate.id}
      template={peekTemplate}
      categories={categories}
      tagOptions={tagOptions}
      onClose={closePeek}
    />
  ) : null

  const main = templates.length ? (
    <SortableList ids={templates.map((template) => template.id)} onReorder={(ids) => reorder.mutate(ids)} label="Templates">
      {templates.map((template) => (
        <SortableRow
          key={template.id}
          id={template.id}
          {...TEMPLATE_COLUMNS}
          label={template.name}
          disabled={reorder.isPending}
          selected={template.id === peekId}
          onOpen={() => setSearchParams(buildSearchParams(searchParams, { peek: String(template.id) }))}
        >
          <CategoryGlyph categoryId={template.category?.id} icon={template.category?.icon} name={template.category?.name} />
          <Cell strong>{template.name}</Cell>
          <Cell tone="muted" hide="narrow">
            {template.title}
          </Cell>
          <Cell hide="narrow">
            <TagChips names={template.tags} max={2} />
          </Cell>
          {template.default_amount_cents === null ? (
            <Cell align="right" tone="faint">
              Variable
            </Cell>
          ) : (
            <AmountCell>
              <Amount cents={template.default_amount_cents} kind={template.type === "income" ? "income" : "expense"} />
            </AmountCell>
          )}
        </SortableRow>
      ))}
    </SortableList>
  ) : (
    <Sheet>
      <EmptyState
        icon={LightningIcon}
        inline
        action={
          <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>
            Add template
          </Button>
        }
      >
        No templates yet.
      </EmptyState>
    </Sheet>
  )

  return (
    <Panel
      title="Templates"
      layout="fill"
      peekOpen={peek !== null}
      actions={
        <Button variant="primary" icon={PlusIcon} aria-label="Add template" onClick={() => setAdding(true)}>
          {isDesktop ? "Add template" : "Add"}
        </Button>
      }
    >
      {reorder.isError ? <FieldError>{getApiErrorMessage(reorder.error, "Unable to reorder templates.")}</FieldError> : null}
      <PeekLayout peek={peek} main={main} />
      {adding ? <AddTemplateDialog categories={categories} tagOptions={tagOptions} onClose={() => setAdding(false)} /> : null}
    </Panel>
  )
}

export default TemplatesPage
