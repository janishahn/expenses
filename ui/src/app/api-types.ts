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

export type DeletedTransaction = {
  id: number
  date: string
  type: string
  amount_cents: number
  category: { id: number; name: string; icon: string | null } | null
  title: string | null
  description: string | null
  deleted_at: string | null
}

export type TransactionRouteState = {
  returnTo?: string
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

export type TransactionDetail = {
  id: number
  date: string
  occurred_at: string | null
  type: string
  amount_cents: number
  category_id: number
  category: CategorySummary | null
  title: string
  description: string | null
  latitude: number | null
  longitude: number | null
  is_reimbursement: boolean
  tags: string[]
  durable_purchase: DurablePurchase | null
  attachments: ReceiptAttachment[]
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

export type BankReconciliationTransaction = {
  id: number
  date: string
  type: string
  amount_cents: number
  signed_amount_cents: number
  title: string | null
  category: string | null
  date_delta_days: number
}

export type BankStatementRowStatus =
  | "matched"
  | "suggested"
  | "ambiguous"
  | "missing"
  | "reviewed"

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
  status: BankStatementRowStatus
  candidate_count: number
  suggested_transaction: BankReconciliationTransaction | null
}

export type BankReconciliationSummary = {
  row_count: number
  unresolved_count: number
  suggested_count: number
  matched_count: number
  reviewed_count: number
  bank_total_cents: number
  only_in_expenses_count: number
}

export type BankReconciliationResponse = {
  summary: BankReconciliationSummary
  rows: BankStatementRow[]
  only_in_expenses: BankReconciliationTransaction[]
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

export type SpendingChatRole = "user" | "assistant"

export type SpendingChatMessageInput = {
  role: SpendingChatRole
  content: string
}

// Opaque Pydantic AI message dicts. Preserved across turns and sent back as
// context, but never inspected or displayed in the UI.
export type SpendingChatHistoryEntry = Record<string, unknown>

export type SpendingChatStreamRequest = {
  messages: SpendingChatMessageInput[]
  message_history?: SpendingChatHistoryEntry[]
}

export type AIUsageSummary = {
  feature: string
  period: "week" | "month" | "all"
  started_at: string | null
  total_chats: number
  completed_chats: number
  failed_chats: number
  cancelled_chats: number
  costed_chats: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_input_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_cost_decimal: string
  average_cost_decimal: string
  cost_unit: string | null
  average_total_tokens: number
  p95_duration_ms: number | null
}

export type SpendingChatTurnStartedEvent = {
  type: "turn_started"
  turn_id: string
}

export type SpendingChatToolCallStartEvent = {
  type: "tool_call_start"
  tool_call_id: string
  tool_name: string
  arguments: Record<string, unknown>
}

export type SpendingChatToolCallEndEvent = {
  type: "tool_call_end"
  tool_call_id: string
  tool_name: string
  // Display-only preview, not source data; the UI uses `success` and `result_summary`.
  result_preview: string
  result_summary: string | null
  success: boolean
}

export type SpendingChatTextChunkEvent = {
  type: "text_chunk"
  content: string
}

export type SpendingChatProgressNarrationEvent = {
  type: "progress_narration"
  content: string
}

export type SpendingChatTextCommitEvent = {
  type: "text_commit"
}

export type SpendingChatResultEvent = {
  type: "result"
  assistant_message: string
  message_history: SpendingChatHistoryEntry[]
}

export type SpendingChatDoneEvent = {
  type: "done"
}

export type SpendingChatErrorEvent = {
  type: "error"
  message: string
}

export type SpendingChatStreamEvent =
  | SpendingChatTurnStartedEvent
  | SpendingChatToolCallStartEvent
  | SpendingChatToolCallEndEvent
  | SpendingChatProgressNarrationEvent
  | SpendingChatTextChunkEvent
  | SpendingChatTextCommitEvent
  | SpendingChatResultEvent
  | SpendingChatDoneEvent
  | SpendingChatErrorEvent
