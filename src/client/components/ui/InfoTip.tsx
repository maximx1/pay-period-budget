import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";

type InfoTipProps = {
  /** The button's accessible name, e.g. "Why is this red?". */
  label: string;
  /** The small icon the button shows. */
  icon: ReactNode;
  children: ReactNode;
  className?: string;
};

/** How close the bubble may come to the side of the screen, in CSS pixels: the page's own gutter. */
const SCREEN_MARGIN = 16;

/**
 * A small icon that explains itself: tapping it (or hovering with a mouse) shows a bubble
 * under it, and tapping anywhere else or Escape hides it again. The button is a full 44px
 * touch target around a small icon. The bubble starts under the icon and moves left as far
 * as it needs to stay on screen.
 */
export function InfoTip({ label, icon, children, className }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [shift, setShift] = useState(0);
  const bubbleId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const shown = open || hovered;

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  // Measured where it would sit unshifted, before the screen shows it.
  useLayoutEffect(() => {
    if (!shown || !root.current || !bubble.current) return setShift(0);
    const left = root.current.getBoundingClientRect().left;
    const right = left + bubble.current.offsetWidth;
    setShift(Math.min(0, window.innerWidth - SCREEN_MARGIN - right));
  }, [shown]);

  // Only a real mouse hovers; a tap also fires mouseenter, which would fight the click.
  const hoverable = () => window.matchMedia?.("(hover: hover)").matches ?? false;

  return (
    <span
      ref={root}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => hoverable() && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={shown ? bubbleId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="-m-3.5 inline-flex size-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-ring"
      >
        {icon}
      </button>
      <span
        ref={bubble}
        id={bubbleId}
        role="tooltip"
        style={{ left: shift }}
        className={cn(
          "absolute top-full z-20 mt-3 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-3",
          "text-sm font-normal text-fg shadow-lg",
          shown ? "block" : "hidden",
        )}
      >
        {children}
      </span>
    </span>
  );
}
