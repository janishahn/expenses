import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react"
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight"
import { BasketIcon } from "@phosphor-icons/react/Basket"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { FileTextIcon } from "@phosphor-icons/react/FileText"
import { XIcon } from "@phosphor-icons/react/X"
import { Popover } from "radix-ui"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type TooltipContentProps,
} from "recharts"
import { formatCurrency } from "../../app/format"
import { FinancialPanel } from "../product/ProductSurfaces"
import { AppButton } from "../ui/product-button"
import {
  CHART_GRID_COLOR,
  CHART_MONO_TICK_STYLE,
  CHART_TOOLTIP_ANIMATION_DURATION,
  DarkChartTooltipCard,
  useChartAnimation,
} from "./chartTheme"

export type FlowNode = {
  id: string
  label: string
  type: string
  amount_cents: number
  category_id?: number | null
}

type WaterfallKind = "income" | "expense" | "result"

type WaterfallStep = {
  id: string
  label: string
  kind: WaterfallKind
  amountCents: number
  startCents: number
  endCents: number
  members: FlowNode[]
}

type Axis = {
  minimum: number
  maximum: number
  ticks: number[]
}

const MAX_INCOME_STEPS = 3
const MAX_EXPENSE_STEPS = 5

function collapsedSteps(
  nodes: FlowNode[],
  kind: Exclude<WaterfallKind, "result">,
  maximum: number,
): Array<Omit<WaterfallStep, "startCents" | "endCents">> {
  const sorted = [...nodes].sort(
    (left, right) => right.amount_cents - left.amount_cents || left.label.localeCompare(right.label),
  )
  if (sorted.length <= maximum) {
    return sorted.map((node) => ({
      id: node.id,
      label: node.label,
      kind,
      amountCents: kind === "expense" ? -node.amount_cents : node.amount_cents,
      members: [node],
    }))
  }

  const visible = sorted.slice(0, maximum - 1)
  const remainder = sorted.slice(maximum - 1)
  return [
    ...visible.map((node) => ({
      id: node.id,
      label: node.label,
      kind,
      amountCents: kind === "expense" ? -node.amount_cents : node.amount_cents,
      members: [node],
    })),
    {
      id: `${kind}:other`,
      label: kind === "income" ? "Other income" : "Other spending",
      kind,
      amountCents:
        remainder.reduce((sum, node) => sum + node.amount_cents, 0) *
        (kind === "expense" ? -1 : 1),
      members: remainder,
    },
  ]
}

function buildWaterfallSteps(nodes: FlowNode[]): WaterfallStep[] {
  const incomes = nodes.filter((node) => node.type === "income" && node.amount_cents > 0)
  const expenses = nodes.filter((node) => node.type === "expense" && node.amount_cents > 0)
  const changes = [
    ...collapsedSteps(incomes, "income", MAX_INCOME_STEPS),
    ...collapsedSteps(expenses, "expense", MAX_EXPENSE_STEPS),
  ]

  let runningBalance = 0
  const steps = changes.map((step) => {
    const startCents = runningBalance
    runningBalance += step.amountCents
    return { ...step, startCents, endCents: runningBalance }
  })

  return [
    ...steps,
    {
      id: "result",
      label: "Net",
      kind: "result",
      amountCents: runningBalance,
      startCents: 0,
      endCents: runningBalance,
      members: [],
    },
  ]
}

function niceAxis(steps: WaterfallStep[]): Axis {
  const rawMinimum = Math.min(0, ...steps.flatMap((step) => [step.startCents, step.endCents]))
  const rawMaximum = Math.max(0, ...steps.flatMap((step) => [step.startCents, step.endCents]))
  const span = Math.max(100, rawMaximum - rawMinimum)
  const roughStep = span / 4
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const tickSize = Math.max(100, multiplier * magnitude)
  let minimum = Math.floor(rawMinimum / tickSize) * tickSize
  let maximum = Math.ceil(rawMaximum / tickSize) * tickSize

  if (minimum === maximum) {
    maximum += tickSize
  }

  const ticks: number[] = []
  for (let value = minimum; value <= maximum; value += tickSize) {
    ticks.push(value)
  }
  if (ticks.length < 2) {
    minimum = Math.min(0, minimum - tickSize)
    maximum = Math.max(tickSize, maximum + tickSize)
    return { minimum, maximum, ticks: [minimum, maximum] }
  }
  return { minimum, maximum, ticks }
}

