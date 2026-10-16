import { useState } from "react"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { useAuth } from "../app/auth"
import type { AIFeature } from "../app/auth-context"
import { Button } from "./ui/Button"
import { Status } from "./ui/EmptyState"
import { useIsDesktop } from "./ui/layout-state"
import { Cell, CellControls, List, ListHead, Row, type Columns } from "./ui/LedgerRow"
import { ErrorBody, LoadingBody } from "./ui/Panel"
import { SettingRow } from "./ui/SettingsShell"
import { Sheet } from "./ui/Sheet"
import { Switch } from "./ui/Switch"
import { FieldError, Select, TextField } from "./ui/TextField"

type BackendKind = "anthropic" | "openai" | "openrouter" | "openai-compatible"
type Thinking = "auto" | "off" | "low" | "medium" | "high"
type Choice = { enabled: boolean; backend: string; model: string; thinking: Thinking }
type Feature = Choice & { id: AIFeature; name: string }
type AISettings = { backends: Array<{ name: string; kind: BackendKind }>; features: Feature[] }
type Model = { id: string; name: string }

const settingsKey = ["admin", "ai-settings"]
const KIND_LABELS: Record<BackendKind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  "openai-compatible": "OpenAI-compatible",
}
const THINKING: Array<{ value: Thinking; label: string }> = [
  { value: "auto", label: "Model default" },
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]
const FEATURE_COLUMNS: Columns = {
  columns: "180px minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr) 52px",
  mobileColumns: "minmax(0, 1fr) minmax(0, 1fr)",
}
const errorText = (error: unknown) => getApiErrorMessage(error, "Unable to update AI settings.")
const choicesOf = (features: Feature[]): Record<string, Choice> =>
  Object.fromEntries(features.map(({ id, enabled, backend, model, thinking }) => [id, { enabled, backend, model, thinking }]))

// Server-wide switches for each AI feature. The host defines the backends in EXPENSES_AI_BACKENDS.
export default function AISettingsPanel() {
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => apiFetch<AISettings>("/api/admin/ai/settings") })
  if (settings.isPending) return <LoadingBody label="Loading AI settings…" />
  if (settings.error) return <ErrorBody message={errorText(settings.error)} />
  return <FeatureSettings settings={settings.data} />
}

