import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise"
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight"
import { CopyIcon } from "@phosphor-icons/react/Copy"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { copyText } from "../app/clipboard"
import { confirmDialog } from "./confirm"
import { Button, IconButton, LinkButton } from "./ui/Button"
import { Status } from "./ui/EmptyState"
import { useIsDesktop } from "./ui/layout-state"
import { Cell, CellControls, List, ListHead, Row, type Columns } from "./ui/LedgerRow"
import { ErrorBody, LoadingBody } from "./ui/Panel"
import { SettingRow } from "./ui/SettingsShell"
import { Sheet } from "./ui/Sheet"
import { FieldError, Select, TextField } from "./ui/TextField"
import { showToast } from "./ui/toast-store"

export type AIProvider = "configured" | "chatgpt"
type Model = { id: string; name: string; reasoning_efforts: string[] }
type Choice = { provider: AIProvider; model: string; reasoning_effort: string }
type Feature = Choice & { id: string; name: string }
export type AISettings = {
  enabled: boolean
  configured_available: boolean
  configured_model: string
  connection: {
    status: string
    email: string | null
    plan_authorized: boolean
    usage_url: string
  }
  features: Feature[]
}
type Pairing = { pairing_code: string; expires_at: string }
const settingsKey = ["ai-settings"]
const efforts = ["auto", "none", "minimal", "low", "medium", "high", "xhigh"]
const effortLabel = (value: string) =>
  ({
    auto: "Model default",
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
  })[value] ?? value
const errorText = (error: unknown) => getApiErrorMessage(error, "Unable to update AI settings.")
const providerLabels: Record<AIProvider, string> = {
  configured: "Local / API",
  chatgpt: "ChatGPT plan",
}
const FEATURE_COLUMNS: Columns = {
  columns: "150px minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)",
  mobileColumns: "minmax(0, 1fr) minmax(0, 1fr)",
}

// Opens the ChatGPT usage page when the Assistant runs on a ChatGPT plan.
export function ChatGPTPlanLink() {
  const { data } = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiFetch<AISettings>("/api/ai/settings"),
    staleTime: 30_000,
  })
  if (data?.features.find((f) => f.id === "spending_chat")?.provider !== "chatgpt") return null
  return (
    <LinkButton variant="ghost" to={data.connection.usage_url} target="_blank" rel="noreferrer">
      ChatGPT plan
      <ArrowUpRightIcon aria-hidden="true" />
    </LinkButton>
  )
}

export default function AISettingsPanel() {
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => apiFetch<AISettings>("/api/ai/settings") })
  if (settings.isPending) return <LoadingBody label="Loading AI settings…" />
  if (settings.error) return <ErrorBody message={errorText(settings.error)} />
  return (
    <>
      {!settings.data.enabled ? (
        <Sheet body="flush">
          <SettingRow
            label={
              <Status icon={WarningCircleIcon} wrap>
                AI features are off on this server. Set EXPENSES_LLM_ENABLED to turn them on.
              </Status>
            }
          />
        </Sheet>
      ) : null}
      <ConnectionCard settings={settings.data} />
      <FeatureSettings settings={settings.data} />
    </>
  )
}

