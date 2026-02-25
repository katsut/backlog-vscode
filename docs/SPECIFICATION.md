# Backlog Viewer for VS Code - 仕様書

## 1. 概要

| 項目 | 内容 |
|------|------|
| 名称 | Backlog Viewer |
| パッケージ名 | `nulab-vscode` |
| バージョン | 0.0.1 |
| ライセンス | MIT |
| 対応 VS Code | ^1.74.0 |
| 言語 | TypeScript (strict mode) |

Backlog のプロジェクト・課題・Wiki・ドキュメントを VS Code 内で閲覧できる拡張機能。
MCP (Model Context Protocol) との統合により、AI アシスタントとのシームレスな連携も実現する。

---

## 2. アーキテクチャ

### 2.1 ディレクトリ構成

```
src/
├── extension.ts                        # エントリーポイント (activate/deactivate)
├── services/
│   ├── backlogApi.ts                   # Backlog API クライアント
│   └── configService.ts               # 設定・認証管理
├── providers/
│   ├── treeViewProvider.ts             # プロジェクト Tree View
│   ├── issuesTreeViewProvider.ts       # 課題 Tree View
│   ├── wikiTreeViewProvider.ts         # Wiki Tree View
│   ├── documentsTreeViewProvider.ts    # ドキュメント Tree View
│   ├── webviewProvider.ts             # 課題詳細サイドバー
│   └── projectsWebviewProvider.ts     # プロジェクト Webview
├── webviews/
│   ├── common.ts                      # Webview 共通ユーティリティ
│   ├── issueWebview.ts                # 課題詳細 HTML 生成
│   ├── wikiWebview.ts                 # Wiki 詳細 HTML 生成
│   └── documentWebview.ts            # ドキュメント詳細 HTML 生成
├── utils/
│   └── markdownRenderer.ts            # Markdown レンダラー
├── types/
│   └── backlog.ts                     # 型定義
media/
├── reset.css                          # CSS リセット
├── vscode.css                         # VS Code テーマ連携
├── main.css                           # メインスタイル
├── markdown.css                       # GitHub 風 Markdown スタイル
├── webview-common.css                 # Webview 共通スタイル
└── main.js                            # サイドバー Webview スクリプト
```

### 2.2 設計パターン

| パターン | 適用箇所 |
|---------|---------|
| Provider パターン | 各 Tree View / Webview プロバイダー |
| Service パターン | BacklogApiService, ConfigService |
| State Machine | API サービスの初期化状態管理 (`uninitialized` → `initializing` → `initialized`) |
| Singleton | MarkdownRenderer |
| Lazy Initialization | API 接続 (初回 API 呼び出し時に初期化) |

### 2.3 依存ライブラリ

| ライブラリ | バージョン | 用途 |
|-----------|-----------|------|
| `backlog-js` | ^0.15.0 | Backlog REST API v2 クライアント |
| `marked` | ^17.0.0 | Markdown → HTML レンダリング |
| `vsce` | ^2.15.0 | 拡張機能パッケージング (dev) |
| `typescript` | ^4.9.4 | TypeScript コンパイラ (dev) |
| `eslint` | ^8.28.0 | Linter (dev) |
| `prettier` | ^2.8.0 | Formatter (dev) |

---

## 3. 設定

### 3.1 ユーザー設定 (settings.json)

| キー | 型 | デフォルト | 説明 |
|-----|-----|----------|------|
| `backlog.domain` | string | `""` | Backlog ドメイン (例: `yourspace.backlog.jp`) |
| `backlog.autoRefresh` | boolean | `true` | 自動リフレッシュの有効/無効 |
| `backlog.refreshInterval` | number | `300` | 自動リフレッシュ間隔 (秒) |

### 3.2 API キー管理

- VS Code **SecretStorage** に暗号化保存
- コマンド `backlog.setApiKey` で設定
- レガシー設定 (settings.json) からの自動マイグレーション対応

---

## 4. UI 構成

### 4.1 Activity Bar

アイコン `$(project)` で「Backlog」コンテナを表示。

### 4.2 サイドバー Tree View

#### プロジェクト一覧 (未フォーカス時)

