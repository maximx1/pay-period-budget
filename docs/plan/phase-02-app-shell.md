# Phase 2: App shell

**Goal:** after signing in you land in a real application frame: a side panel with
navigation, routed pages that swap without leaving the page, and the shared UI pieces the
later phases need. No budget logic yet.

**Depends on:** phase 1 (done). **Suggested model:** Sonnet for all tasks.

**No new dependencies.** Icons come from `lucide-react`, already installed.

## Target layout

```
≥ 1024px (lg)                               < 1024px
┌──────────┬──────────────────────────┐     ┌──────────────────────────┐
│ account  │                          │     │ ☰  Page title            │
│──────────│      page content        │     ├──────────────────────────┤
│ Home     │      (max-width,         │     │                          │
│ Date     │       centred)           │     │      page content        │
│ Recurring│                          │     │                          │
│ Settings │                          │     │                          │
│          │                          │     └──────────────────────────┘
│ ⎋ logout │                          │     ☰ opens the same panel as a drawer
└──────────┴──────────────────────────┘
```

- Side panel: 16rem wide, full height, `bg-surface`, right border. Top: account block
  (circle with the first letter of the username, username, email truncated with ellipsis).
  Middle: nav links with icon + label. Bottom: log out button (icon + "Log out").
- Small screens: a top bar with a menu button and the current page title. The menu button
  opens the side panel as a drawer over a dimmed backdrop. It closes on navigation, on
  backdrop click and on Escape, and returns focus to the menu button.
- Content: padded, scrolls independently of the side panel, capped at `max-w-6xl` and
  centred in the space right of the panel so it doesn't stretch across an ultrawide.
- Respect device safe areas (`env(safe-area-inset-*)`) on the top bar, the drawer and
  anything fixed to the bottom; the Android build needs it.

## Tasks

### 2.1 Layout and routes

- [x] Done

**Files:** `src/client/router.tsx`, new `src/client/features/shell/AppShell.tsx`,
`SidePanel.tsx`, `TopBar.tsx`, `navItems.ts`; new placeholder pages
`src/client/features/search/DateSearchPage.tsx`,
`src/client/features/recurring/RecurringPage.tsx`,
`src/client/features/settings/SettingsPage.tsx`; edit
`src/client/features/home/HomePage.tsx`.

- `AppShell` renders the layout above with an `<Outlet />` for the page. Put it as a
  layout route inside `RequireAuth`.
- Routes: `/` Home, `/search` Date search, `/recurring` Recurring, `/settings` Settings.
  Unknown paths keep redirecting to `/`.
- `navItems.ts` exports the list `{ to, label, icon }` so panel and top bar title share it.
  Icons: `House`, `CalendarSearch`, `Repeat`, `Settings`.
- Use `NavLink`; the active item gets `bg-surface-2`, primary-coloured text and
  `aria-current="page"` (NavLink sets that itself).
- Log out calls `useLogout().mutate()`. Remove the sign-out button from `HomePage`.
- Each placeholder page renders a heading and one line saying which phase fills it in.
- The drawer must not be reachable by keyboard while closed (`inert` or not rendered).

**Accept when:**
- Clicking each nav item changes the URL and content with no full page load; reloading on
  `/recurring` stays on Recurring.
- At 375px the panel is hidden, the top bar shows, and the drawer opens and closes by all
  three routes described above.
- At 1280px and at 2560px the panel is fixed and content is centred and capped.
- Log out returns to `/login`, and pressing Back does not show app content.

### 2.2 Dialog primitive

- [x] Done

**Files:** new `src/client/components/ui/Dialog.tsx`.

Build on the native `<dialog>` element with `showModal()`, which gives focus trapping,
Escape handling and a backdrop for free.

```tsx
<Dialog open={open} onClose={() => setOpen(false)} title="Add transaction">
  ...body...
  <DialogActions>
    <Button variant="ghost" onClick={close}>Cancel</Button>
    <Button type="submit">Add</Button>
  </DialogActions>
</Dialog>
```

- Controlled by `open`; calls `onClose` for Escape, backdrop click and the close button.
- Title rendered as an `<h2>` wired up with `aria-labelledby`.
- ≥ 640px: centred card, `max-w-md`. Below 640px: a bottom sheet (full width, rounded top
  corners, pinned to the bottom, max height 90dvh with internal scroll, bottom safe-area
  padding) so the on-screen keyboard doesn't cover the actions.
- Style the backdrop with `::backdrop`.
- Body scroll is locked while open (`showModal` handles this in current browsers; verify).

**Accept when:** a temporary button on the Settings placeholder opens a demo dialog; focus
moves into it, Tab cycles inside it, Escape and backdrop close it, and focus returns to
the button. Remove the demo before finishing, or leave it out of the commit.

### 2.3 Small primitives

- [x] Done

**Files:** new files under `src/client/components/ui/`: `IconButton.tsx`, `Fab.tsx`,
`PageHeader.tsx`, `EmptyState.tsx`, `Card.tsx`, `Toaster.tsx`.

- `IconButton`: square 44px button around one icon; `label` prop is required and becomes
  `aria-label` and `title`. Variants `ghost` (default) and `secondary`.
