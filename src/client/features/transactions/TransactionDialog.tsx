import { zodResolver } from "@hookform/resolvers/zod";
import { Repeat, Search, Split } from "lucide-react";
import { useState } from "react";
import { Controller, type FieldPath, type UseFormRegisterReturn, type UseFormSetError, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import type { PeriodView } from "../../../shared/budget.ts";
import {
  atStartOfDay,
  dateOf,
  formatDateRange,
  formatDay,
  formatLongDate,
  formatMonthDay,
  isLocalDate,
  isLocalDateTime,
  type LocalDateTime,
  nowIn,
} from "../../../shared/dates.ts";
import { dueDatesAround } from "../../../shared/dueDates.ts";
import { centsToInput, formatCents, parseMoneyInput } from "../../../shared/money.ts";
import {
  laterTotal,
  MAX_SPLIT_LABEL,
  type SplitAddInput,
  type SplitSummary,
  type TransactionSplitInput,
  type TransactionSplitResponse,
} from "../../../shared/split.ts";
import {
  MAX_TRANSACTION_CENTS,
  type Transaction,
  type TransactionResponse,
  transactionInputSchema,
} from "../../../shared/transactions.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useDebouncedValue } from "../../lib/useDebouncedValue.ts";
import { applyApiError } from "../auth/formErrors.ts";
import { billOrIncomeDetailPath, useBillsIncome, useCreateBillOrIncome } from "../billsIncome/api.ts";
import { useCategories, useCreateCategory } from "../categories/api.ts";
import { ScreenshotPicker } from "../scan/ScreenshotPicker.tsx";
import { useAddToSplit, useAddToSplitPreview, useWaitingSplits } from "../splits/api.ts";
import { SkipPayment } from "../splits/SkipPayment.tsx";
import { useCreateTransaction, useDeleteTransaction, useSplitPreview, useSplitTransaction, useUpdateTransaction } from "./api.ts";
import { SplitItems, SplitPreview } from "./SplitFields.tsx";

const parseAmount = (text: string) => {
  const cents = parseMoneyInput(text);
  return cents !== null && cents > 0 && cents <= MAX_TRANSACTION_CENTS ? cents : null;
};

/** In the Category list: make a new category, named in a field that then appears. */
const NEW_CATEGORY = "__new__";
/** In the Transfer list: make a new transfer, likewise. */
const NEW_TRANSFER = "__new_transfer__";

const AMOUNT_HINT = "Enter an amount like 27.50";

// The server's rules for the fields it shares with this form, plus the form's own shapes
// for the amount (typed as text) and the optional extras.
const formSchema = transactionInputSchema.pick({ name: true, kind: true, occursAt: true }).extend({
  /** Splitting: several amounts with due dates instead of one amount. */
  split: z.boolean(),
  /** Used unless splitting. */
  amount: z.string(),
  /** Used when splitting: each amount, the date it is due by, and (with several) what it is. */
  items: z.array(
    z.object({
      label: z.string().max(MAX_SPLIT_LABEL, `Keep it under ${MAX_SPLIT_LABEL} characters`),
      amount: z.string(),
      dueDate: z.string(),
    }),
  ),
  /** When splitting: each item ends in the pay period before the one it is due in. */
  finishEarly: z.boolean(),
  /** When splitting: each pay period's payment rounds up to a multiple of $50. */
  roundUp: z.boolean(),
  /** When splitting: every item needs a name, even one alone (it joins a split that has some). */
  named: z.boolean(),
  note: z.string().max(500, "Keep the note under 500 characters"),
  paid: z.boolean(),
  /** The bill or income it belongs to; empty for none. */
  billIncomeId: z.string(),
  /** An upcoming entry of that bill or income which this pays toward; empty for none. */
  countsToward: z.string(),
  /** The category it is filed under; empty for none; NEW_CATEGORY for one named below. */
  categoryId: z.string(),
  /** The name of a category made as this is saved. */
  newCategory: z.string(),
  /** The name of a transfer made as this is saved. */
  newTransfer: z.string(),
  /** Paid late, for its item's due date before it. Used only while the item has a due date. */
  latePayment: z.boolean(),
}).superRefine(({ split, named: allNamed, amount, items, categoryId, newCategory, billIncomeId, newTransfer }, context) => {
  if (!split && parseAmount(amount) === null) context.addIssue({ code: "custom", path: ["amount"], message: AMOUNT_HINT });
  if (split) {
    for (const [index, item] of items.entries()) {
      const at = (field: string, message: string) => context.addIssue({ code: "custom", path: ["items", index, field], message });
      if (parseAmount(item.amount) === null) at("amount", AMOUNT_HINT);
      if (!isLocalDate(item.dueDate)) at("dueDate", "Enter the date it's due by");
      if ((items.length > 1 || allNamed) && !item.label.trim()) at("label", "Say what this one is");
    }
  }

  const named = (value: string, field: "newCategory" | "newTransfer", what: string, max: number) => {
    const name = value.trim();
    if (!name) context.addIssue({ code: "custom", path: [field], message: `Name the new ${what}` });
    else if (name.length > max) context.addIssue({ code: "custom", path: [field], message: `Keep the name under ${max} characters` });
  };
  if (categoryId === NEW_CATEGORY) named(newCategory, "newCategory", "category", 40);
  if (billIncomeId === NEW_TRANSFER) named(newTransfer, "newTransfer", "transfer", 80);
});
export type FormValues = z.infer<typeof formSchema>;
/** What a new transaction can start with in place of the blanks. */
export type TransactionPrefill = Partial<Pick<FormValues, "name" | "amount" | "kind" | "occursAt" | "billIncomeId" | "categoryId">>;

// A transfer is not a third way for money to move: it is money sent to, or brought back
// from, one of the owner's other accounts, saved as an expense or income tied to that transfer.
const typeOptions = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
] as const;
const directionOptions = [
  { value: "expense", label: "Sent to it" },
  { value: "income", label: "Came back" },
] as const;

type TransactionDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The period on screen: sets the default date and decides whether a save "moved" the item. */
  view: PeriodView;
  /** The budget's time zone, for "now". */
  timezone: string;
  /** Present when editing; absent when adding. */
  transaction?: Transaction;
  /** When adding: starting values for the "Type it in" form, such as a bill's payment. */
  prefill?: TransactionPrefill;
  /** Asks for a search for other transactions like the one being edited. */
  onFindLike?: (transaction: Transaction) => void;
  /** When adding: offers a second tab that picks screenshots to import from, and hands them here. */
  onScan?: (files: File[]) => void;
};

/**
 * New items default to right now when looking at the current period, otherwise to the
 * first day of the period on screen (adding to a past or future period is deliberate).
 */
function defaultOccursAtFor(view: PeriodView, timezone: string): LocalDateTime {
  const now = nowIn(timezone, new Date());
  const { startDate, endDate } = view.period;
  return startDate <= dateOf(now) && dateOf(now) <= endDate ? now : atStartOfDay(startDate);
}

/** Puts the server's complaints about split items ("items.0.dueDate") on their fields. Returns whether there were any. */
function applySplitItemErrors(error: unknown, setError: UseFormSetError<FormValues>): boolean {
  let onItems = false;
  for (const [path, message] of Object.entries(error instanceof ApiError ? (error.fields ?? {}) : {})) {
    const match = /^items\.(\d+)\.(amountCents|dueDate|label)$/.exec(path);
    if (!match) continue;
    const field = match[2] === "amountCents" ? "amount" : (match[2] as "dueDate" | "label");
    setError(`items.${Number(match[1])}.${field}`, { message });
    onItems = true;
  }
  return onItems;
}

/** The items as the server takes them, or null while any amount or due date isn't filled in properly. */
function splitItemsOf(items: FormValues["items"], labels: readonly string[]) {
  const parsed = items.map((item, index) => ({ label: labels[index] ?? "", amountCents: parseAmount(item.amount), dueDate: item.dueDate }));
  if (parsed.some((item) => item.amountCents === null || !isLocalDate(item.dueDate))) return null;
  return parsed.map((item) => ({ ...item, amountCents: item.amountCents! }));
}

/**
 * Where a dry-run preview that follows the form stands: it is current once the form has
 * stayed the same for the debounce and the answer for it has come back. A refusal is either
 * about fields (`errors`) or about the whole (`problem`).
 */
function previewState<T>(previewKey: string | null, settledKey: string | null, preview: { data?: T; error: unknown; isError: boolean; isFetching: boolean }) {
  const current = previewKey !== null && settledKey === previewKey && !preview.isFetching;
  const failure = current && preview.error instanceof ApiError ? preview.error : null;
  const errors = failure?.fields ?? {};
  const problem =
    failure && !failure.fields ? failure.message : current && preview.isError && !failure ? "Couldn't work out the transactions. Try again." : null;
  return { current, errors, problem, plan: previewKey === null || failure ? undefined : preview.data };
}

/** A ticked-or-not option with a line saying what it does. */
function OptionCheckbox({ label, description, registration }: { label: string; description: string; registration: UseFormRegisterReturn }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" {...registration} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className="text-sm text-muted">{description}</span>
      </span>
    </label>
  );
}

const ROUND_UP_LABEL = "Round up to the next $50";
const ROUND_UP_HINT =
  "Each pay period's payment rounds up to a multiple of $50. The extra pays it off sooner, so the last payments shrink or drop off.";