| 要素 | 表示条件 |
|------|---------|
| **backlogProjects** | `!backlogProjectFocused && backlogExplorer.enabled` |

- プロジェクトを `{projectKey}: {projectName}` 形式で表示
- アイコン: フォルダー (青)
- クリックでプロジェクトフォーカス

#### フォーカス時 (3つのビューに切替)

| ビュー | 表示条件 |
|-------|---------|
| **backlogIssues** | `backlogExplorer.enabled && backlogProjectFocused` |
| **backlogWiki** | `backlogExplorer.enabled && backlogProjectFocused` |
| **backlogDocuments** | `backlogExplorer.enabled && backlogProjectFocused` |

### 4.3 Tree Item の表示仕様

#### 課題 (IssueTreeItem)

- ラベル: `{issueKey}: {summary}`
- ツールチップ: 概要、ステータス、優先度、担当者
- ステータスアイコン:

| ステータス | アイコン |
|-----------|---------|
| Open / オープン | `circle-outline` |
| In Progress / 処理中 | `sync` |
| Resolved / 解決済み | `check` |
| Closed / クローズ | `circle-filled` |

- 優先度による色分け:

| 優先度 | 色 |
|-------|-----|
| High / 高 | `charts.red` |
| Medium / 中 | `charts.orange` |
| Low / 低 | `charts.green` |

- 親子課題の階層表示に対応

#### Wiki (WikiTreeItem)

- ラベル: Wiki 名
- ツールチップ: 名前、作成日、更新日、作成者、タグ
- アイコン: book (緑)
- Wiki 機能無効時は情報メッセージを表示

#### ドキュメント (DocumentTreeItem)

- フォルダー / ドキュメントの階層構造表示
- アイコン: フォルダー(黄)、ファイル(青)、サブモジュール(青)

### 4.4 ビュータイトルメニュー

#### Projects ビュー

| 順序 | コマンド | アイコン |
|-----|---------|---------|
| 1 | Refresh | `$(refresh)` |
| 2 | Search Projects | `$(search)` |
| 3 | Clear Search | `$(clear-all)` |
| 4 | Settings | `$(gear)` |

#### Issues ビュー

| 順序 | コマンド | アイコン |
|-----|---------|---------|
| 1 | Refresh Issues | `$(refresh)` |
| 2 | Search Issues | `$(search)` |
| 3 | Filter Issues | `$(filter)` |
| 4 | Sort Issues | `$(sort-precedence)` |
| 5 | Clear Filters | `$(clear-all)` |
| 6 | Back to Projects | `$(arrow-left)` |

#### Wiki / Documents ビュー

| 順序 | コマンド | アイコン |
|-----|---------|---------|
| 1 | Refresh | `$(refresh)` |
| 2 | Back to Projects | `$(arrow-left)` |

---

## 5. Webview 詳細画面

### 5.1 課題詳細 (IssueWebview)

エディタタブで表示。構成:

1. **ヘッダー**: 課題概要、リフレッシュボタン
2. **メタ情報**: 課題キー、ステータスバッジ、優先度バッジ、Backlog リンク
3. **詳細フィールド**: ステータス、優先度、担当者、期限日
4. **説明**: Markdown レンダリング
5. **コメント**: 通常コメントと変更履歴を分離表示
6. **変更履歴**: フィールド変更の差分表示 (担当者👤、ステータス📋、優先度⚡、期限📅、説明📝)

#### コメント分類ロジック

- 空コメントまたは変更パターン (日本語/英語) にマッチ → 変更履歴
- それ以外 → 通常コメント

#### ステータスバッジ色

| ステータス | 色コード |
|-----------|---------|
| Open | `#1f883d` (緑) |
| In Progress | `#bf8700` (オレンジ) |
| Resolved | `#8250df` (紫) |
| Closed | `#656d76` (灰) |

### 5.2 Wiki 詳細 (WikiWebview)

1. **ヘッダー**: Wiki 名、リフレッシュボタン
2. **メタ情報**: 作成者、作成日、更新者、更新日、Backlog リンク
3. **タグ**: タグバッジ一覧
4. **添付ファイル**: ファイル名とサイズ
5. **共有ファイル**: ファイル名とサイズ
6. **コンテンツ**: Markdown レンダリング

