import { type PointerEvent, useRef } from "react";
import { dragOffset, swipeDirection, type SwipePoint } from "./swipe.ts";

type SwipeOptions = {
  /** The finger moved toward the left side of the screen. */
  onLeft: () => void | Promise<void>;
  /** The finger moved toward the right side of the screen. */
  onRight: () => void | Promise<void>;
  /** False turns swipes off without unmounting anything. */
  enabled?: boolean;
  /** Whether there is anything to swipe to on that side; the element only resists a drag toward it. */
  canLeft?: boolean;
  canRight?: boolean;
};

// Places a sideways drag already means something else, or must not reach the page behind.
const OWN_GESTURES = "dialog, input, textarea, select, [contenteditable]";

/** How long the element takes to slide off the screen, and to settle back when let go short. */
const SLIDE_OUT_MS = 160;
const SETTLE_MS = 200;
/** After a swipe's handler has run, how long to wait for the element to be replaced before putting it back. */
const REPLACED_WITHIN_MS = 150;

/** Whether a touch on `target` belongs to something inside `root` that handles sideways movement itself. */
function hasOwnGesture(target: Element, root: Element): boolean {
  if (target.closest(OWN_GESTURES)) return true;
  for (let element: Element | null = target; element && element !== root; element = element.parentElement) {
    const overflowX = getComputedStyle(element).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && element.scrollWidth > element.clientWidth) return true;
  }
  return false;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Puts the element `offset` pixels to the side, fading it a little the further it goes. */
function place(element: HTMLElement, offset: number, transitionMs = 0) {
  element.style.transition = transitionMs ? `transform ${transitionMs}ms ease-out, opacity ${transitionMs}ms ease-out` : "none";
  element.style.transform = offset ? `translateX(${offset}px)` : "";
  element.style.opacity = offset ? String(1 - Math.min(0.6, (Math.abs(offset) / window.innerWidth) * 0.6)) : "";
}

/**
 * Sideways swipes with one finger on one element. Spread the result onto it, and give it
 * `touch-pan-y` so the browser keeps scrolling up and down itself and leaves sideways
 * movement to these handlers (without it the browser cancels the touch as soon as it
 * moves). A mouse or a pen is ignored. So is a touch that starts on a form field, in
 * anything that scrolls sideways, or while an element marked `data-swipe-lock` is inside.
 *
 * The element follows the finger. A swipe slides it off the screen before its handler
 * runs, and the handler is expected to replace it (a page keyed by what it shows); if it
 * is still there shortly after, it slides back. Let go short of a swipe, it settles back.
 * With reduced motion asked for, nothing moves and the handler runs straight away.
 */
export function useSwipe({ onLeft, onRight, enabled = true, canLeft = true, canRight = true }: SwipeOptions) {
  const touch = useRef<{ id: number; start: SwipePoint; element: HTMLElement } | null>(null);

  const release = (element: HTMLElement) => place(element, 0, SETTLE_MS);

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      // A second finger makes it a pinch, not a swipe.
      if (event.pointerType !== "touch" || !event.isPrimary) {
        if (touch.current) release(touch.current.element);
        touch.current = null;
        return;
      }
      const root = event.currentTarget;
      const usable =
        enabled &&
        event.target instanceof Element &&
        !hasOwnGesture(event.target, root) &&
        !root.querySelector("[data-swipe-lock]");
      touch.current = usable ? { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, element: root } : null;
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const began = touch.current;
      if (!began || began.id !== event.pointerId || reducedMotion()) return;
      const offset = dragOffset(began.start, { x: event.clientX, y: event.clientY }, window.innerWidth, { canLeft, canRight });
      place(began.element, offset);
    },
    async onPointerUp(event: PointerEvent<HTMLElement>) {
      const began = touch.current;
      touch.current = null;
      if (!began || began.id !== event.pointerId) return;
      const { element } = began;
      const direction = swipeDirection(began.start, { x: event.clientX, y: event.clientY }, window.innerWidth);
      const allowed = enabled && (direction === "left" ? canLeft : direction === "right" ? canRight : false);
      if (!direction || !allowed) return release(element);

      const handler = direction === "left" ? onLeft : onRight;
      if (reducedMotion()) return void handler();

      element.style.transition = `transform ${SLIDE_OUT_MS}ms ease-in, opacity ${SLIDE_OUT_MS}ms ease-in`;
      element.style.transform = `translateX(${direction === "left" ? "-" : ""}100vw)`;
      element.style.opacity = "0";
      await new Promise((done) => setTimeout(done, SLIDE_OUT_MS));
      await handler();
      // Not replaced: the move failed or went nowhere, so bring it back.
      setTimeout(() => {
        if (element.isConnected) release(element);
      }, REPLACED_WITHIN_MS);
    },
    // The browser took the touch for itself: a scroll, or a system gesture.
    onPointerCancel() {
      if (touch.current) release(touch.current.element);
      touch.current = null;
    },
  };
}
