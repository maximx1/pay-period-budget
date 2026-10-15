// Telling a sideways swipe from everything else a finger does on a page: a tap, a scroll,
// a diagonal drag, and the system's own gestures at the screen's edges. No DOM in here.

export type SwipePoint = { x: number; y: number };
export type SwipeDirection = "left" | "right";

/** How far sideways a finger has to travel, in CSS pixels. */
export const SWIPE_MIN_DISTANCE = 64;
/** A swipe has to travel more than this many times as far sideways as up or down. */
export const SWIPE_FLATNESS = 2;
/**
 * A touch that starts this close to either side of the screen is left to the system:
 * Android's back gesture and Safari's history swipe both begin there.
 */
export const SWIPE_EDGE_GUARD = 24;

/**
 * The direction the finger moved, "left" meaning toward the left side of the screen, or
 * null when the movement was not a swipe.
 */
export function swipeDirection(start: SwipePoint, end: SwipePoint, viewportWidth: number): SwipeDirection | null {
  if (start.x < SWIPE_EDGE_GUARD || start.x > viewportWidth - SWIPE_EDGE_GUARD) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null;
  if (Math.abs(dx) <= SWIPE_FLATNESS * Math.abs(dy)) return null;
  return dx < 0 ? "left" : "right";
}

/** How far a finger moves before the page starts to follow it, in CSS pixels. */
export const DRAG_START = 8;
/** How much of the finger's movement the page follows where there is nothing to swipe to. */
export const DRAG_RESISTANCE = 0.2;

/**
 * How far sideways the page should sit under a finger that has moved from `start` to
 * `current`, in CSS pixels: 0 until the movement is clearly sideways, then the finger's own
 * distance, or a fifth of it toward a side with nothing there (`canLeft`, `canRight`).
 */
export function dragOffset(
  start: SwipePoint,
  current: SwipePoint,
  viewportWidth: number,
  { canLeft, canRight }: { canLeft: boolean; canRight: boolean },
): number {
  if (start.x < SWIPE_EDGE_GUARD || start.x > viewportWidth - SWIPE_EDGE_GUARD) return 0;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (Math.abs(dx) < DRAG_START || Math.abs(dx) <= SWIPE_FLATNESS * Math.abs(dy)) return 0;
  const allowed = dx < 0 ? canLeft : canRight;
  return allowed ? dx : dx * DRAG_RESISTANCE;
}
