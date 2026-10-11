# Phase 7: Manual ordering, settings, polish

**Goal:** fill in the remaining side-panel pages and the smaller behaviours left out of
earlier phases.

**Depends on:** phase 5 (phase 6 is not required). **Suggested model:** Sonnet. Tasks are
independent of each other and can be done in any order.

**No new dependencies** except where a task names one.

## Tasks

### 7.1 Date search (tabled)

- [ ] Done

**Do not build yet.** What this page should do is undecided (decision 6 in `README.md`).
The outline below is one candidate, kept for when it is picked up; confirm with the owner
first. Until then the page stays a placeholder.

**Files:** `src/client/features/search/DateSearchPage.tsx`,
`src/client/features/periods/api.ts`, `src/client/features/home/HomePage.tsx`.

- A date input (default today) and a "Go to period" button. Submitting calls
  `POST /api/periods/locate` and navigates to `/periods/<id>?date=YYYY-MM-DD`.
- Out-of-range dates show the server's field error under the input ("That's before your
  budget started" / "That's more than a year ahead").
- Below the input, a short list of quick links: "Today", "Next period", "Previous period".
- On the home view, when a `date` query parameter is present, scroll the matching date
  group into view and highlight it briefly.

### 7.2 Manual ordering within the same date and time

- [x] Done

**Files:** `src/shared/transactions.ts`, `src/server/services/transactions.ts`,
`src/server/routes/transactions.ts`, `src/server/routes/transactions.test.ts`,
`src/client/features/transactions/TransactionSection.tsx`, `TransactionRow.tsx`, `api.ts`.

- `PUT /api/transactions/order` with `{ ids: string[] }`: all ids must belong to the user
  and share the same `occursAt`; otherwise 400. Sets `sortOrder` to each id's index.
- New transactions get `sortOrder` = (max among those with the same `occursAt`) + 1 so
  they land last in their group. Changing `occursAt` does the same in the new group.
- UI: when a date group contains two or more rows with identical `occursAt` and the same
  status, each of those rows gets "Move up" / "Move down" `IconButton`s (hidden behind a
  per-group "Reorder" toggle so rows stay clean). Optimistic update.
- Keep it to buttons; drag-and-drop is not worth a dependency here.

**Tests:** order persists and is returned by the period view; ids with mixed `occursAt`
→ 400; another user's id → 400; a new transaction lands last in its group.

### 7.3 Settings page

- [x] Done

**Files:** `src/shared/auth.ts`, `src/server/services/auth.ts`, `src/server/routes/auth.ts`,
`src/server/repos/types.ts`, `src/server/repos/sqlite/users.ts`, `sessions.ts`,
`src/server/routes/auth.test.ts`, new `src/server/routes/settings.ts`,
`src/client/features/settings/SettingsPage.tsx` and section components beside it,
`src/client/main.tsx`.

Sections, each a `Card`:

- **Profile:** username and email, read-only.
- **Password:** current password, new password, confirm. `POST /api/auth/password` with
  `{ currentPassword, newPassword }` verifies the current one (rate-limited like sign-in),
  stores the new hash, and deletes every *other* session of the user.
- **Signed-in devices:** `GET /api/auth/sessions` lists the user's sessions (created, last
  seen, a short description parsed from the user agent, and which one is "this device");
  `DELETE /api/auth/sessions/:id` signs one out; "Sign out everywhere else" removes all
  but the current one.
- **Budget:** schedule type, anchor date and time zone, read-only, with a time-zone select
  (`Intl.supportedValuesOf("timeZone")`) saved through `PATCH /api/settings`. Changing the
  schedule itself is backlog; say so in a muted line.
- **Appearance:** System / Light / Dark. Store the choice in `localStorage`, apply it by
  setting or removing `data-theme` on `<html>` (the CSS already supports both), and apply
  it before first paint with a tiny inline script in `index.html` to avoid a flash.
  Note: the production CSP has no `script-src 'unsafe-inline'`, so add the script's hash
  to the CSP in `app.ts` (or move the script to a small external file loaded in `<head>`).

