import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

type FabProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  /** What the button does. Becomes its accessible name and tooltip. */
  label: string;
};

/**
 * Floating action button pinned to the bottom-right corner of the page column.
 * Render it as the last element a page returns: it sticks to the bottom of the visible
 * area while the page scrolls, and reserves room so it never covers the final row.
 */
export function Fab({ label, className, children, ...props }: FabProps) {
  return (
    <div className="pointer-events-none sticky bottom-6 z-10 mt-auto flex justify-end pt-4 pb-[env(safe-area-inset-bottom)]">
      <button
        type="button"
        {...props}
        aria-label={label}
        title={label}
        className={cn(
          "pointer-events-auto flex size-14 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg transition-colors hover:bg-primary-hover",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        {children}
      </button>
    </div>
  );
}
