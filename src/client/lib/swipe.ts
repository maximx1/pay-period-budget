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
