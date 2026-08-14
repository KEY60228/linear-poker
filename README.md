# Linear Planning Poker

非同期プランニングポーカーを Linear の Project に紐づけて行い、合意した Estimate を Linear に書き戻すセルフホスト型の Web サービス。Cloudflare Workers 上で動作する OSS です。

## できること

- Linear の Project 単位でプランニングポーカーのセッションを作成
- 参加者が非同期に投票。全員が投票すると自動で開票（誰が投票済みかは公開、値は開票まで非公開）
- 「見積もれない・情報が足りない」を表す `need_info` 投票と、それに伴う「議論待ち」ステータス
- 開票後は中央値 / 平均 / 最頻値 / レンジと、ワークスペースの Estimate スケールへスナップした確定候補を表示
- 確定すると Linear の Estimate フィールドへ書き戻し、Project ステータスを `Planned` に更新
- 再投票（同一セッション内で新しいラウンドを開始）
- Slack 通知: セッション開始時と、未投票者へのデイリーリマインダー（デフォルト JST 15:00）

## アーキテクチャ

- **Runtime**: Cloudflare Workers + [Hono](https://hono.dev)
- **強整合ステート**: Durable Object（1 セッション = 1 DO）
- **永続化**: D1（SQLite）
- **トークン保管**: Workers KV（`TOKENS`）
- **Linear API レスポンスキャッシュ**: Workers KV（`LINEAR_CACHE`、TTL 5 分）
- **Cron**: Cloudflare Cron Trigger（リマインダー用）
- **フロント**: React + Vite、ビルド成果物を Workers Assets で同居配信
- **Linear API**: `@linear/sdk`（OAuth2 トークン）

## 前提

- [Cloudflare アカウント](https://dash.cloudflare.com/sign-up)（Workers 無料プランで動作します）
- Linear ワークスペースの管理権限（OAuth アプリとラベルを作成するため）
- Node.js 20+ / [pnpm](https://pnpm.io)

## セットアップ

### 1. Linear 側の準備

#### StoryPoint ラベルと Issue

本サービスは「1 セッション = 1 Linear Project = 1 StoryPoint Issue」という運用を前提としています。見積もりの書き込み先となる Issue を、特定のラベルで識別します。

1. Linear で Issue ラベルを作成する。名前はデフォルトで **`StoryPointIssue`**（`wrangler.jsonc` の `STORY_POINT_LABEL_NAME` で変更可能）
2. ポーカー対象にしたい Project ごとに、見積もりを書き込む Issue を 1 つ用意し、このラベルを付ける

> 1 つの Project 内にラベル付き Issue が複数あると対象を特定できないため、Project あたり 1 Issue にしてください。

#### OAuth アプリ

Linear ワークスペースの Settings → API → Applications で OAuth Application を作成し、Redirect URL に以下を登録します。

- ローカル: `http://localhost:8787/auth/linear/callback`
- 本番: `https://<your-deployment>.workers.dev/auth/linear/callback`（独自ドメインの場合はそのドメイン）

Client ID / Client Secret は後の手順で使います。

### 2. 依存をインストール

```bash
pnpm install
```

### 3. Cloudflare リソースを作る

```bash
# D1
pnpm wrangler d1 create linear_poker_db
# 出力された database_id を wrangler.jsonc の d1_databases[0].database_id に貼る

# KV (tokens)
pnpm wrangler kv namespace create TOKENS
# 出力された id を wrangler.jsonc の kv_namespaces（binding: TOKENS）の id に貼る

# KV (linear api cache)
pnpm wrangler kv namespace create LINEAR_CACHE
# 出力された id を wrangler.jsonc の kv_namespaces（binding: LINEAR_CACHE）の id に貼る
```

### 4. マイグレーション

```bash
pnpm db:migrate:local
# 本番:
pnpm db:migrate:remote
```

### 5. ローカル環境変数

`.dev.vars.example` を `.dev.vars` にコピーして埋めます。

```bash
cp .dev.vars.example .dev.vars
```

| 変数 | 説明 |
| --- | --- |
| `LINEAR_OAUTH_CLIENT_ID` | Linear OAuth アプリの Client ID |
| `LINEAR_OAUTH_CLIENT_SECRET` | Linear OAuth アプリの Client Secret |
| `LINEAR_OAUTH_REDIRECT_URI` | OAuth コールバック URL（ローカルは既定値のままで可） |
| `SESSION_SECRET` | Cookie 署名用のランダム文字列 |
| `APP_BASE_URL` | Slack 通知に埋め込むアプリの URL |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook の URL（空なら Slack 通知は無効） |

`SESSION_SECRET` は十分に長いランダム文字列を入れます:

```bash
openssl rand -base64 48
```

#### Slack 通知（任意）

Slack 通知を使う場合は [Incoming Webhook](https://api.slack.com/messaging/webhooks) を作成し、その URL を `SLACK_WEBHOOK_URL` に設定します。通知はセッション開始時とデイリーリマインダーの 2 種類のみで、Bot Token や Linear↔Slack のユーザーマッピングは不要です（参加者名はプレーンテキストで埋め込まれ、@メンションはしません）。

### 6. 開発サーバ

```bash
pnpm dev
```

- Worker: <http://localhost:8787>
- フロント (Vite): <http://localhost:5173>（`/api` `/auth` は Worker にプロキシ）

ログインフロー全体は <http://localhost:8787> 側で完結します（OAuth コールバックは Worker 側に来る）。

#### Cron（デイリーリマインダー）をローカルで動かす

`wrangler dev` は `--test-scheduled` 付きで起動しているため、開発サーバ起動中に以下を叩くと scheduled ハンドラを手動実行できます。

```bash
curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"
```

`cron` パラメータには `wrangler.jsonc` の `triggers.crons` に登録した式を URL エンコードして渡します。

### 7. デプロイ

```bash
# 本番用シークレットを設定
pnpm wrangler secret put LINEAR_OAUTH_CLIENT_ID
pnpm wrangler secret put LINEAR_OAUTH_CLIENT_SECRET
pnpm wrangler secret put LINEAR_OAUTH_REDIRECT_URI
pnpm wrangler secret put SESSION_SECRET
pnpm wrangler secret put APP_BASE_URL
pnpm wrangler secret put SLACK_WEBHOOK_URL  # Slack 通知を使う場合のみ

pnpm run deploy
```

デプロイ後、表示された workers.dev の URL を Linear OAuth アプリの Redirect URL（`https://.../auth/linear/callback`）と `LINEAR_OAUTH_REDIRECT_URI` / `APP_BASE_URL` に反映してください。

## 設定

| 設定 | 場所 | 説明 |
| --- | --- | --- |
| `STORY_POINT_LABEL_NAME` | `wrangler.jsonc` の `vars` | StoryPoint Issue を識別するラベル名。デフォルト `StoryPointIssue` |
| リマインダー時刻 | `wrangler.jsonc` の `triggers.crons` | デフォルト `0 6 * * *`（UTC 06:00 = JST 15:00）。Cron は UTC で解釈されるため、自分のタイムゾーンに合わせて変更してください |

## コントリビュート

Issue / Pull Request を歓迎します。開発の流れや規約は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
