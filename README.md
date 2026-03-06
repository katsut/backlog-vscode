# Nulab Workspace Extension

Backlog / Slack / Google Calendar / Google Drive / Cacoo を VSCode に統合するワークスペース拡張機能。AI チャット（Claude CLI）を各エディターに内蔵。

## Features

### Backlog

- **Issues** — プロジェクト・課題をツリービューで閲覧、Webview で詳細表示（コメント・添付ファイル対応）
- **My Tasks** — 自分に割り当てられた課題を一覧
- **Notifications** — Backlog 通知の閲覧・管理
- **Wiki** — プロジェクト Wiki の閲覧
- **Documents** — ドキュメント閲覧・編集（AI チャット付き）

### Slack

- **Notifications** — メンション・DM 通知の閲覧
- **Search** — キーワード検索でメッセージを横断検索
- **Thread** — スレッドの閲覧・返信

### Google Calendar

- **予定表示** — 設定日数範囲の予定をツリービューで表示
- **議事録連携** — Gemini 自動生成メモや添付ドキュメントを VSCode 内で閲覧
- **イベント詳細** — 参加者・Meet リンク・説明文を Webview で表示

### Google Drive

- **ファイル検索** — キーワードで Google Drive を全文検索
- **ファイルを開く** — Google Docs・テキスト・画像は VSCode 内で、その他はブラウザで開く

### Cacoo

- **Diagrams** — Cacoo ダイアグラムの閲覧

### TODO / AI チャット

- **タスク管理** — Backlog 通知・Slack メンション・議事録から TODO を作成
- **AI チャット** — TODO エディター・ドキュメントエディター内で Claude と対話。回答ドラフト作成、文書校正、質問応答に対応
- **モデル選択** — Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5 を用途に応じて切り替え
- **ストリーミング** — リアルタイムで応答を表示、途中停止可能

## Setup

### 1. Backlog

#### API キーの取得

1. Backlog にログイン → 「個人設定」→「API」
1. API キーを生成してコピー

#### Backlog: VSCode 設定

1. `Cmd+Shift+P` → `Backlog: Set API Key` でキーを入力（Secret Storage に暗号化保存）
1. Settings (`Cmd+,`) で以下を設定:

```json
{
  "nulab.backlog.domain": "yourspace.backlog.jp"
}
```

| Setting | Description | Default |
| --- | --- | --- |
| `nulab.backlog.domain` | Backlog スペースのドメイン | - |
| `nulab.backlog.autoRefresh` | 自動更新の有効化 | `true` |
| `nulab.backlog.refreshInterval` | 更新間隔（秒） | `300` |
| `nulab.backlog.notificationPollingInterval` | 通知ポーリング間隔（秒） | `60` |
| `nulab.backlog.favoriteProjects` | お気に入りプロジェクトキー一覧 | `[]` |
| `nulab.backlog.autoTodoEnabled` | 通知から自動 TODO 作成 | `true` |
| `nulab.backlog.autoTodoReasons` | 自動 TODO 対象の通知種別 | (後述) |

#### autoTodoReasons の設定

Backlog 通知のうち、どの種別を自動で TODO に変換するかを配列で指定します。

```json
{
  "nulab.backlog.autoTodoReasons": [1, 2, 3, 5, 9, 10]
}
```

| ID | 通知種別 |
| --- | --- |
| 1 | 課題の担当者に設定 |
| 2 | 課題にコメント |
| 3 | 課題の追加 |
| 5 | Wiki の追加 |
| 9 | 課題をまとめて更新 |
| 10 | プロジェクトに参加 |

### 2. Slack

Slack 連携には **User OAuth Token (`xoxp-`)** が必要です。Bot Token (`xoxb-`) では検索機能が利用できません。

#### Slack App の作成

