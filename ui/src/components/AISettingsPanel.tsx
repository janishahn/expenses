import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getApiErrorMessage } from "../app/api"
import { AppButton } from "./ui/product-button"
import { AppFieldLabel, AppInput, AppNativeSelect } from "./ui/product-fields"
import { FinancialPanel } from "./product/ProductSurfaces"
import { confirmDialog } from "./confirm"

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
const errorText = (error: unknown) =>
  getApiErrorMessage(error, "Unable to update AI settings.")
const providerLabels: Record<AIProvider, string> = {
  configured: "Local / API provider",
  chatgpt: "ChatGPT plan",
}
// Wide panels align section labels and feature controls in shared columns.
const sectionColumns = "@min-[60rem]:grid-cols-[10rem_minmax(0,1fr)]"
const featureColumns =
  "@min-[60rem]:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1fr)]"
const fieldLabel = "@min-[60rem]:sr-only"

export function ChatGPTUsageIndicator() {
  const { data } = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiFetch<AISettings>("/api/ai/settings"),
    staleTime: 30_000,
  })
  if (data?.features.find((f) => f.id === "spending_chat")?.provider !== "chatgpt") return null
  return (
    <p className="text-sm text-muted">
      Using ChatGPT plan ·{" "}
      <a
        className="text-accent underline"
        href={data.connection.usage_url}
        target="_blank"
        rel="noreferrer"
      >
        Manage usage
      </a>
    </p>
  )
}

export default function AISettingsPanel() {
  const queryClient = useQueryClient()
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [message, setMessage] = useState("")
  const [saved, setSaved] = useState(false)
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiFetch<AISettings>("/api/ai/settings"),
    refetchInterval: () =>
      pairing && Date.now() < Date.parse(pairing.expires_at) ? 2000 : false,
  })
  const connection = settings.data?.connection
  const connected = connection?.status === "connected"
  const connect = useMutation({
    mutationFn: () => apiFetch<Pairing>("/api/ai/chatgpt/pairing", { method: "POST" }),
    onSuccess: (value) => {
      setPairing(value)
      setMessage("")
    },
  })
  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>("/api/ai/chatgpt/connection", { method: "DELETE" }),
    onSuccess: (value) => {
      setPairing(null)
      setMessage(value.message)
      queryClient.removeQueries({ queryKey: ["ai-models", "chatgpt"] })
      void queryClient.invalidateQueries({ queryKey: settingsKey })
    },
  })
  return (
    <FinancialPanel className="@container p-5" data-testid="ai-settings">
      <h2 className="font-head text-xl font-bold">AI settings</h2>
      {settings.isPending && (
        <p role="status" className="mt-3 text-sm text-muted">
          Loading AI settings…
        </p>
      )}
      {settings.error && (
        <div role="alert" className="mt-3 space-y-3">
          <p className="text-sm">{errorText(settings.error)}</p>
          <AppButton onClick={() => void settings.refetch()}>Retry</AppButton>
        </div>
      )}
      {settings.data && (
        <>
          {!settings.data.enabled && (
            <p className="mt-3 rounded-md bg-signal-yellow-soft/70 p-3 text-sm">
              AI features are disabled on this server. Enable EXPENSES_LLM_ENABLED to configure
              them.
            </p>
          )}
          <div className={`mt-4 grid gap-3 border-t border-border pt-4 ${sectionColumns}`}>
            <h3 className="font-semibold">ChatGPT connection</h3>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-col gap-3 @min-[60rem]:flex-row @min-[60rem]:items-center @min-[60rem]:justify-between">
                <div className="min-w-0 max-w-prose space-y-1">
                  {connected && (
                    <p role="status" className="text-sm font-medium">
                      Connected{connection?.email ? ` as ${connection.email}` : ""}
                      {!connection?.plan_authorized ? "; plan access has not been granted" : ""}.
                    </p>
                  )}
                  {connection?.status === "reauth_required" && (
                    <p role="status" className="text-sm font-medium">
                      Your ChatGPT connection needs to be renewed.
                    </p>
                  )}
                  <p className="text-sm text-muted">
                    Features set to ChatGPT plan use your ChatGPT Plus or Pro allowance and send
                    the financial details each request needs to OpenAI. The connection is stored on
                    this server for your account only.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <AppButton
                    disabled={!settings.data.enabled || connect.isPending}
                    onClick={() => connect.mutate()}
                  >
                    {connected ? "Reconnect ChatGPT" : "Continue with ChatGPT"}
                  </AppButton>
                  {connection?.status !== "disconnected" && (
                    <AppButton
                      tone="ghost"
                      disabled={disconnect.isPending}
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            title: "Disconnect ChatGPT?",
                            description:
                              "Expenses will stop using this connection. Features assigned to ChatGPT will need another provider or a new connection.",
                            confirmLabel: "Disconnect",
                            tone: "danger",
                          })
                        )
                          disconnect.mutate()
                      }}
                    >
                      Disconnect
                    </AppButton>
                  )}
                  <a
                    className="inline-flex min-h-11 items-center text-sm text-accent underline"
                    href="https://chatgpt.com/settings/usage"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Manage usage
                  </a>
                </div>
              </div>
              {pairing && (
                <div
                  className="max-w-2xl space-y-3 rounded-lg bg-surface-hi p-4"
                  data-testid="chatgpt-pairing"
                >
                  <p className="font-semibold">Finish connecting on your computer</p>
                  <ol className="list-decimal space-y-3 pl-5 text-sm">
                    <li className="space-y-1.5">
                      <p>From an Expenses checkout on the computer running your browser, run:</p>
                      <code className="block rounded-md bg-faint px-3 py-2 wrap-anywhere">
                        uv run connect-chatgpt --server {window.location.origin}
                      </code>
                    </li>
                    <li className="space-y-1.5">
                      <p>
                        Enter this pairing code when prompted, then approve access in ChatGPT.
                        The code expires in 10 minutes.
                      </p>
                      <code
                        className="block text-lg font-semibold tracking-wider wrap-anywhere"
                        aria-label="ChatGPT pairing code"
                      >
                        {pairing.pairing_code}
                      </code>
                    </li>
                  </ol>
                  <AppButton
                    tone="ghost"
                    onClick={() => {
                      setPairing(null)
                      void settings.refetch()
                      void queryClient.invalidateQueries({ queryKey: ["ai-models"] })
                    }}
                  >
                    I’ve finished connecting
                  </AppButton>
                </div>
              )}
              {(connect.error || disconnect.error) && (
                <p role="alert" className="text-sm text-semantic-red">
                  {errorText(connect.error || disconnect.error)}
                </p>
              )}
              {message && (
                <p role="status" className="text-sm">
                  {message}
                </p>
              )}
            </div>
          </div>
          <FeatureSettings
            key={JSON.stringify(settings.data.features)}
            settings={settings.data}
            saved={saved}
            onSavedChange={setSaved}
          />
        </>
      )}
    </FinancialPanel>
  )
}

