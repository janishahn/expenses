import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  Bank,
  Basket,
  ChartBar,
  ChartLineUp,
  ChatCircleDots,
  CheckCircle,
  FileText,
  Flask,
  ForkKnife,
  GearSix,
  House,
  Lightning,
  ListBullets,
  Newspaper,
  Shapes,
  Sparkle,
  SquaresFour,
  Tag,
  Wallet,
} from "@phosphor-icons/react";

type PeriodKey = "this-month" | "last-month" | "this-year";
type StepKind = "income" | "expense" | "result";

type EvidenceRow = {
  label: string;
  amount: number;
};

type FlowStep = {
  id: string;
  label: string;
  lines: string[];
  amount: number;
  kind: Exclude<StepKind, "result">;
  transactionCount: number;
  description: string;
  evidence: EvidenceRow[];
};

type PeriodData = {
  label: string;
  dateRange: string;
  steps: FlowStep[];
};

const periodData: Record<PeriodKey, PeriodData> = {
  "this-month": {
    label: "This month",
    dateRange: "1–15 Aug 2026",
    steps: [
      {
        id: "salary",
        label: "Salary",
        lines: ["Salary"],
        amount: 3250,
        kind: "income",
        transactionCount: 1,
        description: "Your main income deposit raised the running balance first.",
        evidence: [{ label: "Acme GmbH · Salary", amount: 3250 }],
      },
      {
        id: "bank-transfer",
        label: "Bank transfer",
        lines: ["Bank", "transfer"],
        amount: 1450,
        kind: "income",
        transactionCount: 3,
        description: "Incoming transfers added to the same balance without assigning them to later costs.",
        evidence: [
          { label: "Shared rent transfer", amount: 920 },
          { label: "Travel reimbursement", amount: 410 },
          { label: "Private transfer", amount: 120 },
        ],
      },
      {
        id: "paypal",
        label: "PayPal",
        lines: ["PayPal"],
        amount: 85,
        kind: "income",
        transactionCount: 2,
        description: "Two refunds made a small positive contribution.",
        evidence: [
          { label: "Retail refund", amount: 64 },
          { label: "Fee correction", amount: 21 },
        ],
      },
      {
        id: "groceries",
        label: "Groceries",
        lines: ["Groceries"],
        amount: -1210,
        kind: "expense",
        transactionCount: 19,
        description: "Groceries caused the largest fall in the running balance.",
        evidence: [
          { label: "REWE", amount: -142.8 },
          { label: "EDEKA", amount: -118.2 },
          { label: "17 more transactions", amount: -949 },
        ],
      },
      {
        id: "food-dining",
        label: "Food & dining",
        lines: ["Food &", "dining"],
        amount: -710,
        kind: "expense",
        transactionCount: 12,
        description: "Food, restaurant, and café spending formed the second-largest expense group.",
        evidence: [
          { label: "Restaurants", amount: -386 },
          { label: "Food", amount: -214 },
          { label: "Cafés", amount: -110 },
        ],
      },
      {
        id: "free-time-travel",
        label: "Free time & travel",
        lines: ["Free time", "& travel"],
        amount: -615,
        kind: "expense",
        transactionCount: 9,
        description: "Discretionary trips and leisure purchases reduced the balance by €615.",
        evidence: [
          { label: "Travel", amount: -338 },
          { label: "Free time", amount: -207 },
          { label: "Entertainment", amount: -70 },
        ],
      },
      {
        id: "bills-health",
        label: "Bills & health",
        lines: ["Bills &", "health"],
        amount: -405,
        kind: "expense",
        transactionCount: 8,
        description: "Recurring bills and health costs made a smaller, steady reduction.",
        evidence: [
          { label: "Living", amount: -205 },
          { label: "Health", amount: -126 },
          { label: "Tech", amount: -74 },
        ],
      },
      {
        id: "other",
        label: "Other spending",
        lines: ["Other", "spending"],
        amount: -290,
        kind: "expense",
        transactionCount: 14,
        description: "The remaining small categories are grouped to keep the comparison readable.",
        evidence: [
          { label: "Presents", amount: -104 },
          { label: "Drugstore", amount: -86 },
          { label: "Other categories", amount: -100 },
        ],
      },
    ],
  },
  "last-month": {
    label: "Last month",
    dateRange: "1–31 Jul 2026",
    steps: [
      { id: "salary", label: "Salary", lines: ["Salary"], amount: 3250, kind: "income", transactionCount: 1, description: "Your main income deposit raised the running balance first.", evidence: [{ label: "Acme GmbH · Salary", amount: 3250 }] },
      { id: "bank-transfer", label: "Bank transfer", lines: ["Bank", "transfer"], amount: 250, kind: "income", transactionCount: 2, description: "Two incoming transfers added €250 to the balance.", evidence: [{ label: "Shared purchase", amount: 180 }, { label: "Private transfer", amount: 70 }] },
      { id: "paypal", label: "PayPal", lines: ["PayPal"], amount: 40, kind: "income", transactionCount: 1, description: "One PayPal refund added €40.", evidence: [{ label: "Retail refund", amount: 40 }] },
      { id: "groceries", label: "Groceries", lines: ["Groceries"], amount: -960, kind: "expense", transactionCount: 23, description: "Groceries caused the largest fall in the running balance.", evidence: [{ label: "REWE", amount: -118 }, { label: "EDEKA", amount: -94 }, { label: "21 more transactions", amount: -748 }] },
      { id: "food-dining", label: "Food & dining", lines: ["Food &", "dining"], amount: -620, kind: "expense", transactionCount: 15, description: "Food, restaurant, and café spending reduced the balance by €620.", evidence: [{ label: "Restaurants", amount: -315 }, { label: "Food", amount: -209 }, { label: "Cafés", amount: -96 }] },
      { id: "free-time-travel", label: "Free time & travel", lines: ["Free time", "& travel"], amount: -410, kind: "expense", transactionCount: 7, description: "Travel and leisure made a moderate reduction.", evidence: [{ label: "Travel", amount: -204 }, { label: "Free time", amount: -143 }, { label: "Entertainment", amount: -63 }] },
      { id: "bills-health", label: "Bills & health", lines: ["Bills &", "health"], amount: -510, kind: "expense", transactionCount: 10, description: "Bills and health costs were higher than this month.", evidence: [{ label: "Living", amount: -284 }, { label: "Health", amount: -142 }, { label: "Tech", amount: -84 }] },
      { id: "other", label: "Other spending", lines: ["Other", "spending"], amount: -330, kind: "expense", transactionCount: 16, description: "The remaining small categories are grouped to keep the comparison readable.", evidence: [{ label: "Presents", amount: -126 }, { label: "Drugstore", amount: -93 }, { label: "Other categories", amount: -111 }] },
    ],
  },
  "this-year": {
    label: "This year",
    dateRange: "1 Jan–15 Aug 2026",
    steps: [
      { id: "salary", label: "Salary", lines: ["Salary"], amount: 26000, kind: "income", transactionCount: 8, description: "Salary supplied most recorded income this year.", evidence: [{ label: "Acme GmbH · 8 deposits", amount: 26000 }] },
      { id: "bank-transfer", label: "Bank transfer", lines: ["Bank", "transfer"], amount: 8400, kind: "income", transactionCount: 22, description: "Incoming transfers formed the second-largest income source.", evidence: [{ label: "Shared costs", amount: 5620 }, { label: "Reimbursements", amount: 1880 }, { label: "Other transfers", amount: 900 }] },
      { id: "paypal", label: "PayPal", lines: ["PayPal"], amount: 880, kind: "income", transactionCount: 17, description: "PayPal refunds and receipts made a small contribution.", evidence: [{ label: "Refunds", amount: 631 }, { label: "Other receipts", amount: 249 }] },
      { id: "groceries", label: "Groceries", lines: ["Groceries"], amount: -11250, kind: "expense", transactionCount: 176, description: "Groceries caused the largest yearly fall in the running balance.", evidence: [{ label: "Supermarkets", amount: -9650 }, { label: "Markets", amount: -930 }, { label: "Other groceries", amount: -670 }] },
      { id: "food-dining", label: "Food & dining", lines: ["Food &", "dining"], amount: -7040, kind: "expense", transactionCount: 118, description: "Food, restaurants, and cafés formed the second-largest expense group.", evidence: [{ label: "Restaurants", amount: -3810 }, { label: "Food", amount: -2190 }, { label: "Cafés", amount: -1040 }] },
      { id: "free-time-travel", label: "Free time & travel", lines: ["Free time", "& travel"], amount: -5280, kind: "expense", transactionCount: 63, description: "Travel and leisure reduced the yearly balance by €5,280.", evidence: [{ label: "Travel", amount: -2940 }, { label: "Free time", amount: -1590 }, { label: "Entertainment", amount: -750 }] },
      { id: "bills-health", label: "Bills & health", lines: ["Bills &", "health"], amount: -6120, kind: "expense", transactionCount: 91, description: "Recurring bills, tech, and health costs made a steady reduction.", evidence: [{ label: "Living", amount: -3420 }, { label: "Health", amount: -1660 }, { label: "Tech", amount: -1040 }] },
      { id: "other", label: "Other spending", lines: ["Other", "spending"], amount: -4650, kind: "expense", transactionCount: 144, description: "Small categories are grouped to keep the yearly comparison readable.", evidence: [{ label: "Presents", amount: -1620 }, { label: "Drugstore", amount: -1280 }, { label: "Other categories", amount: -1750 }] },
    ],
  },
};

