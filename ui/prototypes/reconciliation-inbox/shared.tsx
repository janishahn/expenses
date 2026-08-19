import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight"
import { BankIcon } from "@phosphor-icons/react/Bank"
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle"
import { LinkSimpleIcon } from "@phosphor-icons/react/LinkSimple"
import { PlusIcon } from "@phosphor-icons/react/Plus"
import { ReceiptIcon } from "@phosphor-icons/react/Receipt"
import { UploadSimpleIcon } from "@phosphor-icons/react/UploadSimple"
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle"
import { XIcon } from "@phosphor-icons/react/X"
import { euros, inboxItems, shortDate, type Candidate, type InboxItem } from "./prototype-data"

export type InboxLayout = "clean" | "paired" | "compact"

type Notice = {
  itemId: string
  message: string
}

export function ReconciliationInbox({ layout }: { layout: InboxLayout }) {
  const [resolvedIds, setResolvedIds] = useState<string[]>([])
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const [createItem, setCreateItem] = useState<InboxItem | null>(null)
  const [matchItem, setMatchItem] = useState<InboxItem | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const removalTimer = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const openItems = useMemo(
    () => inboxItems.filter((item) => !resolvedIds.includes(item.id)),
    [resolvedIds]
  )

  useEffect(() => () => {
    if (removalTimer.current) window.clearTimeout(removalTimer.current)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
  }, [])

  const resolve = (item: InboxItem, message: string) => {
    setLeavingId(item.id)
    removalTimer.current = window.setTimeout(() => {
      setResolvedIds((current) => [...current, item.id])
      setLeavingId(null)
      setCreateItem(null)
      setMatchItem(null)
      setNotice({ itemId: item.id, message })
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
      noticeTimer.current = window.setTimeout(() => setNotice(null), 5000)
    }, 180)
  }

  const undo = () => {
    if (!notice) return
    setResolvedIds((current) => current.filter((id) => id !== notice.itemId))
    setNotice(null)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
  }

  const reset = () => {
    setResolvedIds([])
    setLeavingId(null)
    setNotice(null)
  }

  return (
    <PrototypeShell>
      <main className="page">
        <header className="page-title"><h1>Reconciliation</h1></header>
        <SessionFacts openCount={openItems.length} resolvedCount={resolvedIds.length} />
        <ImportPanel onReconcile={reset} />

        <section className={`inbox-surface inbox-${layout}`} aria-labelledby={`${layout}-inbox-title`}>
          <header className="inbox-heading">
            <h2 id={`${layout}-inbox-title`}>
              {openItems.length === 0 ? "Reconciliation complete" : `${openItems.length} item${openItems.length === 1 ? "" : "s"} to reconcile`}
            </h2>
            {openItems.length > 0 ? <span>Only items that need a decision</span> : null}
          </header>

          {openItems.length > 0 ? (
            <div className="inbox-list">
              {openItems.map((item) => (
                <InboxRow
                  key={item.id}
                  item={item}
                  layout={layout}
                  leaving={leavingId === item.id}
                  onMatch={() => {
                    if (item.suggestion) resolve(item, `Matched ${item.bankTitle} with ${item.suggestion.title}`)
                    else setMatchItem(item)
                  }}
                  onChoose={() => setMatchItem(item)}
                  onCreate={() => setCreateItem(item)}
                />
              ))}
            </div>
          ) : (
            <DoneState count={inboxItems.length} onReset={reset} />
          )}
        </section>
      </main>

      {notice ? (
        <div className="action-notice" role="status">
          <CheckCircleIcon weight="fill" />
          <span>{notice.message}</span>
          <button type="button" onClick={undo}>Undo</button>
        </div>
      ) : null}

      {createItem ? (
        <TransactionModal
          item={createItem}
          onClose={() => setCreateItem(null)}
          onSave={(candidate) => resolve(createItem, `Created and matched ${candidate.title}`)}
        />
      ) : null}

      {matchItem ? (
        <MatchModal
          item={matchItem}
          onClose={() => setMatchItem(null)}
          onMatch={(candidate) => resolve(matchItem, `Matched ${matchItem.bankTitle} with ${candidate.title}`)}
          onCreate={() => {
            setMatchItem(null)
            setCreateItem(matchItem)
          }}
        />
      ) : null}
    </PrototypeShell>
  )
}

