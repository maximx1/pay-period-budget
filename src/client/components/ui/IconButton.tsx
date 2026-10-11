import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

type Variant = "ghost" | "secondary";

const variants: Record<Variant, string> = {
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-2",
};

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  /** What the button does. Becomes its accessible name and tooltip. */
  label: string;
  variant?: Variant;
};

/** A 44px square button holding a single icon, passed as children. */
export function IconButton({ label, variant = "ghost", className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
