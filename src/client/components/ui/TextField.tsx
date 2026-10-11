import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, useId, useState } from "react";
import { cn } from "../../lib/cn.ts";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  /** Rendered inside the field, at its trailing edge. */
  trailing?: ReactNode;
};

export function TextField({ label, error, hint, trailing, className, id, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          {...props}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            // 16px text keeps mobile browsers from zooming the page on focus.
            "min-h-11 w-full rounded-lg border bg-surface px-3 text-base text-fg placeholder:text-muted",
            "focus:outline-2 focus:outline-offset-1 focus:outline-ring",
            error ? "border-danger" : "border-border",
            !!trailing && "pr-11",
            className,
          )}
        />
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>}
      </div>
      {message && (
        <p id={messageId} className={cn("text-sm", error ? "text-danger" : "text-muted")}>
          {message}
        </p>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<TextFieldProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="flex size-9 items-center justify-center rounded-md text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon className="size-5" aria-hidden />
        </button>
      }
    />
  );
}
