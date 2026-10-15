import { ChevronDown, CircleCheck, CopyCheck, Info, ScanText, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { dateOf, formatDay } from "../../../shared/dates.ts";
import { formatCents, parseMoneyInput } from "../../../shared/money.ts";
import { mergeScans, type ScanResponse } from "../../../shared/scan.ts";
import type { TransactionKind } from "../../../shared/transactions.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog } from "../../components/ui/Dialog.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useBillsIncome } from "../billsIncome/api.ts";
import { useImportTransactions } from "../transactions/api.ts";
import { useScanScreenshot } from "./api.ts";
import { type Draft, draftsFromRows, importRows, problemWith, wantsALook, withDryRun } from "./review.ts";

type ScanImportDialogProps = {
  open: boolean;
  /** The screenshots picked, read one after another as soon as the dialog opens. */
  files: readonly File[];
  onClose: () => void;
};

/**
 * Importing transactions from screenshots of a bank's list: each picture is read on the
 * server while an animated scan plays over it, then everything found is listed for review.
 */
export function ScanImportDialog({ open, files, onClose }: ScanImportDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Import from screenshots" size="full">
      <ScanImport files={files} onClose={onClose} />
    </Dialog>
  );
}

type Stage = { step: "reading"; index: number } | { step: "checking" } | { step: "review" };
const kindOptions = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
] as const satisfies ReadonlyArray<{ value: TransactionKind; label: string }>;

const errorMessage = (error: unknown) => (error instanceof ApiError ? error.message : "Something went wrong.");

function ScanImport({ files, onClose }: { files: readonly File[]; onClose: () => void }) {
  const toast = useToast();
  const scanOne = useScanScreenshot();
  const importer = useImportTransactions();
  const [stage, setStage] = useState<Stage>({ step: "reading", index: 0 });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const started = useRef(false);

  // Links the pictures can be shown by, let go of when the dialog closes.
  useEffect(() => {
    const made = files.map((file) => URL.createObjectURL(file));
    setUrls(made);
    return () => made.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  // Read each picture in turn, then ask the server what importing them would do.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const found: ScanResponse["rows"][] = [];
      const failed: string[] = [];
      const said = new Set<string>();
      for (const [index, file] of files.entries()) {
        setStage({ step: "reading", index });
        try {
          const result = await scanOne.mutateAsync(file);
          found.push(result.rows);
          if (result.notice) said.add(result.notice);
        } catch (error) {
          failed.push(`${files.length > 1 ? `Screenshot ${index + 1}: ` : ""}${errorMessage(error)}`);
        }
      }
      setFailures(failed);
      setNotices([...said]);
      let next = draftsFromRows(mergeScans(found));
      const { rows, keys } = importRows(next, () => true);
      if (rows.length > 0) {
        setStage({ step: "checking" });
        try {
          next = withDryRun(next, keys, await importer.mutateAsync({ dryRun: true, addEarlierPeriods: true, transactions: rows }));
        } catch {
          // Without the check the rows can still be reviewed; duplicates just aren't pointed out.
          setNotices((current) => [...current, "Couldn't check these against your budget, so possible duplicates aren't marked."]);
        }
      }
      setDrafts(next);
      setStage({ step: "review" });
    })();
    // Runs once, for the pictures the dialog was opened with.
  }, []);

  if (stage.step !== "review") {
    const index = stage.step === "reading" ? stage.index : files.length - 1;
    return (
      <Processing
        image={urls[index]}
        title={stage.step === "reading" ? `Reading screenshot ${index + 1} of ${files.length}` : "Checking against your budget"}
        step={stage.step === "reading" ? index : files.length}
        total={files.length}
      />
    );
  }

  const ticked = drafts.filter((draft) => draft.include);
  const blocked = ticked.filter((draft) => problemWith(draft) !== null);
  const update = (key: string, change: Partial<Draft>) =>
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));
  const tickAll = (include: boolean) =>
    setDrafts((current) => current.map((draft) => (draft.skipped === "held" ? draft : { ...draft, include })));

  const runImport = async () => {
    setImportError(null);
    const { rows } = importRows(drafts, (draft) => draft.include);
    try {
      const result = await importer.mutateAsync({
        addEarlierPeriods: true,
        // A row the person ticked although it was imported once and deleted is wanted back.
        restoreDeleted: ticked.some((draft) => draft.skipped === "deleted"),
        transactions: rows,
      });
      toast(`Imported ${result.created} transaction${result.created === 1 ? "" : "s"}`);
      onClose();
    } catch (error) {
      setImportError(errorMessage(error));
    }
  };

  return (
    <div className="flex min-h-full flex-col gap-4">
      {failures.map((failure) => (
        <Alert key={failure}>{failure}</Alert>
      ))}
      {notices.map((notice) => (
        <Alert key={notice} tone="warning">
          {notice}
        </Alert>
      ))}

      {drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <ScanText className="size-10 text-muted" aria-hidden />
          <p className="font-semibold">No transactions found</p>
          <p className="max-w-sm text-sm text-muted">
            Try a screenshot of the list itself, with each transaction&rsquo;s amount showing, and as little else as you can.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-sm text-muted">
              Found {drafts.length} transaction{drafts.length === 1 ? "" : "s"}. {ticked.length} ticked to import.
            </p>
            <div className="flex gap-1">
              <button type="button" className={linkButton} onClick={() => tickAll(true)}>
                Tick all
              </button>
              <button type="button" className={linkButton} onClick={() => tickAll(false)}>
                Untick all
              </button>
            </div>
          </div>
          <ul className="flex flex-col gap-3">
            {drafts.map((draft) => (
              <DraftRow key={draft.key} draft={draft} onChange={(change) => update(draft.key, change)} />
            ))}
          </ul>
        </>
      )}

      {/* Stays in reach at the foot of the tray however long the list. */}
      <div className="sticky bottom-0 mt-auto -mx-5 -mb-[calc(1.25rem+env(safe-area-inset-bottom))] border-t border-border bg-surface px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {importError && <p className="mb-2 text-sm text-danger">{importError}</p>}
        {blocked.length > 0 && (
          <p className="mb-2 text-sm text-danger">
            {blocked.length === 1 ? "One ticked transaction needs" : `${blocked.length} ticked transactions need`} a name, a date
            and an amount first.
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={runImport} loading={importer.isPending} disabled={ticked.length === 0 || blocked.length > 0}>
            Import {ticked.length}
          </Button>
        </div>
      </div>
    </div>
  );
}

