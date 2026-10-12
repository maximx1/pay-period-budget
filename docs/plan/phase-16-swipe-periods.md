# Phase 16: Swipe between pay periods

**Goal:** on a touch screen, swiping the home screen left opens the next pay period and
swiping right opens the previous one, as well as the arrows.

**Depends on:** phase 4 (the home screen). **Suggested model:** Sonnet. Client only.

**Status:** planned 2026-10-12 at the owner's request and built the same day. **It has
never been swiped with a real finger**: it was driven in a browser with simulated touches.
See "Not checked" at the end before calling it done.

## What the owner asked for

"Swipe left and right to get to the previous and next period as well." As well: the
arrows, the Today link and the date search all stay.

## What is already there

- `PeriodHeader.tsx` holds the two moves as `goNext` and `goPrevious`. Next opens the
  following period, generating it first when it does not exist yet and is within the
  horizon. Previous opens the one before, and at the earliest period *adds* one (decision
  12).
- Nothing in the client listens for touch gestures. Reordering uses buttons; the drawer
  opens from its button.
- The dialogs on the home screen are rendered inside `HomePage`. They are native
  `<dialog>` elements in the top layer, but **React events from inside them still bubble
  to `HomePage`'s elements**, so a handler on the page would see a swipe made in a dialog.

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **The page follows the finger's direction, like pages of a book:** swipe left for the
   next period, right for the previous one.
2. **A swipe does what the arrow does, with one exception: it never adds a period before
   the earliest.** That writes to the budget's history and stays a deliberate tap on the
   arrow. Swiping forward into a period that has to be generated is allowed, as tapping
   is.
3. **Touch only.** A mouse drag selects text and a trackpad swipe is the browser's own
   back and forward; neither changes the period.
4. **The screen's edges are left alone.** Android's back gesture and Safari's history
   swipe both start at the edge. A touch that starts within 24px of either side is not
   ours.
5. **Up-and-down scrolling always wins.** A swipe counts only when it travels at least
   64px sideways and more than twice as far sideways as up or down.
6. **No dragging the page along with the finger in the first version.** The period changes
   on release, with a short slide in from the side it came from (none when the device asks
   for reduced motion). A page that tracks the finger is a bigger job and can follow if
   this feels flat.
7. **No keyboard shortcut.** Not asked for; the arrows are already reachable by keyboard.

## Tasks

### 16.1 Recognising a swipe

- [x] Done

- `src/client/lib/swipe.ts`: a pure function that takes where a touch started and ended
  (points and the viewport's width) and answers `"left"`, `"right"` or `null`, by the
  rules in decisions 4 and 5. No DOM in it.
- `useSwipe({ onLeft, onRight, enabled })` beside it: returns the pointer handlers for one
  element. Only `pointerType === "touch"`, only the first finger, and it gives up on
  `pointercancel`. It ignores a touch that starts inside a `dialog`, an `input`,
  `textarea`, `select` or anything that scrolls sideways.
- The element gets `touch-action: pan-y` (Tailwind `touch-pan-y`), so the browser keeps
  vertical scrolling and leaves the sideways movement to the page. Without it the browser
  cancels the pointer as soon as it decides the touch is a scroll.

**Tests:** `swipe.test.ts`, table-driven: far enough and flat enough each way; too short;
too steep; starting at either edge; a diagonal just inside and just outside the rule.

### 16.2 Swiping the home screen

- [x] Done

- Move `goNext` and `goPrevious` out of `PeriodHeader` into `usePeriodNav(view)` in
  `features/periods/`, returning the two moves, whether each is possible, and whether one
  is under way. The header uses it for the arrows exactly as now, including adding an
  earlier period.
- `HomePage` wraps the period's content (header, summary, both sections; not the page
  title) in the swipe element. Left calls next; right calls previous **only when
  `nav.prevId` exists** (decision 2).
- Off while a move is already under way, while a section is in Reorder mode, and while
  the period is loading or failed.
