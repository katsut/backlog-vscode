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

## 開発ガイドライン

### Webview

- **新規 Webview は React + esbuild** で実装する。`src/webviews/legacy/` のパターンは使わない
- エントリーポイントは `src/webviews/entries/` に `.tsx` で作成し、`scripts/build-webviews.js` がバンドル → `dist/webviews/` に出力
- 初期データは `window.__INITIAL_STATE__` に JSON 埋め込み（`<` → `\u003c` エスケープ必須）
- CSP は nonce ベースで `style-src` / `script-src` を制限すること
- 共通フックは `src/webviews/hooks/`、共通コンポーネントは `src/webviews/components/` に配置

### デザインシステム

- CSS は `reset.css → vscode.css → webview-common.css → main.css` の順で読み込む
- `webview-common.css` に定義済みの CSS 変数（`--backlog-color`, `--slack-color`, `--webview-space-*` 等）を使うこと。ハードコードしない
- カスタムカラーは `package.json` の `contributes.colors` で定義（`nulab.brandColor`, `cacoo.brandColor`）
- TreeView アイコンは `vscode.ThemeIcon` + `vscode.ThemeColor` のペアで指定。優先度・ステータスの色は `src/providers/base/backlogIcons.ts` の関数を使う

### TreeView プロバイダー

- `vscode.TreeDataProvider<T>` を実装し、カスタム TreeItem クラスを定義するパターン
- `_onDidChangeTreeData` + `refresh()` で更新通知
- プロバイダーは `src/providers/` に配置

### コマンド

- コマンドは機能単位で `src/commands/` のサブディレクトリにモジュール化
- 各モジュールは `register*Commands(container): Disposable[]` を export
- `src/commands/registry.ts` で全モジュールを統合登録

### 設定・シークレット

- API キー・トークンは `SecretsConfig`（`vscode.SecretStorage`）経由で管理。ハードコード禁止
- 各サービスの設定は `src/config/` に専用クラスを作成（`BacklogConfig`, `SlackConfig` 等）