function PrototypeShell({ children }: { children: ReactNode }) {
  return (
    <div className="prototype-shell">
      <aside className="app-sidebar" aria-label="Expenses navigation">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <strong>Expenses</strong>
        </div>
        <nav className="app-nav">
          <div><small>TRACK</small><span><ReceiptIcon />Dashboard</span><span><ReceiptIcon />Transactions</span><span data-active><BankIcon />Reconcile</span></div>
          <div><small>PLAN</small><span><ReceiptIcon />Budgets</span><span><ReceiptIcon />Forecast</span></div>
          <div><small>ORGANIZE</small><span><ReceiptIcon />Categories</span><span><ReceiptIcon />Rules</span></div>
        </nav>
        <div className="profile-card"><b>JH</b><span><strong>Janis</strong><small>Private workspace</small></span></div>
      </aside>
      <div className="workspace">
        <header className="mobile-bar">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <strong>Reconcile</strong>
        </header>
        {children}
      </div>
    </div>
  )
}

function SessionFacts({ openCount, resolvedCount }: { openCount: number; resolvedCount: number }) {
  return (
    <div className="session-facts" aria-label="Reconciliation summary">
      <span><b>14</b> imported</span>
      <i aria-hidden="true" />
      <span><b>{10 + resolvedCount}</b> matched</span>
      <i aria-hidden="true" />
      <span><b>{openCount}</b> remaining</span>
      <i aria-hidden="true" />
      <span><b>−€149.06</b> net</span>
    </div>
  )
}

function ImportPanel({ onReconcile }: { onReconcile: () => void }) {
  const inputId = useId()
  const [fileName, setFileName] = useState("Umsaetze_StartKonto_2026-08.csv")
  const [state, setState] = useState<"ready" | "working" | "done">("ready")

  const reconcile = () => {
    setState("working")
    window.setTimeout(() => {
      setState("done")
      onReconcile()
    }, 500)
  }

  return (
    <section className="import-panel" aria-label="Import bank statement">
      <div className="import-account">
        <span className="bank-tile"><BankIcon weight="bold" /></span>
        <label>
          <span>Account</span>
          <select defaultValue="StartKonto" aria-label="Account">
            <option>StartKonto</option>
            <option>Credit card</option>
          </select>
        </label>
      </div>
      <div className="file-control">
        <input
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={(event) => {
            setFileName(event.target.files?.[0]?.name ?? "No file selected")
            setState("ready")
          }}
        />
        <label htmlFor={inputId} title={fileName}><UploadSimpleIcon /><span>{fileName}</span></label>
      </div>
      <button className="button button-primary reconcile-button" type="button" onClick={reconcile} disabled={state === "working"}>
        {state === "working" ? "Reconciling…" : "Reconcile"}
        {state !== "working" ? <ArrowRightIcon /> : null}
      </button>
      {state === "done" ? <span className="import-confirmation"><CheckCircleIcon weight="fill" />File reconciled</span> : null}
    </section>
  )
}

function InboxRow({
  item,
  layout,
  leaving,
  onMatch,
  onChoose,
  onCreate,
}: {
  item: InboxItem
  layout: InboxLayout
  leaving: boolean
  onMatch: () => void
  onChoose: () => void
  onCreate: () => void
}) {
  const className = `inbox-row ${layout}-row ${leaving ? "is-leaving" : ""}`
  if (layout === "paired") {
    return (
      <article className={className}>
        <BankSide item={item} />
        <div className="pair-arrow" aria-hidden="true"><ArrowRightIcon /></div>
        <DecisionSide item={item} onMatch={onMatch} onChoose={onChoose} onCreate={onCreate} />
      </article>
    )
  }

  if (layout === "compact") {
    return (
      <article className={className}>
        <div className="compact-bank">
          <StatusLabel status={item.status} />
          <div className="compact-title"><strong>{item.bankTitle}</strong><span>{shortDate(item.bookingDate)} · {item.rawDescription}</span></div>
          <strong className="amount expense">{euros(item.amountCents)}</strong>
        </div>
        <CompactDecision item={item} onMatch={onMatch} onChoose={onChoose} onCreate={onCreate} />
      </article>
    )
  }

  return (
    <article className={className}>
      <div className="clean-bank">
        <div className="row-meta"><StatusLabel status={item.status} /><span>{shortDate(item.bookingDate)} booked · {shortDate(item.valueDate)} value</span></div>
        <div className="bank-title-line"><div><h3>{item.bankTitle}</h3><p>{item.rawDescription}</p></div><strong className="amount expense">{euros(item.amountCents)}</strong></div>
      </div>
      <DecisionSide item={item} onMatch={onMatch} onChoose={onChoose} onCreate={onCreate} />
    </article>
  )
}

