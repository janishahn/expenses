export type FlowNode = {
  id: string
  label: string
  type: string
  amount_cents: number
  category_id?: number | null
}

export type FlowLink = {
  from: string
  to: string
  amount_cents: number
}

const FIXED_KEYWORDS = [
  "rent",
  "housing",
  "mortgage",
  "insurance",
  "utilities",
  "electric",
  "electricity",
  "gas",
  "water",
  "internet",
  "wifi",
  "phone",
  "mobile",
  "subscription",
  "subscriptions",
  "membership",
  "gym",
  "school",
  "tuition",
  "childcare",
  "kindergarten",
  "health insurance",
  "car insurance",
  "loan",
  "debt",
  "tax",
  "taxes",
]

const VARIABLE_KEYWORDS = [
  "grocery",
  "groceries",
  "supermarket",
  "food",
  "dining",
  "restaurant",
  "transport",
  "transit",
  "fuel",
  "gasoline",
  "petrol",
  "pharmacy",
  "medical",
  "doctor",
  "household",
  "supplies",
  "pet",
  "child",
  "baby",
  "maintenance",
  "repair",
  "auto",
  "car",
  "parking",
  "toll",
]

const DISCRETIONARY_KEYWORDS = [
  "entertainment",
  "shopping",
  "hobby",
  "travel",
  "vacation",
  "holiday",
  "gift",
  "gifts",
  "electronics",
  "games",
  "gaming",
  "leisure",
  "fashion",
  "beauty",
  "coffee",
  "caf",
  "bar",
  "streaming",
  "cinema",
  "music",
  "books",
  "sport",
  "toys",
]

function groupForExpenseLabel(label: string): "fixed" | "variable" | "discretionary" {
  const normalized = label.toLowerCase()
  if (FIXED_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "fixed"
  }
  if (VARIABLE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "variable"
  }
  if (DISCRETIONARY_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "discretionary"
  }
  return "discretionary"
}

function groupLabel(group: string): string {
  if (group === "fixed") return "Fixed"
  if (group === "variable") return "Variable"
  return "Discretionary"
}

export function buildGroupedFlow(nodes: FlowNode[], links: FlowLink[]): {
  nodes: FlowNode[]
  links: FlowLink[]
} {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const groupedLinks = new Map<string, number>()
  const groupTotals = new Map<string, number>()

  function addLink(from: string, to: string, amount: number) {
    const key = `${from}->${to}`
    groupedLinks.set(key, (groupedLinks.get(key) || 0) + amount)
  }

  for (const link of links) {
    const target = nodeById.get(link.to)
    if (!target || target.type !== "expense") {
      addLink(link.from, link.to, link.amount_cents)
      continue
    }
    const group = groupForExpenseLabel(target.label)
    const groupNodeId = `group:${group}`
    addLink(link.from, groupNodeId, link.amount_cents)
    addLink(groupNodeId, link.to, link.amount_cents)
    groupTotals.set(groupNodeId, (groupTotals.get(groupNodeId) || 0) + link.amount_cents)
  }

  const baseNodes = nodes.filter((node) => !node.id.startsWith("group:"))
  const groupNodes: FlowNode[] = Array.from(groupTotals.entries()).map(
    ([id, amount]) => ({
      id,
      label: groupLabel(id.split(":", 2)[1] || "discretionary"),
      type: "group",
      amount_cents: amount,
      category_id: null,
    })
  )

  const outputLinks: FlowLink[] = []
  for (const [key, amount] of groupedLinks.entries()) {
    const [from, to] = key.split("->")
    outputLinks.push({ from, to, amount_cents: amount })
  }

  return {
    nodes: [...baseNodes, ...groupNodes],
    links: outputLinks,
  }
}

export const FLOW_GROUPING_HEURISTICS = {
  fixed: FIXED_KEYWORDS,
  variable: VARIABLE_KEYWORDS,
  discretionary: DISCRETIONARY_KEYWORDS,
}