- `Fab`: round 56px primary button fixed to the bottom-right of the content area, offset
  by the safe-area insets; takes `label` and an icon. It must sit above page content but
  below dialogs.
- `PageHeader`: page title (`<h1>`), optional subtitle, optional right-aligned actions slot.
  On small screens the title is already in the top bar, so render the `<h1>` visually
  hidden there and show only subtitle/actions.
- `EmptyState`: icon, title, description, optional action.
- `Card`: `rounded-2xl border border-border bg-surface` container with padding prop.
- `Toaster`: a tiny context (`useToast()` returning `toast(message, { variant })`) rendering
  a stack of auto-dismissing messages in an `aria-live="polite"` region at the bottom
  centre, above the Fab. Variants `info` and `error`. Mount the provider in `main.tsx`.
- Refactor `AuthPage` to use `Card`.

**Accept when:** each primitive is used at least once by a placeholder page (for example
an `EmptyState` on Recurring and a `PageHeader` everywhere), and `npm run check` passes.

### 2.4 Shared formatting helpers

- [x] Done

**Files:** new `src/shared/money.ts`, `src/shared/money.test.ts`, `src/shared/dates.ts`,
`src/shared/dates.test.ts`.

`money.ts`
- `formatCents(cents: number, opts?: { showPlus?: boolean }): string`: `-2700` → `-$27.00`,
  `150000` → `$1,500.00`, with `showPlus` → `+$1,500.00`. USD via `Intl.NumberFormat`.
- `parseMoneyInput(text: string): number | null`: `"27"` → `2700`, `"27.5"` → `2750`,
  `"1,234.56"` → `123456`, `"$5"` → `500`; null for empty, negative, non-numeric or more
  than two decimals. Never go through floating-point multiplication; parse the integer
  and fraction parts as strings.

`dates.ts`: types `LocalDate` and `LocalDateTime` (string aliases) and pure functions,
all implemented with UTC arithmetic so the host time zone can't affect results:
- `isLocalDate(s)`, `isLocalDateTime(s)` (strict format and real calendar date)
- `addDays(date, n)`, `diffDays(a, b)` (b − a), `compareDates(a, b)`
- `addMonthsClamped(date, n)`: day clamps to the target month's length
- `addYearsClamped(date, n)`
- `dateOf(dateTime)`: the `LocalDate` part
- `atStartOfDay(date)`: `date + "T00:00"`
- `todayIn(timeZone, now: Date)`: the calendar date in that IANA zone
- `nowIn(timeZone, now: Date)`: the wall-clock `LocalDateTime` in that zone
- `formatDateRange(start, end)`: `"Oct 2 – Oct 15, 2026"`; includes both years when they
  differ
- `formatDay(date)`: `"Mon, Oct 5"`

**Tests (table-driven):** month clamping (Jan 31 + 1 month, + 2 months), leap day,
year rollover, negative `addDays`, `todayIn` on both sides of midnight for
`America/Chicago` and `Asia/Tokyo`, every `parseMoneyInput` case above, and rejection of
`2026-02-30` and `2026-13-01`.

**Accept when:** `npm run check` passes. No UI in this task.

## Implementation notes

Completed 2026-10-10. Where the build differs from the task text above, this section wins.

- **Drawer and Dialog share `useModal`** (`components/ui/useModal.ts`), a thin controller
  over the native `<dialog>`. The small-screen side panel is a `Drawer`
  (`components/ui/Drawer.tsx`), itself a modal dialog, so it gets focus trapping, Escape
  and focus return the same way.
- **Initial focus in a dialog:** put `data-autofocus` on the field that should get it.
  React's `autoFocus` does not work here, because the field mounts before the dialog is
  shown. Dialog children are mounted only while open, so forms start fresh each time.
- **`Fab` is sticky, not fixed.** It must be the last element a page returns, as a direct
  child of the page column (pages return fragments, not a wrapper `div`). That keeps it at
  the right edge of the capped content column on wide screens, and it reserves its own
  space so the last row is never covered.
- **Scrolling happens in `<main data-scroll-root>`**, not on the body. Anything that needs
  the scroll position (phase 7.1's scroll-into-view, for example) should use that element.
  It is locked while any dialog is open.
- **Active nav item** comes from `navItemForPath()` in `features/shell/navItems.ts`, which
  treats every path outside the other sections as Home. `/periods/:id` in phase 3 will
  therefore highlight Home with no extra work.
- **`/dev/ui`** (development server only) shows every primitive on one page inside the
  real shell. Use it to check new or changed primitives in both colour schemes; add new
  primitives to it. It replaces the "use each primitive on a placeholder page" idea in 2.3.
- **New colour token `danger-fg`** (text on a `bg-danger` fill); white was unreadable on
  the dark-mode danger colour.
- **Toasts render under an open dialog.** Show errors that happen inside a dialog inline
  in the dialog; use toasts for feedback after it closes.
- The nav label is "Recurring" at `/recurring` (see decision 11 in `README.md`).
- Checked in the browser at 375, 1024, 1280 and 2560px wide, dark and light: navigation
  without page loads, reload on a deep link, unknown-path redirect, drawer open/close by
  menu button, Escape, backdrop and link click, dialog focus/trap/Escape/backdrop/return,
  bottom-sheet layout on phones, toasts, floating button while scrolling, log out + Back.