function BankSide({ item }: { item: InboxItem }) {
  return (
    <div className="bank-side">
      <div className="row-meta"><StatusLabel status={item.status} /><span>{shortDate(item.bookingDate)} booked</span></div>
      <h3>{item.bankTitle}</h3>
      <p>{item.rawDescription}</p>
      <strong className="amount expense">{euros(item.amountCents)}</strong>
    </div>
  )
}

function StatusLabel({ status }: { status: InboxItem["status"] }) {
  const copy = status === "suggested" ? "Suggested" : status === "ambiguous" ? "Choose match" : "Not tracked"
  return <span className={`status-label ${status}`}>{copy}</span>
}

function DecisionSide({
  item,
  onMatch,
  onChoose,
  onCreate,
}: {
  item: InboxItem
  onMatch: () => void
  onChoose: () => void
  onCreate: () => void
}) {
  if (item.status === "suggested" && item.suggestion) {
    return (
      <div className="decision-side suggested-decision">
        <div className="decision-label"><LinkSimpleIcon weight="bold" />Suggested Expenses match</div>
        <CandidateSummary candidate={item.suggestion} />
        <div className="row-actions">
          <button className="button button-accent" type="button" onClick={onMatch}>Match</button>
          <button className="button button-quiet" type="button" onClick={onChoose}>Choose another</button>
        </div>
      </div>
    )
  }
  if (item.status === "ambiguous") {
    return (
      <div className="decision-side ambiguous-decision">
        <div className="decision-label"><WarningCircleIcon weight="fill" />Two possible matches</div>
        <p>Both Expenses transactions have the same amount and fall within five days.</p>
        <button className="button button-primary" type="button" onClick={onChoose}>Choose match</button>
      </div>
    )
  }
  return (
    <div className="decision-side missing-decision">
      <div><strong>No Expenses transaction found</strong><span>Create it with the bank details prefilled.</span></div>
      <button className="button button-primary" type="button" onClick={onCreate}><PlusIcon weight="bold" />Create new transaction</button>
    </div>
  )
}

function CompactDecision({
  item,
  onMatch,
  onChoose,
  onCreate,
}: {
  item: InboxItem
  onMatch: () => void
  onChoose: () => void
  onCreate: () => void
}) {
  if (item.status === "suggested" && item.suggestion) {
    return (
      <div className="compact-decision compact-suggestion">
        <span><LinkSimpleIcon weight="bold" />Suggested match</span>
        <CandidateSummary candidate={item.suggestion} />
        <div className="row-actions"><button className="button button-accent" onClick={onMatch}>Match</button><button className="button button-quiet" onClick={onChoose}>Other</button></div>
      </div>
    )
  }
  if (item.status === "ambiguous") {
    return (
      <div className="compact-decision compact-unresolved">
        <span><WarningCircleIcon weight="fill" />2 possible Expenses matches</span>
        <button className="button button-primary" type="button" onClick={onChoose}>Choose match</button>
      </div>
    )
  }
  return (
    <div className="compact-decision compact-unresolved">
      <span>No Expenses transaction found</span>
      <button className="button button-primary" type="button" onClick={onCreate}>Create new transaction</button>
    </div>
  )
}

function CandidateSummary({ candidate }: { candidate: Candidate }) {
  return (
    <div className="candidate-summary">
      <span className="category-tile"><ReceiptIcon weight="bold" /></span>
      <span><strong>{candidate.title}</strong><small>{shortDate(candidate.date)} · {candidate.category}</small></span>
      <b>{euros(-candidate.amountCents)}</b>
    </div>
  )
}