### 5.3 ドキュメント詳細 (DocumentWebview)

1. **ヘッダー**: ドキュメント名、リフレッシュボタン
2. **メタ情報**: 作成日、作成者、更新日、Backlog リンク
3. **ドキュメント情報**: メタデータカード
4. **コンテンツ**: Markdown または ProseMirror JSON → HTML 変換

#### ProseMirror JSON 対応

以下のノードタイプを HTML に変換:

| ノード | HTML |
|-------|------|
| `paragraph` | `<p>` |
| `heading` | `<h1>`〜`<h6>` |
| `bulletList` / `orderedList` | `<ul>` / `<ol>` |
| `codeBlock` | `<pre><code>` |
| `blockquote` | `<blockquote>` |
| `table` / `tableRow` / `tableCell` | `<table>` 系 |
| `image` | `<img>` (添付ファイルの base64 埋め込み) |
| `hardBreak` | `<br>` |
| `horizontalRule` | `<hr>` |

テキストマーク: `strong`, `em`, `code`, `underline`, `strike`, `link`

### 5.4 Webview メッセージ通信

#### Webview → 拡張機能

| コマンド | 説明 |
|---------|------|
| `openExternal` | 外部ブラウザで URL を開く |
| `refreshIssue` | 課題データを再取得して更新 |
| `refreshWiki` | Wiki データを再取得して更新 |
| `refreshDocument` | ドキュメントデータを再取得して更新 |

### 5.5 Webview 管理

- `Map<string, WebviewPanel>` で開いているパネルを追跡
- 同一コンテンツの重複パネル防止
- 既存パネルへの自動フォーカス
- パネル破棄時に Map からクリーンアップ

---

## 6. 検索・フィルタ・ソート

### 6.1 プロジェクト検索

- 検索対象: プロジェクト名、プロジェクトキー
- 大文字小文字を区別しない

### 6.2 課題検索

- 検索対象: 概要 (summary)、課題キー (issueKey)、説明 (description)
- 大文字小文字を区別しない

### 6.3 課題フィルタ

| フィルタ | 説明 |
|---------|------|
| Open Issues | Open / In Progress / オープン / 処理中 のみ |
| Non-Closed Issues | Closed / クローズ 以外 (プロジェクトフォーカス時に自動適用) |
| My Issues | 現在のユーザーに割り当てられた課題のみ |
| Overdue Issues | 期限超過かつ未解決の課題のみ |
| Status Filter | ステータス名で複数選択 |
| Priority Filter | 優先度名で複数選択 |
| Assignee Filter | 担当者名で複数選択 (「Unassigned」含む) |

### 6.4 課題ソート

| ソートキー | 方向 |
|-----------|------|
| 更新日 (updated) | 昇順 / 降順 (デフォルト: 降順) |
| 作成日 (created) | 昇順 / 降順 |
| 優先度 (priority) | 高→低 / 低→高 |
| ステータス (status) | A-Z / Z-A |
| 概要 (summary) | A-Z / Z-A |

### 6.5 Wiki 検索

- 検索対象: Wiki 名、タグ名
- 名前のアルファベット順ソート (デフォルト適用)

---

## 7. コマンド一覧

### 7.1 全コマンド

