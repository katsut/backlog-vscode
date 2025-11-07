# Backlog VSCode ビューワー拡張機能 実装計画

## 実装状況サマリー

Phase 1-6 完了済み、Phase 7-9 未実装

## フェーズ別実装状況

### ✅ Phase 1: 基盤構築

- [x] VS Code拡張機能プロジェクト初期化
- [x] TypeScript設定とビルド環境構築
- [x] ESLint + Prettier設定
- [x] package.json拡張機能メタデータ設定
- [x] activation関数とextension.ts実装

### ✅ Phase 2: マルチビューTree View実装

- [x] Projects Tree View:
  プロジェクト一覧表示・検索機能
- [x] Issues Tree View:
  課題一覧表示（プロジェクト別）
- [x] Wiki Tree View:
  Wiki一覧表示（プロジェクト別）
- [x] Documents Tree View:
  ドキュメント一覧表示（プロジェクト別）
- [x] プロジェクトフォーカス機能
  （動的ビュー切り替え）
- [x] アイコン・コンテキストメニュー・
  ツールバー実装

### ✅ Phase 3: 高度なWebview実装

- [x] 課題詳細Webview:
  エディタタブで表示、コメント機能付き
- [x] Wiki詳細Webview:
  Wiki内容の表示
- [x] ドキュメント詳細Webview:
  ドキュメント情報表示
- [x] Webview追跡・管理システム:
  重複防止・自動フォーカス・リフレッシュ
- [x] VS Code準拠のHTML/CSSスタイル実装

### ✅ Phase 4: Backlog API完全対応

- [x] Secret Storage:
  APIキーの安全な保存
- [x] backlog-js:
  公式ライブラリ使用のAPI実装
- [x] エラーハンドリング:
  包括的なエラー処理
- [x] 自動リフレッシュ:
  設定可能なリフレッシュ機能
- [x] 複数プロジェクト対応:
  プロジェクト間の動的切り替え

### ✅ Phase 5: 検索・フィルタ・ソート機能

- [x] プロジェクト検索:
  名前・キー・説明での検索
- [x] 課題検索:
  キーワード検索機能
- [x] フィルタリング:
  ステータス・優先度・担当者フィルタ
- [x] ソート機能:
  更新日・作成日・優先度・ステータス・概要
- [x] 検索状態管理:
  検索条件の保持・クリア機能

### ✅ Phase 6: MCP統合・キーボードショートカット

- [x] MCP統合:
  Model Context Protocol対応
- [x] AIアシスタント連携:
  MCP操作後の自動処理
- [x] キーボードショートカット:
  プラットフォーム別最適化
  - Windows/Linux: `Alt+Shift+P/I`
  - macOS: `Ctrl+Shift+P/I`
- [x] 入力検証:
  プロジェクトキー・課題キー形式チェック
- [x] 自動リフレッシュ:
  Issues ビューの動的更新

### 🔄 Phase 7: 課題操作機能

- [ ] 課題作成:
  新規課題作成ダイアログ
- [ ] 課題編集:
  既存課題の概要・説明編集
- [ ] コメント追加:
  課題へのコメント投稿機能
- [ ] ステータス変更:
  ステータス更新機能
- [ ] 添付ファイル:
  ファイル添付・表示機能

### 🔄 Phase 8: 高度な機能とUI改善

- [ ] 保存済み検索:
  検索条件の保存・管理
- [ ] 検索履歴:
  過去の検索条件履歴
- [ ] 通知機能:
  課題更新通知
- [ ] オフライン対応:
  キャッシュ機能・オフライン表示
- [ ] パフォーマンス最適化:
  遅延読み込み・仮想化

### 🔄 Phase 9: テストと品質保証

- [ ] 単体テスト:
  Jest使用の包括的テスト
- [ ] 統合テスト:
  API連携テスト
- [ ] E2Eテスト:
  VS Code拡張機能テスト
- [ ] パフォーマンステスト:
  レスポンス時間・メモリ使用量
- [ ] セキュリティテスト:
  APIキー・通信の安全性確認

## 現在のアーキテクチャ

### 実装済みファイル構造

```text
src/
├── extension.ts
│   # メインエントリーポイント
│   # MCP統合・コマンド登録
├── providers/
│   ├── treeViewProvider.ts
│   │   # Projects Tree View Provider
│   ├── issuesTreeViewProvider.ts
│   │   # Issues Tree View Provider
│   ├── wikiTreeViewProvider.ts
│   │   # Wiki Tree View Provider
│   ├── documentsTreeViewProvider.ts
│   │   # Documents Tree View Provider
│   ├── webviewProvider.ts
│   │   # 汎用Webview Provider
│   └── projectsWebviewProvider.ts
│       # Projects専用Webview Provider
├── services/
│   ├── backlogApi.ts
│   │   # Backlog API クライアント
│   │   # backlog-js使用
│   └── configService.ts
│       # 設定・認証サービス
│       # Secret Storage
└── media/
    ├── main.css
    │   # VS Code準拠スタイル
    ├── reset.css
    │   # CSSリセット
    ├── vscode.css
    │   # VS Codeテーマ対応
    ├── main.js
    │   # Webview JavaScript
    └── vscode-webview.d.ts
        # TypeScript型定義
```

### 技術スタック

#### 実装済み技術

- VS Code Extension API v1.74.0+
- TypeScript (strict mode)
- backlog-js v0.9.1
- Secret Storage API
- Model Context Protocol (MCP)
- ESLint + Prettier

#### 開発依存関係

- @types/vscode v1.74.0
- @typescript-eslint/eslint-plugin v5.45.0
- @typescript-eslint/parser v5.45.0
- eslint v8.28.0
- prettier v2.8.0
- typescript v4.9.4

## 実装済み機能詳細

### マルチビューサイドバー

- 4つの専用ビュー
  (Projects/Issues/Wiki/Documents)
- プロジェクトフォーカス機能
- 動的ビュー切り替え

### エディタタブWebview

- 課題・Wiki・ドキュメント詳細表示
- 重複防止・自動フォーカス・
  リフレッシュ機能
- VS Code準拠のリッチUI

### 高度な検索・フィルタ

- プロジェクト検索
- 課題検索（キーワード・フィルタ・ソート）
- 複合条件フィルタリング

### MCP統合

- AIアシスタント連携
- MCP操作後の自動処理
- backlog-mcp-server対応

### キーボードショートカット

- プラットフォーム別最適化
- 入力検証・エラーハンドリング

### セキュアAPI連携

- Secret Storage使用
- 包括的エラーハンドリング
- 自動リフレッシュ機能

## 実装順序の依存関係

### Phase 1 → Phase 2

基盤構築完了後にTree View実装が可能

### Phase 2 → Phase 3

Tree View完成後にWebview実装が可能

### Phase 3 → Phase 4

Webview完成後にAPI完全対応が可能

### Phase 4 → Phase 5

API対応完了後に検索・フィルタ実装が可能

### Phase 5 → Phase 6

基本機能完成後にMCP統合・
ショートカット実装が可能

### Phase 6 → Phase 7

読み取り機能完成後に
書き込み機能（課題操作）実装が可能

### Phase 7 → Phase 8

基本操作完成後に高度なUI機能実装が可能

### Phase 8 → Phase 9

全機能完成後にテスト・品質保証実装が可能

## 品質指標

### 達成済み

- TypeScript strict mode使用
- ESLint + Prettier自動チェック
- VS Code標準UIガイドライン準拠
- APIキーのセキュア保存

### 今後の目標

- 単体テストカバレッジ80%以上
- E2Eテスト実装
- パフォーマンステスト実装
- セキュリティ監査実施