function TransactionModal({
  item,
  onClose,
  onSave,
}: {
  item: InboxItem
  onClose: () => void
  onSave: (candidate: Candidate) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(item.draft)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    const focusFrame = requestAnimationFrame(() => titleInputRef.current?.focus())
    return () => {
      cancelAnimationFrame(focusFrame)
      if (dialog?.open) dialog.close()
    }
  }, [])

  const update = (field: keyof Candidate, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby="create-transaction-title"
      aria-describedby="create-transaction-description"
      onCancel={(event) => {
        event.preventDefault()
        dialogRef.current?.close()
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
    >
      <form
        className="dialog-panel"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
        }}
      >
        <header className="dialog-header">
          <div><h2 id="create-transaction-title">Create transaction</h2><p id="create-transaction-description">Edit what Expenses will save. The bank record stays unchanged.</p></div>
          <button className="icon-button" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}><XIcon /></button>
        </header>

        <div className="bank-reference">
          <span><strong>{item.bankTitle}</strong><small>{shortDate(item.bookingDate)} booked</small></span>
          <b>{euros(item.amountCents)}</b>
        </div>

        <div className="form-grid">
          <label className="field field-title"><span>Title</span><input ref={titleInputRef} aria-label="Title" value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label className="field"><span>Transaction date</span><input aria-label="Transaction date" type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /><small>Bank booking: {shortDate(item.bookingDate)}</small></label>
          <label className="field"><span>Category</span><select aria-label="Category" value={draft.category} onChange={(event) => update("category", event.target.value)}><option>Uncategorized</option><option>Transport</option><option>Groceries</option><option>Shopping</option><option>Electronics</option><option>Household</option></select></label>
          <label className="field"><span>Amount</span><input aria-label="Amount" value={euros(item.amountCents)} readOnly /><small>Fixed to the bank record</small></label>
          <label className="field field-description"><span>Description <i>optional</i></span><textarea aria-label="Description" rows={3} value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
        </div>

        <footer className="dialog-footer">
          <button className="button button-quiet" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button className="button button-primary" type="submit"><PlusIcon weight="bold" />Create and match</button>
        </footer>
      </form>
    </dialog>
  )
}

function MatchModal({
  item,
  onClose,
  onMatch,
  onCreate,
}: {
  item: InboxItem
  onClose: () => void
  onMatch: (candidate: Candidate) => void
  onCreate: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstCandidateRef = useRef<HTMLButtonElement>(null)
  const candidates = item.candidates ?? []
  const [selectedId, setSelectedId] = useState(candidates[0]?.id)
  const selected = candidates.find((candidate) => candidate.id === selectedId)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    const focusFrame = requestAnimationFrame(() => firstCandidateRef.current?.focus())
    return () => {
      cancelAnimationFrame(focusFrame)
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog match-dialog"
      aria-labelledby="choose-match-title"
      onCancel={(event) => {
        event.preventDefault()
        dialogRef.current?.close()
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
    >
      <div className="dialog-panel">
        <header className="dialog-header">
          <div><h2 id="choose-match-title">Choose an Expenses transaction</h2><p>Match the bank record to the transaction you already entered.</p></div>
          <button className="icon-button" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}><XIcon /></button>
        </header>
        <div className="bank-reference"><span><strong>{item.bankTitle}</strong><small>{shortDate(item.bookingDate)} booked</small></span><b>{euros(item.amountCents)}</b></div>
        <div className="candidate-list" role="radiogroup" aria-label="Possible transactions">
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              ref={candidate === candidates[0] ? firstCandidateRef : undefined}
              type="button"
              className="candidate-option"
              role="radio"
              aria-checked={selectedId === candidate.id}
              data-selected={selectedId === candidate.id || undefined}
              onClick={() => setSelectedId(candidate.id)}
            >
              <span className="radio-dot" aria-hidden="true" />
              <CandidateSummary candidate={candidate} />
              <span className="candidate-description">{candidate.description}</span>
            </button>
          ))}
        </div>
        <footer className="dialog-footer split-footer">
          <button className="button button-quiet" type="button" onClick={onCreate}>Create new instead</button>
          <button className="button button-primary" type="button" disabled={!selected} onClick={() => selected && onMatch(selected)}><LinkSimpleIcon weight="bold" />Match selected</button>
        </footer>
      </div>
    </dialog>
  )
}

function DoneState({ count, onReset }: { count: number; onReset: () => void }) {
  return (
    <div className="done-state">
      <span><CheckCircleIcon weight="fill" /></span>
      <h3>Inbox cleared</h3>
      <p>{count} bank rows matched or created. Nothing needs your attention.</p>
      <button className="button button-primary" type="button" onClick={onReset}>Review another file</button>
    </div>
  )
}