const addTabs = [
  { value: "type", label: "Type it in" },
  { value: "screenshots", label: "Screenshots" },
  { value: "split", label: "Split it up" },
] as const;
type AddTab = (typeof addTabs)[number]["value"];

export function TransactionDialog({ open, onClose, transaction, onScan, ...rest }: TransactionDialogProps) {
  // Editing a split's payment can turn into adding to that split.
  const [joining, setJoining] = useState<SplitSummary | null>(null);
  const close = () => {
    setJoining(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={joining ? `Add to ${joining.name}` : transaction ? "Edit transaction" : "Add transaction"}>
      {joining ? (
        <AddToSplitForm split={joining} defaultOccursAt={defaultOccursAtFor(rest.view, rest.timezone)} onClose={close} />
      ) : transaction ? (
        <TransactionForm onClose={close} transaction={transaction} onAddToSplit={setJoining} {...rest} />
      ) : (
        <AddTabs onScan={onScan} onClose={close} {...rest} />
      )}
    </Dialog>
  );
}

function AddTabs({ onScan, ...rest }: Omit<TransactionDialogProps, "open" | "transaction">) {
  const [tab, setTab] = useState<AddTab>("type");
  const tabs = addTabs.filter((option) => option.value !== "screenshots" || onScan);
  return (
    <>
      <div className="mb-4">
        <SegmentedControl label="How to add it" hideLabel options={tabs} value={tab} onChange={setTab} />
      </div>
      {tab === "screenshots" && onScan ? (
        <ScreenshotPicker onPick={onScan} />
      ) : (
        // Keyed so each tab starts its own form.
        <TransactionForm key={tab} split={tab === "split"} {...rest} />
      )}
    </>
  );
}

type TransactionFormProps = Omit<TransactionDialogProps, "open" | "onScan"> & {
  /** Several amounts with due dates, spread over the pay periods before them. Only when adding. */
  split?: boolean;
  /** When editing a split's payment: asks to add more to that split instead. */
  onAddToSplit?: (split: SplitSummary) => void;
};

function TransactionForm({ onClose, view, timezone, transaction, prefill, onFindLike, onAddToSplit, split = false }: TransactionFormProps) {
  const toast = useToast();
  const create = useCreateTransaction();
  const splitter = useSplitTransaction();
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();
  const [formError, setFormError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(Boolean(transaction?.note));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const defaultOccursAt = defaultOccursAtFor(view, timezone);

  // The split this payment belongs to, while it has something left to pay.
  const splits = useWaitingSplits();
  const splitOf = transaction?.splitId ? splits.data?.find((entry) => entry.id === transaction.splitId) : undefined;

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: transaction
      ? {
          name: transaction.name,
          split: false,
          amount: centsToInput(transaction.amountCents),
          items: [],
          finishEarly: false,
          roundUp: false,
          named: false,
          kind: transaction.kind,
          occursAt: transaction.occursAt,
          note: transaction.note ?? "",
          paid: transaction.status === "paid",
          billIncomeId: transaction.billIncomeId ?? "",
          countsToward: "",
          categoryId: transaction.categoryId ?? "",
          newCategory: "",
          newTransfer: "",
          latePayment: transaction.latePayment ?? false,
        }
      : {
          name: "",
          split,
          amount: "",
          items: [{ label: "", amount: "", dueDate: "" }],
          finishEarly: false,
          roundUp: false,
          named: false,
          kind: "expense",
          occursAt: defaultOccursAt,
          note: "",
          paid: false,
          billIncomeId: "",
          countsToward: "",
          categoryId: "",
          newCategory: "",
          newTransfer: "",
          latePayment: false,
          ...(!split && prefill),
        },
  });

  // Bills and income to tie this to: the current ones, and the one it is already tied to
  // even if that has since ended.
  const items = useBillsIncome();
  const [chosenId, chosenKind] = watch(["billIncomeId", "kind"]);
  const choices = (items.data ?? []).filter((item) => !item.archived || item.id === transaction?.billIncomeId);
  // The bill or income this is saved against: the one its detail view opens for.
  const linkedItem = items.data?.find((item) => item.id === transaction?.billIncomeId);
  const navigate = useNavigate();
  const createTransfer = useCreateBillOrIncome();
  // Whether Type says Transfer. Until it is touched, it follows what this is tied to.
  const [typeChosen, setTypeChosen] = useState<"transfer" | "other" | null>(null);
  const tiedToTransfer = choices.find((choice) => choice.id === chosenId)?.kind === "transfer";
  const transferMode = typeChosen === null ? tiedToTransfer || chosenId === NEW_TRANSFER : typeChosen === "transfer";
  const billChoices = choices.filter((item) => item.kind !== "transfer");
  const transferChoices = choices.filter((item) => item.kind === "transfer");
  const itemOptions = [{ value: "", label: "None" }, ...billChoices.map((item) => ({ value: item.id, label: item.name }))];
  const transferOptions = [
    { value: "", label: "Choose one" },
    ...transferChoices.map((item) => ({ value: item.id, label: item.name })),
    { value: NEW_TRANSFER, label: "New transfer…" },
  ];
  /** Type changed: a bill can't stay chosen under Transfer, nor a transfer under Expense or Income. */
  function chooseType(type: (typeof typeOptions)[number]["value"]) {
    setTypeChosen(type === "transfer" ? "transfer" : "other");
    if (type !== "transfer") setValue("kind", type);
    const keep = type === "transfer" ? tiedToTransfer || chosenId === NEW_TRANSFER : !tiedToTransfer && chosenId !== NEW_TRANSFER;
    if (!keep) {
      setValue("billIncomeId", "");
      setValue("countsToward", "");
    }
  }

  const categories = useCategories();
  const createCategory = useCreateCategory();
  const chosenCategory = watch("categoryId");
  // Shown once the list has loaded, even with no categories yet: one can be made from here.
  const categoryOptions = [
    { value: "", label: "None" },
    ...(categories.data ?? []).map((category) => ({ value: category.id, label: category.name })),
    { value: NEW_CATEGORY, label: "New category…" },
  ];

  // What a new payment could be paying: the upcoming entries that bill or income added to
  // the period on screen. Paying toward one shrinks it, so the bill is not counted twice.
  const payable = transaction || split
    ? []
    : view.transactions.filter(
        (entry) =>
          chosenId !== "" &&
          entry.billIncomeId === chosenId &&
          entry.occurrenceDate !== null &&
          entry.status === "upcoming" &&
          entry.kind === chosenKind,
      );
  const towardOptions = [
    { value: "", label: chosenKind === "income" ? "Nothing: this is on top of it" : "Nothing: this is an extra payment" },
    ...payable.map((entry) => ({
      value: entry.id,
      label: `The ${formatCents(Math.abs(entry.amountCents))} due ${formatDay(dateOf(entry.occursAt))}`,
    })),
  ];

  /** Picking a bill or income for a new transaction fills in what is known about it. */
  function choose(itemId: string) {
    setValue("countsToward", "");
    const item = choices.find((choice) => choice.id === itemId);
    if (!item || transaction) return;
    if (getValues("name").trim() === "") setValue("name", item.name);
    // A transfer goes either way, so whichever way this one was said to go stands.
    if (item.kind !== "transfer") setValue("kind", item.kind);
    if (getValues("amount").trim() === "" && item.defaultAmountCents > 0) {
      setValue("amount", centsToInput(item.defaultAmountCents));
    }
    if (getValues("categoryId") === "" && item.categoryId) setValue("categoryId", item.categoryId);
  }
  const itemField = register("billIncomeId");

  // Money out toward something with a due date may say it paid the one before, not the next.
  const chosenItem = choices.find((choice) => choice.id === chosenId);
  const watchedDate = dateOf(watch("occursAt"));
  const lateRule =
    !split && chosenKind === "expense" && chosenItem?.dueDate
      ? { unit: chosenItem.dueUnit, interval: chosenItem.dueInterval, date: chosenItem.dueDate, endDate: chosenItem.endDate }
      : null;
  const around = lateRule && isLocalDate(watchedDate) ? dueDatesAround(lateRule, watchedDate) : null;
  const lateHint =
    around?.before && around.next
      ? `It paid what was due ${formatMonthDay(around.before)}, so it doesn't count toward ${formatMonthDay(around.next)}.`
      : "It paid the due date before it, so it doesn't count toward the next one.";
  const chosen = choices.find((choice) => choice.id === chosenId);
  // Says which way this one counts, so that what the money is then spent on is not tied here by mistake.
  const transferHint =
    chosen?.kind === "transfer"
      ? chosenKind === "income"
        ? `Money coming back from ${chosen.name}.`
        : `Money going to ${chosen.name}.`
      : undefined;

  // Splitting: what it would make, worked out by the server as the form changes.
  const [watchedName, watchedOccursAt, watchedItems, finishEarly, roundUp, watchedNote] = watch(["name", "occursAt", "items", "finishEarly", "roundUp", "note"]);
  const splitLabels = watchedItems.length > 1 ? watchedItems.map((item, index) => item.label.trim() || `Item ${index + 1}`) : [];
  const previewInput = ((): Omit<TransactionSplitInput, "dryRun"> | null => {
    if (!split || !isLocalDateTime(watchedOccursAt)) return null;
    const items = splitItemsOf(watchedItems, splitLabels);
    if (!items) return null;
    return {
      // What it is called and tied to change nothing about the plan.
      name: watchedName.trim() || "Split",
      kind: chosenKind,
      occursAt: watchedOccursAt,
      note: watchedNote,
      finishEarly,
      roundUp,
      items,
    };
  })();
  const previewKey = previewInput && JSON.stringify(previewInput);
  const settledKey = useDebouncedValue(previewKey, 300);
  const preview = useSplitPreview(settledKey === null ? null : (JSON.parse(settledKey) as Omit<TransactionSplitInput, "dryRun">));
  const { current: previewCurrent, errors: previewErrors, problem: previewProblem, plan } = previewState(previewKey, settledKey, preview);

  function finish({ period, countedToward }: TransactionResponse) {
    onClose();
    if (countedToward) {
      toast(
        countedToward.removed
          ? `${countedToward.name} is paid off.`
          : `${formatCents(Math.abs(countedToward.remainingCents))} of ${countedToward.name} is still upcoming.`,
      );
    } else if (period.id !== view.period.id) {
      toast(`${transaction ? "Moved" : "Added"} to ${formatDateRange(period.startDate, period.endDate)}`);
    }
  }

  function finishSplit(result: TransactionSplitResponse) {
    const { payments, later } = result;
    onClose();
    const first = dateOf(payments[0]!.occursAt);
    const added =
      payments.length === 1
        ? `Added 1 transaction on ${formatLongDate(first)}`
        : `Added ${payments.length} transactions, ${formatDateRange(first, dateOf(payments.at(-1)!.occursAt))}`;
    // What is too far ahead to add yet, so it can be split again nearer the time.
    toast(
      later.length === 0
        ? added
        : `${added}. ${formatCents(laterTotal(result))} more waits under Split payments, from ${formatLongDate(dateOf(later[0]!.occursAt))}`,
    );
  }

  async function saveSplit(values: Pick<FormValues, "name" | "kind" | "occursAt" | "note" | "items" | "finishEarly" | "roundUp">, links: Pick<TransactionSplitInput, "billIncomeId" | "categoryId">) {
    const { items } = values;
    try {
      finishSplit(
        await splitter.mutateAsync({
          name: values.name,
          kind: values.kind,
          occursAt: values.occursAt,
          note: values.note,
          finishEarly: values.finishEarly,
          roundUp: values.roundUp,
          ...links,
          items: items.map((item) => ({
            label: items.length > 1 ? item.label.trim() : "",
            amountCents: parseAmount(item.amount) ?? 0,
            dueDate: item.dueDate,
          })),
        }),
      );
    } catch (error) {
      const onItems = applySplitItemErrors(error, setError);
      const message = applyApiError(error, setError, ["name", "occursAt", "note", "billIncomeId", "categoryId"]);
      setFormError(onItems ? null : message);
    }
  }

  const onSubmit = handleSubmit(async ({ name, amount, kind, occursAt, note, paid, billIncomeId, countsToward, categoryId, newCategory, newTransfer, items, finishEarly, roundUp, latePayment }) => {
    setFormError(null);
    if (transferMode && billIncomeId === "") {
      setError("billIncomeId", { message: "Choose the account it moved between, or make a new one" });
      return;
    }
    const amountCents = parseAmount(amount) ?? 0;
    // Hidden once the item has no due date, or the money comes in: then it is not late.
    const late = lateRule !== null && latePayment;
    let tiedTo = billIncomeId === "" ? null : billIncomeId;
    if (billIncomeId === NEW_TRANSFER) {
      try {
        const { item } = await createTransfer.mutateAsync({
          name: newTransfer.trim(),
          description: "",
          kind: "transfer",
          openingCents: 0,
          defaultAmountCents: 0,
          recurrenceUnit: "none",
          recurrenceInterval: 1,
          endDate: null,
          categoryId: null,
          dueDate: null,
          dueUnit: "month",
          dueInterval: 1,
        });
        tiedTo = item.id;
        // Made now, so a save that fails below doesn't make it twice when tried again.
        setValue("billIncomeId", item.id);
        setValue("newTransfer", "");
      } catch (error) {
        if (error instanceof ApiError && error.fields?.name) setError("newTransfer", { message: error.fields.name });
        else setFormError(error instanceof ApiError ? error.message : "Couldn't make that transfer. Try again.");
        return;
      }
    }
    let filedUnder = categoryId === "" ? null : categoryId;
    if (categoryId === NEW_CATEGORY) {
      try {
        const { category } = await createCategory.mutateAsync({ name: newCategory.trim(), defaultLimitCents: null });
        filedUnder = category.id;
        // Made now, so a save that fails below doesn't make it twice when tried again.
        setValue("categoryId", category.id);
        setValue("newCategory", "");
      } catch (error) {
        if (error instanceof ApiError && error.fields?.name) setError("newCategory", { message: error.fields.name });
        else setFormError(error instanceof ApiError ? error.message : "Couldn't make that category. Try again.");
        return;
      }
    }
    if (split) {
      await saveSplit(
        { name, kind, occursAt, note, items, finishEarly, roundUp },
        { billIncomeId: tiedTo, ...(categories.data && { categoryId: filedUnder }) },
      );
      return;
    }
    try {
      finish(
        transaction
          ? await update.mutateAsync({
              id: transaction.id,
              // Sent only when it changed, so an edit of something else never re-ties anything.
              patch: {
                name,
                amountCents,
                kind,
                occursAt,
                note,
                ...(tiedTo !== transaction.billIncomeId && { billIncomeId: tiedTo }),
                ...(filedUnder !== transaction.categoryId && { categoryId: filedUnder }),
                ...(late !== (transaction.latePayment ?? false) && { latePayment: late }),
              },
            })
          : await create.mutateAsync({
              name,
              amountCents,
              kind,
              occursAt,
              note,
              paid,
              billIncomeId: tiedTo,
              // Said outright once the list has loaded, so what the form shows is what is saved.
              // Until then it is left to the server, which files it where its bill or income is.
              ...(categories.data && { categoryId: filedUnder }),
              ...(countsToward !== "" && payable.some((entry) => entry.id === countsToward) && { countsToward }),
              ...(late && { latePayment: true }),
            }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.fields?.amountCents) {
        setError("amount", { message: error.fields.amountCents });
      }
      setFormError(
        applyApiError(error, setError, ["name", "occursAt", "note", "billIncomeId", "countsToward", "categoryId", "latePayment"]),
      );
    }
  });

  async function deleteTransaction() {
    if (!transaction) return;
    setFormError(null);
    try {
      await remove.mutateAsync(transaction.id);
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "Couldn't delete that. Try again.");
      setConfirmingDelete(false);
    }
  }

  const saving = create.isPending || update.isPending || splitter.isPending || createCategory.isPending || createTransfer.isPending;
  const typeControl = (
    <Controller
      control={control}
      name="kind"
      render={({ field }) => (
        <SegmentedControl label="Type" options={typeOptions} value={transferMode ? "transfer" : field.value} onChange={chooseType} />
      )}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}

      <TextField label="Name" autoComplete="off" data-autofocus error={errors.name?.message} {...register("name")} />

      {split ? (
        typeControl
      ) : (
        // Three types need the width: side by side only from sm.
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <TextField
            label="Amount"
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            error={errors.amount?.message}
            {...register("amount")}
          />
          {typeControl}
        </div>
      )}

      {transferMode && (
        <>
          <SelectField
            label="Transfer"
            options={transferOptions}
            hint={chosenId === "" || chosenId === NEW_TRANSFER ? "Another account of your own: savings, joint, a loan." : transferHint}
            error={errors.billIncomeId?.message}
            {...itemField}
            onChange={(event) => {
              void itemField.onChange(event);
              choose(event.target.value);
            }}
          />
          {chosenId === NEW_TRANSFER && (
            <TextField
              label="New transfer name"
              autoComplete="off"
              maxLength={80}
              hint="It's added to Recurring as a transfer when you save."
              error={errors.newTransfer?.message}
              {...register("newTransfer")}
            />
          )}
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <SegmentedControl label="Which way" options={directionOptions} value={field.value} onChange={field.onChange} />
            )}
          />
        </>
      )}

      <TextField
        label={split ? "First payment" : "Date and time"}
        type="datetime-local"
        hint={split ? "The rest go on the first day of each pay period after it." : undefined}
        error={errors.occursAt?.message ?? previewErrors.occursAt}
        {...register("occursAt")}
      />

      {split && (
        <>
          <SplitItems
            control={control}
            register={register}
            setValue={setValue}
            errors={errors}
            previewErrors={previewErrors}
            name={watchedName}
          />
          <div className="flex flex-col">
            <OptionCheckbox
              label="Finish a pay period early"
              description="Each one is paid off by the period before the one it's due in, instead of in that period."
              registration={register("finishEarly")}
            />
            <OptionCheckbox label={ROUND_UP_LABEL} description={ROUND_UP_HINT} registration={register("roundUp")} />
          </div>
        </>
      )}

      {!transferMode && billChoices.length > 0 && (
        <SelectField
          label="Recurring item"
          options={itemOptions}
          hint={chosenId === "" ? "Optional. Groups this with one of your recurring items." : undefined}
          error={errors.billIncomeId?.message}
          {...itemField}
          onChange={(event) => {
            void itemField.onChange(event);
            choose(event.target.value);
          }}
        />
      )}

      {lateRule && (
        <OptionCheckbox label="Late payment" description={lateHint} registration={register("latePayment")} />
      )}

      {payable.length > 0 && (
        <SelectField
          label="Counts toward"
          options={towardOptions}
          hint="Choosing an upcoming entry shrinks it by this amount, and removes it once it is paid off."
          error={errors.countsToward?.message}
          {...register("countsToward")}
        />
      )}

      {categories.data && (
        <SelectField
          label="Category"
          options={categoryOptions}
          error={errors.categoryId?.message}
          {...register("categoryId")}
        />
      )}
      {chosenCategory === NEW_CATEGORY && (
        <TextField
          label="New category name"
          autoComplete="off"
          maxLength={40}
          hint="It's added to your categories when you save."
          error={errors.newCategory?.message}
          {...register("newCategory")}
        />
      )}

      {showNote ? (
        <TextField
          label="Note"
          autoComplete="off"
          hint={split && splitLabels.length > 1 ? "Each transaction's note also lists what every item makes up of it." : undefined}
          error={errors.note?.message ?? previewErrors.note}
          {...register("note")}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="-my-1 min-h-11 self-start rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Add a note
        </button>
      )}

      {transaction && splitOf && (
        <SplitPanel
          split={splitOf}
          canSkip={transaction.status === "upcoming" && !confirmingSkip}
          onSkip={() => setConfirmingSkip(true)}
          onAddTo={onAddToSplit && (() => onAddToSplit(splitOf))}
        />
      )}

      {transaction && onFindLike && (
        <button
          type="button"
          onClick={() => onFindLike(transaction)}
          className="-my-1 inline-flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Search className="size-4" aria-hidden />
          Find others like this
        </button>
      )}

      {linkedItem && (
        <button
          type="button"
          onClick={() => {
            onClose();
            void navigate(billOrIncomeDetailPath(linkedItem.id));
          }}
          className="-my-1 inline-flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Repeat className="size-4" aria-hidden />
          Open {linkedItem.name} in Recurring
        </button>
      )}

      {split && (
        <SplitPreview
          plan={plan}
          problem={previewProblem}
          blocked={Object.keys(previewErrors).length > 0}
          loading={previewKey !== null && !previewCurrent}
          labels={splitLabels}
        />
      )}

      {!transaction && !split && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-fg">
          <input type="checkbox" className="size-5 accent-primary" {...register("paid")} />
          Already paid
        </label>
      )}

      {confirmingSkip && transaction && splitOf ? (
        <SkipPayment splitId={splitOf.id} transaction={transaction} onDone={onClose} onCancel={() => setConfirmingSkip(false)} />
      ) : confirmingDelete ? (
        <DialogActions>
          <p className="self-center text-sm font-medium text-fg sm:mr-auto">Delete this transaction?</p>
          <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={remove.isPending}>
            Keep it
          </Button>
          <Button variant="danger" onClick={deleteTransaction} loading={remove.isPending}>
            Delete
          </Button>
        </DialogActions>
      ) : (
        <DialogActions>
          {transaction && (
            <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {transaction ? "Save" : split && plan && plan.payments.length > 1 ? `Add ${plan.payments.length}` : "Add"}
          </Button>
        </DialogActions>
      )}
    </form>
  );
}

