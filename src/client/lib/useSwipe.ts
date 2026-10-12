import { type PointerEvent, useRef } from "react";
import { swipeDirection, type SwipePoint } from "./swipe.ts";

type SwipeOptions = {
  /** The finger moved toward the left side of the screen. */
  onLeft: () => void;
  /** The finger moved toward the right side of the screen. */
  onRight: () => void;
  /** False turns swipes off without unmounting anything. */
  enabled?: boolean;
};

// Places a sideways drag already means something else, or must not reach the page behind.
const OWN_GESTURES = "dialog, input, textarea, select, [contenteditable]";

/** Whether a touch on `target` belongs to something inside `root` that handles sideways movement itself. */
function hasOwnGesture(target: Element, root: Element): boolean {
  if (target.closest(OWN_GESTURES)) return true;
  for (let element: Element | null = target; element && element !== root; element = element.parentElement) {
    const overflowX = getComputedStyle(element).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && element.scrollWidth > element.clientWidth) return true;
  }
  return false;
}

/**
 * Sideways swipes with one finger on one element. Spread the result onto it, and give it
 * `touch-pan-y` so the browser keeps scrolling up and down itself and leaves sideways
 * movement to these handlers (without it the browser cancels the touch as soon as it
 * moves). A mouse or a pen is ignored. So is a touch that starts on a form field, in
 * anything that scrolls sideways, or while an element marked `data-swipe-lock` is inside.
 */
export function useSwipe({ onLeft, onRight, enabled = true }: SwipeOptions) {
  const touch = useRef<{ id: number; start: SwipePoint } | null>(null);

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      // A second finger makes it a pinch, not a swipe.
      if (event.pointerType !== "touch" || !event.isPrimary) {
        touch.current = null;
        return;
      }
      const root = event.currentTarget;
      const usable =
        enabled &&
        event.target instanceof Element &&
        !hasOwnGesture(event.target, root) &&
        !root.querySelector("[data-swipe-lock]");
      touch.current = usable ? { id: event.pointerId, start: { x: event.clientX, y: event.clientY } } : null;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const began = touch.current;
      touch.current = null;
      if (!enabled || !began || began.id !== event.pointerId) return;
      const direction = swipeDirection(began.start, { x: event.clientX, y: event.clientY }, window.innerWidth);
      if (direction === "left") onLeft();
      else if (direction === "right") onRight();
    },
    // The browser took the touch for itself: a scroll, or a system gesture.
    onPointerCancel() {
      touch.current = null;
    },
  };
}
