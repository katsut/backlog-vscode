# Backlog Documents — Sync & VSCode Plugin 仕様書

## 概要

Backlog Documentsをローカルワークスペース及びVSCode拡張から操作するための仕様。
UPDATE APIが存在しないため、更新反映は手動（クリップボード + ブラウザ）で行う。

---

## 1. Backlog Documents API Reference

Base URL: `https://{SPACE_ID}.backlog.jp/api/v2`

### 1.1 Get document list

`GET /api/v2/documents`

| Parameter | Type | Description |
| --- | --- | --- |
| projectId[] | Number | Project ID (multiple) |
| keyword | string | Search keyword |
| sort | string | `created` or `updated` |
| order | string | `asc` or `desc` (default: `desc`) |
| offset | int | Offset |
| count | int | 1-100 (default: 20) |

**Response**: Array of `BacklogDocument`

### 1.2 Get document tree

`GET /api/v2/documents/tree`

| Parameter | Type | Description |
| --- | --- | --- |
| projectIdOrKey | string | Project ID or Project Key |

**Response**:

```json
{
  "projectId": 1,
  "activeTree": {
    "id": "Active",
    "children": [
      {
        "id": "01934345404771adb2113d7792bb4351",
        "name": "folder name",
        "children": [...],
        "emoji": ""
      }
    ]
  },
  "trashTree": { "id": "Trash", "children": [] }
}
```

### 1.3 Get document

`GET /api/v2/documents/:documentId`

**Response**: `BacklogDocument` (see Type Definitions)

### 1.4 Get document attachment

`GET /api/v2/documents/:documentId/attachments/:attachmentId`

**Response**: Binary file download

### 1.5 Add document

`POST /api/v2/documents`

| Parameter | Type | Description |
| --- | --- | --- |
| projectId (Required) | int | Project ID |
| title | string | Document title |
| content | string | Markdown text. Parsed by server into ProseMirror JSON. |
| emoji | string | Emoji icon |
| parentId | string | Parent document ID for tree placement |
| addLast | boolean | `true` = add as last sibling (default: `false`) |

**Response**: `BacklogDocument` (with generated `id`, converted `json`)

### 1.6 Delete document

`DELETE /api/v2/documents/:documentId`

| Parameter | Type | Description |
| --- | --- | --- |
| documentId | string | Document ID |

**Response**: Deleted `BacklogDocument` (with `json: null`, `plain: null`)

### 1.7 API Constraints

- **UPDATE (PATCH/PUT) は存在しない** — 既存ドキュメントの内容をAPIで更新する手段がない
- Delete + Create は ID が変わりリンクが切れるため非推奨
- 既存ドキュメントの更新は **Backlog Web UI で手動** で行う

---

## 2. Data Format

### 2.1 Input (Write)

- `content` フィールドに **Markdown** テキストを渡す
- サーバー側で Markdown → ProseMirror JSON に変換される

### 2.2 Output (Read)

| Field | Type | Description |
| --- | --- | --- |
| `plain` | string | ドキュメントの Markdown 表現 |
| `json` | object | ProseMirror 互換の JSON ブロック構造 |
| `attachments` | array | 添付ファイル（画像等）のメタデータ |

### 2.3 ProseMirror JSON Structure

