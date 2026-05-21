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
- **Auto-reveal requires zero `need_info` votes.** If anyone voted `need_info`, the session stays in `voting` with a "needs discussion" badge — no new status. Anyone can press a **manual reveal** button to escape, otherwise it waits for the `need_info` voter(s) to change their vote (which re-evaluates the auto-reveal condition).
- Reminders: JST 15:00 (cron `0 6 * * *` UTC), only for `voting` sessions, skip users who voted `need_info`.
- **Slack notifications fire only on session start and the daily reminder.** Reveal and finalize stay in-app; do not post to Slack on those events.
- **No Linear↔Slack user mapping.** Reminders embed Linear `displayName` as plain text — do not @-mention. Setup stays at `SLACK_WEBHOOK_URL` only; do not add Bot Token requirements without an explicit spec change.
- Anyone can finalize. Finalize writes back to Linear's Estimate field (snapped to the workspace's Estimate scale) AND moves the project's status to `Planned` (looked up by `type === "planned"` from `projectStatuses`). Both writes are idempotent so a retry after a partial failure is safe.

## Doing work

- Run `pnpm typecheck` before claiming a task is done.
- Use `pnpm db:migrate:local` after editing files in `migrations/`.
- For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in Linear OAuth credentials.
- Don't commit `.dev.vars`, `dist/`, or `.wrangler/`.

## What's done vs not

- **Done (v0.1–v0.3)**: OAuth + signed cookie sessions; team/project listing and StoryPoint issue detection; session creation; participant management; voting with auto-reveal + the need_info "needs discussion" pause + manual reveal; revealed-state stats (median / mean / mode / range) with a snap-to-scale finalize suggestion; finalize that writes the agreed estimate back to Linear and persists locally; re-vote that opens a fresh round.
- **Not yet**: Slack notifications, the daily reminder cron, fallback UX for the StoryPoint label missing case, self-host docs polish. See README roadmap.
