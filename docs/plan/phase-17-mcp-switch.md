# Phase 17: Turning assistant access on and off

**Goal:** one setting on the server decides whether an assistant (the MCP server) can
reach the budget at all. It is on unless the setting says otherwise.

**Depends on:** phase 11 (API tokens, the MCP server). **Suggested model:** Sonnet, with
care in 17.1: it is an authentication rule.

**Status:** planned 2026-10-12 at the owner's request and built the same day. Checked
against a server started with the setting off. Not yet deployed.

## What the owner asked for

"An ability to turn on and off the MCP via config. By default it should be enabled."

## What is already there

- The MCP server is not part of the deployed server. It is one file an assistant runs on
  its own machine (`dist/mcp/ppb-mcp.mjs`), and its only way to the budget is the API,
  carrying an **API token** created in Settings (`mcp/api.ts`).
- So the thing the server can switch off is API tokens. Nothing else uses them today.
- `src/server/env.ts` already reads settings of this kind (`ALLOW_REGISTRATION`,
  `IDLE_TIMEOUT_MINUTES`), and `GET /api/auth/config` already tells the client about them.
- `middleware/` accepts an API token in one place (`authenticate`, `accept.apiTokens`).

## Decided

Applied as sensible defaults; say so to overrule any of them.

1. **"Config" is a server setting, `ALLOW_API_TOKENS`, default `true`**, beside
   `ALLOW_REGISTRATION`. It is named for what it switches. The README and the deploy guide
   introduce it as "turns assistant (MCP) access off".
2. **Off means every API token is refused**, for reading as well as writing, with a
   message that says why ("API tokens are turned off on this server"), so the assistant
   can repeat it instead of reporting a bad token.
3. **Tokens are kept, not deleted.** Turning it back on makes them work again. Nothing has
   to be set up twice.
4. **Settings follows the server.** When it is off, the API tokens section says so and
   offers no "create"; existing tokens are still listed and can still be deleted.
5. **Signed-in sessions are untouched**: the web app and the Android app use sessions, not
   API tokens.
6. **It is for the whole server, not per account.** A per-account switch in Settings would
   be a different feature; with one owner the server setting is the simpler truth.

## Tasks

### 17.1 The setting on the server

- [x] Done

- `ALLOW_API_TOKENS` in `env.ts`, parsed like `ALLOW_REGISTRATION`; default `true`.
- With it off: a request carrying an API token gets a 403 with the message in decision 2,
  on every endpoint; `POST /api/auth/tokens` is refused the same way for a signed-in
  session. Listing and deleting tokens still work.
- `GET /api/auth/config` gains `apiTokensEnabled`.
- `.env.example`, `.env.docker.example`, `compose.yaml`, `README.md`, `docs/deploy.md`,
  `docs/deploy-agent.md`, and the "API surface" section of `domain.md`.

**Tests:** default is on and everything behaves as now; off refuses a read token and a
write token on a budget endpoint and on `GET /api/auth/me`; a cookie session and a bearer
session still work; a token made while it was on works again once it is back on; creating
one while off is refused. Break once: the check left out of the middleware.

### 17.2 Settings and the MCP server

- [x] Done

- Settings → API tokens: when `apiTokensEnabled` is false, a line says assistant access is
  turned off on this server, and the create form is not shown.
- The MCP server shows the server's message as it is when a call is refused for this
  reason, at start-up and on any tool call. Check `mcp/api.ts` does not replace a 403's
  message with its own wording about scopes.
- `npm run build:mcp`.

**Tests:** `mcp/tools.test.ts`: a refused call reports the server's reason.

## Implementation notes

### 17.1 and 17.2 (2026-10-12)

Built as planned.

- `ALLOW_API_TOKENS` in `env.ts` → `config.allowApiTokens`, `true` unless the variable is
  the text `false`. Anything else (`off`, `0`) stops the server at start-up, like the
  other true-or-false settings.
- **The check is in `authenticate` in `middleware/session.ts`, before the token is looked
  up.** With the setting off, anything *shaped* like an API token gets the 403, whether
  or not it is one. That is deliberate: the answer then says nothing about any particular
  token, the database is not touched, and a refused token is not recorded as used. What
  it reveals, that tokens are off here, is what `/api/auth/config` says to anyone.
- The message is `API_TOKENS_OFF_MESSAGE` in `src/shared/auth.ts`: "API tokens are turned
  off on this server". The same 403 answers `POST /api/auth/tokens` from a signed-in
  session. `GET` and `DELETE /api/auth/tokens` are unchanged.
- `GET /api/auth/config` has `apiTokensEnabled`. On the client, `useApiTokensEnabled()` in
  `features/auth/session.ts`; if the server cannot be asked it is taken to be on, and the
  server refuses anyway.
- **Settings → API tokens** shows a plain notice when it is off ("Assistant access is
  turned off on this server, so no token works right now", and, when there are tokens,
  that they are kept) and no "New token" button. Existing tokens are listed and can be
  revoked. The notice is not the red `Alert`: it is a setting, not a failure.
- **The MCP server needed no change.** `mcp/api.ts` rewords only a 401 ("the server
  refused the API token..."); a 403's own message is passed on. A test starts it against
  a server with tokens off: `whoAmI` (what runs at start-up) and the tools all fail with
  the server's sentence, so an assistant is not told to make a new token that would not
  help. **No rebuild of the MCP file is needed for this phase.**
- Documented in `.env.example`, `.env.docker.example`, `compose.yaml` (passed through,
  default `true`), `README.md` (the settings table and a paragraph under the MCP heading),
  `docs/deploy.md`, `docs/deploy-agent.md` and `domain.md`.
- Tests: `routes/apiTokens.test.ts` gained six, run against a second app built over the
  same database with the setting the other way: read and write tokens refused on a budget
  endpoint, on a write and on `GET /api/auth/me`; an unknown token told the same; not
  marked as used; the cookie session and the phone's bearer session unaffected; no new
  token while off, listing and revoking still fine; a token made before works again when
  it is back on. `env.test.ts` covers the parsing.
- Checked by breaking each rule once: the middleware check removed (4 tests fail), the
  create check removed (1).
- **Checked for real**, not only in tests: the built app was started on another port in
  production mode with `ALLOW_API_TOKENS=false` over a copy of the dev database.
  `/api/auth/config` reported `apiTokensEnabled: false`; a token-shaped bearer got the 403
  and the sentence, where the dev server gives it a 401; Settings showed the notice with
  no "New token" button, at 1280px dark and 360px light, with one token listed and its
  Revoke button (a placeholder row put into the copy, since none can be made while off). The copy and the temporary launch entry were removed afterwards.
- **Not checked:** the setting through Docker Compose (the compose file passes it, but
  compose has still never been run, see `HANDOFF.md`), and a real assistant being told.
