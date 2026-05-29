# Linear Planning Poker

非同期プランニングポーカーを Linear の Project に紐づけて行い、合意した Estimate を Linear に書き戻す OSS / セルフホスト前提の Web サービス。Cloudflare Workers の上で動く。

> **Status: v0.1 (Skelton)** — Workers + Hono + D1/DO/KV のバインディングと、Linear OAuth ログイン + Cookie セッションまで。投票・確定・Slack 通知は v0.2 以降。

## アーキテクチャ

- **Runtime**: Cloudflare Workers + [Hono](https://hono.dev)
- **強整合ステート**: Durable Object（1 セッション = 1 DO）
- **永続化**: D1（SQLite）
- **トークン保管**: Workers KV（`TOKENS`）
- **Linear API レスポンスキャッシュ**: Workers KV（`LINEAR_CACHE`、TTL 5 分）
- **Cron**: Cloudflare Cron Trigger（リマインダー用、JST 15:00 = UTC 06:00）
- **フロント**: React + Vite、ビルド成果物を Workers Assets で同居配信
- **Linear API**: `@linear/sdk`（OAuth2 トークン）

## セットアップ

### 1. 依存をインストール

```bash
pnpm install
```

### 2. Linear OAuth アプリを作成

Linear ワークスペースの Settings → API → Applications で OAuth Application を作成し、Redirect URL に以下を登録する。

- ローカル: `http://localhost:8787/auth/linear/callback`
- 本番: `https://<your-deployment>.workers.dev/auth/linear/callback`

### 3. Cloudflare リソースを作る

```bash
# D1
pnpm wrangler d1 create linear_poker_db
# 出力された database_id を wrangler.jsonc の REPLACE_ME_WITH_D1_DATABASE_ID に貼る

# KV (tokens)
pnpm wrangler kv namespace create TOKENS
# 出力された id を wrangler.jsonc の REPLACE_ME_WITH_KV_NAMESPACE_ID に貼る

# KV (linear api cache)
pnpm wrangler kv namespace create LINEAR_CACHE
# 出力された id を wrangler.jsonc の REPLACE_ME_WITH_LINEAR_CACHE_KV_ID に貼る
```

### 4. マイグレーション

```bash
pnpm db:migrate:local
# 本番:
pnpm db:migrate:remote
```

### 5. ローカル環境変数

`.dev.vars.example` を `.dev.vars` にコピーして埋める。

```bash
cp .dev.vars.example .dev.vars
```

`SESSION_SECRET` は十分に長いランダム文字列を入れる:

```bash
openssl rand -base64 48
```

### 6. 開発サーバ

別のターミナルで:

```bash
pnpm dev
```

- Worker: <http://localhost:8787>
- フロント (Vite): <http://localhost:5173>（`/api` `/auth` は Worker にプロキシ）

ログインフロー全体は <http://localhost:8787> 側で完結する（OAuth コールバックは Worker 側に来る）。

### 7. デプロイ

```bash
# 本番用シークレットを設定
pnpm wrangler secret put LINEAR_OAUTH_CLIENT_ID
pnpm wrangler secret put LINEAR_OAUTH_CLIENT_SECRET
pnpm wrangler secret put LINEAR_OAUTH_REDIRECT_URI
pnpm wrangler secret put SESSION_SECRET
pnpm wrangler secret put APP_BASE_URL
pnpm wrangler secret put SLACK_WEBHOOK_URL  # v0.4 以降で利用

pnpm deploy
```

## ディレクトリ

```
src/
  worker/
    index.ts          # Worker エントリ + Hono ルーティング
    env.ts            # Bindings 型定義
    routes/auth.ts    # /auth/linear, /auth/linear/callback, /auth/logout
    routes/api.ts     # /api/me ほか (v0.2 で拡張)
    do/session.ts     # SessionDO (v0.2 で実装)
    lib/linear.ts     # OAuth + LinearClient ラッパ
    lib/session.ts    # Cookie + KV セッション
    lib/crypto.ts     # HMAC 署名 / ランダム ID
  web/                # React + Vite
migrations/
  0001_initial.sql    # D1 スキーマ (sessions/participants/rounds/votes/final_estimates)
```

## 設計メモ

- 1 セッション = 1 Linear Project = 1 StoryPoint Issue を運用前提として固定
- `story-point` ラベルで対象 Issue を識別（ラベル名は `STORY_POINT_LABEL_NAME` で上書き可能）
- 投票値 `need_info` は「見積もれない、要詳細」を表す特殊選択肢。リマインダー対象から除外
- 全員投票完了 **かつ `need_info` 投票者ゼロ** で自動開票。`need_info` がいる間は「議論待ち」バッジを表示し、手動 reveal で脱出可能（開票・確定の Slack 通知は無し）
- Slack 通知は **セッション開始** と **リマインダー** のみ
- 確定後 Linear に書き戻し（Issue Estimate + Project status を `Planned` に更新）
- 再投票は同 Issue 内で `round_no` をインクリメント

詳細は [docs/handoff.md](./docs/handoff.md) を参照。

## ロードマップ

- [x] **v0.1** — Workers + Hono 雛形、Wrangler 設定、D1 / DO / KV バインディング、Linear OAuth ログイン、フロント雛形
- [x] **v0.2** — Team / Backlog Project 一覧、StoryPoint Issue 検出、セッション作成、投票、自動開票（DO）
- [x] **v0.3** — 開票後の参考値表示、確定 → Linear 書き戻し、再投票
- [x] **v0.4** — Slack 通知（セッション開始 + JST 15:00 リマインダー）、Cron Trigger
- [ ] **v0.5** — フォールバック UX、セルフホスト手順整備
