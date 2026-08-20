import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  adminHealth,
  balanceHistory,
  burndown,
  categoryTrend,
  expenseMix,
  flowSteps,
  forecast,
  incomeMix,
  monthlyIncomeExpense,
  monthlySpending,
  scenario,
  tagTrend,
} from "./prototypeData"
import {
  PROTOTYPE_PAGES,
  type PrototypeMode,
  type PrototypePage,
  type VariantProps,
} from "./types"

const PAGE_META: Record<PrototypePage, { title: string; detail: string }> = {
  dashboard: {
    title: "Dashboard",
    detail: "Current position, recent movement, and where the money went.",
  },
  insights: {
    title: "Insights",
    detail: "Recorded income and spending patterns across the selected period.",
  },
  forecast: {
    title: "Forecast",
    detail: "A six-month projection with recurring-only and likely paths.",
  },
  scenarios: {
    title: "What If",
    detail: "Baseline compared with a planned freelance income adjustment.",
  },
  budgets: {
    title: "Budgets",
    detail: "July allocation, actual pace, and expected month-end position.",
  },
  tags: {
    title: "Tag: Summer trip",
    detail: "Tagged activity and its income and expense composition.",
  },
  recurring: {
    title: "Recurring audit",
    detail: "The annual shape and long-term cost of active commitments.",
  },
  admin: {
    title: "Admin",
    detail: "Raspberry Pi health samples collected during this session.",
  },
}

const MODE_META: Record<PrototypeMode, { label: string; note: string }> = {
  literal: {
    label: "Literal defaults",
    note: "Stock example palette, white surfaces, default axes, legends, tooltips, cursors, and animation.",
  },
  native: {
    label: "Product shell",
    note: "The app keeps its paper surfaces and semantic colors while Recharts owns most chart chrome and motion.",
  },
  motion: {
    label: "Live motion",
    note: "Large plots and a live-data control make Recharts' default mount and update animations easy to judge.",
  },
}

const PALETTES: Record<PrototypeMode, string[]> = {
  literal: ["#8884d8", "#82ca9d", "#ffc658", "#ff8042", "#0088fe", "#00c49f"],
  native: ["#3b4ee8", "#15936d", "#f25f48", "#edbd35", "#7855d8", "#5b8def"],
  motion: ["#0088fe", "#00c49f", "#ffbb28", "#ff8042", "#a855f7", "#22c55e"],
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return reduced
}

function scaleNumber(value: number | null, factor: number): number | null {
  return value === null ? null : Math.round(value * factor)
}

function scaleRange(value: number[] | null, factor: number): number[] | null {
  return value?.map((entry) => Math.round(entry * factor)) ?? null
}