| コマンド | タイトル | カテゴリ | 説明 |
|---------|---------|---------|------|
| `backlog.refreshProjects` | Refresh | - | 全データを再読み込み |
| `backlog.refreshIssues` | Refresh Issues | - | 課題一覧を再読み込み |
| `backlog.refreshWiki` | Refresh Wiki | - | Wiki 一覧を再読み込み |
| `backlog.refreshDocuments` | Refresh Documents | - | ドキュメント一覧を再読み込み |
| `backlog.searchProjects` | Search Projects | - | プロジェクト検索ダイアログ |
| `backlog.clearProjectSearch` | Clear Search | - | プロジェクト検索をクリア |
| `backlog.search` | Search Issues | - | 課題検索ダイアログ |
| `backlog.filter` | Filter Issues | - | 課題フィルタダイアログ |
| `backlog.sort` | Sort Issues | - | 課題ソートダイアログ |
| `backlog.clearFilters` | Clear Filters | - | 全フィルタをクリア |
| `backlog.focusProject` | Focus Project | - | プロジェクトにフォーカス |
| `backlog.unfocusProject` | Back to Projects | - | プロジェクト一覧に戻る |
| `backlog.openIssue` | Open Issue | - | 課題詳細を Webview で表示 |
| `backlog.openWiki` | Open Wiki | - | Wiki 詳細を Webview で表示 |
| `backlog.openDocument` | Open Document | - | ドキュメント詳細を Webview で表示 |
| `backlog.openProjectByKey` | Open Project by Key | Backlog | プロジェクトキーで直接開く |
| `backlog.openIssueByKey` | Open Issue by Key | Backlog | 課題キーで直接開く |
| `backlog.openSettings` | Settings | - | VS Code 設定を開く |
| `backlog.setApiKey` | Set API Key | - | API キーを安全に設定 |
| `backlog.openIssueAfterMCPOperation` | - | - | MCP 操作後の自動表示 |

### 7.2 キーボードショートカット

| コマンド | Windows / Linux | macOS |
|---------|----------------|-------|
| Open Project by Key | `Alt+Shift+P` | `Ctrl+Shift+P` |
| Open Issue by Key | `Alt+Shift+I` | `Ctrl+Shift+I` |

### 7.3 入力検証

| 対象 | 正規表現 |
|-----|---------|
| プロジェクトキー | `^[A-Z][A-Z0-9_]*$` (大文字小文字不問) |
| 課題キー | `^[A-Z][A-Z0-9_]*-\d+$` (大文字小文字不問) |

---

## 8. API 連携

### 8.1 BacklogApiService

`backlog-js` ライブラリをラップし、状態管理付きの API クライアントを提供。

#### 状態遷移

```
uninitialized → initializing → initialized
                     ↑               ↓
                     └───────────────┘  (reinitialize)
```

#### API メソッド

| メソッド | 戻り値 | 説明 |
|---------|--------|------|
| `getProjects()` | `Project[]` | 全プロジェクト取得 |
| `getProjectIssues(projectId, options?)` | `Issue[]` | プロジェクトの課題取得 |
| `getIssue(issueId)` | `Issue` | 課題詳細取得 |
| `getIssueComments(issueId)` | `Comment[]` | 課題コメント取得 |
| `getUser()` | `User` | 現在のユーザー情報 |
| `getWikiPages(projectId)` | `WikiListItem[]` | Wiki ページ一覧 |
| `getWiki(wikiId)` | `Wiki` | Wiki 詳細 |
| `getDocuments(projectId)` | `DocumentTree` | ドキュメントツリー |
| `getDocument(documentId)` | `Document` | ドキュメント詳細 |
| `downloadDocumentAttachment(documentId, attachmentId)` | `Buffer` | 添付ファイルダウンロード |
| `reinitialize()` | `void` | サービス再初期化 |

### 8.2 エラーハンドリング

| エラー種別 | 処理 |
|-----------|------|
| 設定不足 (ドメイン/APIキー) | 警告メッセージ + アクションボタン |
| 403 Forbidden | 機能無効メッセージ (Wiki/ドキュメント) |
| 404 Not Found | 機能利用不可メッセージ |
| ネットワークエラー | エラー通知 + コンソールログ |
| ダウンロードタイムアウト | 30 秒でタイムアウト |

---

## 9. Markdown レンダリング

### 9.1 基本機能

- GitHub Flavored Markdown (GFM) 対応
- タスクリスト対応
- 改行 → `<br>` 変換

### 9.2 Backlog 固有機能

| 機能 | パターン | 変換後 |
|------|---------|--------|
| 課題メンション | `#PROJ-123` | `<span class="issue-mention">` |
| ユーザーメンション | `@username` | `<span class="user-mention">` |
| 絵文字 | `(smile)` | 😊 |
| 絵文字 | `(sad)` | 😢 |
| 絵文字 | `(thumbsup)` | 👍 |
| 絵文字 | `(heart)` | ❤️ |
| 絵文字 | `(star)` | ⭐ |
| 添付ファイル参照 | `![alt](/document/.../file/ID)` | base64 data URL に変換 |

