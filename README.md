# Nulab Workspace Extension

A VS Code extension to integrate Backlog, Cacoo, and Slack
into your development workflow.

## Features

### Backlog

- **Issues** — Browse projects and issues in a hierarchical tree view; view details, comments, and attachments in a rich webview
- **My Tasks** — Quick access to issues assigned to you
- **Notifications** — View and manage Backlog notifications
- **Wiki** — Browse and read project wiki pages
- **Documents** — Browse project documents with local sync support

### Cacoo

- **Diagrams** — Browse Cacoo diagrams and view individual sheets

### Slack

- **Channels** — Browse Slack channels and read threads
- **Search** — Search Slack messages by keyword or mention

### General

- **TODO** — Track your TODO items

## Installation

### Development Environment Setup

1. Clone the repository

   ```bash
   git clone https://github.com/katsut/nulab-vscode.git
   cd nulab-vscode
   ```

2. Install dependencies

   ```bash
   npm install
   ```

3. Compile TypeScript

   ```bash
   npm run compile
   ```

4. Open in VS Code and press F5 to debug

## Configuration

### 1. Get Backlog API Key

1. Login to Backlog
2. Go to "Personal Settings" → "API"
3. Generate API key
4. Copy the generated API key

### 2. VS Code Settings

#### Set API Key (Secure)

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run `Backlog: Set API Key` command
3. Enter API key (stored securely in Secret Storage)

#### Set API URL

Configure in VS Code settings:

```json
{
  "backlog.apiUrl": "https://yourspace.backlog.jp/api/v2"
}
```

#### Main Configuration Options

| Setting | Description | Example |
|---------|-------------|---------|
| `backlog.apiUrl` | Backlog API URL | `https://yourspace.backlog.jp/api/v2` |
| `backlog.autoRefresh` | Enable/disable auto refresh | `true` |
| `backlog.refreshInterval` | Refresh interval (seconds) | `300` |

### 3. Slack 連携

Slack 連携には **User OAuth Token (`xoxp-`)** が必要です。Bot Token (`xoxb-`) では検索機能（メンション・キーワード検索）が利用できません。

#### Slack App の作成

1. [Slack API: Your Apps](https://api.slack.com/apps) にアクセス
2. 「Create New App」→「From scratch」で新しいアプリを作成
3. 「OAuth & Permissions」ページで以下の **User Token Scopes** を追加:

| スコープ | 用途 |
| --- | --- |
| `channels:read` | パブリックチャンネル一覧の取得 |
| `groups:read` | プライベートチャンネル一覧の取得 |
| `im:read` | DM 一覧の取得 |
| `mpim:read` | グループ DM 一覧の取得 |
| `channels:history` | パブリックチャンネルのスレッド取得 |
| `groups:history` | プライベートチャンネルのスレッド取得 |
| `im:history` | DM のスレッド取得 |
| `mpim:history` | グループ DM のスレッド取得 |
| `search:read` | メッセージ検索（メンション・キーワード） |
| `chat:write` | メッセージ返信の送信 |
| `users:read` | ユーザー名の解決 |
| `usergroups:read` | ユーザーグループ（メンション対象）の取得 |

次の手順でインストール:

1. 「Install to Workspace」でワークスペースにインストール
2. 発行された **User OAuth Token** (`xoxp-...`) をコピー

#### VSCode での設定

1. `Cmd+Shift+P` → `Slack: Set Token`
2. `xoxp-...` トークンを入力

### 4. Google Calendar 連携

Google Calendar の予定と、それに紐づく議事録（Gemini 自動生成）や添付ドキュメントを VSCode 内で閲覧できます。

#### GCP で OAuth クライアントを作成

1. [GCP Console](https://console.cloud.google.com/) でプロジェクトを選択
2. 上部の検索バーで「Google Calendar API」を検索 → **有効にする**。同様に「Google Drive API」も有効化
3. 検索バーで「OAuth 同意画面」を検索 → **内部** を選択 → アプリ名を入力して保存
4. 左メニュー **API とサービス** → **認証情報** → 「認証情報を作成」→ **OAuth クライアント ID**
5. アプリケーションの種類: **デスクトップアプリ** → 作成
6. **クライアント ID** と **クライアントシークレット** をメモ

#### VSCode での設定

1. Settings (`Cmd+,`) で `nulab.google.clientId` にクライアント ID を設定
2. `Cmd+Shift+P` → `Nulab: Set Google Client Secret` でクライアントシークレットを入力
3. `Cmd+Shift+P` → `Nulab: Sign in to Google` でブラウザ認証

| Setting | Description | Default |
| ------- | ----------- | ------- |
| `nulab.google.clientId` | OAuth Client ID | - |
| `nulab.google.calendarId` | 取得するカレンダー ID | `primary` |
| `nulab.google.daysRange` | 表示する日数範囲 (前後) | `7` |

認証後、Notifications サイドバーの **Google Calendar** ビューにカレンダー予定が表示されます。

### 5. Security Features

- Secret Storage: Encrypted API key storage
- Auto Migration: Safe migration from existing settings
- HTTPS Communication: Encrypted data transfer

## Usage

### Browsing Backlog

1. Open the **Backlog** section in the sidebar
   - Browse projects, issues, wiki, and documents in tree views
   - Setup guide shown when not configured
2. Click an issue, wiki page, or document to open its detail view
   - Rich webview with Backlog-style UI and VS Code theme support
3. Use **My Tasks** for issues assigned to you, **Notifications** for updates, and **TODO** for task tracking

### Viewing Cacoo Diagrams

1. Open the **Cacoo** section in the sidebar to browse diagrams
2. Click a diagram to view its sheets

### Using Slack

1. Open the **Slack** section in the sidebar to browse channels
2. Click a thread to view the full conversation
3. Use **Slack Search** to find messages by keyword or mention

## Architecture

```text
┌─────────────────────────────────────────┐
│           VS Code Extension             │
├─────────────────────────────────────────┤
│  ├─ Tree Views (Sidebar)                │
│  └─ Webviews (Detail / Editor)          │
├─────────────────────────────────────────┤
│  Services Layer                         │
│  ├─ ConfigService                       │
│  ├─ BacklogApiService (backlog-js)      │
│  ├─ CacooApiService                     │
│  ├─ SlackApiService                     │
│  ├─ GoogleApiService (Service Account)  │
│  └─ SyncService                         │
├─────────────────────────────────────────┤
│  Backlog / Cacoo / Slack / Google APIs  │
└─────────────────────────────────────────┘
```

## Development

### Development Commands

```bash
npm run compile    # Compile
npm run watch      # Watch mode
npm run lint       # Lint
npm run format     # Format
```

### Technologies Used

- TypeScript: Type-safe development
- VS Code Extension API: Tree View, Webview, Secret Storage
- backlog-js: Official Backlog API library
- Slack Web API: Channel browsing, message search, thread viewing
- ESLint + Prettier: Code quality management

## Troubleshooting

### Common Issues

1. Extension not working
   - Check API URL and API Key configuration
   - Verify API key permissions
   - Check network connection

2. Data not displayed
   - Verify project access permissions
   - Use refresh button to reload data
   - Check developer console for errors