const currency = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currency.format(Math.abs(value));
}

function formatSigned(value: number) {
  if (value === 0) return currency.format(0);
  return `${value > 0 ? "+" : "−"}${formatCurrency(value)}`;
}

const navigation = [
  { label: "OVERVIEW", items: [["Dashboard", <SquaresFour />], ["Transactions", <ListBullets />], ["Budgets", <Wallet />], ["Forecast", <ChartLineUp />]] },
  { label: "UNDERSTAND", items: [["Insights", <ChartBar />], ["Digest", <Newspaper />], ["Assistant", <ChatCircleDots />]] },
  { label: "MANAGE", items: [["Recurring", <ArrowsClockwise />], ["Templates", <Lightning />], ["Rules", <Sparkle />], ["Categories", <Shapes />], ["Tags", <Tag />]] },
  { label: "SYSTEM", items: [["What If", <Flask />], ["Reconcile", <Bank />], ["Reports", <FileText />], ["Settings", <GearSix />]] },
] as const;

type ChartStep = FlowStep | {
  id: "result";
  label: string;
  lines: string[];
  amount: number;
  kind: "result";
  transactionCount: number;
  description: string;
  evidence: EvidenceRow[];
};

type PlottedStep = ChartStep & {
  start: number;
  end: number;
  x: number;
  top: number;
  bottom: number;
};

