import { type ButtonHTMLAttributes, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn.ts";

type FabProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  /** What the button does. Becomes its accessible name and tooltip. */
  label: string;
};

/** Where AppShell wants floating buttons drawn: an overlay beside the scroller, not inside it. */
export const FabSlotContext = createContext<HTMLElement | null>(null);

/**
 * Floating action button pinned to the bottom-right corner of the page column.
 * Render it as the last element a page returns. The button is drawn in an overlay outside
 * the scrolling column, so scrolling never re-lays it out (a sticky element recomputes its
 * offset every frame, which stuttered as the end of the page came into view). What stays
 * in the page is a spacer, so the button never covers the final row.
 */
export function Fab({ label, className, children, ...props }: FabProps) {
  const slot = useContext(FabSlotContext);
  const button = (
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
  );

  return (
    <>
      <div aria-hidden className="mt-auto h-[calc(4.5rem+env(safe-area-inset-bottom))] shrink-0" />
      {slot ? (
        createPortal(button, slot)
      ) : (
        <div className="pointer-events-none sticky bottom-6 z-10 -mt-[4.5rem] flex justify-end">{button}</div>
      )}
    </>
  );
}
