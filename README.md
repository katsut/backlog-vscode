# Nulab Workspace Extension

Backlog / Slack / Google Calendar / Google Drive / Cacoo を VSCode に統合するワークスペース拡張機能。

## Features

### Backlog

- **Issues** — プロジェクト・課題をツリービューで閲覧、Webview で詳細表示（コメント・添付ファイル対応）
- **My Tasks** — 自分に割り当てられた課題を一覧
- **Notifications** — Backlog 通知の閲覧・管理
- **Wiki** — プロジェクト Wiki の閲覧
- **Documents** — ドキュメント閲覧、ローカル同期（Document Sync）

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

### TODO

- **タスク管理** — Backlog 通知・Slack メンション・議事録から TODO を作成
- **Claude Code 連携** — セッションファイルで Claude Code と連携

## Setup

### 1. Backlog

#### API キーの取得

1. Backlog にログイン → 「個人設定」→「API」
2. API キーを生成してコピー

#### VSCode 設定

1. `Cmd+Shift+P` → `Backlog: Set API Key` でキーを入力（Secret Storage に暗号化保存）
2. Settings (`Cmd+,`) で以下を設定:

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

### 3. Google Calendar / Drive

Google Calendar の予定表示・議事録閲覧と、Google Drive のファイル検索に対応。

#### GCP で OAuth クライアントを作成

1. [GCP Console](https://console.cloud.google.com/) でプロジェクトを選択
2. 「Google Calendar API」と「Google Drive API」を有効化
3. 「OAuth 同意画面」→ **内部** を選択 → アプリ名を入力して保存
4. 「認証情報」→「認証情報を作成」→ **OAuth クライアント ID**
5. アプリケーションの種類: **デスクトップアプリ** → 作成
6. **クライアント ID** と **クライアントシークレット** をメモ

#### Google: VSCode 設定

1. Settings (`Cmd+,`) で `nulab.google.clientId` にクライアント ID を設定
2. `Cmd+Shift+P` → `Nulab: Set Google Client Secret` でシークレットを入力
3. `Cmd+Shift+P` → `Nulab: Sign in to Google` でブラウザ認証

| Setting | Description | Default |
| --- | --- | --- |
| `nulab.google.clientId` | OAuth Client ID | - |
| `nulab.google.calendarId` | カレンダー ID | `primary` |
| `nulab.google.daysRange` | 表示する日数範囲（前後） | `7` |

#### Google Drive 検索の使い方

1. Notifications サイドバーの **Google: Drive** ビューで検索ボタン (🔍) をクリック
2. キーワードを入力して検索
3. 結果をクリックしてファイルを開く
   - **Google Docs / テキスト / 画像** → VSCode 内で表示
   - **スプレッドシート / スライド / 動画 / PDF / その他** → ブラウザで開く
4. コマンドパレットからも `Nulab: Search Google Drive` で検索可能

### 4. Cacoo

| Setting | Description |
| --- | --- |
| `nulab.cacoo.organizationKey` | Cacoo 組織キー |

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
└── webviews/          # Webview HTML 生成
```

### Technologies

- TypeScript
- VS Code Extension API (TreeView, Webview, Custom Editor, Secret Storage)
- backlog-js (Backlog API)
- Slack Web API
- Google Calendar / Drive API (OAuth2)

## Troubleshooting

- **拡張が動作しない** — API URL・キーの設定を確認。開発者コンソール (`Cmd+Shift+I`) でエラーを確認
- **データが表示されない** — プロジェクトのアクセス権限を確認。更新ボタンでリロード
- **Google 認証エラー** — Client ID / Secret を再設定し、`Sign in to Google` を再実行
- **Slack トークンエラー** — `xoxp-` で始まる User OAuth Token を使用しているか確認