type SplitPanelProps = {
  split: SplitSummary;
  /** Offer to skip this payment: it is unpaid, and not already being asked about. */
  canSkip: boolean;
  onSkip: () => void;
  onAddTo?: () => void;
};

/** When editing a split's payment: which split it is, what is left of it, and what can be done to it. */
function SplitPanel({ split, canSkip, onSkip, onAddTo }: SplitPanelProps) {
  const left = (split.items ?? []).reduce((sum, item) => sum + item.leftCents, 0);
  const count = (split.upcoming?.length ?? 0) + split.payments.length;
  return (
    <section aria-label="Split" className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-start gap-2">
        <Split className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium break-words text-fg">Part of the split {split.name}</p>
          <p className="text-sm text-muted">
            {formatCents(left)} left in {count === 1 ? "1 payment" : `${count} payments`}
            {split.roundUp && ", rounded up to $50"}
          </p>
        </div>
      </div>
      {split.editable ? (
        <div className="flex flex-wrap gap-2">
          {canSkip && (
            <Button variant="secondary" onClick={onSkip}>
              Skip this payment
            </Button>
          )}
          {onAddTo && (
            <Button variant="secondary" onClick={onAddTo}>
              Add to this split
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">It was made before splits could be changed, so it can't be added to.</p>
      )}
    </section>
  );
}

type AddToSplitFormProps = {
  split: SplitSummary;
  /** Where the new items' first payment goes unless changed. */
  defaultOccursAt: LocalDateTime;
  onClose: () => void;
};

/**
 * More for a split to pay, such as another purchase on the same plan: the new items, from a
 * first payment on, with the split's unpaid payments from there worked out again with them.
 */
export function AddToSplitForm({ split, defaultOccursAt, onClose }: AddToSplitFormProps) {
  const toast = useToast();
  const adder = useAddToSplit();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      // Only the split's items, first payment and rounding are asked for; the rest is the split's own.
      name: split.name,
      split: true,
      named: true,
      amount: "",
      items: [{ label: "", amount: "", dueDate: "" }],
      finishEarly: split.finishEarly ?? false,
      roundUp: split.roundUp ?? false,
      kind: split.kind ?? "expense",
      occursAt: defaultOccursAt,
      note: "",
      paid: false,
      billIncomeId: "",
      countsToward: "",
      categoryId: "",
      newCategory: "",
      newTransfer: "",
      latePayment: false,
    },
  });

  const existing = split.items ?? [];
  const [watchedOccursAt, watchedItems, roundUp] = watch(["occursAt", "items", "roundUp"]);
  const newLabels = watchedItems.map((item) => item.label.trim());
  const previewInput = ((): { splitId: string; input: Omit<SplitAddInput, "dryRun"> } | null => {
    if (!isLocalDateTime(watchedOccursAt)) return null;
    const items = splitItemsOf(watchedItems, newLabels.map((label, index) => label || `New item ${index + 1}`));
    return items && { splitId: split.id, input: { occursAt: watchedOccursAt, roundUp, items } };
  })();
  const previewKey = previewInput && JSON.stringify(previewInput);
  const settledKey = useDebouncedValue(previewKey, 300);
  const preview = useAddToSplitPreview(settledKey === null ? null : (JSON.parse(settledKey) as NonNullable<typeof previewInput>));
  const { current, errors: previewErrors, problem, plan } = previewState(previewKey, settledKey, preview);

  const onSubmit = handleSubmit(async ({ occursAt, items, roundUp: rounding }) => {
    setFormError(null);
    try {
      const { payments, later } = await adder.mutateAsync({
        splitId: split.id,
        input: {
          occursAt,
          roundUp: rounding,
          items: items.map((item) => ({ label: item.label.trim(), amountCents: parseAmount(item.amount) ?? 0, dueDate: item.dueDate })),
        },
      });
      onClose();
      const names = items.map((item) => item.label.trim()).join(" and ");
      const count = payments.length + later.length;
      toast(
        payments.length === 0
          ? `Added ${names} to ${split.name}`
          : `Added ${names} to ${split.name}: ${count === 1 ? "1 payment" : `${count} payments`} from ${formatLongDate(dateOf(payments[0]!.occursAt))}`,
      );
    } catch (error) {
      const onItems = applySplitItemErrors(error, setError);
      const message = applyApiError(error, setError, ["occursAt"]);
      setFormError(onItems ? null : message);
    }
  });

  const first = plan?.payments[0];
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}

      <section aria-label="Already in it" className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium text-fg">Already in it</h3>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {existing.map((item) => (
            <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="min-w-0 break-words text-fg">
                {item.label || split.name} <span className="text-muted">· due {formatDay(item.dueDate)}</span>
              </span>
              <span className="text-muted tabular-nums">
                {formatCents(item.leftCents)} left of {formatCents(item.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <TextField
        label="First payment"
        type="datetime-local"
        hint="The new items start in this pay period. The split's unpaid payments from here on are worked out again."
        error={errors.occursAt?.message ?? previewErrors.occursAt}
        data-autofocus
        {...register("occursAt")}
      />

      <SplitItems
        control={control}
        register={register}
        setValue={setValue}
        errors={errors}
        previewErrors={previewErrors}
        name={split.name}
        alwaysNamed
      />
      <OptionCheckbox label={ROUND_UP_LABEL} description={ROUND_UP_HINT} registration={register("roundUp")} />

      <SplitPreview
        plan={plan}
        heading={
          first
            ? `${plan.payments.length === 1 ? "Its 1 payment" : `Its ${plan.payments.length} payments`} from ${formatLongDate(dateOf(first.occursAt))}`
            : undefined
        }
        problem={problem}
        blocked={Object.keys(previewErrors).length > 0}
        loading={previewKey !== null && !current}
        labels={plan?.labels ?? []}
      />

      <DialogActions>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={adder.isPending}>
          Add
        </Button>
      </DialogActions>
    </form>
  );
}
