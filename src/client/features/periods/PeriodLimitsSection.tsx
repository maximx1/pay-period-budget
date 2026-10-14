import { Trash2 } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Link } from "react-router";
import type { PeriodView } from "../../../shared/budget.ts";
import type { PeriodCategoryLimit } from "../../../shared/categories.ts";
import { centsToInput, formatCents } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { controlClass } from "../../components/ui/Field.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { ApiError } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { useCategories } from "../categories/api.ts";
import { parseLimit } from "../categories/limitInput.ts";
import { useRemovePeriodLimit, useSetPeriodLimit } from "./api.ts";

/** Enter in one of these fields saves that limit, not the dialog's dates and starting amount. */
const onEnter = (action: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  action();
};

type LimitRowProps = {
  periodId: string;
  limit: PeriodCategoryLimit;
  onError: (error: unknown) => void;
};

function LimitRow({ periodId, limit, onError }: LimitRowProps) {
  const setLimit = useSetPeriodLimit();
  const removeLimit = useRemovePeriodLimit();
  const [text, setText] = useState(centsToInput(limit.limitCents));
  const cents = parseLimit(text);
  const changed = cents !== null && cents !== limit.limitCents;
  const over = limit.spentCents > limit.limitCents;

  const save = () => {
    if (!changed || cents === null) return;
    onError(null);
    setLimit.mutate({ periodId, categoryId: limit.categoryId, limitCents: cents }, { onError });
  };

  return (
    <li className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">{limit.name}</p>
        <p className={cn("text-sm tabular-nums", over ? "font-medium text-warning" : "text-muted")}>
          {formatCents(limit.spentCents)} of {formatCents(limit.limitCents)}
          {over && `, over by ${formatCents(limit.spentCents - limit.limitCents)}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label={`Limit for ${limit.name}`}
          aria-invalid={cents === null ? true : undefined}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onEnter(save)}
          className={controlClass(cents === null, "min-h-11 min-w-0 flex-1 sm:w-28 sm:flex-none")}
        />
        <Button variant="secondary" onClick={save} disabled={!changed} loading={setLimit.isPending}>
          Set
        </Button>
        <IconButton
          label={`Remove the limit for ${limit.name}`}
          disabled={removeLimit.isPending}
          onClick={() => {
            onError(null);
            removeLimit.mutate({ periodId, categoryId: limit.categoryId }, { onError });
          }}
        >
          <Trash2 className="size-5" aria-hidden />
        </IconButton>
      </div>
    </li>
  );
}

/**
 * This period's limits: what each allows and what has been spent against it, with a way to
 * change, remove or add one. Each change is saved by itself and touches this period only.
 */
export function PeriodLimitsSection({ view }: { view: PeriodView }) {
  const categories = useCategories();
  const setLimit = useSetPeriodLimit();
  const [error, setError] = useState<unknown>(null);
  const [addingId, setAddingId] = useState("");
  const [addingText, setAddingText] = useState("");

  const limited = new Set(view.categoryLimits.map((limit) => limit.categoryId));
  const available = (categories.data ?? []).filter((category) => !limited.has(category.id));
  const addingCents = parseLimit(addingText);

  function choose(categoryId: string) {
    setAddingId(categoryId);
    // Start from what the category usually gets.
    const usual = available.find((category) => category.id === categoryId)?.defaultLimitCents;
    setAddingText(usual == null ? "" : centsToInput(usual));
  }

  const add = () => {
    if (addingId === "" || addingCents === null) return;
    setError(null);
    setLimit.mutate(
      { periodId: view.period.id, categoryId: addingId, limitCents: addingCents },
      { onError: setError, onSuccess: () => choose("") },
    );
  };

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="font-semibold text-fg">Category limits</h3>
      <p className="text-sm text-muted">
        What this pay period allows in each category. A change here is saved at once and affects this period only.
      </p>
      {error !== null && <Alert>{error instanceof ApiError ? error.message : "That didn't work. Try again."}</Alert>}

      {view.categoryLimits.length > 0 && (
        <ul className="flex flex-col gap-4 sm:gap-3">
          {view.categoryLimits.map((limit) => (
            // Keyed by the amount too, so the field shows a limit changed elsewhere.
            <LimitRow key={`${limit.categoryId}:${limit.limitCents}`} periodId={view.period.id} limit={limit} onError={setError} />
          ))}
        </ul>
      )}

      {categories.data?.length === 0 ? (
        <p className="text-sm text-muted">
          You have no categories yet.{" "}
          <Link to="/categories" className="font-semibold text-primary hover:underline">
            Add one on the Categories page.
          </Link>
        </p>
      ) : (
        available.length > 0 && (
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select
              aria-label="Category to add a limit for"
              value={addingId}
              onChange={(event) => choose(event.target.value)}
              className={controlClass(false, "min-h-11 min-w-0")}
            >
              <option value="">Add a limit for…</option>
              {available.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {addingId !== "" && (
              <div className="flex items-center gap-2">
                <input
                  aria-label="Limit"
                  aria-invalid={addingText.trim() !== "" && addingCents === null ? true : undefined}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={addingText}
                  onChange={(event) => setAddingText(event.target.value)}
                  onKeyDown={onEnter(add)}
                  className={controlClass(addingText.trim() !== "" && addingCents === null, "min-h-11 min-w-0 flex-1 sm:w-28 sm:flex-none")}
                />
                <Button variant="secondary" onClick={add} disabled={addingCents === null} loading={setLimit.isPending}>
                  Add
                </Button>
              </div>
            )}
          </div>
        )
      )}
    </section>
  );
}
