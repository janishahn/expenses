import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../app/api"
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
  error instanceof Error ? error.message : "Unable to update AI settings."

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
    <FinancialPanel className="space-y-5 p-5" data-testid="ai-settings">
      <div>
        <h2 className="font-head text-xl font-bold">AI settings</h2>
        <p className="mt-1 text-sm text-muted">
          Choose a provider, model, and thinking level for each feature.
        </p>
      </div>
      {settings.isPending && <p role="status">Loading AI settings…</p>}
      {settings.error && (
        <div role="alert">
          <p>{errorText(settings.error)}</p>
          <AppButton onClick={() => void settings.refetch()}>Retry</AppButton>
        </div>
      )}
      {settings.data && (
        <>
          {!settings.data.enabled && (
            <p>
              AI features are disabled on this server. Enable EXPENSES_LLM_ENABLED to configure
              them.
            </p>
          )}
          <div className="space-y-3 border-b border-border pb-5">
            <h3 className="font-semibold">ChatGPT connection</h3>
            <p className="text-sm text-muted">
              Eligible requests use your ChatGPT Plus or Pro allowance. The financial details
              needed for each request are sent to OpenAI. Your connection is stored securely on
              your Expenses server and belongs only to your Expenses account.
            </p>
            {connected && (
              <p role="status">
                Connected{connection?.email ? ` as ${connection.email}` : ""}
                {!connection?.plan_authorized ? "; plan access has not been granted" : ""}.
              </p>
            )}
            {connection?.status === "reauth_required" && (
              <p role="status">Your ChatGPT connection needs to be renewed.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
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
                className="text-sm text-accent underline"
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                Manage usage
              </a>
            </div>
            {pairing && (
              <div
                className="space-y-2 rounded-lg bg-surface-hi p-4"
                data-testid="chatgpt-pairing"
              >
                <p className="font-semibold">Finish connecting on your computer</p>
                <p className="text-sm">
                  From an Expenses checkout on the computer running your browser, run:
                </p>
                <code className="block break-all text-sm">
                  uv run connect-chatgpt --server {window.location.origin}
                </code>
                <p className="text-sm">
                  Enter this pairing code when prompted, then approve access in ChatGPT. The
                  code expires in 10 minutes.
                </p>
                <code className="block break-all" aria-label="ChatGPT pairing code">
                  {pairing.pairing_code}
                </code>
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
              <p role="alert">{errorText(connect.error || disconnect.error)}</p>
            )}
            {message && <p role="status">{message}</p>}
          </div>
          <FeatureSettings
            key={JSON.stringify(settings.data.features)}
            settings={settings.data}
            onSaved={() => setMessage("AI settings saved.")}
          />
        </>
      )}
    </FinancialPanel>
  )
}

function FeatureSettings({
  settings,
  onSaved,
}: {
  settings: AISettings
  onSaved: () => void
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
    onSuccess: (value) => {
      onSaved()
      queryClient.setQueryData(settingsKey, value)
    },
  })
  const change = (id: string, update: Partial<Choice>) => {
    setChoices((previous) => ({ ...previous, [id]: { ...previous[id], ...update } }))
  }
  return (
    <div className="space-y-5">
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
            className="space-y-2"
            disabled={!settings.enabled || save.isPending}
          >
            <legend className="mb-2 font-semibold">{feature.name}</legend>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <AppFieldLabel htmlFor={`${feature.id}-provider`}>Provider</AppFieldLabel>
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
                  <option value="configured">Local / API provider</option>
                  <option value="chatgpt">ChatGPT plan</option>
                </AppNativeSelect>
              </div>
              <div>
                <AppFieldLabel htmlFor={`${feature.id}-model`}>Model</AppFieldLabel>
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
                {customModel && (
                  <div className="mt-2">
                    <AppFieldLabel htmlFor={`${feature.id}-custom-model`}>Model ID</AppFieldLabel>
                    <AppInput
                      id={`${feature.id}-custom-model`}
                      value={selected.model}
                      maxLength={200}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(e) => change(feature.id, { model: e.target.value })}
                    />
                  </div>
                )}
              </div>
              <div>
                <AppFieldLabel htmlFor={`${feature.id}-thinking`}>
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
            {catalog.isFetching && (
              <p className="text-sm text-muted" role="status">
                Loading available models…
              </p>
            )}
            {selected.provider === "chatgpt" &&
              (settings.connection.status !== "connected" ||
                !settings.connection.plan_authorized) && (
                <p className="text-sm text-muted">
                  Connect ChatGPT and allow plan usage to load models.
                </p>
              )}
            {catalog.error && (
              <p className="text-sm" role="alert">
                {errorText(catalog.error)}{" "}
                {selected.provider === "configured" && "The server default remains available."}
              </p>
            )}
          </fieldset>
        )
      })}
      <p className="text-sm text-muted">
        Lower thinking levels can use less allowance. Model support varies; “Model default”
        uses the provider or feature default.
      </p>
      {Object.values(choices).some((choice) => choice.provider === "chatgpt") && (
        <p className="text-sm text-muted">
          Custom model IDs are checked on save with a short request that uses ChatGPT allowance.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
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
      </div>
      {save.error && <p role="alert">{errorText(save.error)}</p>}
    </div>
  )
}
