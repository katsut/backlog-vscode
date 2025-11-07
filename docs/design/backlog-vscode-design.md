# Backlog VSCode ビューワー拡張機能 デザインドキュメント

## アーキテクチャ概要

```text
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                       │
├─────────────────────────────────────────────────────────────┤
│  extension.ts (Main Entry Point)                           │
│  ├─ BacklogTreeViewProvider                                │
│  └─ BacklogWebviewProvider                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Services Layer                          │
├─────────────────────────────────────────────────────────────┤
│  ConfigService ─────┐                                      │
│                     ▼                                      │
│  BacklogApiService (backlog-js)                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backlog REST API                        │
└─────────────────────────────────────────────────────────────┘
```

## コンポーネント設計

### 1. Tree View Provider

**責任**: サイドバーでのプロジェクト・課題一覧表示

**クラス**: `BacklogTreeViewProvider`

- `getChildren()`: 階層データの提供
- `refresh()`: データの再読み込み
- `loadInitialData()`: 初期データの取得

**ツリー構造**:

```text
📁 Project A
├─ 🔴 PROJ-001: High priority issue
├─ 🟡 PROJ-002: Medium priority issue  
└─ 🟢 PROJ-003: Low priority issue
📁 Project B
├─ ...
```

### 2. Webview Provider

**責任**: 課題詳細画面の表示

**クラス**: `BacklogWebviewProvider`

- `resolveWebviewView()`: Webviewの初期化
- `showIssueDetail()`: 課題詳細の表示
- `_getHtmlForWebview()`: HTMLテンプレートの生成

**UI構成**:

```text
┌─────────────────────────────────┐
│ Issue Title                     │
│ [PROJ-123] [Status] [Priority] │
├─────────────────────────────────┤
│ Assignee: John Doe             │
│ Created: 2023-01-01            │
│ Updated: 2023-01-15            │
│ Due Date: 2023-02-01           │
├─────────────────────────────────┤
│ Description                    │
│ Issue description content...    │
├─────────────────────────────────┤
│ Comments                       │
│ └─ Comment 1                   │
│ └─ Comment 2                   │
├─────────────────────────────────┤
│ [Open in Backlog]             │
└─────────────────────────────────┘
```

### 3. Services Layer

#### ConfigService

**責任**: VS Code設定の管理

- API URL/Key の取得・設定
- 自動更新設定の管理
- 設定の検証

#### BacklogApiService  

**責任**: Backlog API通信

- backlog-js ライブラリのラップ
- プロジェクト・課題データの取得
- エラーハンドリング

## データフロー

### 1. 拡張機能起動時

```text
extension.ts:activate()
  ├─ ConfigService.initialize()
  ├─ BacklogApiService.initialize()
  ├─ TreeViewProvider.loadInitialData()
  └─ WebviewProvider.initialize()
```

### 2. 課題選択時

```text
User clicks issue in tree
  ├─ TreeView.onItemSelected()
  ├─ command: backlog.openIssue
  ├─ WebviewProvider.showIssueDetail()
  ├─ BacklogApi.getIssue()
  ├─ BacklogApi.getIssueComments()
  └─ Webview.postMessage(issueData)
```

### 3. データ更新時

```text
User clicks refresh
  ├─ command: backlog.refreshProjects
  ├─ TreeViewProvider.refresh()
  ├─ BacklogApi.getProjects()
  ├─ BacklogApi.getProjectIssues()
  └─ TreeView.fireDataChangedEvent()
```

## UI/UX設計

### テーマ対応

- VS Code標準のCSS変数を使用
- ダークテーマ・ライトテーマの両方に対応
- アクセシビリティ要件の準拠

### アイコン設計

| 要素 | アイコン | 色 |
|------|----------|-----|
| プロジェクト | folder | blue |
| オープン課題 | circle-outline | - |
| 処理中課題 | sync | - |
| 解決済み課題 | check | - |
| クローズ課題 | circle-filled | - |
| 高優先度 | - | red |
| 中優先度 | - | orange |
| 低優先度 | - | green |

### レスポンシブ対応

- サイドバー幅に応じた表示調整
- 長いテキストの省略表示
- モバイル環境での使いやすさ

## セキュリティ設計

### API認証

- APIキーの安全な保存（VS Code Secret Storage）
- 通信の暗号化（HTTPS必須）
- APIキーの表示時マスク

### Webview セキュリティ

- Content Security Policy の適用
- スクリプトの nonce 検証
- 外部リソースの制限

## パフォーマンス設計

### データ取得の最適化

- 必要最小限のデータ取得
- ページネーション対応
- キャッシュ機能の実装

### UIレスポンスの最適化

- 非同期データ読み込み
- プログレッシブ読み込み
- エラー状態の適切な表示

## エラーハンドリング

### API通信エラー

- ネットワークエラー
- 認証エラー
- レート制限エラー
- データ形式エラー

### ユーザーフィードバック

- エラーメッセージの表示
- 設定ページへの誘導
- リトライ機能の提供

## 設定項目

| 項目 | 型 | デフォルト | 説明 |
|------|-----|-----------|------|
| backlog.apiUrl | string | "" | Backlog API URL |
| backlog.apiKey | string | "" | Backlog API Key |
| backlog.autoRefresh | boolean | true | 自動更新の有効/無効 |
| backlog.refreshInterval | number | 300 | 更新間隔（秒） |

## 今後の拡張可能性

### Phase 2 機能

- 課題の作成・編集
- コメントの追加
- ステータス変更
- 検索・フィルタ機能

### Phase 3 機能

- Wiki連携
- Git連携
- 通知機能
- カスタムビュー

## 開発・テスト戦略

### 開発環境

- TypeScript strict mode
- ESLint + Prettier
- VS Code Extension Host でのデバッグ

### テスト方針

- 単体テスト（Jest）
- 統合テスト（VS Code Test Framework）
- 手動テスト（実際のBacklogデータ）

### リリース戦略

- VS Code Marketplace公開
- セマンティックバージョニング
- 継続的インテグレーション
