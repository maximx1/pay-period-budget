import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { Category } from "../../../shared/categories.ts";
import { centsToInput } from "../../../shared/money.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { ApiError } from "../../lib/api.ts";
import { applyApiError } from "../auth/formErrors.ts";
import { useCreateCategory, useDeleteCategory, useUpdateCategory } from "./api.ts";
import { parseLimit } from "./limitInput.ts";

const formSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(40, "Keep the name under 40 characters"),
  /** Empty means no limit. */
  limit: z.string().refine((text) => text.trim() === "" || parseLimit(text) !== null, "Enter an amount like 200.00"),
  applyToPeriods: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const limitOf = (text: string) => (text.trim() === "" ? null : parseLimit(text));

type CategoryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when adding. */
  category?: Category;
};

export function CategoryDialog({ open, onClose, category }: CategoryDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={category ? "Edit category" : "Add a category"}>
      <CategoryForm onClose={onClose} category={category} />
    </Dialog>
  );
}

function CategoryForm({ onClose, category }: Omit<CategoryDialogProps, "open">) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: category?.name ?? "",
      limit: category?.defaultLimitCents == null ? "" : centsToInput(category.defaultLimitCents),
      applyToPeriods: true,
    },
  });

  // Whether the pay periods that already exist should follow is only a question when the
  // usual limit is new or different.
  const typed = watch("limit");
  const saved = category?.defaultLimitCents ?? null;
  const limitValid = typed.trim() === "" || parseLimit(typed) !== null;
  const limitChanged = limitValid && limitOf(typed) !== saved;
  const removing = limitChanged && limitOf(typed) === null;

  const onSubmit = handleSubmit(async ({ name, limit, applyToPeriods }) => {
    setFormError(null);
    const defaultLimitCents = limitOf(limit);
    const apply = limitChanged && applyToPeriods;
    try {
      if (category) {
        await update.mutateAsync({
          id: category.id,
          patch: { name, defaultLimitCents, ...(apply && { applyToPeriods: true }) },
        });
      } else {
        await create.mutateAsync({ name, defaultLimitCents, ...(apply && { applyToPeriods: true }) });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fields?.defaultLimitCents) {
        setError("limit", { message: error.fields.defaultLimitCents });
      }
      setFormError(applyApiError(error, setError, ["name"]));
    }
  });

  async function deleteCategory() {
    if (!category) return;
    setFormError(null);
    try {
      await remove.mutateAsync(category.id);
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "Couldn't delete that. Try again.");
      setConfirmingDelete(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}

      <TextField label="Name" autoComplete="off" data-autofocus error={errors.name?.message} {...register("name")} />

      <TextField
        label="Usual limit each pay period (optional)"
        inputMode="decimal"
        placeholder="0.00"
        autoComplete="off"
        hint="Each new pay period starts with this limit. You're told when what's filed under this category goes over it."
        error={errors.limit?.message}
        {...register("limit")}
      />

      {limitChanged && (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" {...register("applyToPeriods")} />
          <span>
            <span className="font-medium">
              {removing
                ? "Also remove it from the current pay period and the ones after it"
                : category
                  ? "Also change the current pay period and the ones after it"
                  : "Add it to the current pay period and the ones after it"}
            </span>
            <span className="block text-muted">
              {!watch("applyToPeriods")
                ? "Only pay periods created from now on will follow."
                : removing
                  ? "Periods that are over keep the limit they have."
                  : category
                    ? "Replaces the limit those periods have now. Periods that are over stay as they are."
                    : "Periods that are over get none; add one to any of them in its period settings."}
            </span>
          </span>
        </label>
      )}

      {confirmingDelete ? (
        <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-sm font-medium text-fg">
            Delete {category?.name}? Its transactions and its bills and income stay, with no category. Its limits are
            removed from every pay period.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={remove.isPending}>
              Keep it
            </Button>
            <Button variant="danger" onClick={deleteCategory} loading={remove.isPending}>
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <DialogActions>
          {category && (
            <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending || update.isPending}>
            {category ? "Save" : "Add"}
          </Button>
        </DialogActions>
      )}
    </form>
  );
}
