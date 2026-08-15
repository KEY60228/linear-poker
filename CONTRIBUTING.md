# Contributing

Issues and Pull Requests to Linear Planning Poker are welcome.

## Development environment

See the Setup section in [README.md](./README.md). For local development you need:

- Node.js 20+ / pnpm (use the version pinned in `packageManager` in `package.json`)
- A Linear OAuth app (register `http://localhost:8787/auth/linear/callback` as a Redirect URL for local dev)
- `wrangler.jsonc` (copy from `wrangler.jsonc.example` and fill in your own Cloudflare resource IDs)
- `.dev.vars` (copy from `.dev.vars.example`; **never commit it**)

```bash
pnpm install
pnpm db:migrate:local   # D1 migrations (local)
pnpm dev                # Worker (8787) + Vite (5173)
```

## Repository layout

```
src/
  worker/
    index.ts          # Worker entry + Hono routing
    env.ts            # Bindings type definitions
    routes/auth.ts    # /auth/linear, /auth/linear/callback, /auth/logout
    routes/api.ts     # REST API for session operations
    do/session.ts     # SessionDO (session state machine)
    lib/linear.ts     # OAuth + LinearClient wrapper
    lib/session.ts    # Cookie + KV sessions
    lib/crypto.ts     # HMAC signing / random IDs
    lib/slack.ts      # Slack notifications
    lib/reminder.ts   # Daily reminder (cron)
    lib/cache.ts      # KV cache for Linear API responses
    lib/db.ts         # D1 access
  web/                # React + Vite SPA
migrations/           # D1 schema (sessions/participants/rounds/votes/final_estimates)
```

## Bug reports

Please include reproduction steps and your environment (local `wrangler dev` or a production deployment). Be careful not to paste secrets such as tokens or the contents of `.dev.vars`.

## License

By contributing, you agree that your contributions will be licensed under this repository's [MIT License](./LICENSE).
