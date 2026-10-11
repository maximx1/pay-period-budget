import { type TextareaHTMLAttributes, useId } from "react";
import { controlClass, Field, fieldMessageId } from "./Field.tsx";

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export function TextAreaField({ label, error, hint, className, id, rows = 3, ...props }: TextAreaFieldProps) {
  const generatedId = useId();
  const areaId = id ?? generatedId;

  return (
    <Field id={areaId} label={label} error={error} hint={hint}>
      <textarea
        {...props}
        id={areaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? fieldMessageId(areaId) : undefined}
        className={controlClass(Boolean(error), `resize-y py-2.5 ${className ?? ""}`)}
      />
    </Field>
  );
}
