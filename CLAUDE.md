# CLAUDE.md

## 注意事項

- **Backlog Documents API の POST / DELETE は非公式** — `postDocument()` / `deleteDocument()` は公式ドキュメントに記載されていないエンドポイントを使用しており、将来動作しなくなる可能性がある。
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
