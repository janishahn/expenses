import type { components } from "./api-schema"

// Response types come from the API's OpenAPI schema; `npm run gen:api` regenerates it
// from the contract that `uv run export-openapi` writes. Hand-written types below
// cover what the schema does not describe.
type Schemas = components["schemas"]

export type CategorySummary = Schemas["CategorySummaryOut"]
export type CategoryListItem = Schemas["CategoryListItemOut"]
// `/api/categories/options` and `/api/tags/options`, which the schema leaves out: every
// category or tag without the period totals and usage counts of the list endpoints.
export type CategoriesResponse = {
  categories: Pick<CategoryListItem, "id" | "name" | "type" | "icon" | "order" | "archived_at">[]
}

export type TemplatesResponse = Schemas["TemplatesResponseOut"]
export type TemplateRow = TemplatesResponse["templates"][number]

export type TransactionTag = Schemas["TransactionTagOut"]
export type TagOption = Omit<Schemas["TagOut"], "expense_cents" | "income_cents" | "usage_count">
export type TagsResponse = { tags: TagOption[] }

export type TransactionListItem = Schemas["TransactionListItemOut"]
export type TransactionsResponse = Schemas["TransactionsResponseOut"]

// `/api/transactions/summary`, which the schema leaves out: the period's totals for the
// list filters. Expenses are net of reimbursements.
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

export type DurablePurchase = Schemas["DurablePurchaseOut"]
// One line of a read receipt, in euro cents. Discounts and deposit returns are negative.
export type ReceiptItem = Schemas["ReceiptItemOut"]
// items_status null: never read, because the file is a PDF or reading was off at upload.
// "read" with an error: reading again failed and the earlier items were kept.
export type ReceiptAttachment = Schemas["ReceiptAttachmentOut"]
export type TransactionBankRow = Schemas["TransactionBankRowOut"]
export type TransactionDetail = Schemas["TransactionDetailOut"]

export type ReimbursementTransactionSummary = Schemas["ReimbursementTransactionSummaryOut"]
export type ReimbursementAllocationOut = Schemas["ReimbursementAllocationOut"]
export type ReimbursementAllocationIn = Schemas["ReimbursementAllocationInOut"]

// The schema has one shape with optional fields; the client tells the two apart by mode.
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

export type ReimbursementExpenseSearchResponse = Schemas["ReimbursementExpenseSearchResponseOut"]
export type ReimbursementExpenseSearchResult = ReimbursementExpenseSearchResponse["results"][number]
export type OpenReimbursementsResponse = Schemas["OpenReimbursementsResponseOut"]
export type OpenReimbursement = OpenReimbursementsResponse["results"][number]

export type BankReconciliationTransaction = Schemas["BankReconciliationTransactionOut"]
export type BankStatementRow = Schemas["BankStatementRowOut"]
export type BankStatementRowStatus = BankStatementRow["status"]
export type BankRowResolution = NonNullable<BankStatementRow["resolution"]>
export type BankRowsPage = Schemas["BankRowsPageOut"]
export type BankAccount = Schemas["BankAccountOut"]
export type BankStatementPreviewRow = Schemas["BankStatementPreviewRowOut"]
export type BankStatementPreviewResponse = Schemas["BankStatementPreviewResponseOut"]

export type AssistantChatSummary = Schemas["AssistantChatSummaryOut"]
export type AssistantTurn = Schemas["AssistantTurnOut"]
export type AssistantChat = Schemas["AssistantChatOut"]
export type AssistantTurnStatus = AssistantTurn["status"]
export type AssistantItem = AssistantTurn["items"][number]
// The approve button, such as Add, is verb, and done is the state after it, such as Added.
export type AssistantApprovalCard = Extract<AssistantItem, { kind: "approval" }>["card"]
// Shown as "amount of of_cents", such as an allocation of an expense.
export type AssistantApprovalRow = AssistantApprovalCard["rows"][number]

// The chat stream's events, which the schema does not describe.
export type AssistantStreamEvent =
  | { type: "start"; chat_id: string; title: string }
  | { type: "item"; item: AssistantItem }
  | { type: "delta"; id: string; text: string }
  | { type: "end"; status: AssistantTurnStatus; message?: string }

export type AIUsage = Schemas["AIUsageOut"]
export type AIUsagePeriod = AIUsage["period"]
// Runs whose backend reported a cost are priced_runs; cost_usd sums only these.
export type AIUsageFigures = Omit<AIUsage["totals"], "chats" | "turns" | "p95_duration_ms">
// One model serving one feature, with a value per bucket.
export type AIUsageSlice = Schemas["AIUsageSlice"]
// access own: the viewer's chat, with its title. private: another user's chat. deleted: the chat is gone.
export type AIUsageChat = Schemas["AIUsageChat"]
export type AIUsageRun = Schemas["AIUsageRun"]
// models are in the order the chat first used them; runs are the latest 100 turns, oldest first.
export type AIUsageChatDetail = Schemas["AIUsageChatDetailOut"]