function ConnectionCard({ settings }: { settings: AISettings }) {
  const queryClient = useQueryClient()
  const [pairing, setPairing] = useState<Pairing | null>(null)
  // Polls while a pairing code is valid, so the connection shows up once the helper finishes.
  useQuery({
    queryKey: settingsKey,
    queryFn: () => apiFetch<AISettings>("/api/ai/settings"),
    refetchInterval: () => (pairing && Date.now() < Date.parse(pairing.expires_at) ? 2000 : false),
  })
  const connection = settings.connection
  const connect = useMutation({
    mutationFn: () => apiFetch<Pairing>("/api/ai/chatgpt/pairing", { method: "POST" }),
    onSuccess: (value) => setPairing(value),
  })
  const disconnect = useMutation({
    mutationFn: () => apiFetch<{ message: string }>("/api/ai/chatgpt/connection", { method: "DELETE" }),
    onSuccess: (value) => {
      setPairing(null)
      showToast({ message: value.message })
      queryClient.removeQueries({ queryKey: ["ai-models", "chatgpt"] })
      void queryClient.invalidateQueries({ queryKey: settingsKey })
    },
  })
  const command = `uv run connect-chatgpt --server ${window.location.origin}`
  const label =
    connection.status === "connected"
      ? `Connected${connection.email ? ` as ${connection.email}` : ""}`
      : connection.status === "reauth_required"
        ? "The connection needs to be renewed"
        : "Not connected"
  const error = connect.error ?? disconnect.error

  return (
    <Sheet title="ChatGPT" body="flush">
      <SettingRow
        label={<span role="status">{label}</span>}
        detail={connection.status === "connected" && !connection.plan_authorized ? "plan access not granted" : undefined}
      >
        {connection.status === "connected" ? (
          <LinkButton variant="ghost" to={connection.usage_url} target="_blank" rel="noreferrer">
            Usage
            <ArrowUpRightIcon aria-hidden="true" />
          </LinkButton>
        ) : null}
        <Button variant="quiet" disabled={!settings.enabled || connect.isPending} onClick={() => connect.mutate()}>
          {connection.status === "disconnected" ? "Continue with ChatGPT" : "Reconnect"}
        </Button>
        {connection.status !== "disconnected" ? (
          <Button
            variant="danger"
            disabled={disconnect.isPending}
            onClick={async () => {
              const confirmed = await confirmDialog({
                title: "Disconnect ChatGPT?",
                description: "Features set to ChatGPT plan stop working until they use another provider.",
                confirmLabel: "Disconnect",
                tone: "danger",
              })
              if (confirmed) disconnect.mutate()
            }}
          >
            Disconnect
          </Button>
        ) : null}
      </SettingRow>
      {pairing ? (
        <>
          <SettingRow label="On the computer running this browser, run this from an Expenses checkout" stack>
            <TextField readOnly value={command} aria-label="Connection command" onFocus={(event) => event.target.select()} />
            <IconButton
              icon={CopyIcon}
              label="Copy command"
              onClick={() => {
                copyText(command)
                showToast({ message: "Command copied." })
              }}
            />
          </SettingRow>
          <SettingRow label="Enter this code when asked, then approve access in ChatGPT" detail="expires in 10 minutes">
            <TextField short readOnly value={pairing.pairing_code} aria-label="ChatGPT pairing code" />
          </SettingRow>
          <SettingRow label="">
            <Button
              variant="quiet"
              onClick={() => {
                setPairing(null)
                void queryClient.invalidateQueries({ queryKey: settingsKey })
                void queryClient.invalidateQueries({ queryKey: ["ai-models"] })
              }}
            >
              I’ve finished connecting
            </Button>
          </SettingRow>
        </>
      ) : null}
      {error ? <SettingRow label={<FieldError>{errorText(error)}</FieldError>} /> : null}
    </Sheet>
  )
}

const choicesOf = (features: Feature[]): Record<string, Choice> =>
  Object.fromEntries(
    features.map((feature) => [feature.id, { provider: feature.provider, model: feature.model, reasoning_effort: feature.reasoning_effort }])
  )

