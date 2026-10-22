import { useNavigate } from "react-router";
import { todayIn } from "../../../shared/dates.ts";
import type { BillOrIncome } from "../../../shared/billsIncome.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { canTrackBalance } from "../../../shared/balances.ts";
import { balancePath, useBalances } from "../balances/api.ts";
import { usePeriodList } from "../periods/api.ts";
import { RECENT_TRANSACTIONS, useRecentBillOrIncomeTransactions } from "./api.ts";
import { ItemTotals, ItemTransactionList, KIND_LABELS, shownAmount, signedUsualOf } from "./ItemTransactions.tsx";

type BillOrIncomeDetailDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Kept after closing so the dialog doesn't empty while it fades out. */
  item?: BillOrIncome;
  /** The budget's time zone, for "today". */
  timezone: string;
  onEdit: () => void;
};

/** One bill or income at a glance: its schedule, what has gone to it, and its latest transactions. */
export function BillOrIncomeDetailDialog({ open, onClose, item, timezone, onEdit }: BillOrIncomeDetailDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={item?.name ?? ""}>
      {item && <Detail item={item} timezone={timezone} onClose={onClose} onEdit={onEdit} />}
    </Dialog>
  );
}

function Detail({ item, timezone, onClose, onEdit }: Required<Omit<BillOrIncomeDetailDialogProps, "open">>) {
  const navigate = useNavigate();
  const recent = useRecentBillOrIncomeTransactions(item.id);
  const periods = usePeriodList(true);
  const today = todayIn(timezone, new Date());
  const more = recent.data ? recent.data.totals.count - recent.data.transactions.length : 0;
  const balances = useBalances();
  const tracked = Boolean(balances.data?.balances.some((balance) => balance.billIncomeId === item.id));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {KIND_LABELS[item.kind]} · {item.scheduleText}
        {item.defaultAmountCents > 0 && ` · ${shownAmount(signedUsualOf(item))}`}
        {item.archived && " · Archived"}
      </p>

      {recent.isPending ? (
        <div className="h-40 animate-pulse rounded-lg bg-surface-2" role="status" aria-label="Loading transactions" />
      ) : recent.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Alert>Couldn't load its transactions.</Alert>
          <Button variant="secondary" onClick={() => recent.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <ItemTotals totals={recent.data.totals} />
          {recent.data.transactions.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing yet. Transactions it adds, and ones you tie to it, show up here.
            </p>
          ) : (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-fg">
                {more > 0 ? `Latest ${RECENT_TRANSACTIONS}` : "Transactions"}
              </h3>
              <ItemTransactionList
                transactions={recent.data.transactions}
                periods={periods.data}
                today={today}
                onNavigate={onClose}
              />
            </div>
          )}
        </>
      )}

      <DialogActions>
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            onEdit();
          }}
        >
          Edit
        </Button>
        {canTrackBalance(item.kind) && balances.data && (!item.archived || tracked) && (
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              navigate(balancePath(item.id, tracked));
            }}
          >
            {tracked ? "Balance history" : "Track its balance"}
          </Button>
        )}
        {more > 0 ? (
          <Button
            data-autofocus
            onClick={() => {
              onClose();
              navigate(`/bills-income/${item.id}`);
            }}
          >
            All {recent.data?.totals.count} transactions
          </Button>
        ) : (
          <Button data-autofocus onClick={onClose}>
            Done
          </Button>
        )}
      </DialogActions>
    </div>
  );
}
