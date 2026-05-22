# Linear Planning Poker Service — 引き継ぎ書

Linear の Project に対して非同期プランニングポーカーを行う Web サービスを、Cloudflare 上に OSS / セルフホスト前提で構築する。本ドキュメントは初回ディスカッションで合意した設計の引き継ぎ用。

---

## 1. プロダクト概要

### 目的
Linear の Project に対して、チームメンバーが非同期で見積もり投票（プランニングポーカー）を行い、合意した Estimate を Linear に書き戻す。

### コアコンセプト
- **Project ごとに Estimate を持つ Issue は 1 つだけ**にする運用前提
- その Issue は `story-point` ラベル（名称は env で変更可能）で識別
- Project Template で Project 作成時に該当 Issue が自動生成されている前提
- Issue の増減で Project の Estimate がブレないことを保証する

### 利用フロー
1. ユーザーが Linear OAuth でログイン
2. Team を選択
3. Backlog ステータスの Project 一覧から対象を選ぶ
4. その Project 内の StoryPoint Issue が自動検出され、セッションが作成される
5. 参加者を招待（Linear ワークスペースメンバーのみ）
6. 各参加者が非同期で投票
7. 全員投票完了で自動開票（アプリ内で完結。Slack 通知なし）
8. 同期会議で議論し、確定値を入力 → Linear に書き戻し
9. 値が割れたら再投票（同 Issue で round を増やす）

---

## 2. 決定事項一覧

### 対象 Project
- **Project の status が `Backlog`** のもののみ対象
- セッション作成時に **Team を選んで絞り込み** する UI を提供

### 対象 Issue
- 各 Project 内の **`story-point` ラベル付き Issue**（ラベル名は env で変更可能にする）
- Project Template で Project 作成時に自動生成される想定
- **1 セッション = 1 Project = 1 Issue**
- ラベル付き Issue が見つからない場合のフォールバック UX が必要

### 認証
- **Linear OAuth2** のみ
- 未契約のゲストは入れない（Linear ワークスペースメンバーであること）

### 投票
- **Estimate スケール**: Linear のワークスペース設定に追随（None / Exponential / Fibonacci / Linear / T-shirt）
- **特殊選択肢**: `need_info`（"見積もれない、要詳細"）
  - 投票値の 1 種として扱う（"全員投票した" の判定に含まれる）
  - 開票時に "@alice は要詳細" と明示表示
  - **リマインダー対象から除外**（既に意思表示済みのため）
  - **`need_info` 投票者がいる間は自動開票しない**（議論待ち。詳細は「開票」セクション参照）
- **投票前の可視性**: 誰が投票済か可視 / 何を出したかは秘匿
- **開票後の可視性**: 誰が何を出したか全公開

### 開票
- **全員投票完了 かつ `need_info` 投票者がゼロ** で自動開票
- `need_info` 投票者がいる場合は **`voting` 状態のまま「議論待ち」バッジを表示** し、自動開票は保留
  - デフォルトは「`need_info` を出した人が値を変更するまで待つ」（変更されたら開票条件を再評価）
  - エスケープハッチとして **誰でも押せる手動 reveal ボタン** を提供（議論を踏まえて先に進めたい場合）
  - 状態マシン上は `voting` のまま。新しいステータスは追加しない
- 開票通知はアプリ内のみ（Slack には流さない）

### 確定（Linear への書き戻し）
- **誰でも確定可能**（参加者なら誰でも押せる）
- 確定 UI で参考値として **中央値・最頻値・平均・レンジ** を表示
- `need_info` の人がいる場合は警告表示（押すことは可能）
- 確定したら Linear の Estimate フィールドに書き戻し（Slack 通知はしない）
- 同時に **Project の status を `Planned` に変更** する（見積もり完了 = 着手可能、を意味する状態に進める）
- Linear の Estimate スケールに丸める必要あり（Fibonacci なら 1,2,3,5,8,...）

### 再投票
- 値が割れたら同 Issue で `round_no` をインクリメントして再投票
- 過去 round の結果は履歴で参照可能
- 参加者は同じ（必要に応じて追加/削除可能）

### 参加者管理
- **招待制**（参加者を明示指定）
- 途中での **追加/削除は誰でも可能**