function FeatureSettings({ settings }: { settings: AISettings }) {
  const queryClient = useQueryClient()
  const { refreshAuthState } = useAuth()
  const isDesktop = useIsDesktop()
  const [choices, setChoices] = useState(() => choicesOf(settings.features))
  // Stored settings replace the local choices when they change, without remounting the focused select.
  const [stored, setStored] = useState(settings.features)
  if (stored !== settings.features) {
    setStored(settings.features)
    setChoices(choicesOf(settings.features))
  }
  const [customModels, setCustomModels] = useState<Record<string, boolean>>({})
  const backendsInUse = [...new Set(Object.values(choices).map((choice) => choice.backend))].filter((name) =>
    settings.backends.some((backend) => backend.name === name)
  )
  const catalogQueries = useQueries({
    queries: settings.backends.map((backend) => ({
      queryKey: ["admin", "ai-models", backend.name],
      queryFn: () => apiFetch<{ models: Model[] }>(`/api/admin/ai/models?backend=${encodeURIComponent(backend.name)}`),
      enabled: backendsInUse.includes(backend.name),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  })
  const catalogs = Object.fromEntries(settings.backends.map((backend, index) => [backend.name, catalogQueries[index]]))
  // Every complete change saves at once. A failed save keeps the choices on screen next to the error.
  const save = useMutation({
    mutationFn: (features: Record<string, Choice>) =>
      apiFetch<AISettings>("/api/admin/ai/settings", { method: "PUT", body: JSON.stringify({ features }) }),
    onSuccess: (value) => {
      queryClient.setQueryData(settingsKey, value)
      void refreshAuthState()
    },
  })
  const change = (id: string, update: Partial<Choice>) => {
    const next = { ...choices, [id]: { ...choices[id], ...update } }
    setChoices(next)
    save.reset()
    // A feature that is on needs a model; wait for one before saving.
    if (!next[id].enabled || next[id].model.trim()) save.mutate(next)
  }

  return (
    <Sheet
      title="Features"
      meta={save.isPending ? "Saving…" : undefined}
      actions={
        backendsInUse.length ? (
          <Button variant="ghost" icon={ArrowClockwiseIcon} onClick={() => backendsInUse.forEach((name) => void catalogs[name].refetch())}>
            Refresh models
          </Button>
        ) : undefined
      }
      body="flush"
    >
      {settings.backends.length === 0 ? (
        <SettingRow
          label={
            <Status icon={WarningCircleIcon} wrap>
              No AI backends are configured. Set EXPENSES_AI_BACKENDS on the server to turn on AI features.
            </Status>
          }
        />
      ) : null}
      <List flat label="AI features">
        {/* On mobile each row wraps to two lines, so the controls' own names stand in for column labels. */}
        {isDesktop ? (
          <ListHead {...FEATURE_COLUMNS}>
            <span>Feature</span>
            <span>Backend</span>
            <span>Model</span>
            <span>Thinking</span>
            <span>On</span>
          </ListHead>
        ) : null}
        {settings.features.map((feature) => {
          const selected = choices[feature.id]
          const catalog = catalogs[selected.backend]
          const models = catalog?.data?.models ?? []
          const listed = models.some((model) => model.id === selected.model)
          // Typing a model ID covers backends that cannot list their models.
          const custom = customModels[feature.id] || catalog?.isError || (selected.model !== "" && !listed && catalog?.isSuccess)
          const disabled = save.isPending || settings.backends.length === 0
          const modelSelect = (
            <Select
              aria-label="Model"
              disabled={disabled || !catalog}
              value={custom ? "__custom__" : selected.model}
              onChange={(event) => {
                const isCustom = event.target.value === "__custom__"
                setCustomModels((previous) => ({ ...previous, [feature.id]: isCustom }))
                if (!isCustom) change(feature.id, { model: event.target.value })
              }}
            >
              <option value="">{catalog?.isFetching ? "Loading models…" : "Choose a model"}</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
              <option value="__custom__">Enter model ID…</option>
            </Select>
          )
          return (
            <Row key={feature.id} {...FEATURE_COLUMNS} label={feature.name} controls>
              <Cell strong>
                <span id={`ai-feature-${feature.id}`}>{feature.name}</span>
              </Cell>
              <Select
                aria-label="Backend"
                disabled={disabled}
                value={selected.backend}
                onChange={(event) => {
                  setCustomModels((previous) => ({ ...previous, [feature.id]: false }))
                  change(feature.id, { backend: event.target.value, model: "" })
                }}
              >
                <option value="">Choose a backend</option>
                {selected.backend && !catalog ? <option value={selected.backend}>{selected.backend} (not configured)</option> : null}
                {settings.backends.map((backend) => (
                  <option key={backend.name} value={backend.name}>
                    {`${backend.name} · ${KIND_LABELS[backend.kind]}`}
                  </option>
                ))}
              </Select>
              {custom ? (
                <CellControls>
                  {catalog?.isError ? null : modelSelect}
                  <TextField
                    aria-label="Model ID"
                    placeholder="Model ID"
                    disabled={disabled || !catalog}
                    value={selected.model}
                    maxLength={200}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => setChoices({ ...choices, [feature.id]: { ...selected, model: event.target.value } })}
                    onBlur={() => {
                      if (selected.model.trim() !== feature.model) change(feature.id, { model: selected.model.trim() })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") change(feature.id, { model: selected.model.trim() })
                    }}
                  />
                </CellControls>
              ) : (
                modelSelect
              )}
              <Select
                aria-label="Thinking"
                disabled={disabled}
                value={selected.thinking}
                onChange={(event) => change(feature.id, { thinking: event.target.value as Thinking })}
              >
                {THINKING.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </Select>
              <Switch
                labelledBy={`ai-feature-${feature.id}`}
                checked={selected.enabled}
                disabled={disabled || !catalog || !selected.model.trim()}
                onCheckedChange={(enabled) => change(feature.id, { enabled })}
              />
            </Row>
          )
        })}
      </List>
      {backendsInUse.map((name) =>
        catalogs[name].error ? (
          <SettingRow
            key={name}
            label={
              <FieldError>
                {name}: {getApiErrorMessage(catalogs[name].error, "Unable to list models.")} Enter a model ID instead.
              </FieldError>
            }
          />
        ) : null
      )}
      {save.error ? <SettingRow label={<FieldError>{errorText(save.error)}</FieldError>} /> : null}
    </Sheet>
  )
}
