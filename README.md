# Linear Planning Poker

Async planning poker tied to Linear Projects: vote asynchronously, agree on an estimate, and write it back to Linear. A self-hosted OSS web service that runs on Cloudflare Workers.

日本語版は [README.ja.md](./README.ja.md) を参照してください。

## Features

- Create a planning-poker session per Linear Project
- Participants vote asynchronously; the session auto-reveals once everyone has voted (who has voted is public, values stay hidden until reveal)
- A `need_info` vote ("can't estimate, need details") and a corresponding "needs discussion" status
- After reveal: median / mean / mode / range, plus a suggested final value snapped to your workspace's Estimate scale
- Finalizing writes the estimate back to Linear's Estimate field and moves the Project status to `Planned`
- Re-vote (start a new round within the same session)
- Slack notifications: on session start, and a daily reminder for pending voters (default 15:00 JST)

## Architecture

- **Runtime**: Cloudflare Workers + [Hono](https://hono.dev)
- **Strongly consistent state**: Durable Object (1 session = 1 DO)
- **Persistence**: D1 (SQLite)
- **Token storage**: Workers KV (`TOKENS`)
- **Linear API response cache**: Workers KV (`LINEAR_CACHE`, 5-minute TTL)
- **Cron**: Cloudflare Cron Trigger (for the daily reminder)
- **Frontend**: React + Vite, built assets served alongside the Worker via Workers Assets
- **Linear API**: `@linear/sdk` (OAuth2 tokens)

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the Workers free plan is enough)
- Admin access to your Linear workspace (to create an OAuth app and a label)
- Node.js 20+ / [pnpm](https://pnpm.io)

## Setup

### 1. Prepare Linear

#### StoryPoint label and Issue

This service assumes "1 session = 1 Linear Project = 1 StoryPoint Issue". The Issue that receives the estimate is identified by a specific label.

1. Create an Issue label in Linear. The default name is **`StoryPointIssue`** (configurable via `STORY_POINT_LABEL_NAME` in `wrangler.jsonc`)
2. For each Project you want to run poker on, prepare one Issue to hold the estimate and attach the label to it

> If a Project contains more than one labelled Issue, the target cannot be determined — keep it to one Issue per Project.

#### OAuth application

In your Linear workspace, go to Settings → API → Applications, create an OAuth Application, and register the following Redirect URLs.

- Local: `http://localhost:8787/auth/linear/callback`
- Production: `https://<your-deployment>.workers.dev/auth/linear/callback` (or your custom domain)

You will need the Client ID / Client Secret in a later step.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Create the Wrangler config and Cloudflare resources

Copy `wrangler.jsonc.example` to `wrangler.jsonc` (`wrangler.jsonc` contains your own resource IDs and is not tracked by Git).

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Then create the Cloudflare resources and paste each generated ID over the `REPLACE_ME_...` placeholders in `wrangler.jsonc`.

```bash
# D1
pnpm wrangler d1 create linear_poker_db
# Paste the database_id into d1_databases[0].database_id

# KV (tokens)
pnpm wrangler kv namespace create TOKENS
# Paste the id into kv_namespaces (binding: TOKENS)

# KV (linear api cache)
pnpm wrangler kv namespace create LINEAR_CACHE
# Paste the id into kv_namespaces (binding: LINEAR_CACHE)
```

### 4. Migrations

```bash
pnpm db:migrate:local
# Production:
pnpm db:migrate:remote
```

### 5. Local environment variables

Copy `.dev.vars.example` to `.dev.vars` and fill it in.

```bash
cp .dev.vars.example .dev.vars
```

| Variable | Description |
| --- | --- |
| `LINEAR_OAUTH_CLIENT_ID` | Client ID of your Linear OAuth app |
| `LINEAR_OAUTH_CLIENT_SECRET` | Client Secret of your Linear OAuth app |
| `LINEAR_OAUTH_REDIRECT_URI` | OAuth callback URL (the default is fine for local dev) |
| `SESSION_SECRET` | Random string used to sign cookies |
| `APP_BASE_URL` | App URL embedded in Slack notifications |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL (leave empty to disable Slack notifications) |

Use a sufficiently long random string for `SESSION_SECRET`:

```bash
openssl rand -base64 48
```

#### Slack notifications (optional)

To enable Slack notifications, create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) and set its URL as `SLACK_WEBHOOK_URL`. There are only two kinds of notifications — session start and the daily reminder — and no Bot Token or Linear↔Slack user mapping is required (participant names are embedded as plain text, no @-mentions).

### 6. Dev server

```bash
pnpm dev
```

- Worker: <http://localhost:8787>
- Frontend (Vite): <http://localhost:5173> (`/api` and `/auth` are proxied to the Worker)

The whole login flow happens on <http://localhost:8787> (the OAuth callback lands on the Worker).

#### Running the cron (daily reminder) locally

`wrangler dev` starts with `--test-scheduled`, so while the dev server is running you can trigger the scheduled handler manually:

```bash
curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"
```

Pass the URL-encoded cron expression registered in `triggers.crons` of your `wrangler.jsonc`.

### 7. Deploy

```bash
# Set production secrets
pnpm wrangler secret put LINEAR_OAUTH_CLIENT_ID
pnpm wrangler secret put LINEAR_OAUTH_CLIENT_SECRET
pnpm wrangler secret put LINEAR_OAUTH_REDIRECT_URI
pnpm wrangler secret put SESSION_SECRET
pnpm wrangler secret put APP_BASE_URL
pnpm wrangler secret put SLACK_WEBHOOK_URL  # only if you use Slack notifications

pnpm run deploy
```

After deploying, reflect the workers.dev URL in your Linear OAuth app's Redirect URL (`https://.../auth/linear/callback`) and in `LINEAR_OAUTH_REDIRECT_URI` / `APP_BASE_URL`.

## Configuration

| Setting | Where | Description |
| --- | --- | --- |
| `STORY_POINT_LABEL_NAME` | `vars` in `wrangler.jsonc` | Label name that identifies the StoryPoint Issue. Default: `StoryPointIssue` |
| Reminder time | `triggers.crons` in `wrangler.jsonc` | Default `0 6 * * *` (06:00 UTC = 15:00 JST). Cron runs in UTC — adjust to your timezone |

## Contributing

Issues and Pull Requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