### リマインダー
- **JST 15:00 に毎日**（Cron Trigger: `0 6 * * *` UTC）
- 対象: `voting` 状態のセッションで未投票の人
- `need_info` を選択済みの人は除外
- `revealed` 以降のセッションには通知しない（投票完了で止める）

### Slack 通知のトリガー
- セッション開始（"投票してね" + リンク）
- リマインダー（"未投票: Alice, Bob"）

開票・確定では Slack 通知を **送らない**（アプリ内で完結する）。

### Slack ユーザー連携
- **Linear ↔ Slack のユーザーマッピングは持たない**
- 通知本文では Linear の `displayName` をプレーンテキストで埋める（@メンションにはしない）
- セットアップは `SLACK_WEBHOOK_URL`（Incoming Webhook URL）の env だけで完結させる
- 将来的に Bot Token を入れて `users.lookupByEmail` で自動メンション化、という拡張余地は残すが、v1 では入れない

### マネタイズ・配布
- **OSS**、セルフホスト前提
- マネタイズなし
- 各チームが自身の Cloudflare アカウントにデプロイ
- Linear OAuth Client ID/Secret、Slack Webhook URL は env で各自設定

---

## 3. アーキテクチャ

### 技術スタック
- **Runtime**: Cloudflare Workers
- **API Framework**: Hono
- **強整合ステート**: Durable Object（1 セッション = 1 DO）
- **永続化**: D1（SQLite）
- **Cron**: Cloudflare Cron Trigger
- **フロント**: React + Workers Assets（または Pages）
- **Slack**: Incoming Webhook URL（env 設定）
- **Linear API**: GraphQL（OAuth2 トークン使用）

### Durable Object 設計
- 1 セッション = 1 DO インスタンス
- 同時投票・全員投票判定・開票ロックを強整合に処理
- 状態遷移: `voting` → `revealed`（自動）→ `finalized`（手動）
- 再投票時: `revealed` または `voting` → `voting`（新 round）

### 状態マシン

```
Session
  status: voting | revealed | finalized

  voting:
    - 参加者が投票中
    - 投票済み/未投票 のみ可視（値は秘匿）
    - 全員投票完了 かつ need_info 投票者ゼロ で revealed へ自動遷移
    - need_info 投票者がいる場合は「議論待ち」バッジを表示し自動開票を保留
      （手動 reveal ボタンで誰でも先に進められる）
    - 参加者の追加/削除可

  revealed:
    - 全員の投票値が見える
    - 中央値・最頻値・平均・レンジ表示
    - finalize で finalized へ / revote で voting へ
    - リマインダー停止

  finalized:
    - Linear に書き戻し済み
    - 履歴として参照可能
    - 「Revert finalization」操作で revealed に戻せる（ローカル状態のみ変更。
      Linear 側の Estimate / Project status は触らない — Linear 側で値が
      revert された後にアプリ側の状態を追従させる用途）
```

### データモデル（D1）

```sql
sessions(
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  facilitator_id TEXT NOT NULL,
  status TEXT NOT NULL,  -- voting | revealed | finalized
  current_round_no INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
)

participants(
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id)
)

rounds(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  revealed_at INTEGER
)

votes(
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value TEXT NOT NULL,  -- "1" | "2" | ... | "need_info"
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id)
)

final_estimates(
  session_id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  finalized_by TEXT NOT NULL,
  finalized_at INTEGER NOT NULL
)
```

### 依存方向 / 構成方針
- フロント (SPA) は Workers Assets で配信、API は同じ Worker で Hono ルーティング
- Linear API 呼び出しは Worker から直接（OAuth トークンは KV または D1 で暗号化保存）
- Slack 通知は Webhook URL に POST するだけ

---

## 4. 環境変数（セルフホスト時に設定）

```
LINEAR_OAUTH_CLIENT_ID=
LINEAR_OAUTH_CLIENT_SECRET=
LINEAR_OAUTH_REDIRECT_URI=
SLACK_WEBHOOK_URL=
STORY_POINT_LABEL_NAME=story-point  # デフォルト、上書き可能
SESSION_SECRET=  # Cookie 署名用
APP_BASE_URL=  # https://your-deployment.workers.dev など
```

---

## 5. API サーフェス（暫定）

