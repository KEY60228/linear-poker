# コントリビューションガイド

Linear Planning Poker への Issue / Pull Request を歓迎します。

## 開発環境

セットアップ手順は [README.md](./README.md) の「セットアップ」を参照してください。ローカル開発には以下が必要です。

- Node.js 20+ / pnpm（バージョンは `package.json` の `packageManager` に従う）
- Linear の OAuth アプリ（ローカル用に Redirect URL `http://localhost:8787/auth/linear/callback` を登録）
- `.dev.vars`（`.dev.vars.example` をコピーして作成。**コミットしないこと**）

```bash
pnpm install
pnpm db:migrate:local   # D1 マイグレーション（ローカル）
pnpm dev                # Worker (8787) + Vite (5173)
```

## リポジトリ構成

```
src/
  worker/
    index.ts          # Worker エントリ + Hono ルーティング
    env.ts            # Bindings 型定義
    routes/auth.ts    # /auth/linear, /auth/linear/callback, /auth/logout
    routes/api.ts     # セッション操作の REST API
    do/session.ts     # SessionDO（セッションの状態機械）
    lib/linear.ts     # OAuth + LinearClient ラッパ
    lib/session.ts    # Cookie + KV セッション
    lib/crypto.ts     # HMAC 署名 / ランダム ID
    lib/slack.ts      # Slack 通知
    lib/reminder.ts   # デイリーリマインダー（Cron）
    lib/cache.ts      # Linear API レスポンスの KV キャッシュ
    lib/db.ts         # D1 アクセス
  web/                # React + Vite SPA
migrations/           # D1 スキーマ (sessions/participants/rounds/votes/final_estimates)
```

## バグ報告

再現手順と実行環境（ローカル `wrangler dev` か本番デプロイか）を書いてもらえると助かります。

## ライセンス

コントリビュートされたコードは、本リポジトリの [MIT ライセンス](./LICENSE)の下で公開されることに同意したものとみなします。
