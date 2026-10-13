import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { TrashIcon } from "@phosphor-icons/react/Trash"
import { useNavigate, useParams } from "react-router-dom"
import { apiFetch, getApiErrorMessage, isApiErrorStatus } from "../app/api"
import { confirmDialog } from "../components/confirm"
import { Amount } from "../components/ui/Amount"
import { IconButton } from "../components/ui/Button"
import { CategoryGlyph } from "../components/ui/CategoryGlyph"
import { EmptyState } from "../components/ui/EmptyState"
import { AmountCell, Cell, List, Row } from "../components/ui/LedgerRow"
import { Menu, MenuItem } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading } from "../components/ui/Panel"
import { MetricStrip, Sheet } from "../components/ui/Sheet"
import { FieldError } from "../components/ui/TextField"
import { fullDate, repeatsText, ruleLabel, type OccurrencesResponse } from "./recurring-rule"

const PARENTS = [{ label: "Recurring", to: "/recurring" }]
const OCCURRENCE_COLUMNS = {
  columns: "110px 18px minmax(0, 1fr) auto",
  mobileColumns: "96px 18px minmax(0, 1fr) auto",
}

// Every transaction a recurring rule has posted, newest first.
function RecurringOccurrencesPage() {
  const { ruleId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ["recurring", Number(ruleId), "occurrences"],
    queryFn: () => apiFetch<OccurrencesResponse>(`/api/recurring/${ruleId}/occurrences`),
    enabled: Boolean(ruleId),
  })
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/recurring/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recurring"] })
      navigate("/recurring", { replace: true })
    },
  })

  if (!ruleId || isApiErrorStatus(error, 404)) {
    return (
      <PanelError
        title="Recurring rule"
        parents={PARENTS}
        message="Rule not found."
        returnTo={{ label: "Back to recurring", to: "/recurring" }}
      />
    )
  }
  if (isLoading) return <PanelLoading title="Recurring rule" parents={PARENTS} label="Loading occurrences…" />
  if (error || !data) return <PanelError title="Recurring rule" parents={PARENTS} message="Unable to load occurrences." />

  const { rule, occurrences } = data
  const label = ruleLabel(rule)
  const total = occurrences.reduce((sum, occurrence) => sum + occurrence.amount_cents, 0)

  return (
    <Panel
      title={label}
      parents={PARENTS}
      actions={
        <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
          <MenuItem
            icon={TrashIcon}
            danger
            onSelect={async () => {
              if (await confirmDialog({ title: `Delete recurring rule "${label}"?`, confirmLabel: "Delete", tone: "danger" })) {
                remove.mutate()
              }
            }}
          >
            Delete rule
          </MenuItem>
        </Menu>
      }
    >
      {remove.isError ? <FieldError>{getApiErrorMessage(remove.error, "Unable to delete the rule.")}</FieldError> : null}
      <MetricStrip
        metrics={[
          {
            label: "Amount",
            value: <Amount cents={rule.amount_cents} kind={rule.type} currency={rule.currency_code} />,
            detail: repeatsText(rule.interval_unit, rule.interval_count).toLowerCase(),
          },
          { label: "Next", value: fullDate(rule.next_occurrence), detail: `since ${fullDate(rule.anchor_date)}` },
          {
            label: "Posting",
            value: rule.auto_post ? "Automatic" : "Manual",
            detail: rule.end_date ? `until ${fullDate(rule.end_date)}` : "no end date",
          },
          {
            label: "Posted",
            value: String(occurrences.length),
            detail: occurrences.length ? (
              <>
                <Amount cents={total} kind={rule.type} /> in total
              </>
            ) : (
              "nothing yet"
            ),
          },
        ]}
      />
      {occurrences.length ? (
        <List scroll={false} label="Posted transactions">
          {occurrences.map((occurrence) => {
            const category = occurrence.category ?? rule.category
            return (
              <Row
                key={occurrence.id}
                {...OCCURRENCE_COLUMNS}
                label={`${occurrence.title ?? label}, ${occurrence.occurrence_date ? fullDate(occurrence.occurrence_date) : "no date"}`}
                onOpen={() => navigate(`/transactions/${occurrence.id}`)}
              >
                <Cell tone="muted">{occurrence.occurrence_date ? fullDate(occurrence.occurrence_date) : "–"}</Cell>
                <CategoryGlyph
                  categoryId={category?.id}
                  icon={category?.id === rule.category?.id ? rule.category?.icon : null}
                  name={category?.name}
                />
                <Cell>{occurrence.title ?? label}</Cell>
                <AmountCell>
                  <Amount cents={occurrence.amount_cents} kind={rule.type} />
                </AmountCell>
              </Row>
            )
          })}
        </List>
      ) : (
        <Sheet>
          <EmptyState inline>No occurrences posted yet.</EmptyState>
        </Sheet>
      )}
    </Panel>
  )
}

export default RecurringOccurrencesPage