type BalancedStep = ChartStep & {
  start: number;
  end: number;
};

function buildWaterfallSequence(data: PeriodData): BalancedStep[] {
  const income = data.steps.filter((step) => step.kind === "income").reduce((sum, step) => sum + step.amount, 0);
  const spending = Math.abs(data.steps.filter((step) => step.kind === "expense").reduce((sum, step) => sum + step.amount, 0));
  const net = income - spending;
  const allSteps: ChartStep[] = [
    ...data.steps,
    {
      id: "result",
      label: "Net",
      lines: ["Net"],
      amount: net,
      kind: "result",
      transactionCount: data.steps.reduce((sum, step) => sum + step.transactionCount, 0),
      description: `Income exceeded spending by ${formatCurrency(net)}. This is the actual change recorded for the period.`,
      evidence: [],
    },
  ];

  let running = 0;
  return allSteps.map((step) => {
    if (step.kind === "result") return { ...step, start: 0, end: net };
    const start = running;
    running += step.amount;
    return { ...step, start, end: running };
  });
}

function formatAxisValue(value: number) {
  if (value === 0) return "€0";
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1000) {
    const thousands = absolute / 1000;
    return `${sign}€${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return `${sign}€${Math.round(absolute)}`;
}

function WaterfallChart({
  data,
  selectedId,
  onSelect,
}: {
  data: PeriodData;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ id: string; visible: boolean } | null>(null);
  const width = 1040;
  const height = 430;
  const margin = { top: 48, right: 18, bottom: 82, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const barWidth = 66;
  const sequence = buildWaterfallSequence(data);
  const maximum = Math.max(0, ...sequence.flatMap((step) => [step.start, step.end]));
  const minimum = Math.min(0, ...sequence.flatMap((step) => [step.start, step.end]));
  const tickSize = maximum > 12000 ? 10000 : maximum > 6000 ? 2000 : 1000;
  const domainMax = Math.ceil(maximum / tickSize) * tickSize;
  const domainMin = Math.floor(minimum / tickSize) * tickSize;
  const domain = Math.max(1, domainMax - domainMin);
  const y = (value: number) => margin.top + ((domainMax - value) / domain) * plotHeight;
  const slot = plotWidth / sequence.length;
  const plotted: PlottedStep[] = sequence.map((step, index) => ({
    ...step,
    x: margin.left + index * slot + (slot - barWidth) / 2,
    top: Math.min(y(step.start), y(step.end)),
    bottom: Math.max(y(step.start), y(step.end)),
  }));
  const ticks: number[] = [];
  for (let value = domainMin; value <= domainMax; value += tickSize) ticks.push(value);
  const tooltipStep = plotted.find((step) => step.id === tooltip?.id);

  const showTooltip = (id: string) => setTooltip({ id, visible: true });
  const hideTooltip = () => setTooltip((current) => (current ? { ...current, visible: false } : null));

  const activate = (step: PlottedStep) => onSelect(step.id);

  return (
    <div className="waterfall-wrap desktop-waterfall">
      <svg
        className="waterfall-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="waterfall-title waterfall-description"
      >
        <title id="waterfall-title">Income and spending chart for {data.label.toLowerCase()}</title>
        <desc id="waterfall-description">
          Income increases the running balance. Expense groups reduce it. The last bar shows net movement.
        </desc>

        {ticks.map((tick) => (
          <g key={tick} className="chart-gridline">
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text x={margin.left - 14} y={y(tick) + 4} textAnchor="end">
              {tick === 0 ? "€0" : `€${Math.abs(tick / 1000)}k`}
            </text>
          </g>
        ))}

        {plotted.slice(0, -1).map((step, index) => {
          const next = plotted[index + 1];
          return (
            <line
              key={`${step.id}-connector`}
              className="chart-connector"
              x1={step.x + barWidth}
              x2={next.x}
              y1={y(step.end)}
              y2={y(step.end)}
            />
          );
        })}

        {plotted.map((step, index) => {
          const barHeight = Math.max(3, step.bottom - step.top);
          const selected = selectedId === step.id;
          const valueY = Math.max(22, step.top - 13);
          return (
            <g
              key={step.id}
              className="chart-step"
              data-kind={step.kind}
              data-selected={selected ? "" : undefined}
              tabIndex={0}
              role="button"
              aria-pressed={selected}
              aria-label={`${step.label}: ${formatSigned(step.amount)}. Select for details.`}
              onClick={() => activate(step)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate(step);
                }
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") showTooltip(step.id);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") hideTooltip();
              }}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) showTooltip(step.id);
              }}
              onBlur={hideTooltip}
              style={{ "--step-index": index } as React.CSSProperties}
            >
              <rect
                className="chart-bar-focus"
                x={step.x - 5}
                y={step.top - 5}
                width={barWidth + 10}
                height={barHeight + 10}
                rx="8"
              />
              <rect
                className="chart-bar"
                x={step.x}
                y={step.top}
                width={barWidth}
                height={barHeight}
                rx="4"
              />
              <rect
                className="chart-hit-area"
                x={step.x - 8}
                y={margin.top - 16}
                width={barWidth + 16}
                height={plotHeight + 40}
              />
              {step.kind === "result" ? (
                <text className="chart-value" x={step.x + barWidth / 2} y={valueY} textAnchor="middle">
                  {formatSigned(step.amount)}
                </text>
              ) : null}
              <text className="chart-label" x={step.x + barWidth / 2} y={height - 42} textAnchor="middle">
                {step.lines.map((line, lineIndex) => (
                  <tspan key={line} x={step.x + barWidth / 2} dy={lineIndex === 0 ? 0 : 16}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        className="chart-tooltip"
        data-visible={tooltip?.visible && tooltipStep ? "" : undefined}
        aria-hidden={!tooltip?.visible}
        style={{
          left: `${tooltipStep ? ((tooltipStep.x + barWidth / 2) / width) * 100 : 50}%`,
          top: `${tooltipStep ? (Math.max(36, tooltipStep.top - 4) / height) * 100 : 50}%`,
        }}
      >
        <span>{tooltipStep?.label ?? ""}</span>
        <strong>{tooltipStep ? formatSigned(tooltipStep.amount) : ""}</strong>
        <small>{tooltipStep ? `Balance ${formatCurrency(tooltipStep.end)}` : ""}</small>
      </div>
    </div>
  );
}

function MobileWaterfallChart({
  data,
  selectedId,
  onSelect,
}: {
  data: PeriodData;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sequence = buildWaterfallSequence(data);
  const maximum = Math.max(0, ...sequence.flatMap((step) => [step.start, step.end]));
  const minimum = Math.min(0, ...sequence.flatMap((step) => [step.start, step.end]));
  const tickSize = maximum > 12000 ? 10000 : maximum > 6000 ? 2000 : 1000;
  const domainMax = Math.ceil(maximum / tickSize) * tickSize;
  const domainMin = Math.floor(minimum / tickSize) * tickSize;
  const domain = Math.max(1, domainMax - domainMin);
  const position = (value: number) => ((value - domainMin) / domain) * 100;
  const middle = domainMin < 0 && domainMax > 0 ? 0 : domainMin + domain / 2;
  const ticks = [domainMin, middle, domainMax];

  return (
    <div className="mobile-waterfall" aria-labelledby="mobile-waterfall-title">
      <p id="mobile-waterfall-title" className="sr-only">
        Income and spending chart for {data.label.toLowerCase()}. Income increases the running balance, expense groups reduce it, and the last row shows the net result.
      </p>

      <div className="mobile-waterfall-scale" aria-hidden="true">
        <span>Balance</span>
        <div>
          {ticks.map((tick, index) => (
            <span
              key={`${tick}-${index}`}
              data-edge={index === 0 ? "start" : index === ticks.length - 1 ? "end" : undefined}
              style={{ left: `${position(tick)}%` }}
            >
              {formatAxisValue(tick)}
            </span>
          ))}
        </div>
      </div>

      <div className="mobile-waterfall-body">
        <div className="mobile-waterfall-guides" aria-hidden="true">
          {ticks.map((tick, index) => (
            <i key={`${tick}-${index}`} style={{ left: `${position(tick)}%` }} />
          ))}
        </div>

        {sequence.map((step, index) => {
          const left = position(Math.min(step.start, step.end));
          const width = Math.abs(position(step.end) - position(step.start));
          const end = position(step.end);
          const selected = selectedId === step.id;
          return (
            <button
              key={step.id}
              type="button"
              className="chart-step mobile-chart-step"
              data-kind={step.kind}
              data-selected={selected ? "" : undefined}
              aria-pressed={selected}
              aria-label={`${step.label}: ${formatSigned(step.amount)}. Balance after this step: ${formatSigned(step.end)}. Select for details.`}
              onClick={() => onSelect(step.id)}
              style={{
                "--bar-left": `${left}%`,
                "--bar-width": `${width}%`,
                "--bar-end": `${end}%`,
                "--step-index": index,
              } as React.CSSProperties}
            >
              <span className="mobile-step-copy">
                <strong>{step.label}</strong>
                <small data-kind={step.kind}>{formatSigned(step.amount)}</small>
              </span>
              <span className="mobile-step-plot" aria-hidden="true">
                <i className="mobile-chart-bar" />
                <i className="mobile-chart-endpoint" />
                {index < sequence.length - 1 ? <i className="mobile-chart-connector" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CashBridgeIcon({ kind }: { kind: StepKind }) {
  if (kind === "income") return <ChartLineUp aria-hidden="true" />;
  if (kind === "expense") return <Basket aria-hidden="true" />;
  return <CheckCircle aria-hidden="true" />;
}

function FlowDataTable({ data, net, className }: { data: PeriodData; net: number; className?: string }) {
  return (
    <table className={className}>
      <caption>Income and spending data for {data.dateRange}</caption>
      <thead><tr><th scope="col">Step</th><th scope="col">Amount</th></tr></thead>
      <tbody>
        {data.steps.map((step) => <tr key={step.id}><td>{step.label}</td><td>{formatSigned(step.amount)}</td></tr>)}
        <tr><td>Net</td><td>{formatSigned(net)}</td></tr>
      </tbody>
    </table>
  );
}

export function CashBridgeVariant() {
  const [period, setPeriod] = useState<PeriodKey>("this-month");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState("groceries");
  const [dataOpen, setDataOpen] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const dataTriggerRef = useRef<HTMLButtonElement>(null);
  const dataCloseRef = useRef<HTMLButtonElement>(null);
  const data = periodData[period];

  const summary = useMemo(() => {
    const income = data.steps.filter((step) => step.kind === "income").reduce((sum, step) => sum + step.amount, 0);
    const spending = Math.abs(data.steps.filter((step) => step.kind === "expense").reduce((sum, step) => sum + step.amount, 0));
    return { income, spending, net: income - spending };
  }, [data]);

  const selected: ChartStep = detailId === "result"
    ? {
        id: "result",
        label: "Net",
        lines: ["Net"],
        amount: summary.net,
        kind: "result",
        transactionCount: data.steps.reduce((sum, step) => sum + step.transactionCount, 0),
        description: `You kept ${Math.round((summary.net / summary.income) * 100)}% of recorded income in this period.`,
        evidence: [],
      }
    : data.steps.find((step) => step.id === detailId) ?? data.steps[0];
  const shareBase = selected.kind === "income" ? summary.income : selected.kind === "expense" ? summary.spending : summary.income;
  const shareLabel = selected.kind === "result" ? "Income kept" : selected.kind === "income" ? "Share of income" : "Share of spending";
  const share = Math.round((Math.abs(selected.amount) / shareBase) * 100);

  useEffect(() => {
    if (!dataOpen) return;

    const focusFrame = requestAnimationFrame(() => dataCloseRef.current?.focus());
    const compact = window.matchMedia("(max-width: 760px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (compact) document.body.style.overflow = "hidden";

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!dataMenuRef.current?.contains(event.target as Node)) setDataOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDataOpen(false);
        requestAnimationFrame(() => dataTriggerRef.current?.focus());
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      if (compact) document.body.style.overflow = previousOverflow;
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dataOpen]);

  return (
    <div className="prototype-page">
      <aside className="app-sidebar" aria-label="Application navigation preview">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          <strong>Expenses</strong>
        </div>

        <div className="nav-groups">
          {navigation.map((group) => (
            <section key={group.label} className="nav-group">
              <p>{group.label}</p>
              {group.items.map(([label, icon]) => (
                <div key={label} className="nav-row" data-active={label === "Insights" ? "" : undefined}>
                  {icon}
                  <span>{label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="profile-card">
          <span>J</span>
          <div><strong>janishahn</strong><small>Administrator</small></div>
        </div>
      </aside>

      <main
        className="insights-main"
        onPointerDown={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest(".chart-step, button, select, .evidence-panel")) return;
          setSelectedId(null);
          if (document.activeElement instanceof Element && document.activeElement.matches(".chart-step")) {
            (document.activeElement as HTMLElement).blur();
          }
        }}
      >
        <header className="page-header">
          <div>
            <span className="page-kicker">UNDERSTAND</span>
            <h1>Insights</h1>
          </div>
          <label className="period-control">
            <span>Period</span>
            <select
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as PeriodKey);
                setSelectedId(null);
                setDetailId("groceries");
                setDataOpen(false);
              }}
            >
              {Object.entries(periodData).map(([value, option]) => (
                <option key={value} value={value}>{option.label}</option>
              ))}
            </select>
          </label>
        </header>

        <section className="net-section">
          <header className="net-header">
            <div className="net-heading">
              <h2>Income &amp; spending</h2>
              <span>{data.dateRange}<i aria-hidden="true">·</i>Recorded totals</span>
            </div>
            <div className="chart-actions">
              <div className="chart-legend" aria-label="Chart legend">
                <span><i className="legend-dot income" />Income</span>
                <span><i className="legend-dot expense" />Spending</span>
                <span><i className="legend-dot result" />Net</span>
              </div>
              <div ref={dataMenuRef} className="data-menu">
                <button
                  ref={dataTriggerRef}
                  type="button"
                  className="data-trigger"
                  aria-label="View as table"
                  aria-expanded={dataOpen}
                  aria-controls="net-data-popover"
                  onClick={() => setDataOpen((open) => !open)}
                >
                  <FileText aria-hidden="true" />
                </button>
                <span className="data-trigger-tooltip" role="tooltip">View as table</span>
                <button
                  type="button"
                  className="data-backdrop"
                  data-open={dataOpen ? "" : undefined}
                  aria-label="Close chart data"
                  tabIndex={dataOpen ? 0 : -1}
                  onClick={() => {
                    setDataOpen(false);
                    requestAnimationFrame(() => dataTriggerRef.current?.focus());
                  }}
                />
                <div
                  id="net-data-popover"
                  className="data-popover"
                  data-open={dataOpen ? "" : undefined}
                  role="dialog"
                  aria-label="Chart data"
                  aria-hidden={!dataOpen}
                >
                  <div className="data-popover-header">
                    <div><strong>Chart data</strong><span>{data.dateRange}</span></div>
                    <button
                      ref={dataCloseRef}
                      type="button"
                      aria-label="Close chart data"
                      tabIndex={dataOpen ? 0 : -1}
                      onClick={() => {
                        setDataOpen(false);
                        requestAnimationFrame(() => dataTriggerRef.current?.focus());
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <FlowDataTable data={data} net={summary.net} />
                  <p>Recorded totals only. Expenses are not assigned to income sources.</p>
                </div>
              </div>
            </div>
          </header>

          <div className="net-layout">
            <div className="chart-column">
              <WaterfallChart
                data={data}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setDetailId(id);
                }}
              />
              <MobileWaterfallChart
                data={data}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setDetailId(id);
                }}
              />
              <FlowDataTable data={data} net={summary.net} className="sr-only" />
            </div>

            <aside className="evidence-panel" aria-live="polite">
              <div className="evidence-heading">
                <span className={`evidence-icon ${selected.kind}`}><CashBridgeIcon kind={selected.kind} /></span>
                <div>
                  <h3>{selected.label}</h3>
                  <span>{selected.kind === "income" ? "INCOME SOURCE" : selected.kind === "expense" ? "EXPENSE GROUP" : "PERIOD RESULT"}</span>
                </div>
              </div>

              <strong className={`evidence-amount ${selected.kind}`}>{formatSigned(selected.amount)}</strong>

              <dl className="evidence-metrics">
                <div><dt>{shareLabel}</dt><dd>{share}%</dd></div>
                <div><dt>Records</dt><dd>{selected.transactionCount}</dd></div>
              </dl>

              {selected.kind === "result" ? (
                <div className="result-breakdown">
                  <div><span><ChartLineUp />Income</span><strong>{formatCurrency(summary.income)}</strong></div>
                  <div><span><ForkKnife />Spending</span><strong>−{formatCurrency(summary.spending)}</strong></div>
                  <div><span><House />Kept</span><strong>{formatSigned(summary.net)}</strong></div>
                </div>
              ) : (
                <div className="evidence-list">
                  <span className="evidence-list-title">BREAKDOWN</span>
                  {selected.evidence.map((row) => (
                    <div key={row.label}>
                      <span>{row.label}</span>
                      <strong>{formatSigned(row.amount)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