**Tests:** password change with a wrong current password → 400 on `currentPassword`;
success invalidates other sessions but not the current one; the old password no longer
signs in; session list never includes another user's sessions; deleting someone else's
session id → 404.

### 7.4 Polish pass

- [x] Done

**Files:** as needed across `src/client/`.

Walk every screen at 360px, 768px, 1280px and 2560px, light and dark, and fix what is off.
Specifically check:
- Nothing scrolls horizontally at 360px. Long names and emails truncate.
- Every interactive element is reachable by keyboard and has a visible focus ring; every
  icon-only button has a label.
- Dialogs: focus lands on the first field, returns to the trigger on close, and actions
  stay visible with the on-screen keyboard open.
- Loading states are skeletons with stable heights; errors offer a retry.
- Money columns line up (`tabular-nums`).
- The document title follows the page ("Recurring · Pay Period Budget").
- `index.html` responses in production are sent with `Cache-Control: no-cache` (hashed
  assets are already immutable).

Write up anything that needs a decision rather than fixing it silently.

## Implementation notes

7.2, 7.3 and 7.4 completed 2026-10-10. 7.1 (date search) is still tabled and unbuilt.
Where the build differs from the task text above, this section wins.

**7.2 Manual ordering**
- `PUT /api/transactions/order` answers 204. Another user's id is reported the same way as
  an unknown one (400 on `ids`).
- Recurring items generated onto the same day also take the next free position, so several
  bills due the same day keep the order they were created in and can be rearranged.
- The client always sends the *whole* group at that date and time, both paid and upcoming,
  with only the tapped section's rows rearranged (`mergeOrder` in `optimistic.ts`). Positions
  are therefore unique across the two sections and survive marking something paid.
- While a day is in "Reorder" mode, rows that can move show up/down buttons *in place of*
  the paid circle; other rows are unchanged. "Done" restores the circles.

**7.3 Settings**
- Endpoints: `POST /api/auth/password`, `GET /api/auth/sessions`,
  `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-others`,
  `PATCH /api/settings` (time zone; returns the budget).
- `requireAuth` now also sets `c.var.sessionId`.
- A wrong current password is a 400 on `currentPassword`, limited to 10 tries per 15
  minutes per account.
- Device names come from `lib/userAgent.ts` ("Chrome on Mac"); "last active" is refreshed
  about hourly, which is how often a session's last-seen time is written.
- Changing the time zone changes what "today" is. Stored dates and times are not
  converted (they are wall-clock values), which is what decision 10 calls for.
- Theme: `public/theme.js` (plain script, loaded in `<head>`) applies a saved choice before
  first paint; `lib/theme.ts` reads and writes it. They share the storage key `ppb-theme`.
  An external file was used so the Content-Security-Policy needs no inline-script hash.
- The time-zone select saves on change rather than through a Save button.

**7.4 Polish**
- Browser tab titles follow the page ("Recurring · Pay Period Budget") through
  `useDocumentTitle`, which `PageHeader` calls.
- Production HTML is served with `Cache-Control: no-cache`; covered by
  `src/server/static.test.ts`, which also checks the SPA fallback and asset caching.
- The Recurring and Settings pages are loaded on first visit (`lazy` routes).
- The period summary's three figures wrap instead of breaking a large amount mid-number.
- Walked Home, Recurring and Settings at 360, 768, 1280 and 2560px wide in both colour
  schemes with deliberately awkward data (an 80-character name, an unbroken 90-character
  word, a long URL, a seven-figure amount): no horizontal scrolling anywhere, every
  icon-only control has a label, a long email in the side panel truncates.

**Left for a decision rather than changed**
- On a phone the floating + button sits over the right-hand end of whichever row is behind
  it while scrolling (the list has room to scroll clear of it at the end). Normal for this
  kind of button, but it could instead dock into the top bar on small screens.
- There is no "forgot password". It needs a way to send email; see `backlog.md`.
