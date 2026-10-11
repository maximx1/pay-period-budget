import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "../../lib/api.ts";

/**
 * Puts a failed request's per-field messages onto the matching form fields.
 * Returns the message to show above the form, or null if the fields covered it.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldNames: ReadonlyArray<Path<T>>,
): string | null {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";

  let matched = false;
  for (const name of fieldNames) {
    const message = error.fields?.[name];
    if (message) {
      setError(name, { message });
      matched = true;
    }
  }
  return matched ? null : error.message;
}
