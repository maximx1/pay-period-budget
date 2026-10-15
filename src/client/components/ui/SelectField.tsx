import { ChevronDown } from "lucide-react";
import { type SelectHTMLAttributes, useId } from "react";
import { controlClass, Field, fieldMessageId } from "./Field.tsx";

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  error?: string;
  hint?: string;
};

export function SelectField({ label, options, error, hint, className, id, ...props }: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <Field id={selectId} label={label} error={error} hint={hint}>
      {/* The browser's own arrow sits against the edge on Android; this one has room. */}
      <div className="relative">
        <select
          {...props}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? fieldMessageId(selectId) : undefined}
          className={controlClass(Boolean(error), `min-h-11 appearance-none truncate pr-10 ${className ?? ""}`)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </Field>
  );
}