function ChartPanel({
  title,
  question,
  children,
  wide = false,
  compact = false,
}: {
  title: string
  question: string
  children: ReactNode
  wide?: boolean
  compact?: boolean
}) {
  return (
    <section className={`chart-panel${wide ? " chart-panel-wide" : ""}${compact ? " chart-panel-compact" : ""}`}>
      <header className="chart-panel-header">
        <div>
          <h2>{title}</h2>
          <p>{question}</p>
        </div>
        <span className="chart-engine-chip">Recharts</span>
      </header>
      <div className="chart-stage">{children}</div>
    </section>
  )
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`prototype-metric prototype-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DefaultPie({
  data,
  colors,
  animated,
  label,
}: {
  data: typeof expenseMix
  colors: string[]
  animated: boolean
  label: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="45%"
          innerRadius="48%"
          outerRadius="72%"
          label={label}
          isAnimationActive={animated}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip isAnimationActive={animated} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

function MiniLine({
  values,
  color,
  animated,
}: {
  values: number[]
  color: string
  animated: boolean
}) {
  const data = values.map((value, index) => ({ index: index + 1, value }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          isAnimationActive={animated}
        />
        <Tooltip isAnimationActive={animated} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function DashboardCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const balance = balanceHistory.map((row) => ({
    ...row,
    actual: scaleNumber(row.actual, factor),
    likely: scaleNumber(row.likely, factor),
    range: scaleRange(row.range, factor),
  }))
  const spending = monthlySpending.map((row) => ({
    ...row,
    Housing: Math.round(row.Housing * factor),
    Food: Math.round(row.Food * factor),
    Transport: Math.round(row.Transport * factor),
    Leisure: Math.round(row.Leisure * factor),
    Other: Math.round(row.Other * factor),
  }))

  return (
    <>
      <div className="prototype-metrics prototype-metrics-four">
        <Metric label="Current balance" value={`${Math.round(4120 * factor).toLocaleString()} €`} tone="plan" />
        <Metric label="Income" value={`${Math.round(3900 * factor).toLocaleString()} €`} tone="income" />
        <Metric label="Spending" value={`${Math.round(2230 * factor).toLocaleString()} €`} tone="expense" />
        <Metric label="Net movement" value={`+${Math.round(1670 * factor).toLocaleString()} €`} tone="warning" />
      </div>
      <div className="prototype-chart-grid">
        <ChartPanel title="Balance history" question="How did the actual balance move, and where may it go?" wide>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={balance}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip isAnimationActive={animated} />
              <Legend />
              <Area
                type="monotone"
                dataKey="range"
                name="80% range"
                stroke={colors[2]}
                fill={colors[2]}
                isAnimationActive={animated}
              />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual balance"
                stroke={colors[0]}
                isAnimationActive={animated}
              />
              <Line
                type="monotone"
                dataKey="likely"
                name="Likely balance"
                stroke={colors[1]}
                isAnimationActive={animated}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Six-month spending" question="Which categories drove each month's absolute spend?" wide>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spending} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="month" />
              <Tooltip isAnimationActive={animated} />
              <Legend />
              {["Housing", "Food", "Transport", "Leisure", "Other"].map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="spending"
                  fill={colors[index % colors.length]}
                  isAnimationActive={animated}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Expenses" question="What share did each category take?" compact>
          <DefaultPie data={expenseMix} colors={colors} animated={animated} label={mode === "literal"} />
        </ChartPanel>
        <ChartPanel title="Income" question="Where did this month's income come from?" compact>
          <DefaultPie data={incomeMix} colors={colors.slice().reverse()} animated={animated} label={mode === "literal"} />
        </ChartPanel>
      </div>
    </>
  )
}

function InsightsCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const monthly = monthlyIncomeExpense.map((row) => ({
    ...row,
    income: Math.round(row.income * factor),
    expenses: Math.round(row.expenses * factor),
  }))
  const trend = categoryTrend.map((row) => ({ ...row, amount: Math.round(row.amount * factor) }))
  const flow = flowSteps.map((row) => ({
    ...row,
    amount: Math.round(row.amount * factor),
    range: row.range.map((value) => Math.round(value * factor)),
  }))

  return (
    <div className="prototype-chart-grid">
      <ChartPanel title="Monthly income vs expenses" question="Did recorded income stay ahead of spending?" wide>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip isAnimationActive={animated} />
            <Legend />
            <Line type="monotone" dataKey="income" stroke={colors[1]} isAnimationActive={animated} />
            <Line type="monotone" dataKey="expenses" stroke={colors[3]} isAnimationActive={animated} />
          </LineChart>
        </ResponsiveContainer>
      </ChartPanel>
      <ChartPanel title="Food trend" question="How did the selected category change month to month?">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip isAnimationActive={animated} />
            <Legend />
            <Bar dataKey="amount" name="Food" fill={colors[0]} isAnimationActive={animated} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
      <ChartPanel title="Net result" question="How did each recorded group change the running balance?" wide>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={flow}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" interval={0} angle={-12} textAnchor="end" height={54} />
            <YAxis />
            <Tooltip isAnimationActive={animated} />
            <Bar dataKey="range" name="Running balance" isAnimationActive={animated}>
              {flow.map((row) => (
                <Cell
                  key={row.name}
                  fill={
                    row.tone === "income"
                      ? colors[1]
                      : row.tone === "expense"
                        ? colors[3]
                        : colors[0]
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
  )
}

function ForecastCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const rows = forecast.map((row) => ({
    ...row,
    recurring: Math.round(row.recurring * factor),
    likely: Math.round(row.likely * factor),
    range: row.range.map((value) => Math.round(value * factor)),
  }))
  return (
    <div className="prototype-chart-grid">
      <div className="prototype-metrics prototype-metrics-three chart-panel-wide">
        <Metric label="December likely" value={`${rows.at(-1)?.likely.toLocaleString()} €`} tone="plan" />
        <Metric label="Recurring only" value={`${rows.at(-1)?.recurring.toLocaleString()} €`} tone="income" />
        <Metric label="Lower bound" value={`${rows.at(-1)?.range[0].toLocaleString()} €`} tone="warning" />
      </div>
      <ChartPanel title="Projected balance" question="How wide is the plausible path over the next six months?" wide>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip isAnimationActive={animated} />
            <Legend />
            <Area type="monotone" dataKey="range" name="80% range" stroke={colors[2]} fill={colors[2]} isAnimationActive={animated} />
            <Line type="monotone" dataKey="recurring" name="Recurring only" stroke={colors[1]} isAnimationActive={animated} />
            <Line type="monotone" dataKey="likely" name="Likely balance" stroke={colors[0]} isAnimationActive={animated} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
  )
}

function ScenarioCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const rows = scenario.map((row) => ({
    ...row,
    baseline: Math.round(row.baseline * factor),
    scenario: Math.round(row.scenario * factor),
    difference: row.difference.map((value) => Math.round(value * factor)),
  }))
  return (
    <div className="prototype-chart-grid">
      <div className="prototype-adjustment chart-panel-wide">
        <span>One-time income · Freelance project</span>
        <strong>+725 € in September</strong>
      </div>
      <ChartPanel title="Baseline vs scenario" question="What changes if the planned income arrives?" wide>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip isAnimationActive={animated} />
            <Legend />
            <Area type="monotone" dataKey="difference" name="Difference band" stroke={colors[1]} fill={colors[1]} isAnimationActive={animated} />
            <Line type="monotone" dataKey="baseline" stroke={colors[0]} isAnimationActive={animated} />
            <Line type="monotone" dataKey="scenario" stroke={colors[3]} isAnimationActive={animated} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
  )
}

function BudgetCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const rows = burndown.map((row) => ({
    ...row,
    ideal: Math.round(row.ideal * factor),
    actual: scaleNumber(row.actual, factor),
    previous: Math.round(row.previous * factor),
  }))
  return (
    <>
      <div className="prototype-metrics prototype-metrics-four">
        <Metric label="Monthly plan" value="2,400 €" tone="plan" />
        <Metric label="Spent" value="941 €" tone="expense" />
        <Metric label="Remaining" value="1,459 €" tone="income" />
        <Metric label="Projected" value="2,186 €" tone="warning" />
      </div>
      <div className="prototype-chart-grid">
        <ChartPanel title="Overall spending pace" question="Is spending tracking above or below an even pace?" wide>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip isAnimationActive={animated} />
              <Legend />
              <Area type="monotone" dataKey="actual" name="Actual area" stroke={colors[1]} fill={colors[1]} isAnimationActive={animated} />
              <Line type="monotone" dataKey="ideal" stroke={colors[0]} isAnimationActive={animated} />
              <Line type="monotone" dataKey="actual" stroke={colors[3]} isAnimationActive={animated} />
              <Line type="monotone" dataKey="previous" stroke={colors[4]} isAnimationActive={animated} />
              <ReferenceLine x={16} label="Today" stroke="red" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </>
  )
}

function TagCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const values = tagTrend.map((value) => Math.round(value * factor))
  return (
    <div className="prototype-chart-grid">
      <div className="prototype-spark-grid chart-panel-wide">
        {[
          ["Income", "2,100 €", colors[1], values.map((value) => value * 1.35)],
          ["Expenses", "1,640 €", colors[3], values],
          ["Balance", "+460 €", colors[0], values.map((value) => 2500 - value)],
        ].map(([label, value, color, points]) => (
          <div className="prototype-spark-card" key={String(label)}>
            <span>{label as string}</span>
            <strong>{value as string}</strong>
            <div className="prototype-sparkline">
              <MiniLine values={points as number[]} color={color as string} animated={animated} />
            </div>
          </div>
        ))}
      </div>
      <ChartPanel title="Tagged expenses" question="Which categories make up this tag's spending?" compact>
        <DefaultPie data={expenseMix.slice(1)} colors={colors} animated={animated} label={mode === "literal"} />
      </ChartPanel>
      <ChartPanel title="Tagged income" question="Which sources make up this tag's income?" compact>
        <DefaultPie data={incomeMix} colors={colors.slice().reverse()} animated={animated} label={mode === "literal"} />
      </ChartPanel>
    </div>
  )
}

function RecurringCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const annual = expenseMix.map((row) => ({ ...row, value: Math.round(row.value * 12 * factor) }))
  return (
    <>
      <div className="prototype-metrics prototype-metrics-three">
        <Metric label="Monthly total" value="1,347 €" tone="expense" />
        <Metric label="Annual total" value="16,164 €" tone="warning" />
        <Metric label="Five-year total" value="80,820 €" tone="plan" />
      </div>
      <div className="prototype-chart-grid">
        <ChartPanel title="Annual expense mix" question="Where do active recurring commitments accumulate?" wide compact>
          <DefaultPie data={annual} colors={colors} animated={animated} label={mode === "literal"} />
        </ChartPanel>
      </div>
    </>
  )
}

function AdminCharts({ mode, factor, animated }: ChartProps) {
  const colors = PALETTES[mode]
  const rows = [
    ["CPU temperature", "52°C", adminHealth.temperature, colors[3]],
    ["CPU load", "34%", adminHealth.cpu, colors[0]],
    ["RAM", "0.9 / 1.8 GB", adminHealth.ram, colors[1]],
    ["Disk", "24 / 38 GB", adminHealth.disk, colors[4]],
  ] as const
  return (
    <div className="prototype-admin-grid">
      {rows.map(([label, value, points, color]) => (
        <ChartPanel key={label} title={label} question={`Latest reading · ${value}`} compact>
          <MiniLine
            values={points.map((point) => Math.round(point * factor))}
            color={color}
            animated={animated}
          />
        </ChartPanel>
      ))}
    </div>
  )
}

type ChartProps = {
  mode: PrototypeMode
  factor: number
  animated: boolean
}

function PageCharts({ page, ...props }: ChartProps & { page: PrototypePage }) {
  if (page === "dashboard") return <DashboardCharts {...props} />
  if (page === "insights") return <InsightsCharts {...props} />
  if (page === "forecast") return <ForecastCharts {...props} />
  if (page === "scenarios") return <ScenarioCharts {...props} />
  if (page === "budgets") return <BudgetCharts {...props} />
  if (page === "tags") return <TagCharts {...props} />
  if (page === "recurring") return <RecurringCharts {...props} />
  return <AdminCharts {...props} />
}

function PageNavigation({
  current,
  onChange,
}: {
  current: PrototypePage
  onChange: (page: PrototypePage) => void
}) {
  return (
    <nav className="prototype-page-nav" aria-label="Chart page previews">
      {PROTOTYPE_PAGES.map((page, index) => (
        <button
          key={page.id}
          type="button"
          className={page.id === current ? "is-active" : ""}
          aria-current={page.id === current ? "page" : undefined}
          onClick={() => onChange(page.id)}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          {page.shortLabel}
        </button>
      ))}
    </nav>
  )
}

export default function ChartSystemPrototype({
  mode,
  page,
  onPageChange,
}: VariantProps & { mode: PrototypeMode }) {
  const reducedMotion = useReducedMotion()
  const [nextSync, setNextSync] = useState(false)
  const factor = nextSync ? 1.06 : 1
  const meta = PAGE_META[page]
  const modeMeta = MODE_META[mode]
  const nav = <PageNavigation current={page} onChange={onPageChange} />
  const charts = useMemo(
    () => <PageCharts page={page} mode={mode} factor={factor} animated={!reducedMotion} />,
    [factor, mode, page, reducedMotion],
  )

  return (
    <div className={`prototype-experience prototype-${mode}`}>
      {mode !== "literal" ? (
        <aside className="prototype-sidebar">
          <div className="prototype-brand">
            <span>€</span>
            <strong>Expenses</strong>
          </div>
          {nav}
          <p className="prototype-sidebar-note">Default Recharts study</p>
        </aside>
      ) : null}

      <div className="prototype-workspace">
        {mode === "literal" ? (
          <div className="prototype-literal-topbar">
            <div className="prototype-brand">
              <span>R</span>
              <strong>Recharts default gallery</strong>
            </div>
            {nav}
          </div>
        ) : null}

        <header className="prototype-page-header">
          <div>
            <span className="prototype-mode-label">{modeMeta.label}</span>
            <h1>{meta.title}</h1>
            <p>{meta.detail}</p>
          </div>
          <div className="prototype-header-actions">
            <span>{modeMeta.note}</span>
            {mode === "motion" ? (
              <button type="button" onClick={() => setNextSync((value) => !value)}>
                {nextSync ? "Return to current values" : "Simulate next sync"}
              </button>
            ) : null}
          </div>
        </header>

        <main className="prototype-page-content" key={page}>
          {charts}
        </main>
      </div>
    </div>
  )
}
