import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type FieldProps = {
  /** id of the control inside. */
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
};

export const fieldMessageId = (id: string) => `${id}-message`;

/** Shared box styling for form controls that aren't a plain <input>. */
export const controlClass = (invalid: boolean, className?: string) =>
  cn(
    "w-full rounded-lg border bg-surface px-3 text-base text-fg placeholder:text-muted",
    "focus:outline-2 focus:outline-offset-1 focus:outline-ring",
    invalid ? "border-danger" : "border-border",
    className,
  );

/** Label above, error or hint below. The control inside should use `aria-describedby={fieldMessageId(id)}`. */
export function Field({ id, label, error, hint, children }: FieldProps) {
  const message = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {message && (
        <p id={fieldMessageId(id)} className={cn("text-sm", error ? "text-danger" : "text-muted")}>
          {message}
        </p>
      )}
    </div>
  );
}