```
GET    /auth/linear         # OAuth 開始
GET    /auth/linear/callback

GET    /api/teams           # ログインユーザーが所属する Team 一覧
GET    /api/teams/:teamId/backlog-projects
                            # status=Backlog の Project 一覧

POST   /api/sessions        # セッション作成（projectId, participantIds）
GET    /api/sessions/:id    # セッション詳細
DELETE /api/sessions/:id    # 中止

POST   /api/sessions/:id/participants     # 参加者追加
DELETE /api/sessions/:id/participants/:userId  # 参加者削除

POST   /api/sessions/:id/votes            # 投票（value）
POST   /api/sessions/:id/finalize         # 確定（value）
POST   /api/sessions/:id/revote           # 再投票開始

# Cron でトリガーされる内部処理
# - daily reminder
```

---

## 6. Linear API 呼び出し

### GraphQL クエリ
- `viewer` / `teams` でログインユーザーの所属 Team 取得
- `projects(filter: { status: { type: { eq: "backlog" } } })` で Backlog Project 取得
- `issues(filter: { project: {...}, labels: {...} })` で StoryPoint Issue 取得
- `issueUpdate(input: { estimate: ... })` で Estimate 書き戻し

### Webhook（任意・後回し可）
- Project status 変化を受けてセッション自動クローズ、など
- 最初は不要、後付け可能

---

## 7. 開発マイルストーン案

### v0.1 — Skelton
- [ ] Cloudflare Workers + Hono 雛形
- [ ] Wrangler 設定、D1 / DO のバインディング
- [ ] Linear OAuth ログイン + セッション Cookie
- [ ] フロント雛形（React + Vite）

### v0.2 — セッション作成 / 投票
- [ ] Team / Backlog Project 一覧
- [ ] StoryPoint Issue 検出
- [ ] セッション作成 + 参加者招待
- [ ] 投票 UI（Estimate スケール + `need_info`）
- [ ] 全員投票で自動開票（DO で実装）

### v0.3 — 確定 / 再投票
- [ ] 開票後の参考値表示（中央値・最頻値・平均・レンジ）
- [ ] 確定 → Linear 書き戻し
- [ ] 再投票

### v0.4 — Slack / Cron
- [ ] Slack 通知（セッション開始 / リマインダー のみ）
- [ ] Cron Trigger でリマインダー（JST 15:00）

### v0.5 — 仕上げ
- [ ] 参加者の途中追加/削除
- [ ] フォールバック UX（StoryPoint Issue が無い時など）
- [ ] README / セルフホスト手順

---

## 8. 残っている小ネタ・要確認事項

- **`story-point` ラベル名の env オーバーライド**: 実装時に必ず env 化すること
- **OAuth トークンの保管**: D1 暗号化 or KV、Cloudflare Secrets の使い方を検討
- **Linear Estimate スケールが None の場合**: エラー表示か、独自スケールで投票させて書き戻しなしにするか
- **Team 跨ぎの Project**: Linear では Project が複数 Team に属しうるが、UI 上は Team 1 つを選択させて単純化
- **同時編集の競合**: DO で吸収するので問題なし
- **削除済み参加者の投票履歴**: 履歴は残す方針が安全

---

## 9. 直近のディスカッション履歴（要約）

1. 「Linear で非同期プランニングポーカーをやりたい、Cloudflare に乗せたい」が出発点
2. 実現性: Linear GraphQL + Workers + DO + D1 で十分実現可能
3. 認証は Linear OAuth、ゲストなし
4. Estimate は自動書き戻し
5. Slack 通知あり（開始・リマインダーのみ。開票・確定はアプリ内）
6. OSS / セルフホスト前提
7. 投票単位: 1 Project = 1 StoryPoint Issue（運用前提として固定）
8. ラベルで Issue を識別
9. 投票: 開票前は誰が済か可視/値は秘匿、開票後は全公開
10. 確定権限は誰でも可
11. リマインダー: JST 15:00 / `revealed` 以降は止める
12. Team 絞り込み UI あり
13. `need_info` 選択肢を追加、これを選んだ人はリマインダー除外

---

## 10. 次セッションへのお願い

- 新しいリポジトリで `pnpm create cloudflare` などをベースに雛形作成
- 本書を CLAUDE.md / AGENTS.md / README.md のいずれかに反映
- v0.1（Skelton）から着手し、認証通るところまでを最初の PR にする
- Linear API 周りは `@linear/sdk` を使うか、生 GraphQL を fetch するか、初手で検討

---