function signedCurrency(cents: number): string {
  if (cents === 0) return `${formatCurrency(0)} €`
  return `${cents > 0 ? "+" : "−"}${formatCurrency(Math.abs(cents))} €`
}

function axisCurrency(cents: number): string {
  const euros = Math.abs(cents) / 100
  const sign = cents < 0 ? "−" : ""
  if (euros >= 1000) {
    const compact = new Intl.NumberFormat("de-DE", {
      maximumFractionDigits: euros >= 10_000 ? 0 : 1,
    }).format(euros / 1000)
    return `${sign}${compact}k €`
  }
  return `${sign}${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(euros)} €`
}

function labelLines(label: string): string[] {
  if (label.length <= 13) return [label]
  const words = label.split(/\s+/)
  if (words.length === 1) return [`${label.slice(0, 12)}…`]
  let split = 1
  let smallestDifference = Number.POSITIVE_INFINITY
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(" ")
    const right = words.slice(index).join(" ")
    const difference = Math.abs(left.length - right.length)
    if (difference < smallestDifference) {
      split = index
      smallestDifference = difference
    }
  }
  const first = words.slice(0, split).join(" ")
  const second = words.slice(split).join(" ")
  return [first.length > 15 ? `${first.slice(0, 14)}…` : first, second.length > 15 ? `${second.slice(0, 14)}…` : second]
}

function stepColor(kind: WaterfallKind): string {
  if (kind === "income") return "rgb(var(--semantic-green))"
  if (kind === "expense") return "rgb(var(--semantic-red))"
  return "rgb(var(--accent))"
}

type WaterfallRow = WaterfallStep & {
  range: [number, number]
}

function WaterfallTooltip({ active, payload }: Partial<TooltipContentProps>) {
  if (!active || !payload?.length) return null
  const step = payload[0]?.payload as WaterfallRow | undefined
  return step ? (
    <DarkChartTooltipCard
      title={step.label}
      value={signedCurrency(step.amountCents)}
      detail={`Balance ${signedCurrency(step.endCents)}`}
    />
  ) : null
}

function DesktopWaterfallTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number
  y?: number
  payload?: { value: string }
}) {
  const lines = labelLines(payload?.value ?? "")
  return (
    <text
      x={x}
      y={y + 22}
      textAnchor="middle"
      fill="rgb(var(--text))"
      className="text-xs font-medium"
    >
      {lines.map((line, index) => (
        <tspan key={`${line}-${index}`} x={x} dy={index === 0 ? 0 : 16}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function DesktopWaterfallShape({
  selectedId,
  selectStep,
  setFocusIndex,
  stepCount,
  ...shapeProps
}: Partial<BarShapeProps> & {
  selectedId: string | null
  selectStep: (id: string) => void
  setFocusIndex: (index: number | null) => void
  stepCount: number
}) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    index = 0,
    payload,
    background,
    onMouseEnter,
    onMouseLeave,
    onMouseMove,
  } = shapeProps
  const step = payload as WaterfallRow | undefined
  if (!step) return null
  const barHeight = Math.max(3, height)
  const selected = selectedId === step.id
  const endY = step.endCents >= step.startCents ? y : y + barHeight
  const backgroundX = background?.x ?? x
  const connectorEnd = x + width / 0.62

  return (
    <g
      data-waterfall-step
      data-kind={step.kind}
      data-selected={selected ? "" : undefined}
      className="group cursor-pointer outline-none"
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${step.label}: ${signedCurrency(step.amountCents)}. Balance after this step: ${signedCurrency(step.endCents)}.`}
      onPointerDown={(event) => {
        event.preventDefault()
        selectStep(step.id)
      }}
      onClick={() => selectStep(step.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          selectStep(step.id)
        }
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      onFocus={() => setFocusIndex(index)}
      onBlur={() => setFocusIndex(null)}
      style={{ "--waterfall-index": index, outline: "none" } as CSSProperties}
    >
      {index < stepCount - 1 ? (
        <line
          x1={x + width}
          x2={connectorEnd}
          y1={endY}
          y2={endY}
          stroke="rgb(var(--border-hi))"
          strokeWidth={1.25}
          strokeDasharray="3 3"
        />
      ) : null}
      <rect
        x={x - 5}
        y={y - 5}
        width={width + 10}
        height={barHeight + 10}
        rx={11}
        fill="none"
        stroke="rgb(var(--text))"
        strokeWidth={2}
        className="opacity-0 transition-opacity duration-100 group-data-selected:opacity-80 group-focus-visible:opacity-80"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={barHeight}
        rx={6}
        fill={stepColor(step.kind)}
        className="waterfall-bar transition-[filter] duration-100 group-hover:brightness-95"
      />
      {background && background.y !== null ? (
        <rect
          x={backgroundX}
          y={background.y}
          width={background.width}
          height={background.height}
          fill="transparent"
        />
      ) : null}
      {step.kind === "result" ? (
        <text
          x={x + width / 2}
          y={Math.max(16, y - 13)}
          textAnchor="middle"
          fill="rgb(var(--text))"
          className="pointer-events-none font-mono text-[11px] font-medium"
        >
          {signedCurrency(step.amountCents)}
        </text>
      ) : null}
    </g>
  )
}

function DesktopWaterfall({
  steps,
  selectedId,
  onSelect,
}: {
  steps: WaterfallStep[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const animationActive = useChartAnimation()
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const axis = niceAxis(steps)
  const rows = steps.map((step) => ({
    ...step,
    range: [
      Math.min(step.startCents, step.endCents),
      Math.max(step.startCents, step.endCents),
    ] as [number, number],
  }))
  const shape = useMemo(
    () => (
      <DesktopWaterfallShape
        selectedId={selectedId}
        selectStep={onSelect}
        setFocusIndex={setFocusIndex}
        stepCount={steps.length}
      />
    ),
    [onSelect, selectedId, steps.length],
  )

  return (
    <div
      className="relative hidden min-h-[25.5rem] lg:block"
      role="group"
      aria-label="Income and spending chart"
    >
      <p className="sr-only">
        Income raises the running balance, spending lowers it, and the final bar shows the net result.
      </p>
      <ResponsiveContainer width="100%" aspect={1040 / 430}>
        <BarChart
          data={rows}
          margin={{ top: 48, right: 18, bottom: 82, left: 0 }}
          barCategoryGap="19%"
          accessibilityLayer={false}
        >
          <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={0}
            height={64}
            tick={<DesktopWaterfallTick />}
          />
          <YAxis
            type="number"
            domain={[axis.minimum, axis.maximum]}
            ticks={axis.ticks}
            tickFormatter={axisCurrency}
            axisLine={false}
            tickLine={false}
            tick={CHART_MONO_TICK_STYLE}
            tickMargin={8}
            width={72}
          />
          <Bar
            dataKey="range"
            name="Change"
            shape={shape}
            isAnimationActive={false}
          />
          <Tooltip
            shared={false}
            cursor={false}
            isAnimationActive={animationActive}
            animationDuration={CHART_TOOLTIP_ANIMATION_DURATION}
            active={focusIndex === null ? undefined : true}
            defaultIndex={focusIndex ?? undefined}
            content={<WaterfallTooltip />}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function MobileWaterfallTick({
  x = 0,
  y = 0,
  payload,
  steps,
}: {
  x?: number
  y?: number
  payload?: { value: string }
  steps: WaterfallStep[]
}) {
  const step = steps.find((candidate) => candidate.id === payload?.value)
  if (!step) return null
  const lines = labelLines(step.label)
  return (
    <text x={x - 8} y={y - 10} textAnchor="end" fill="rgb(var(--text))">
      {lines.map((line, index) => (
        <tspan
          key={`${line}-${index}`}
          x={x - 8}
          dy={index === 0 ? 0 : 13}
          className="text-[10px] font-semibold"
        >
          {line}
        </tspan>
      ))}
      <tspan
        x={x - 8}
        dy={14}
        fill={stepColor(step.kind)}
        className="font-mono text-[9px] font-semibold"
      >
        {signedCurrency(step.amountCents)}
      </tspan>
    </text>
  )
}

function MobileWaterfallShape({
  selectedId,
  stepCount,
  ...shapeProps
}: Partial<BarShapeProps> & {
  selectedId: string | null
  stepCount: number
}) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    index = 0,
    payload,
  } = shapeProps
  const step = payload as WaterfallRow | undefined
  if (!step) return null
  const endX = step.endCents >= step.startCents ? x + width : x
  const centerY = y + height / 2
  const selected = selectedId === step.id
  return (
    <g style={{ "--waterfall-index": index } as CSSProperties}>
      {index < stepCount - 1 ? (
        <line
          x1={endX}
          x2={endX}
          y1={centerY}
          y2={centerY + 66}
          stroke="rgb(var(--border-hi))"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}
      {selected ? (
        <rect
          x={x - 3}
          y={y - 3}
          width={Math.max(3, width) + 6}
          height={height + 6}
          rx={9}
          fill="none"
          stroke="rgb(var(--text))"
          strokeWidth={2}
        />
      ) : null}
      <rect
        x={x}
        y={y}
        width={Math.max(3, width)}
        height={height}
        rx={6}
        fill={stepColor(step.kind)}
        className="waterfall-mobile-bar"
        style={{
          transformOrigin:
            step.kind === "expense" ? "right center" : "left center",
        }}
      />
      <circle cx={endX} cy={centerY} r={3} fill={stepColor(step.kind)} />
    </g>
  )
}

function MobileWaterfall({
  steps,
  selectedId,
  onSelect,
}: {
  steps: WaterfallStep[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const axis = niceAxis(steps)
  const domain = axis.maximum - axis.minimum
  const ticks = [axis.minimum, axis.minimum + domain / 2, axis.maximum]
  const rows = steps.map((step) => ({
    ...step,
    range: [
      Math.min(step.startCents, step.endCents),
      Math.max(step.startCents, step.endCents),
    ] as [number, number],
  }))
  const tick = useMemo(
    () => <MobileWaterfallTick steps={steps} />,
    [steps],
  )
  const shape = useMemo(
    () => (
      <MobileWaterfallShape
        selectedId={selectedId}
        stepCount={steps.length}
      />
    ),
    [selectedId, steps.length],
  )

  return (
    <div
      className="waterfall-mobile lg:hidden"
      role="group"
      aria-label="Income and spending chart"
    >
      <p className="sr-only">
        Income raises the running balance, spending lowers it, and the final row shows the net result.
      </p>
      <div className="relative" style={{ height: steps.length * 66 }}>
        <div
          className="absolute inset-0"
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              accessibilityLayer={false}
            >
              <CartesianGrid stroke={CHART_GRID_COLOR} horizontal={false} />
              <XAxis
                type="number"
                orientation="top"
                domain={[axis.minimum, axis.maximum]}
                ticks={ticks}
                tickFormatter={axisCurrency}
                axisLine={false}
                tickLine={false}
                tick={{ ...CHART_MONO_TICK_STYLE, fontSize: 9 }}
                height={28}
              />
              <YAxis
                type="category"
                dataKey="id"
                axisLine={false}
                tickLine={false}
                width={104}
                tick={tick}
              />
              {ticks.map((value, index) => (
                <ReferenceLine
                  key={`${value}-${index}`}
                  x={value}
                  stroke="rgb(var(--border))"
                />
              ))}
              <Bar
                dataKey="range"
                barSize={14}
                shape={shape}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {steps.map((step, index) => {
          return (
            <button
              key={step.id}
              type="button"
              data-waterfall-step
              data-kind={step.kind}
              data-selected={selectedId === step.id ? "" : undefined}
              aria-pressed={selectedId === step.id}
              aria-label={`${step.label}: ${signedCurrency(step.amountCents)}. Balance after this step: ${signedCurrency(step.endCents)}.`}
              onClick={() => onSelect(step.id)}
              className="absolute left-0 z-[1] h-[4.125rem] w-full border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              style={{
                top: index * 66,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function StepIcon({ kind }: { kind: WaterfallKind }) {
  if (kind === "income") return <ArrowUpRightIcon aria-hidden="true" />
  if (kind === "expense") return <BasketIcon aria-hidden="true" />
  return <CheckCircleIcon aria-hidden="true" />
}

function WaterfallDetails({
  step,
  totalIncome,
  totalSpending,
  onCategoryClick,
}: {
  step: WaterfallStep
  totalIncome: number
  totalSpending: number
  onCategoryClick?: (categoryId: number) => void
}) {
  const shareBase = step.kind === "income" ? totalIncome : totalSpending
  const share = shareBase > 0 ? Math.round((Math.abs(step.amountCents) / shareBase) * 100) : 0
  const label = step.kind === "income" ? "Income source" : step.kind === "expense" ? "Expense group" : "Period result"
  const visibleMembers = step.members.slice(0, 5)

  return (
    <FinancialPanel
      role="inspector"
      data-waterfall-details
      data-testid="waterfall-details"
      className="min-w-0 self-start p-4 sm:p-5"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
          style={{
            color: stepColor(step.kind),
            backgroundColor:
              step.kind === "income"
                ? "rgb(var(--signal-green-soft))"
                : step.kind === "expense"
                  ? "rgb(var(--signal-red-soft))"
                  : "rgb(var(--signal-blue-soft))",
          }}
        >
          <StepIcon kind={step.kind} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-head text-base font-bold">{step.label}</h3>
          <span className="mono-meta text-muted">{label}</span>
        </div>
      </div>

      <strong
        className="mt-6 block font-mono text-[1.75rem] leading-none tracking-tight"
        style={{ color: stepColor(step.kind) }}
      >
        {signedCurrency(step.amountCents)}
      </strong>

      {step.kind === "result" ? (
        <div className="mt-5 divide-y divide-border">
          <div className="flex min-h-11 items-center justify-between gap-3 text-xs">
            <span className="text-muted">Income</span>
            <strong className="font-mono">{signedCurrency(totalIncome)}</strong>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3 text-xs">
            <span className="text-muted">Spending</span>
            <strong className="font-mono">{signedCurrency(-totalSpending)}</strong>
          </div>
        </div>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-md bg-faint p-3">
              <dt className="text-[10px] text-muted">
                {step.kind === "income" ? "Share of income" : "Share of spending"}
              </dt>
              <dd className="mt-1 font-mono text-sm font-semibold">{share}%</dd>
            </div>
            <div className="rounded-md bg-faint p-3">
              <dt className="text-[10px] text-muted">Balance after</dt>
              <dd className="mt-1 truncate font-mono text-sm font-semibold">
                {signedCurrency(step.endCents)}
              </dd>
            </div>
          </dl>

          {visibleMembers.length > 1 ? (
            <div className="mt-5">
              <span className="mono-meta text-muted">Breakdown</span>
              <div className="mt-1 divide-y divide-border">
                {visibleMembers.map((member) => {
                  const content = (
                    <>
                      <span className="truncate">{member.label}</span>
                      <strong className="shrink-0 font-mono text-[11px]">
                        {signedCurrency(step.kind === "expense" ? -member.amount_cents : member.amount_cents)}
                      </strong>
                    </>
                  )
                  return member.category_id && step.kind === "expense" && onCategoryClick ? (
                    <button
                      key={member.id}
                      type="button"
                      className="flex min-h-10 w-full items-center justify-between gap-3 text-left text-xs transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      aria-label={`Open ${member.label} transactions`}
                      onClick={() => onCategoryClick(member.category_id as number)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={member.id} className="flex min-h-10 items-center justify-between gap-3 text-xs">
                      {content}
                    </div>
                  )
                })}
              </div>
              {step.members.length > visibleMembers.length ? (
                <p className="mt-2 text-[11px] text-muted">
                  {step.members.length - visibleMembers.length} more in the data view
                </p>
              ) : null}
            </div>
          ) : null}

          {step.members.length === 1 &&
          step.kind === "expense" &&
          step.members[0].category_id &&
          onCategoryClick ? (
            <AppButton
              type="button"
              tone="secondary"
              className="mt-5 w-full"
              onClick={() => onCategoryClick(step.members[0].category_id as number)}
            >
              Open transactions
            </AppButton>
          ) : null}
        </>
      )}
    </FinancialPanel>
  )
}

function ChartDataPopover({
  steps,
  onCategoryClick,
}: {
  steps: WaterfallStep[]
  onCategoryClick?: (categoryId: number) => void
}) {
  return (
    <Popover.Root modal>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-md text-muted transition-[color,background-color,transform] duration-100 hover:bg-faint hover:text-text active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="View chart data"
        >
          <FileTextIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-[70] max-h-[min(70vh,38rem)] w-[min(23rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-border bg-surface-hi p-4 text-text shadow-[var(--shadow-raised)] outline-none"
          aria-label="Chart data"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-head text-sm font-bold">Chart data</h3>
              <p className="mt-0.5 text-[11px] text-muted">Recorded totals</p>
            </div>
            <Popover.Close asChild>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-faint hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label="Close chart data"
              >
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </Popover.Close>
          </div>
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">Income and spending chart values</caption>
            <thead>
              <tr className="border-b border-border text-left font-mono text-[9px] uppercase tracking-wider text-muted">
                <th className="py-2 font-medium">Step</th>
                <th className="py-2 text-right font-medium">Change</th>
                <th className="py-2 pl-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {steps.map((step) => (
                <Fragment key={step.id}>
                  <tr>
                    <td className="py-2.5 font-semibold">
                      {step.members.length === 1 &&
                      step.kind === "expense" &&
                      step.members[0].category_id &&
                      onCategoryClick ? (
                        <button
                          type="button"
                          className="text-left hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          aria-label={`Open ${step.label} transactions`}
                          onClick={() => onCategoryClick(step.members[0].category_id as number)}
                        >
                          {step.label}
                        </button>
                      ) : (
                        step.label
                      )}
                    </td>
                    <td className="py-2.5 text-right font-mono text-[11px]">
                      {signedCurrency(step.amountCents)}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono text-[11px]">
                      {signedCurrency(step.endCents)}
                    </td>
                  </tr>
                  {step.members.length > 1
                    ? step.members.map((member) => (
                        <tr key={member.id} className="bg-faint/60 text-muted">
                          <td className="py-2 pl-3">
                            {step.kind === "expense" && member.category_id && onCategoryClick ? (
                              <button
                                type="button"
                                className="text-left hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                                aria-label={`Open ${member.label} transactions`}
                                onClick={() => onCategoryClick(member.category_id as number)}
                              >
                                {member.label}
                              </button>
                            ) : (
                              member.label
                            )}
                          </td>
                          <td className="py-2 text-right font-mono text-[11px]">
                            {signedCurrency(step.kind === "expense" ? -member.amount_cents : member.amount_cents)}
                          </td>
                          <td className="py-2 pl-3">
                            <span className="sr-only">Included in grouped balance</span>
                          </td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="mt-3 border-t border-border pt-3 text-[10px] leading-relaxed text-muted">
            Expenses are not assigned to specific income sources.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default function WaterfallChart({
  nodes,
  periodLabel,
  onCategoryClick,
}: {
  nodes: FlowNode[]
  periodLabel: string
  onCategoryClick?: (categoryId: number) => void
}) {
  const steps = useMemo(() => buildWaterfallSteps(nodes), [nodes])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState("result")
  const totalIncome = nodes
    .filter((node) => node.type === "income")
    .reduce((sum, node) => sum + node.amount_cents, 0)
  const totalSpending = nodes
    .filter((node) => node.type === "expense")
    .reduce((sum, node) => sum + node.amount_cents, 0)
  const detailStep = steps.find((step) => step.id === detailId) ?? steps.at(-1)

  useEffect(() => {
    const clearSelection = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest("[data-waterfall-step], [data-waterfall-details], button, a, [role='dialog']")) return
      setSelectedId(null)
      if (document.activeElement instanceof HTMLElement && document.activeElement.matches("[data-waterfall-step]")) {
        document.activeElement.blur()
      }
    }

    document.addEventListener("pointerdown", clearSelection)
    return () => document.removeEventListener("pointerdown", clearSelection)
  }, [])

  if (!nodes.some((node) => node.type === "income" || node.type === "expense") || !detailStep) {
    return <p className="py-5 text-sm text-muted">No income or spending data for this period.</p>
  }

  const selectStep = (id: string) => {
    setSelectedId(id)
    setDetailId(id)
  }

  return (
    <section className="net-chart-section">
      <header className="mb-3 flex min-h-12 flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-head text-xl font-bold tracking-tight">Income &amp; spending</h2>
          <p className="mt-0.5 font-mono text-[10px] text-muted">{periodLabel} · Recorded totals</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-3 text-[11px] text-muted sm:flex" aria-label="Chart legend">
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[3px] bg-semantic-green" />Income</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[3px] bg-semantic-red" />Spending</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-[3px] bg-accent" />Net</span>
          </div>
          <ChartDataPopover steps={steps} onCategoryClick={onCategoryClick} />
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18.5rem] xl:gap-5">
        <div className="min-w-0 pt-0.5">
          <DesktopWaterfall steps={steps} selectedId={selectedId} onSelect={selectStep} />
          <MobileWaterfall steps={steps} selectedId={selectedId} onSelect={selectStep} />
        </div>
        <WaterfallDetails
          step={detailStep}
          totalIncome={totalIncome}
          totalSpending={totalSpending}
          onCategoryClick={onCategoryClick}
        />
      </div>
    </section>
  )
}