- At either end a swipe does nothing. No toast: the arrow is already shown disabled.
- The new period slides in from the side it came from, about 150ms, skipped under
  `prefers-reduced-motion`. Keyed on the period's id so it does not replay when a
  transaction changes.

**Files:** `features/periods/PeriodHeader.tsx`, new `features/periods/usePeriodNav.ts`,
`features/home/HomePage.tsx`, `styles.css` for the animation if Tailwind has none that fits.

**Check in the browser** with the mobile viewport, and **on the Android emulator** (the
WebView is where the back gesture lives): swipe both ways through several periods;
forward into one that has to be generated; right at the earliest period does nothing;
scroll a long period up and down without it changing; a swipe inside the transaction
dialog and inside the open drawer does nothing; the back gesture from the edge still goes
back; a mouse drag on the desktop selects text.

## Implementation notes

### 16.1 and 16.2 (2026-10-12)

Built as planned. What the next person needs to know:

- `src/client/lib/swipe.ts` is the rule (`swipeDirection`, with the three numbers as named
  constants) and `src/client/lib/useSwipe.ts` is the hook. The rule has 17 table-driven
  cases and one more for the width.
- **Reorder mode is found through the page, not through state.** The day being reordered
  is marked `data-swipe-lock` in `TransactionSection.tsx`, and the hook ignores a touch
  while any element so marked is inside the swipe area. That kept the reorder state where
  it lives; anything else that should hold the period still can use the same mark.
- **`usePeriodNav(view)`** in `features/periods/` holds both moves. It is called once, in
  the home page, and handed to `PeriodHeader` as `periodNav`, so the arrows and a swipe
  share one "busy": neither starts while the other's request is out. Both arrows are now
  disabled during either request (before, each only watched its own).
- `goPrevious({ existingOnly: true })` is how a swipe stops at the earliest period
  (decision 2). The arrow calls it without.
- **The loaded period is its own component**, `LoadedPeriod` in `HomePage.tsx`, because
  the hooks need a period to exist. The dialog state moved into it with the rest.
- The swipe area is a `<div>` around the header, the summary and the two sections. It is
  `flex-1`, so it reaches the bottom of the page column under a short period, and
  `touch-pan-y touch-pinch-zoom`, so the browser still scrolls and zooms. The dialogs and
  the + button are its siblings, not inside it: a touch in a dialog never reaches it.
- **The slide.** A swipe navigates with `state: { arrivedAs: "next" | "previous" }`; the
  area is keyed by the period's id and takes the class `period-from-next` or
  `period-from-previous` (`styles.css`, inside the block that only applies when motion is
  allowed). 150ms, 1.5rem and a fade. An arrow sets no state and does not slide.
  Going back in the browser to a period reached by a swipe plays its slide again.
- Checked by breaking the rule three times (no edge guard, any slope under 45 degrees
  accepted, directions swapped): each fails cases in `swipe.test.ts`.

**Checked** in the browser at 375px on the dev account, with touches made by dispatching
pointer events from the console (the pane's clicks are mouse clicks): a swipe toward the
left opened the next period and the one after, each with `period-from-next`; a swipe
toward the right came back, with `period-from-previous`; at the earliest period, where
the arrow would add one, a swipe right did nothing, and the number of periods was 4 before
and after; a vertical drag, a 50px drag, a drag from the right edge, a cancelled touch and
the same drag made with a mouse did nothing; nor did a drag inside the open transaction
dialog, or with a day marked as being reordered.

**Not checked, and it matters:**

- **A real touch.** Simulated events prove the handlers and the rule. They do not prove
  that `touch-action: pan-y` behaves on a phone: that scrolling up and down still feels
  right, that a sideways drag is not cancelled by the browser part-way, and that the
  threshold (64px, twice as far across as down) suits a thumb. Try it on the phone or the
  Android emulator first thing.
- Android's back gesture from the edge, with the app in the WebView.
- Swiping forward into a period that has to be generated (the arrow's own path; avoided
  here so as not to add periods to the dev account).
- Reorder mode with real rows sharing a time; the dev account has none.
- The slide with reduced motion turned on.
