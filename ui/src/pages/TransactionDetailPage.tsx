import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { isApiErrorStatus } from "../app/api"
import type { TransactionRouteState } from "../app/api-types"
import { IconButton } from "../components/ui/Button"
import { Menu } from "../components/ui/Menu"
import { Panel, PanelError, PanelLoading } from "../components/ui/Panel"
import { FullView } from "../components/ui/Peek"
import { useTransactionRecord } from "./transaction-record"
import {
  TransactionHead,
  TransactionLocation,
  TransactionMenuItems,
  TransactionNotes,
  TransactionProperties,
  TransactionReceipts,
  TransactionReimbursements,
} from "./TransactionRecord"

// The peek's content at page width: the record and its editors on the left, the tracked
// details (location, receipts) on the right.
function TransactionDetailPage() {
  const { transactionId } = useParams()
  // Links to another transaction keep this route, so each record starts with fresh edit state.
  return <TransactionDetail key={transactionId} id={Number(transactionId)} />
}

function TransactionDetail({ id }: { id: number }) {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = location.state as TransactionRouteState | null
  const returnTo = routeState?.returnTo ?? "/transactions"
  const parents = [{ label: routeState?.returnLabel ?? "Transactions", to: returnTo }]
  const record = useTransactionRecord(id)
  const view = record.view
  const linkTo = (otherId: number) => `/transactions/${otherId}`

  if (!view) {
    if (record.query.isError) {
      const missing = isApiErrorStatus(record.query.error, 404)
      return (
        <PanelError
          title="Transaction"
          parents={parents}
          message={missing ? "Transaction not found." : "Unable to load transaction."}
          returnTo={missing ? { label: "Back to transactions", to: returnTo } : undefined}
        />
      )
    }
    return <PanelLoading title="Transaction" parents={parents} label="Loading transaction…" />
  }

  return (
    <Panel
      title={view.title}
      parents={parents}
      layout="fill"
      actions={
        <Menu label="More actions" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
          <TransactionMenuItems record={record} onDeleted={() => navigate(returnTo, { replace: true })} />
        </Menu>
      }
    >
      <FullView
        transaction
        main={
          <>
            <TransactionHead record={record} />
            <TransactionProperties record={record} linkTo={linkTo} variant="full" />
            <TransactionNotes record={record} />
            <TransactionReimbursements record={record} linkTo={linkTo} />
          </>
        }
        side={
          <>
            <TransactionLocation record={record} />
            <TransactionReceipts record={record} />
          </>
        }
      />
    </Panel>
  )
}

export default TransactionDetailPage
