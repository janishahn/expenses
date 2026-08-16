export const balanceHistory = [
  { month: "Mar", actual: 3240, likely: null, range: null },
  { month: "Apr", actual: 3560, likely: null, range: null },
  { month: "May", actual: 3180, likely: null, range: null },
  { month: "Jun", actual: 3890, likely: null, range: null },
  { month: "Jul", actual: 4120, likely: 4120, range: [4120, 4120] },
  { month: "Aug", actual: null, likely: 4460, range: [3980, 4910] },
  { month: "Sep", actual: null, likely: 4710, range: [3820, 5380] },
  { month: "Oct", actual: null, likely: 5020, range: [3710, 5870] },
]

export const monthlySpending = [
  { month: "Feb", Housing: 1180, Food: 460, Transport: 170, Leisure: 210, Other: 120 },
  { month: "Mar", Housing: 1180, Food: 520, Transport: 140, Leisure: 245, Other: 175 },
  { month: "Apr", Housing: 1180, Food: 435, Transport: 195, Leisure: 190, Other: 90 },
  { month: "May", Housing: 1180, Food: 495, Transport: 160, Leisure: 310, Other: 130 },
  { month: "Jun", Housing: 1180, Food: 410, Transport: 220, Leisure: 165, Other: 105 },
  { month: "Jul", Housing: 1180, Food: 480, Transport: 185, Leisure: 230, Other: 155 },
]

export const expenseMix = [
  { name: "Housing", value: 1180 },
  { name: "Food", value: 480 },
  { name: "Leisure", value: 230 },
  { name: "Transport", value: 185 },
  { name: "Other", value: 155 },
]

export const incomeMix = [
  { name: "Salary", value: 3250 },
  { name: "Freelance", value: 540 },
  { name: "Refunds", value: 110 },
]

export const monthlyIncomeExpense = [
  { month: "Feb", income: 3440, expenses: 2160 },
  { month: "Mar", income: 3610, expenses: 2280 },
  { month: "Apr", income: 3490, expenses: 2050 },
  { month: "May", income: 3820, expenses: 2340 },
  { month: "Jun", income: 3560, expenses: 2110 },
  { month: "Jul", income: 3900, expenses: 2230 },
]

export const categoryTrend = [
  { month: "Feb", amount: 405 },
  { month: "Mar", amount: 470 },
  { month: "Apr", amount: 390 },
  { month: "May", amount: 515 },
  { month: "Jun", amount: 445 },
  { month: "Jul", amount: 480 },
]

export const flowSteps = [
  { name: "Starting balance", amount: 4120, range: [0, 4120], tone: "neutral" },
  { name: "Salary", amount: 3250, range: [4120, 7370], tone: "income" },
  { name: "Other income", amount: 650, range: [7370, 8020], tone: "income" },
  { name: "Housing", amount: -1180, range: [6840, 8020], tone: "expense" },
  { name: "Food", amount: -480, range: [6360, 6840], tone: "expense" },
  { name: "Leisure", amount: -230, range: [6130, 6360], tone: "expense" },
  { name: "Other spending", amount: -340, range: [5790, 6130], tone: "expense" },
  { name: "End balance", amount: 5790, range: [0, 5790], tone: "result" },
]

export const forecast = [
  { month: "Jul", recurring: 4120, likely: 4120, range: [4120, 4120] },
  { month: "Aug", recurring: 4680, likely: 4460, range: [3980, 4910] },
  { month: "Sep", recurring: 5210, likely: 4710, range: [3820, 5380] },
  { month: "Oct", recurring: 5760, likely: 5020, range: [3710, 5870] },
  { month: "Nov", recurring: 6310, likely: 5330, range: [3580, 6380] },
  { month: "Dec", recurring: 6860, likely: 5610, range: [3440, 6890] },
]

export const scenario = forecast.map((row, index) => ({
  month: row.month,
  baseline: row.likely,
  scenario: row.likely + index * 145,
  difference: [row.likely, row.likely + index * 145],
}))

export const burndown = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1
  const ideal = Math.round((2400 * day) / 31)
  const actual = day <= 16 ? Math.round(ideal * (0.8 + Math.sin(day / 3) * 0.09)) : null
  const previous = Math.round((2520 * day) / 31)
  return { day, ideal, actual, previous }
})

export const tagTrend = [680, 920, 740, 1280, 1040, 1510, 1190, 1640]

export const adminHealth = {
  temperature: [48, 49, 51, 50, 53, 52, 54, 52],
  cpu: [18, 26, 21, 37, 31, 44, 29, 34],
  ram: [42, 43, 44, 46, 45, 47, 48, 48],
  disk: [61, 61, 62, 62, 62, 63, 63, 63],
}