const linkButton =
  "min-h-11 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The picture being read with a line sweeping down it, and how far along the reading is. */
function Processing({ image, title, step, total }: { image: string | undefined; title: string; step: number; total: number }) {
  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface-2">
        {image && <img src={image} alt="" className="block max-h-[45dvh] w-auto max-w-full object-contain opacity-70" />}
        <div aria-hidden className="scan-sweep pointer-events-none absolute inset-x-0 top-0 h-20 border-b-2 border-primary bg-linear-to-b from-transparent to-primary/30" />
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        <p className="font-semibold">{title}&hellip;</p>
        <p className="max-w-sm text-sm text-muted">The text is read on your own server. Nothing is saved until you choose what to import.</p>
      </div>
      {total > 1 && (
        <ol aria-hidden className="flex gap-2">
          {Array.from({ length: total }, (_, index) => (
            <li key={index} className={cn("size-2 rounded-full", index < step ? "bg-primary" : index === step ? "animate-pulse bg-primary" : "bg-border")} />
          ))}
        </ol>
      )}
    </div>
  );
}

/** One found transaction: a tick box and a summary, opening to fields for fixing it. */
function DraftRow({ draft, onChange }: { draft: Draft; onChange: (change: Partial<Draft>) => void }) {
  const [open, setOpen] = useState(() => wantsALook(draft));
  const items = useBillsIncome();
  const choices = (items.data ?? []).filter((item) => !item.archived || item.id === draft.billIncomeId);
  const billName = choices.find((item) => item.id === draft.billIncomeId)?.name;
  const cents = parseMoneyInput(draft.amount);
  const problem = problemWith(draft);
  const held = draft.skipped === "held";

  const notes: Array<{ icon: ReactNode; text: string; tone: "warning" | "muted" }> = [];
  if (held) notes.push({ icon: <CopyCheck className="size-4" />, text: "Already imported from a screenshot before.", tone: "muted" });
  if (draft.skipped === "deleted") {
    notes.push({ icon: <Info className="size-4" />, text: "Imported before and then deleted. Tick it to bring it back.", tone: "muted" });
  }
  if (draft.duplicate) {
    const { existing, daysApart } = draft.duplicate;
    notes.push({
      icon: <TriangleAlert className="size-4 text-warning" />,
      text: `May already be in your budget: ${existing.name}, ${formatCents(Math.abs(existing.amountCents))}, ${formatDay(dateOf(existing.occursAt))}${daysApart ? ` (${daysApart} day${daysApart === 1 ? "" : "s"} apart)` : ""}.`,
      tone: "warning",
    });
  }
  if (draft.flags.includes("hard_to_read")) {
    notes.push({ icon: <TriangleAlert className="size-4 text-warning" />, text: "Hard to read. Check the name and the amount.", tone: "warning" });
  }
  if (draft.flags.includes("no_date") && !draft.date) {
    notes.push({ icon: <TriangleAlert className="size-4 text-warning" />, text: "No date could be read. Give it one to import it.", tone: "warning" });
  }
  if (draft.suggestion && draft.billIncomeId === draft.suggestion.billIncomeId) {
    notes.push({
      icon: <CircleCheck className="size-4 text-primary" />,
      text: draft.countsToward
        ? `Pays the upcoming ${draft.suggestion.billIncomeName} entry.`
        : `Looks like ${draft.suggestion.billIncomeName}.`,
      tone: "muted",
    });
  }

  return (
    <li className={cn("rounded-xl border p-3", draft.include ? "border-primary/50" : "border-border")}>
      <div className="flex items-start gap-1">
        <label className="-m-1 flex size-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={draft.include}
            disabled={held}
            onChange={(event) => onChange({ include: event.target.checked })}
            aria-label={`Import ${draft.name || "this transaction"}`}
          />
        </label>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className={cn("truncate font-medium", !draft.name && "text-muted italic")}>{draft.name || "No name"}</span>
              <span className={cn("shrink-0 font-semibold tabular-nums", draft.kind === "income" ? "text-primary" : "text-fg")}>
                {cents === null ? "?" : formatCents(draft.kind === "income" ? cents : -cents, { showPlus: draft.kind === "income" })}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-sm text-muted">
              {draft.date ? formatDay(draft.date) : "No date"}
              {billName && ` · ${billName}`}
              {draft.balanceCents !== null && ` · balance ${formatCents(draft.balanceCents)}`}
            </span>
          </span>
          <ChevronDown className={cn("mt-1 size-5 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>

      {notes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 pl-10 text-sm">
          {notes.map((note) => (
            <li key={note.text} className={cn("flex items-start gap-1.5", note.tone === "warning" ? "text-fg" : "text-muted")}>
              <span className="mt-0.5 shrink-0" aria-hidden>
                {note.icon}
              </span>
              {note.text}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-3 pl-10">
          <TextField label="Name" value={draft.name} maxLength={100} autoComplete="off" onChange={(event) => onChange({ name: event.target.value })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Date" type="date" value={draft.date} onChange={(event) => onChange({ date: event.target.value })} />
            <TextField
              label="Amount"
              inputMode="decimal"
              value={draft.amount}
              onChange={(event) => onChange({ amount: event.target.value })}
            />
          </div>
          <SegmentedControl label="Type" options={kindOptions} value={draft.kind} onChange={(kind) => onChange({ kind })} />
          {choices.length > 0 && (
            <SelectField
              label="Bill or income"
              options={[{ value: "", label: "None" }, ...choices.map((item) => ({ value: item.id, label: item.name }))]}
              value={draft.billIncomeId}
              onChange={(event) => onChange({ billIncomeId: event.target.value })}
            />
          )}
          {problem && <p className="text-sm text-danger">{problem}</p>}
        </div>
      )}
    </li>
  );
}
