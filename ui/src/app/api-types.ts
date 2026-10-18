import type { AIFeature } from "./auth-context"

export type CategorySummary = {
  id: number
  name: string
  type: string
  icon: string | null
}

export type CategoryListItem = CategorySummary & {
  archived_at: string | null
  order?: number
  usage_count?: number
  // Sums for the requested period.
  expense_cents?: number
  income_cents?: number
}

export type CategoriesResponse = {
  categories: CategoryListItem[]
}

export type TemplateRow = {
  id: number
  name: string
  type: string
  category_id: number
  category: CategorySummary | null
  default_amount_cents: number | null
  title: string | null
  tags: string[]
  sort_order: number
}

export type TemplatesResponse = {
  templates: TemplateRow[]
}

export type TransactionTag = {
  id: number
  name: string
}

export type TagOption = {
  id: number
  name: string
  auto_attach_period: { start: string; end: string } | null
}

export type TagsResponse = { tags: TagOption[] }

export type TransactionListItem = {
  id: number
  date: string
  occurred_at: string
  type: string
  amount_cents: number
  net_amount_cents: number
  reimbursed_total_cents: number
  is_reimbursement: boolean
  category: CategorySummary | null
  title: string | null
  description: string | null
  latitude?: number | null
  longitude?: number | null
  tags: TransactionTag[]
  has_attachments?: boolean
}

export type TransactionsResponse = {
  items: TransactionListItem[]
  page: number
  limit: number
  has_more: boolean
  total: number
  period: { slug: string; start: string; end: string }
  filters: {
    type: string | null
    category_id: number | null
    tag_id: number | null
    included_tag_ids: number[]
    excluded_tag_ids: number[]
    query: string | null
  }
  categories: CategorySummary[]
  tags: TransactionTag[]
}

// `/api/transactions/summary`: the period's totals for the list filters. Expenses are net of reimbursements.
export type TransactionsSummary = {
  income_cents: number
  expense_cents: number
  net_cents: number
  count: number
}

export type TransactionRouteState = {
  returnTo?: string
  // The breadcrumb name of returnTo; Transactions when unset.
  returnLabel?: string
  hasOriginContext?: boolean
}

export type DurablePurchase = {
  expected_lifespan_days: number
  acquired_on: string
}

export type ReceiptAttachment = {
  id: number
  transaction_id: number
  original_filename: string
  mime_type: string
  size_bytes: number
  sha256_hex: string
  created_at: string
}

export type TransactionBankRow = {
  id: number
  account_label: string
  booking_date: string
}

export type TransactionDetail = {
  id: number
  date: string
  occurred_at: string | null
  type: string
  amount_cents: number
  net_amount_cents: number
  reimbursed_total_cents: number
  created_at: string
  category_id: number | null
  category: CategorySummary | null
  title: string
  description: string | null
  latitude: number | null
  longitude: number | null
  is_reimbursement: boolean
  tags: string[]
  durable_purchase: DurablePurchase | null
  attachments: ReceiptAttachment[]
  bank_row: TransactionBankRow | null
}

export type ReimbursementTransactionSummary = {
  id: number
  date: string
  title: string | null
  deleted_at: string | null
  category: { id: number; name: string; type: string } | null
}

export type ReimbursementAllocationOut = {
  allocation_id: number
  amount_cents: number
  expense_transaction: ReimbursementTransactionSummary
}

export type ReimbursementAllocationIn = {
  allocation_id: number
  amount_cents: number
  reimbursement_transaction: ReimbursementTransactionSummary
}

export type TransactionReimbursementsIncome = {
  mode: "income"
  is_reimbursement: boolean
  allocated_total_cents: number
  remaining_to_allocate_cents: number
  allocations_out: ReimbursementAllocationOut[]
}

export type TransactionReimbursementsExpense = {
  mode: "expense"
  reimbursed_total_cents: number
  net_cost_cents: number
  allocations_in: ReimbursementAllocationIn[]
}

export type TransactionReimbursements =
  | TransactionReimbursementsIncome
  | TransactionReimbursementsExpense

export type ReimbursementExpenseSearchResult = {
  expense: {
    id: number
    date: string
    amount_cents: number
    title: string | null
    category: { id: number; name: string; type: string } | null
  }
  reimbursed_total_cents: number
  remaining_unreimbursed_cents: number
  allocated_to_this_cents: number
  suggested_amount_cents: number
}

export type ReimbursementExpenseSearchResponse = {
  results: ReimbursementExpenseSearchResult[]
}

export type OpenReimbursement = {
  reimbursement: ReimbursementExpenseSearchResult["expense"]
  remaining_to_allocate_cents: number
  allocated_to_this_cents: number
  suggested_amount_cents: number
}

export type OpenReimbursementsResponse = {
  remaining_unreimbursed_cents: number
  results: OpenReimbursement[]
}

export type BankReconciliationTransaction = {
  id: number
  date: string
  type: "income" | "expense"
  amount_cents: number
  signed_amount_cents: number
  title: string | null
  description: string | null
  category: string | null
  category_id: number | null
  category_icon: string | null
  date_delta_days: number
}

