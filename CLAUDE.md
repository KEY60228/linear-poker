# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repo.

## What this is

Async planning poker for Linear projects, self-hosted on Cloudflare Workers.
See [README.md](./README.md) for product overview and [docs/handoff.md](./docs/handoff.md) for the original design decisions.

## Stack

- Cloudflare Workers (single Worker) + Hono router
- Durable Object `SessionDO` — one DO per planning-poker session, owns strong-consistency state
- D1 (`DB` binding) — persisted history (sessions, participants, rounds, votes, final_estimates)
- KV (`TOKENS` binding) — OAuth access tokens, keyed by app session id
- React + Vite SPA in `src/web`, built into `dist/web`, served by the Workers Assets binding
- `@linear/sdk` for Linear GraphQL access

## Repo layout

```
src/worker/         # Worker code (Hono app, DO, libs)
src/web/            # React SPA
migrations/         # D1 SQL migrations
wrangler.jsonc      # Cloudflare bindings + cron
```

## Conventions

- **TypeScript strict everywhere.** Two `tsconfig` projects: `tsconfig.worker.json` (Workers runtime, no DOM), `tsconfig.web.json` (browser).
- **Don't import Node built-ins in the Worker** without `nodejs_compat`; we have the flag on, but prefer Web APIs (`crypto.subtle`, `fetch`, `URL`, `TextEncoder`).
- **All Linear API calls go through `src/worker/lib/linear.ts`.** Don't reach into `@linear/sdk` from routes directly.
- **All session/token reads go through `src/worker/lib/session.ts`.** Routes get `c.var.session`; never touch the KV binding directly for auth.
- **Cookie sessions are signed with HMAC-SHA256** using `SESSION_SECRET`. See `src/worker/lib/crypto.ts`.
- **The story-point label name is env-configurable** via `STORY_POINT_LABEL_NAME`. Never hard-code `"story-point"`.

## Domain rules (don't break these)

- 1 session = 1 Linear Project = 1 StoryPoint Issue. The Issue is identified by the configurable label.
- Session state machine: `voting → revealed (auto) → finalized (manual)`. Re-vote returns `revealed/voting → voting` with a new `round_no`.
- During `voting`: who voted is public, what they voted is hidden. After `revealed`: everything is public.
- `need_info` is a valid vote value. It counts as "voted" for the all-voted check, and excludes the user from reminders.
- Reminders: JST 15:00 (cron `0 6 * * *` UTC), only for `voting` sessions, skip users who voted `need_info`.
- Anyone can finalize. Finalize writes back to Linear's Estimate field, snapped to the workspace's Estimate scale.

## Doing work

- Run `pnpm typecheck` before claiming a task is done.
- Use `pnpm db:migrate:local` after editing files in `migrations/`.
- For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in Linear OAuth credentials.
- Don't commit `.dev.vars`, `dist/`, or `.wrangler/`.

## What's done vs not

- **v0.1 (this PR)**: Worker + Hono scaffold, OAuth login + signed cookie session, KV-stored tokens, D1 schema, DO skeleton (no logic yet), React SPA skeleton with login/logout.
- **Not yet**: team/project listing, story-point issue detection, session CRUD, voting, reveal, finalize, revote, Slack, cron reminder. See README roadmap.