1. [Slack API: Your Apps](https://api.slack.com/apps) → 「Create New App」→「From scratch」
1. 「OAuth & Permissions」で以下の **User Token Scopes** を追加:

| スコープ | 用途 |
| --- | --- |
| `channels:read` | パブリックチャンネル一覧 |
| `groups:read` | プライベートチャンネル一覧 |
| `im:read` | DM 一覧 |
| `mpim:read` | グループ DM 一覧 |
| `channels:history` | パブリックチャンネルのスレッド取得 |
| `groups:history` | プライベートチャンネルのスレッド取得 |
| `im:history` | DM のスレッド取得 |
| `mpim:history` | グループ DM のスレッド取得 |
| `search:read` | メッセージ検索 |
| `chat:write` | メッセージ返信 |
| `users:read` | ユーザー名の解決 |
| `usergroups:read` | ユーザーグループの取得 |

1. 「Install to Workspace」→ 発行された **User OAuth Token** (`xoxp-...`) をコピー

#### Slack: VSCode 設定

1. `Cmd+Shift+P` → `Slack: Set Token` でトークンを入力

| Setting | Description | Default |
| --- | --- | --- |
| `nulab.slack.pollingInterval` | ポーリング間隔（秒） | `60` |
| `nulab.slack.includeDMs` | DM を通知に含める | `false` |
| `nulab.slack.autoTodoEnabled` | メンションから自動 TODO 作成 | `true` |
| `nulab.slack.autoTodoDMs` | DM も自動 TODO 対象にする | `false` |

### 3. Google Calendar / Drive

Google Calendar の予定表示・議事録閲覧と、Google Drive のファイル検索に対応。

#### GCP で OAuth クライアントを作成

1. [GCP Console](https://console.cloud.google.com/) でプロジェクトを選択
1. 「Google Calendar API」と「Google Drive API」を有効化
1. 「OAuth 同意画面」→ **内部** を選択 → アプリ名を入力して保存
1. 「認証情報」→「認証情報を作成」→ **OAuth クライアント ID**
1. アプリケーションの種類: **デスクトップアプリ** → 作成
1. **クライアント ID** と **クライアントシークレット** をメモ

#### Google: VSCode 設定

1. Settings (`Cmd+,`) で `nulab.google.clientId` にクライアント ID を設定
1. `Cmd+Shift+P` → `Nulab: Set Google Client Secret` でシークレットを入力
1. `Cmd+Shift+P` → `Nulab: Sign in to Google` でブラウザ認証

| Setting | Description | Default |
| --- | --- | --- |
| `nulab.google.clientId` | OAuth Client ID | - |
| `nulab.google.calendarId` | カレンダー ID | `primary` |
| `nulab.google.daysRange` | 表示する日数範囲（前後） | `7` |

認証後、Notifications サイドバーに **Google: Calendar** と **Google: Drive** ビューが表示されます。

#### Google Drive 検索の使い方

1. **Google: Drive** ビューで検索ボタンをクリック
1. キーワードを入力して検索
1. 結果をクリックしてファイルを開く
   - **Google Docs / テキスト / 画像** → VSCode 内で表示
   - **スプレッドシート / スライド / 動画 / PDF / その他** → ブラウザで開く
1. コマンドパレットからも `Nulab: Search Google Drive` で検索可能

#### サインアウト・再認証

- `Cmd+Shift+P` → `Google: Sign Out` でサインアウト
- 再度 `Sign in to Google` で別アカウントに切り替え可能
- Client Secret は Secret Storage に暗号化保存（`Nulab: Set Google Client Secret` で再設定）

### 4. Cacoo

| Setting | Description |
| --- | --- |
| `nulab.cacoo.organizationKey` | Cacoo 組織キー |

### 5. AI チャット（Claude CLI 統合）

TODO エディターやドキュメントエディター内に Claude チャットが組み込まれています。

#### 前提条件

- **Claude CLI** (`claude` コマンド) がインストール済みであること
- Claude CLI で認証済みであること（`claude login`）
- macOS の場合、`/opt/homebrew/bin` にパスが通っていること（GUI 起動の VSCode でも自動対応）

#### 使い方

1. **TODO エディター** — TODO を開くと右側にチャットパネルが表示される
   - 通知の背景情報（Backlog 課題詳細・Slack スレッド等）がシステムプロンプトに自動セット
   - 返信ドラフトの作成、課題の深掘り調査に利用
1. **ドキュメントエディター** — Backlog ドキュメントを開くと右側にチャットパネル
   - ドキュメント内容をコンテキストとして校正・要約・質問応答
1. **ドキュメント閲覧** — 読み取り専用のドキュメントビューにもチャット付き

#### モデル選択

チャットパネル上部のドロップダウンで切り替え可能。選択はブラウザの localStorage に永続化されます。

| モデル | 用途 |
| --- | --- |
| Claude Opus 4.6 | 複雑な分析・長文ドラフト作成 |
| Claude Sonnet 4.6 | バランス型（デフォルト） |
| Claude Haiku 4.5 | 軽量・高速な質問応答 |

#### 技術的な仕組み

- Claude CLI をサブプロセスとして `spawn('claude', args)` で起動
- `--output-format stream-json --include-partial-messages` でストリーミング JSON を受信
- セッション管理: 初回は `--session-id` で新規作成、以降は `--resume` で会話を継続
- Webview (React) と Extension 間は `postMessage` で双方向通信

## Development

### Build Commands

```bash
npm run compile          # TypeScript コンパイル
npm run watch            # ウォッチモード
npm run lint             # ESLint
npm run format           # Prettier
npm run install:local    # ビルド → パッケージ → ローカルインストール
```

インストール後は `Cmd+Shift+P` → `Developer: Reload Window` でリロード。

### Architecture

```text
src/
├── commands/          # コマンドハンドラー
│   ├── backlog/       #   Backlog 関連
│   ├── google/        #   Google Calendar / Drive
│   └── workspace/     #   Slack, TODO 等
├── config/            # 設定管理
├── providers/         # TreeView / Webview プロバイダー
├── services/          # API クライアント・同期サービス
├── types/             # 型定義
└── webviews/          # Webview HTML 生成 (React)
    ├── components/    #   ClaudeChat, TodoHeader 等
    ├── entries/       #   todoView, documentView 等
    └── hooks/         #   useVSCodeMessage 等
```

### Technologies

- TypeScript
- VS Code Extension API (TreeView, Webview, Custom Editor, Secret Storage)
- React (Webview UI)
- esbuild (Webview バンドル)
- backlog-js (Backlog API)
- Slack Web API
- Google Calendar / Drive API (OAuth2)
- Claude CLI (AI チャット)

## Troubleshooting

- **拡張が動作しない** — API URL・キーの設定を確認。開発者コンソール (`Cmd+Shift+I`) でエラーを確認
- **データが表示されない** — プロジェクトのアクセス権限を確認。更新ボタンでリロード
- **Google 認証エラー** — Client ID / Secret を再設定し、`Sign in to Google` を再実行
- **Slack トークンエラー** — `xoxp-` で始まる User OAuth Token を使用しているか確認
- **AI チャットが動作しない** — `claude --version` でCLI がインストール済みか確認。`claude login` で認証済みか確認
- **AI チャットの起動エラー** — GUI で起動した VSCode では PATH に `/opt/homebrew/bin` が含まれないことがある。ターミナルから `code .` で起動するか、シェルの PATH 設定を確認
