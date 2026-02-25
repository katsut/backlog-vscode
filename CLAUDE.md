# CLAUDE.md

## 注意事項

- **Backlog Documents API の POST / DELETE は非公開 API** — `postDocument()` / `deleteDocument()` は公式ドキュメントに記載されていない非公開エンドポイントを使用している。今後の API 変更で動作しなくなる可能性がある。
- Document Sync 関連の変更はまだコミットしないこと。動作確認が完了するまで保留。
- **Wiki / ドキュメントはプロジェクトごとに無効化されている場合がある** — API が 403/404 を返す。TreeView では「利用できません」メッセージを表示し、エラー通知は出さない。Sync コマンド等でもこのケースを考慮すること。

## ビルド・インストール

```bash
npm run compile          # TypeScript コンパイル
npm run install:local    # コンパイル → パッケージ → ローカル VSCode にインストール
```

インストール後は `Cmd+Shift+P` → `Developer: Reload Window` でリロード。

## アーキテクチャ

- `src/services/` — API クライアント、設定管理、同期サービス
- `src/providers/` — TreeView / Webview プロバイダー
- `src/commands/` — コマンドハンドラー
- `src/webviews/` — Webview HTML 生成
- `src/types/backlog.ts` — 型定義

## Document Sync 機能

マッピング設定 (`backlog.documentSync.mappings`) でローカルディレクトリと Backlog ドキュメントツリーノードを紐づけ。
Pull でローカルに `.md` ファイル (YAML frontmatter 付き) を生成し、`.sync-manifest.json` で変更追跡。
UPDATE API がないため、既存ドキュメントの更新はクリップボード + ブラウザで手動反映。

## Backlog RAG (MCP Server)

`mcp-server/` に独立した ESM パッケージとして実装。Claude Code から MCP 経由で利用する。

### セットアップ

1. `cd mcp-server && npm install && npm run build`
2. `.mcp.json` に Backlog 接続情報を設定（API キーを含むため `.gitignore` 済み）
3. Claude Code を起動すると MCP server が自動接続

### MCP ツール

- `backlog_search` — セマンティック検索（ドキュメント・Issue・Wiki 横断）
- `backlog_issue_context` — Issue のグラフコンテキスト（親子・担当者・マイルストーン・意味的関連）
- `backlog_related_docs` — 関連ドキュメント検索
- `backlog_project_overview` — プロジェクト概要（ステータス分布・担当者・マイルストーン）
- `backlog_index` — RAG インデックス構築・更新（差分取り込み対応）

### 技術構成

- **Embedding**: `ruri-v3-310m` (ONNX) — 日本語 JMTEB 最高性能、ローカル推論
- **Vector Store**: Vectra（ファイルベース）
- **Knowledge Graph**: JSON グラフ（Issue 間の構造的・意味的関連）
- **データ**: `.backlog/` 配下にベクトル・グラフ・マニフェストを保存

### ビルド

```bash
cd mcp-server && npm run build
```

## Claude Code ワークフロー: 通知・TODO 対応

VSCode 拡張と Claude Code を連携して、Backlog 通知や TODO への対応を支援する仕組み。

### 1. セッション開始

TODO カスタムエディタから「Claude セッション開始」を実行すると:

- `.todomd` ファイルがテキストエディタで開かれる（Claude Code が `ide_opened_file` で自動認識）
- Claude Code サイドバーが開き、新しい会話が始まる

### 2. 深掘り調査

```bash
CLI=/Users/tsuruta/Develop/private/backlog-vscode/mcp-server/dist/cli.js

# Backlog 課題の詳細コンテキスト
node $CLI issue BNN-123

# 関連課題の検索
node $CLI find BNN --keyword "検索ワード"

# Slack メッセージの検索 (SLACK_TOKEN が .env に必要)
node $CLI slack "検索ワード"

# Slack スレッドの取得
node $CLI slack-thread C01ABCDEF 1234567890.123456
```

### 3. 対応フロー

1. TODO カスタムエディタから「Claude セッション開始」を実行
2. Claude Code が `.todomd` ファイルをコンテキストとして認識
3. Backlog RAG CLI で課題の前後関係を調査
4. 必要に応じて Slack CLI で関連会話を検索
5. 回答のドラフトを作成