### 9.3 カスタムレンダラー

- **リンク**: `target="_blank" rel="noopener noreferrer"` 付与
- **画像**: `class="markdown-image"` 付与、URL サニタイズ
- **コードブロック**: 言語クラス `language-{lang}` 付与
- **テーブル**: `class="markdown-table"` 付与

---

## 10. セキュリティ

### 10.1 認証情報

- API キーは VS Code SecretStorage で暗号化保存
- レガシー設定からの自動マイグレーション
- settings.json にはドメインのみ (平文)

### 10.2 Webview CSP (Content Security Policy)

```
default-src 'none';
style-src ${cspSource} 'nonce-${nonce}';
script-src 'nonce-${nonce}';
font-src ${cspSource};
img-src https: data: ${cspSource};
```

### 10.3 XSS 対策

- HTML エンティティエスケープ (全ユーザーコンテンツ)
- URL サニタイズ (許可プロトコル: `http:`, `https:`, `data:`, `#`)
- Nonce ベースのインラインスクリプト制御
- `eval()` 使用禁止

---

## 11. MCP 統合

### 11.1 連携コマンド

`backlog.openIssueAfterMCPOperation` コマンドにより、MCP サーバー (backlog-mcp-server) から呼び出し可能。

### 11.2 フロー

1. MCP サーバーが Backlog API で課題操作を実行
2. `backlog.openIssueAfterMCPOperation(issueId, issueKey?)` を呼び出し
3. Issues ビューを自動リフレッシュ
4. 対象課題の Webview を自動オープン / 既存パネルをリフレッシュ
5. 最新のコメント・詳細を表示

---

## 12. 自動リフレッシュ

- デフォルト有効 (`backlog.autoRefresh: true`)
- デフォルト間隔: 300 秒 (`backlog.refreshInterval`)
- 全 Tree View を対象にリフレッシュ
- 拡張機能 deactivate 時にタイマー破棄

---

## 13. レスポンシブデザイン

| ブレークポイント | 調整内容 |
|---------------|---------|
| `max-width: 600px` | フィールドレイアウト1列化、コメントヘッダー縦並び |
| `max-width: 768px` | フォントサイズ縮小、見出しサイズ調整 |

---

## 14. ビルド・開発

### 14.1 npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run compile` | TypeScript コンパイル |
| `npm run watch` | ファイル監視付きコンパイル |
| `npm run lint` | ESLint 実行 |
| `npm run lint:fix` | ESLint 自動修正 |
| `npm run format` | Prettier フォーマット |
| `npm test` | テスト実行 |
| `npm run package` | `.vsix` パッケージ生成 |
| `npm run install:local` | コンパイル → パッケージ → ローカル VSCode にインストール |

### 14.2 ローカルインストール

修正後にローカルの VS Code へインストールするには:

```bash
npm run install:local
```

このコマンドは以下を順に実行します:

1. `tsc -p ./` — TypeScript コンパイル
2. `vsce package --no-dependencies` — `.vsix` ファイル生成
3. `code --install-extension nulab-vscode-0.0.1.vsix` — VS Code にインストール

インストール後、VS Code をリロード (`Cmd+Shift+P` → `Developer: Reload Window`) して反映してください。

---

## 15. 実装状況

### 実装完了

- マルチビューサイドバー (Projects / Issues / Wiki / Documents)
- プロジェクトフォーカス / アンフォーカス機構
- 課題・Wiki・ドキュメント詳細 Webview
- Webview パネル管理 (重複防止・自動フォーカス・リフレッシュ)
- Backlog API 連携 (SecretStorage 認証)
- 検索・フィルタ・ソート機能
- キーボードショートカット
- MCP 統合
- 自動リフレッシュ
- Markdown レンダリング (Backlog 固有機能対応)
- セキュリティ (CSP, XSS 対策, SecretStorage)

### 未実装 (将来拡張)

- 課題の作成・編集
- コメントの追加
- ステータス変更
- 複合条件検索・検索履歴
- 課題更新通知
- オフラインキャッシュ
- テストスイート