export type BankStatementRowStatus =
  | "matched"
  | "suggested"
  | "ambiguous"
  | "missing"
  | "reviewed"

export type BankRowResolution = "matched" | "created" | "ignored"

export type BankStatementRow = {
  id: number
  account_label: string
  booking_date: string
  value_date: string | null
  amount_cents: number
  currency: string
  payee: string | null
  booking_text: string | null
  purpose: string | null
  raw_description: string
  reviewed_at: string | null
  resolution: BankRowResolution | null
  resolved_at: string | null
  ignore_reason: string | null
  status: BankStatementRowStatus
  candidate_count: number
  candidates: BankReconciliationTransaction[]
  suggested_transaction: BankReconciliationTransaction | null
}

export type BankRowsPage = {
  items: BankStatementRow[]
  total: number
  page: number
  limit: number
}

export type BankAccount = {
  label: string
  row_count: number
  last_import_at: string | null
}

export type BankStatementPreviewRow = {
  booking_date: string
  value_date: string | null
  amount_cents: number
  currency: string
  payee: string | null
  booking_text: string | null
  purpose: string | null
  raw_description: string
  duplicate: boolean
}

export type BankStatementPreviewResponse = {
  account_label: string
  rows: BankStatementPreviewRow[]
  errors: string[]
  new_count: number
  duplicate_count: number
}

export type AssistantItem =
  | { kind: "thinking"; id: string; text: string; seconds: number | null; state: "active" | "done" }
  | { kind: "note"; id: string; text: string; state: "active" | "done" }
  | {
      kind: "tool"
      id: string
      name: string
      label: string
      detail: string | null
      state: "running" | "done" | "failed" | "stopped"
    }
  | { kind: "text"; id: string; text: string; state: "streaming" | "done" }
  | {
      kind: "approval"
      id: string
      card: AssistantApprovalCard
      state: "pending" | "applied" | "dismissed" | "failed"
      // Why an approved change couldn't be applied.
      message: string | null
    }

export type AssistantApprovalRow = {
  title: string
  detail: string | null
  category: { id: number; name: string; icon: string | null } | null
  date: string | null
  amount_cents: number | null
  // Shown as "amount of of_cents", such as an allocation of an expense.
  of_cents: number | null
  income: boolean
}

export type AssistantApprovalCard = {
  title: string
  meta: string | null
  // The approve button, such as Add, and the state after it, such as Added.
  verb: string
  done: string
  // Every row the change affects.
  rows: AssistantApprovalRow[]
  total_cents: number | null
  total_of_cents: number | null
}

export type AssistantTurnStatus = "completed" | "stopped" | "failed"

export type AssistantStreamEvent =
  | { type: "start"; chat_id: string; title: string }
  | { type: "item"; item: AssistantItem }
  | { type: "delta"; id: string; text: string }
  | { type: "end"; status: AssistantTurnStatus; message?: string }

export type AssistantChatSummary = {
  id: string
  title: string
  updated_at: string
}

export type AssistantTurn = {
  id: number
  user_text: string
  items: AssistantItem[]
  status: AssistantTurnStatus
  // What a failed turn told the user; null for other turns and turns saved before 0.8.9.
  error: string | null
  created_at: string
}

export type AssistantChat = AssistantChatSummary & { turns: AssistantTurn[] }

export type AIUsagePeriod = "week" | "month" | "all"

export type AIUsageFigures = {
  runs: number
  failed_runs: number
  stopped_runs: number
  // Runs whose backend reported a cost; cost_usd sums only these.
  priced_runs: number
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens: number
  total_tokens: number
  cost_usd: string
}

// One model serving one feature, with a value per bucket.
export type AIUsageSlice = AIUsageFigures & {
  feature: AIFeature
  backend: string | null
  model: string
  bucket_tokens: number[]
  bucket_cost_usd: string[]
}

export type AIUsageChat = {
  id: string
  // own: the viewer's chat, with its title. private: another user's chat. deleted: the chat is gone.
  access: "own" | "private" | "deleted"
  title: string | null
  username: string | null
  started_at: string
  last_run_at: string
  turns: number
  priced_runs: number
  total_tokens: number
  cost_usd: string
}

export type AIUsage = {
  period: AIUsagePeriod
  started_at: string | null
  bucket: "day" | "week" | "month"
  buckets: string[]
  totals: AIUsageFigures & { chats: number; turns: number; p95_duration_ms: number | null }
  slices: AIUsageSlice[]
  chat_count: number
  chats: AIUsageChat[]
}

export type AIUsageRun = {
  created_at: string
  status: "running" | "completed" | "failed" | "stopped"
  backend: string | null
  model: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens: number
  total_tokens: number
  tool_calls: number
  duration_ms: number | null
  cost_usd: string | null
}

export type AIUsageChatDetail = AIUsageChat & {
  tool_calls: number
  // In the order the chat first used them.
  models: { backend: string | null; model: string }[]
  // The latest 100 turns, oldest first; turns counts them all.
  runs: AIUsageRun[]
}
