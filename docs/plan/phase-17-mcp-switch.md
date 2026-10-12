# Phase 17: Turning assistant access on and off

**Goal:** one setting on the server decides whether an assistant (the MCP server) can
reach the budget at all. It is on unless the setting says otherwise.

**Depends on:** phase 11 (API tokens, the MCP server). **Suggested model:** Sonnet, with
care in 17.1: it is an authentication rule.

**Status:** planned 2026-10-12 at the owner's request. Not started.

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

- [ ] Done

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

- [ ] Done

- Settings → API tokens: when `apiTokensEnabled` is false, a line says assistant access is
  turned off on this server, and the create form is not shown.
- The MCP server shows the server's message as it is when a call is refused for this
  reason, at start-up and on any tool call. Check `mcp/api.ts` does not replace a 403's
  message with its own wording about scopes.
- `npm run build:mcp`.

**Tests:** `mcp/tools.test.ts`: a refused call reports the server's reason.

## Implementation notes

(None yet.)