`json` フィールドは TipTap/ProseMirror 互換スキーマ:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "id": "NmU", "level": 1 },
      "content": [{ "type": "text", "text": "Heading text" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Body text" }]
    }
  ]
}
```

### 2.4 Backlog 固有の Markdown 記法

`plain` フィールドは標準 Markdown + Backlog 拡張:

| Element | Format | Notes |
| --- | --- | --- |
| Images | `![image](/document/backend/{PROJECT_ID}/{DOC_ID}/file/{FILE_ID})` | Backlog認証が必要 |
| Internal links | `[text](/document/{PROJECT_KEY}/{DOC_ID})` | Backlogドメイン相対 |
| External links | `[text](https://nulab.backlog.jp/alias/document/{DOC_ID})` | 絶対URL |
| Embeds | Raw URL (Figma, Cacoo, Google Slides) | Backlog UI では iframe 表示 |

---

## 3. Document Sync Mechanism (CLI Tool)

### 3.1 概要

CLI同期ツール (`scripts/sync-docs.ts`) で Backlog Documents をローカルに同期する。
UPDATE API がないため、基本は **read-only (pull)** で、ローカル変更の反映は手動。

### 3.2 Commands

```bash
# Backlogから同期（pull）
npm run sync-docs -- pull [--path <filter>] [--force] [--clean]

# ローカル変更状況の確認
npm run sync-docs -- status

# ローカル vs リモートの差分表示
npm run sync-docs -- diff <local-file-path>

# 新規ドキュメントをBacklogに作成
npm run sync-docs -- push <local-file-path> --parent <backlog-parent-id>
```

### 3.3 Sync Manifest

変更検知に `docs/.sync-manifest.json` を使用:

```json
{
  "docs/2.planning/PRD/index.md": {
    "backlog_id": "019034...",
    "backlog_path": "/Nulab Flowbase Documentation Home/.../PRD",
    "project": "BNN",
    "synced_at": "2026-02-17T00:00:00Z",
    "remote_updated_at": "2026-02-16T15:36:56Z",
    "content_hash": "sha256:<hex>"
  }
}
```

### 3.4 Change Detection Logic

| Local Changed | Remote Changed | Action |
| --- | --- | --- |
| No | No | Skip（変更なし） |
| No | Yes | リモートで上書き |
| Yes | No | ローカル変更を保持（スキップ） |
| Yes | Yes | **CONFLICT** — マージが必要 |

- **ローカル変更検知**: `sha256(ファイル内容 - frontmatter)` !== `manifest.content_hash`
- **リモート変更検知**: Backlog API `updated_at` !== `manifest.remote_updated_at`

### 3.5 Local File Format

同期ファイルには YAML frontmatter を付与:

```yaml
---
title: "Document Title"
backlog_id: "019034..."
project: "BNN"
synced_at: "2026-02-17T00:00:00Z"
updated_at: "2026-02-16T15:36:56Z"
---
(Backlog `plain` フィールドの Markdown コンテンツ)
```

### 3.6 Manual Update Workflow

ローカル変更をBacklogに反映する手動フロー:

1. `sync-docs status` でローカル変更ファイルを確認
2. `sync-docs diff <file>` で差分確認
3. タイムスタンプに差異がない（リモート未変更）場合:
   - ローカル内容を **クリップボードにコピー**
   - 該当ドキュメントの **Backlog エディタ画面をブラウザで開く**
4. ユーザーが Backlog UI 上でペースト・保存
5. `sync-docs pull` で再同期 → manifest 更新

---

## 4. VSCode Plugin: Document Editor & Merge Editor

### 4.1 Document Tree View

VSCode サイドバーに Backlog ドキュメントツリーを表示:

- `GET /api/v2/documents/tree` でツリー取得
- フォルダ/ドキュメント階層を emoji アイコン付きで表示
- クリックでエディタに展開

### 4.2 Document Editor

Backlog ドキュメントを VSCode 内で編集:

- `GET /api/v2/documents/:documentId` でコンテンツ取得
- `plain`（Markdown）を標準 Markdown エディタで表示
- ローカル変更を last-synced バージョンに対して追跡

### 4.3 Diff View

ローカルとリモートの比較:

```typescript
// VSCode diff エディタを開く
vscode.commands.executeCommand('vscode.diff',
  remoteUri,    // Backlog content (virtual file)
  localUri,     // Local file
  'Backlog (Remote) ↔ Local'
);
```

### 4.4 Merge Editor (Conflict Resolution)

ローカルとリモート双方に変更がある場合、VSCode の 3-way merge editor を使用:

```
┌─────────────────────────────────────────────────┐
│ Backlog (Remote)  │  Merged Result  │   Local   │
│ (incoming)        │  (center)       │ (current) │
└─────────────────────────────────────────────────┘
```

**Workflow**:

1. Conflict 検知（local hash !== manifest hash AND remote updated_at changed）
2. リモートコンテンツを API で取得
3. VSCode merge editor を開く:
   - **Base**: 前回同期時の内容
   - **Incoming (Remote)**: Backlog API `plain`
   - **Current (Local)**: ローカルファイル（frontmatter 除去済）
4. ユーザーがマージエディタで解決
5. マージ結果をローカルに保存
6. 内容をクリップボードにコピー + Backlog エディタをブラウザで開く
7. ユーザーが Backlog UI でペースト・保存
8. `pull` で再同期 → manifest 更新

```typescript
// VSCode 3-way merge editor を開く
vscode.commands.executeCommand('_open.mergeEditor', {
  base: baseUri,
  input1: remoteUri,
  input2: localUri,
  output: outputUri,
});
```

### 4.5 Update Action（手動反映支援）

リモート未変更・ローカル変更ありの場合の反映アクション:

1. ローカルファイルの内容（frontmatter 除去済）を **クリップボードにコピー**
2. Backlog ドキュメントの編集画面を **ブラウザで開く**
   - URL: `https://{SPACE_ID}.backlog.jp/alias/document/{DOCUMENT_ID}`
3. ユーザーがペースト・保存後、`pull` で再同期

```typescript
// VSCode Extension での実装例
import * as vscode from 'vscode';
import { exec } from 'child_process';

async function pushToBacklog(entry: SyncManifestEntry, content: string) {
  // 1. クリップボードにコピー
  await vscode.env.clipboard.writeText(content);
  vscode.window.showInformationMessage('Content copied to clipboard');

  // 2. ブラウザでBacklogエディタを開く
  const url = `https://${SPACE_ID}.backlog.jp/alias/document/${entry.backlog_id}`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}
```

### 4.6 Push (New Document)

ローカルの新規ファイルを Backlog に作成:

- `POST /api/v2/documents` で `content` (Markdown), `title`, `parentId` を送信
- 作成後、ローカルファイルの frontmatter に `backlog_id` を追記
- `backlog_id` が **未設定** のファイルのみ対象

---

## 5. Data Flow

```
┌──────────┐     GET /documents/:id      ┌──────────┐
│          │ ──────────────────────────→ │          │
│  Backlog │       plain (Markdown)      │  VSCode  │
│  Server  │                             │ Plugin / │
│          │ ←── clipboard + browser ──  │   CLI    │
│          │ ←── POST (new docs only) ── │          │
└──────────┘                             └──────────┘
                                              │
                                    ┌─────────┴──────────┐
                                    │  Local .md Files   │
                                    │  + .sync-manifest  │
                                    └────────────────────┘
```

---

## 6. Type Definitions

```typescript
interface BacklogDocument {
  id: string;
  projectId: number;
  title: string;
  plain: string;
  json: ProseMirrorDoc | string;
  statusId: number;
  emoji: string | null;
  attachments: BacklogAttachment[];
  tags: BacklogTag[];
  createdUser: BacklogUser;
  created: string;   // ISO 8601
  updatedUser: BacklogUser;
  updated: string;   // ISO 8601
}

interface BacklogAttachment {
  id: number;
  name: string;
  size: number;
  createdUser: BacklogUser;
  created: string;
}

interface BacklogTag {
  id: number;
  name: string;
}

interface BacklogUser {
  id: number;
  userId: string;
  name: string;
  roleType: number;
  lang: string;
  mailAddress: string;
  nulabAccount: { nulabId: string; name: string; uniqueId: string; iconUrl: string } | null;
  keyword: string;
  lastLoginTime: string;
}

interface DocumentTreeNode {
  id: string;
  name: string;
  children: DocumentTreeNode[];
  emoji?: string;
}

interface DocumentTree {
  projectId: number;
  activeTree: { id: string; children: DocumentTreeNode[] };
  trashTree: { id: string; children: DocumentTreeNode[] };
}

interface SyncManifestEntry {
  backlog_id: string;
  backlog_path: string;
  project: string;
  synced_at: string;
  remote_updated_at: string;
  content_hash: string;  // sha256 hex
}

type SyncManifest = Record<string, SyncManifestEntry>;
```

---

## 7. Plugin Architecture（推奨）

```
backlog-vscode-plugin/
├── src/
│   ├── extension.ts            # Extension entry point
│   ├── api/
│   │   └── backlog-client.ts   # Backlog Documents API client
│   ├── tree/
│   │   └── document-tree.ts    # TreeDataProvider for sidebar
│   ├── editor/
│   │   ├── document-editor.ts  # Custom editor provider
│   │   └── merge-handler.ts    # Merge editor integration
│   ├── sync/
│   │   ├── manifest.ts         # Sync manifest management
│   │   ├── change-detector.ts  # Change detection logic
│   │   └── pull.ts             # Pull command
│   ├── actions/
│   │   ├── clipboard-push.ts   # Copy + open browser action
│   │   └── create-document.ts  # POST new document
│   └── types/
│       └── backlog.ts          # API type definitions
```