function FeatureSettings({ settings }: { settings: AISettings }) {
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  const [choices, setChoices] = useState(() => choicesOf(settings.features))
  // Stored settings replace the local choices when they change, without remounting the focused select.
  const [stored, setStored] = useState(settings.features)
  if (stored !== settings.features) {
    setStored(settings.features)
    setChoices(choicesOf(settings.features))
  }
  const [customModels, setCustomModels] = useState<Record<string, boolean>>({})
  const configured = useQuery({
    queryKey: ["ai-models", "configured"],
    queryFn: () => apiFetch<{ models: Model[] }>("/api/ai/models?provider=configured"),
    enabled: settings.enabled && settings.configured_available,
    retry: false,
    staleTime: 60_000,
  })
  const chatgpt = useQuery({
    queryKey: ["ai-models", "chatgpt"],
    queryFn: () => apiFetch<{ models: Model[] }>("/api/ai/models?provider=chatgpt"),
    enabled: settings.enabled && settings.connection.status === "connected" && settings.connection.plan_authorized,
    retry: false,
    staleTime: 60_000,
  })
  const catalogs = { configured, chatgpt }
  // Every change saves at once. A failed save keeps the choices on screen next to the error.
  const save = useMutation({
    mutationFn: (features: Record<string, Choice>) =>
      apiFetch<AISettings>("/api/ai/settings", { method: "PUT", body: JSON.stringify({ features }) }),
    onSuccess: (value) => queryClient.setQueryData(settingsKey, value),
  })
  const change = (id: string, update: Partial<Choice>, persist = true) => {
    const next = { ...choices, [id]: { ...choices[id], ...update } }
    setChoices(next)
    save.reset()
    if (persist) save.mutate(next)
  }
  const providersInUse = [...new Set(Object.values(choices).map((choice) => choice.provider))]
  const hasCustomModel = settings.features.some((feature) => customModels[feature.id])
  const disabled = !settings.enabled || save.isPending

  return (
    <Sheet
      title="Features"
      meta={save.isPending ? "Saving…" : undefined}
      actions={
        <Button
          variant="ghost"
          icon={ArrowClockwiseIcon}
          disabled={!settings.enabled}
          onClick={() => {
            if (settings.configured_available) void configured.refetch()
            if (settings.connection.status === "connected") void chatgpt.refetch()
          }}
        >
          Refresh models
        </Button>
      }
      body="flush"
    >
      <List flat label="AI features">
        {/* On mobile each row wraps to two lines, so the selects' own names stand in for column labels. */}
        {isDesktop ? (
          <ListHead {...FEATURE_COLUMNS}>
            <span>Feature</span>
            <span>Provider</span>
            <span>Model</span>
            <span>Thinking</span>
          </ListHead>
        ) : null}
        {settings.features.map((feature) => {
          const selected = choices[feature.id]
          const catalog = catalogs[selected.provider]
          const models = catalog.data?.models ?? []
          const selectedModel = models.find((m) => m.id === selected.model)
          const customModel =
            selected.provider === "chatgpt" &&
            (customModels[feature.id] || (selected.model !== "" && !selectedModel && catalog.isSuccess))
          const availableEfforts = selectedModel?.reasoning_efforts.length ? ["auto", ...selectedModel.reasoning_efforts] : efforts
          const modelSelect = (
            <Select
              aria-label="Model"
              disabled={disabled}
              value={customModel ? "__custom__" : selected.model}
              onChange={(event) => {
                const custom = event.target.value === "__custom__"
                setCustomModels((previous) => ({ ...previous, [feature.id]: custom }))
                change(feature.id, { model: custom ? "" : event.target.value, reasoning_effort: "auto" }, !custom)
              }}
            >
              <option value="">
                {selected.provider === "configured" ? `Server default (${settings.configured_model})` : "Choose a model"}
              </option>
              {selected.model && !selectedModel && !customModel ? (
                <option value={selected.model}>{selected.model} (not in current list)</option>
              ) : null}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
              {selected.provider === "chatgpt" ? <option value="__custom__">Enter model ID…</option> : null}
            </Select>
          )
          return (
            <Row key={feature.id} {...FEATURE_COLUMNS} label={feature.name} controls>
              <Cell strong>{feature.name}</Cell>
              <Select
                aria-label="Provider"
                disabled={disabled}
                value={selected.provider}
                onChange={(event) => {
                  const provider = event.target.value as AIProvider
                  setCustomModels((previous) => ({ ...previous, [feature.id]: false }))
                  const providerModels = catalogs[provider].data?.models ?? []
                  const preferred = feature.id === "spending_chat" ? "gpt-6.1-sol" : "gpt-6-luna"
                  const model =
                    provider === "chatgpt" ? (providerModels.find((m) => m.id === preferred)?.id ?? providerModels[0]?.id ?? "") : ""
                  change(feature.id, {
                    provider,
                    model,
                    reasoning_effort: provider === "chatgpt" ? (feature.id === "spending_chat" ? "medium" : "low") : "auto",
                  })
                }}
              >
                <option value="configured">{providerLabels.configured}</option>
                <option value="chatgpt">{providerLabels.chatgpt}</option>
              </Select>
              {customModel ? (
                <CellControls>
                  {modelSelect}
                  <TextField
                    aria-label="Model ID"
                    placeholder="Model ID"
                    disabled={disabled}
                    value={selected.model}
                    maxLength={200}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => change(feature.id, { model: event.target.value }, false)}
                    onBlur={() => {
                      if (selected.model.trim() && selected.model !== feature.model) save.mutate(choices)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && selected.model.trim()) save.mutate(choices)
                    }}
                  />
                </CellControls>
              ) : (
                modelSelect
              )}
              <Select
                aria-label="Thinking level"
                disabled={disabled}
                value={selected.reasoning_effort}
                onChange={(event) => change(feature.id, { reasoning_effort: event.target.value }, !customModel || selected.model.trim() !== "")}
              >
                {!availableEfforts.includes(selected.reasoning_effort) ? (
                  <option value={selected.reasoning_effort}>{effortLabel(selected.reasoning_effort)} (unavailable)</option>
                ) : null}
                {availableEfforts.map((level) => (
                  <option key={level} value={level}>
                    {effortLabel(level)}
                  </option>
                ))}
              </Select>
            </Row>
          )
        })}
      </List>
      {providersInUse.some((provider) => catalogs[provider].isFetching) ? (
        <SettingRow label={<span role="status">Loading models…</span>} />
      ) : null}
      {providersInUse.includes("chatgpt") &&
      (settings.connection.status !== "connected" || !settings.connection.plan_authorized) ? (
        <SettingRow label={<Status>Connect ChatGPT and allow plan access to load its models.</Status>} />
      ) : null}
      {providersInUse.map((provider) =>
        catalogs[provider].error ? (
          <SettingRow
            key={provider}
            label={
              <FieldError>
                {providerLabels[provider]}: {errorText(catalogs[provider].error)}
                {provider === "configured" ? " The server default stays available." : ""}
              </FieldError>
            }
          />
        ) : null
      )}
      {hasCustomModel ? (
        <SettingRow label={<Status>Saving a model ID sends a short test request to ChatGPT.</Status>} />
      ) : null}
      {save.error ? <SettingRow label={<FieldError>{errorText(save.error)}</FieldError>} /> : null}
    </Sheet>
  )
}