function FeatureSettings({
  settings,
  saved,
  onSavedChange,
}: {
  settings: AISettings
  saved: boolean
  onSavedChange: (saved: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      settings.features.map((feature) => [
        feature.id,
        {
          provider: feature.provider,
          model: feature.model,
          reasoning_effort: feature.reasoning_effort,
        },
      ])
    )
  )
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
    enabled:
      settings.enabled &&
      settings.connection.status === "connected" &&
      settings.connection.plan_authorized,
    retry: false,
    staleTime: 60_000,
  })
  const catalogs = { configured, chatgpt }
  const save = useMutation({
    mutationFn: () =>
      apiFetch<AISettings>("/api/ai/settings", {
        method: "PUT",
        body: JSON.stringify({ features: choices }),
      }),
    onMutate: () => onSavedChange(false),
    onSuccess: (value) => {
      onSavedChange(true)
      queryClient.setQueryData(settingsKey, value)
    },
  })
  const change = (id: string, update: Partial<Choice>) => {
    onSavedChange(false)
    setChoices((previous) => ({ ...previous, [id]: { ...previous[id], ...update } }))
  }
  const providersInUse = [...new Set(Object.values(choices).map((choice) => choice.provider))]
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div
        aria-hidden="true"
        className={`hidden gap-x-3 pb-1.5 text-xs font-semibold text-muted @min-[60rem]:grid ${featureColumns}`}
      >
        <span />
        <span>Provider</span>
        <span>Model</span>
        <span>Thinking level</span>
      </div>
      <div className="grid gap-6 @min-[60rem]:gap-3">
        {settings.features.map((feature) => {
          const selected = choices[feature.id]
          const catalog = catalogs[selected.provider]
          const models = catalog.data?.models ?? []
          const selectedModel = models.find((m) => m.id === selected.model)
          const customModel = selected.provider === "chatgpt" && (
            customModels[feature.id] || (selected.model !== "" && !selectedModel && catalog.isSuccess)
          )
          const availableEfforts = selectedModel?.reasoning_efforts.length
            ? ["auto", ...selectedModel.reasoning_efforts]
            : efforts
          return (
            <fieldset
              key={feature.id}
              aria-labelledby={`${feature.id}-name`}
              className="min-w-0"
              disabled={!settings.enabled || save.isPending}
            >
              <div
                className={`grid items-start gap-3 @2xl:grid-cols-3 @min-[60rem]:items-center ${featureColumns}`}
              >
                <p
                  id={`${feature.id}-name`}
                  className="font-semibold @2xl:col-span-3 @min-[60rem]:col-span-1"
                >
                  {feature.name}
                </p>
                <div className="grid min-w-0 gap-1.5">
                  <AppFieldLabel htmlFor={`${feature.id}-provider`} className={fieldLabel}>
                    Provider
                  </AppFieldLabel>
                  <AppNativeSelect
                    id={`${feature.id}-provider`}
                    value={selected.provider}
                    onChange={(e) => {
                      const provider = e.target.value as AIProvider
                      setCustomModels((previous) => ({ ...previous, [feature.id]: false }))
                      const models = catalogs[provider].data?.models ?? []
                      const preferred =
                        feature.id === "spending_chat" ? "gpt-6.1-sol" : "gpt-6-luna"
                      const model =
                        provider === "chatgpt"
                          ? (models.find((m) => m.id === preferred)?.id ?? models[0]?.id ?? "")
                          : ""
                      change(feature.id, {
                        provider,
                        model,
                        reasoning_effort:
                          provider === "chatgpt"
                            ? feature.id === "spending_chat"
                              ? "medium"
                              : "low"
                            : "auto",
                      })
                    }}
                  >
                    <option value="configured">{providerLabels.configured}</option>
                    <option value="chatgpt">{providerLabels.chatgpt}</option>
                  </AppNativeSelect>
                </div>
                <div
                  className={`grid min-w-0 gap-3 ${customModel ? "@min-[60rem]:grid-cols-2 @min-[60rem]:gap-2" : ""}`}
                >
                  <div className="grid min-w-0 gap-1.5">
                    <AppFieldLabel htmlFor={`${feature.id}-model`} className={fieldLabel}>
                      Model
                    </AppFieldLabel>
                    <AppNativeSelect
                      id={`${feature.id}-model`}
                      value={customModel ? "__custom__" : selected.model}
                      onChange={(e) => {
                        const custom = e.target.value === "__custom__"
                        setCustomModels((previous) => ({ ...previous, [feature.id]: custom }))
                        change(feature.id, { model: custom ? "" : e.target.value, reasoning_effort: "auto" })
                      }}
                    >
                      <option value="">
                        {selected.provider === "configured"
                          ? `Server default (${settings.configured_model})`
                          : "Choose a model"}
                      </option>
                      {selected.model && !selectedModel && !customModel && (
                        <option value={selected.model}>
                          {selected.model} (not in current list)
                        </option>
                      )}
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                      {selected.provider === "chatgpt" && <option value="__custom__">Enter model ID…</option>}
                    </AppNativeSelect>
                  </div>
                  {customModel && (
                    <div className="grid min-w-0 gap-1.5">
                      <AppFieldLabel
                        htmlFor={`${feature.id}-custom-model`}
                        className={fieldLabel}
                      >
                        Model ID
                      </AppFieldLabel>
                      <AppInput
                        id={`${feature.id}-custom-model`}
                        value={selected.model}
                        placeholder="Model ID"
                        maxLength={200}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(e) => change(feature.id, { model: e.target.value })}
                      />
                    </div>
                  )}
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <AppFieldLabel htmlFor={`${feature.id}-thinking`} className={fieldLabel}>
                    Thinking level
                  </AppFieldLabel>
                  <AppNativeSelect
                    id={`${feature.id}-thinking`}
                    value={selected.reasoning_effort}
                    onChange={(e) => change(feature.id, { reasoning_effort: e.target.value })}
                  >
                    {!availableEfforts.includes(selected.reasoning_effort) && (
                      <option value={selected.reasoning_effort}>
                        {effortLabel(selected.reasoning_effort)} (unavailable)
                      </option>
                    )}
                    {availableEfforts.map((level) => (
                      <option key={level} value={level}>
                        {effortLabel(level)}
                      </option>
                    ))}
                  </AppNativeSelect>
                </div>
              </div>
            </fieldset>
          )
        })}
      </div>
      <div className={`mt-5 grid gap-3 ${sectionColumns}`}>
        <div className="min-w-0 space-y-3 @min-[60rem]:col-start-2">
          {providersInUse.some((provider) => catalogs[provider].isFetching) && (
            <p className="text-sm text-muted" role="status">
              Loading available models…
            </p>
          )}
          {providersInUse.includes("chatgpt") &&
            (settings.connection.status !== "connected" ||
              !settings.connection.plan_authorized) && (
              <p className="text-sm text-muted">
                Connect ChatGPT and allow plan usage to load models.
              </p>
            )}
          {providersInUse.map(
            (provider) =>
              catalogs[provider].error && (
                <p key={provider} className="text-sm text-semantic-red" role="alert">
                  {providerLabels[provider]}: {errorText(catalogs[provider].error)}
                  {provider === "configured" && " The server default remains available."}
                </p>
              )
          )}
          <p className="max-w-3xl text-sm text-muted">
            Lower thinking levels can use less allowance. “Model default” uses the provider or
            feature default.
            {providersInUse.includes("chatgpt") &&
              " Custom model IDs are checked on save with a short request that uses ChatGPT allowance."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <AppButton
              disabled={!settings.enabled || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Checking and saving…" : "Save AI settings"}
            </AppButton>
            <AppButton
              tone="ghost"
              disabled={!settings.enabled}
              onClick={() => {
                if (settings.configured_available) void configured.refetch()
                if (settings.connection.status === "connected") void chatgpt.refetch()
              }}
            >
              Refresh models
            </AppButton>
            {saved && (
              <p role="status" className="px-1 text-sm font-semibold text-semantic-green">
                AI settings saved.
              </p>
            )}
          </div>
          {save.error && (
            <p role="alert" className="text-sm text-semantic-red">
              {errorText(save.error)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
