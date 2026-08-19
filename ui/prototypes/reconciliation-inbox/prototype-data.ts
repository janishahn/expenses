export type Candidate = {
  id: number
  title: string
  date: string
  category: string
  description: string
  amountCents: number
}

export type InboxItem = {
  id: string
  bankTitle: string
  rawDescription: string
  bookingDate: string
  valueDate: string
  amountCents: number
  status: "suggested" | "missing" | "ambiguous"
  suggestion?: Candidate
  candidates?: Candidate[]
  draft: Candidate
}

const lidl: Candidate = {
  id: 431,
  title: "Groceries — Lidl",
  date: "2026-08-14",
  category: "Groceries",
  description: "Weekly groceries",
  amountCents: 4267,
}

const aral: Candidate = {
  id: 426,
  title: "Fuel — Aral",
  date: "2026-08-11",
  category: "Transport",
  description: "Filled up before the trip",
  amountCents: 6819,
}

export const inboxItems: InboxItem[] = [
  {
    id: "lidl",
    bankTitle: "LIDL SAGT DANKE 4572",
    rawDescription: "Kartenzahlung · LIDL SAGT DANKE 4572 · BERLIN · 14.08.2026",
    bookingDate: "2026-08-15",
    valueDate: "2026-08-14",
    amountCents: -4267,
    status: "suggested",
    suggestion: lidl,
    candidates: [
      lidl,
      {
        id: 429,
        title: "Weekly groceries",
        date: "2026-08-12",
        category: "Groceries",
        description: "Rewe and Lidl",
        amountCents: 4267,
      },
    ],
    draft: lidl,
  },
  {
    id: "db",
    bankTitle: "DB VERTRIEB GMBH",
    rawDescription: "SEPA-Lastschrift · DB VERTRIEB GMBH · KUNDENNR 71402819 · DEUTSCHLAND-TICKET",
    bookingDate: "2026-08-15",
    valueDate: "2026-08-15",
    amountCents: -5890,
    status: "missing",
    draft: {
      id: 0,
      title: "DB VERTRIEB GMBH",
      date: "2026-08-15",
      category: "Uncategorized",
      description: "SEPA-Lastschrift · KUNDENNR 71402819 · DEUTSCHLAND-TICKET",
      amountCents: 5890,
    },
  },
  {
    id: "amazon",
    bankTitle: "AMAZON EU S.A R.L.",
    rawDescription: "Online-Zahlung · AMAZON EU S.A R.L. · AMAZON.DE/PMTS · 2R8A39KM",
    bookingDate: "2026-08-14",
    valueDate: "2026-08-14",
    amountCents: -2349,
    status: "ambiguous",
    candidates: [
      {
        id: 428,
        title: "USB-C cable",
        date: "2026-08-13",
        category: "Electronics",
        description: "For travel bag",
        amountCents: 2349,
      },
      {
        id: 423,
        title: "Kitchen storage",
        date: "2026-08-11",
        category: "Household",
        description: "Two glass containers",
        amountCents: 2349,
      },
    ],
    draft: {
      id: 0,
      title: "AMAZON EU S.A R.L.",
      date: "2026-08-14",
      category: "Uncategorized",
      description: "Online-Zahlung · AMAZON.DE/PMTS · 2R8A39KM",
      amountCents: 2349,
    },
  },
  {
    id: "aral",
    bankTitle: "ARAL STATION 420173",
    rawDescription: "Kartenzahlung · ARAL STATION 420173 · BERLIN · 11.08.2026",
    bookingDate: "2026-08-12",
    valueDate: "2026-08-11",
    amountCents: -6819,
    status: "suggested",
    suggestion: aral,
    candidates: [aral],
    draft: aral,
  },
]

export function euros(cents: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100)
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00`))
}
