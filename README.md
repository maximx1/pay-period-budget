# Pay Period Budget

A budgeting app organised around pay periods instead of calendar months.

## Running it

Requires Node 22+.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and create an account, or run `npm run db:seed` to create the
local development account defined in `src/server/scripts/seed.ts`.

## Production mode

```bash
npm run build
npm start
```

One process serves both the API and the built client. Configuration is by environment
variable; see `.env.example`. The session cookie is HTTPS-only in production, so put the
app behind HTTPS (or set `COOKIE_SECURE=false` for a plain-HTTP trial on a trusted network).

## Where things are

- `CLAUDE.md`: architecture, conventions and commands.
- `docs/plan/`: roadmap, domain rules and the phase-by-phase task breakdown.
