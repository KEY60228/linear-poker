# コントリビューションガイド

Linear Planning Poker への Issue / Pull Request を歓迎します。このドキュメントでは開発環境の準備から PR を出すまでの流れと、守ってほしい規約をまとめます。

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

## 変更の流れ

1. Issue で提案・報告する（大きめの変更は着手前に方向性をすり合わせるのがおすすめです）
2. `main` からトピックブランチを切る
3. 変更を加え、後述のチェックを通す
4. `main` に向けて Pull Request を作成する

### PR を出す前のチェック

```bash
pnpm typecheck   # worker / web 両方の tsconfig で型チェック
pnpm build       # フロントのビルドが通ることを確認
```

`migrations/` を変更した場合は `pnpm db:migrate:local` を実行し、ローカルで動作確認してください。マイグレーションは追記のみとし、既存ファイルは編集しないでください。

## コミット・PR の規約

コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/) 形式を使います。subject は日本語で構いません。

```
feat(wizard): 既にセッションがある Project をロック表示にする
fix(do): 開票済みセッションで再投票時に round_no が進まない問題を修正
chore(deploy): workers.dev を有効化
```

PR は 1 つの関心ごとに 1 つ、レビューしやすい粒度でお願いします。

## コードの規約

- **TypeScript strict** を維持する（`tsconfig.worker.json` は Workers ランタイム、`tsconfig.web.json` はブラウザ向け）
- Worker では Node.js ビルトインより **Web API を優先**する（`crypto.subtle`, `fetch`, `URL`, `TextEncoder` など）
- **Linear API 呼び出しは `src/worker/lib/linear.ts` 経由**にする。ルートから `@linear/sdk` を直接触らない
- **セッション/トークンの読み取りは `src/worker/lib/session.ts` 経由**にする。ルートで KV バインディングを直接触らない
- ラベル名 `StoryPointIssue` などの設定値をハードコードしない（`STORY_POINT_LABEL_NAME` を参照する）

## 設計上の前提（壊さないでほしいもの）

ドメインルールの全体像は [CLAUDE.md](./CLAUDE.md) と [docs/handoff.md](./docs/handoff.md) にまとまっています。特に以下は仕様として固定です。

- 1 セッション = 1 Linear Project = 1 StoryPoint Issue
- セッションの状態機械: `voting → (needs_discussion ↔ voting) → revealed → finalized`。再投票は `revealed → voting` で新しい `round_no` を開始する
- 投票中は「誰が投票したか」のみ公開し、値は開票まで非公開（本人の投票値のみ本人に返す）
- `need_info` は有効な投票値。全員投票済みの判定に含み、リマインダー対象から除外する
- 自動開票は `need_info` 投票者ゼロが条件。`need_info` がいる場合は `needs_discussion` に遷移する
- Slack 通知はセッション開始とデイリーリマインダーのみ。開票・確定では通知しない
- Slack は Incoming Webhook のみで完結させる。Bot Token や Linear↔Slack ユーザーマッピングを要求する変更は、明示的な仕様変更なしには入れない
- Linear への書き戻し（Estimate + Project status）は冪等に保つ

これらを変更する提案自体は歓迎です。その場合は実装前に Issue で議論してください。

## バグ報告

Issue には以下を含めてもらえると助かります。

- 再現手順と期待する挙動 / 実際の挙動
- 実行環境（ローカル `wrangler dev` か本番デプロイか）
- 関連するセッションのステータス（voting / needs_discussion / revealed / finalized）

トークンや `.dev.vars` の内容など、秘密情報を貼らないよう注意してください。

## ライセンス

コントリビュートされたコードは、本リポジトリの [MIT ライセンス](./LICENSE)の下で公開されることに同意したものとみなします。
