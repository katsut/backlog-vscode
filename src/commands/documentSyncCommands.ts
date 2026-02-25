import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BacklogApiService } from '../services/backlogApi';
import { WorkspaceFileStore } from '../config/workspaceFileStore';
import { BacklogConfig } from '../config/backlogConfig';
import { SyncService } from '../services/syncService';
import { BacklogRemoteContentProvider } from '../providers/backlogRemoteContentProvider';
import { SyncFileDecorationProvider } from '../providers/syncFileDecorationProvider';
import { DocumentSyncMapping, SyncManifest } from '../types/backlog';
import { Entity } from 'backlog-js';
import { proseMirrorToMarkdown } from '../utils/prosemirrorToMarkdown';

export class DocumentSyncCommands {
  private syncService: SyncService;
  private isPulling = false;

  constructor(
    private backlogApi: BacklogApiService,
    private backlogConfig: BacklogConfig,
    private fileStore: WorkspaceFileStore,
    private remoteContentProvider: BacklogRemoteContentProvider,
    private decorationProvider?: SyncFileDecorationProvider
  ) {
    this.syncService = new SyncService();
  }

  async pull(mapping?: DocumentSyncMapping): Promise<void> {
    if (this.isPulling) {
      vscode.window.showWarningMessage('[Nulab] Pull is already in progress.');
      return;
    }

    const resolved = mapping || (await this.resolveMapping());
    if (!resolved) {
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const localDir = path.join(workspaceRoot, resolved.localPath);
    this.isPulling = true;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Pulling documents from Backlog...',
          cancellable: true,
        },
        async (progress, token) => {
          const projectId = await this.resolveProjectId(resolved.projectKey);
          if (!projectId) {
            throw new Error(`Project ${resolved.projectKey} not found`);
          }

          const flatNodes = await this.backlogApi.getDocumentSubtree(
            projectId,
            resolved.documentNodeId
          );

          const manifest = this.syncService.loadManifest(localDir);
          let pulled = 0;
          let unchanged = 0;
          let skipped = 0;
          let deleted = 0;

          // Pull root node itself as index.bdoc
          try {
            await this.pullRootDocument(
              resolved.documentNodeId,
              localDir,
              resolved.projectKey,
              manifest
            );
            pulled++;
          } catch (error) {
            console.error(`[DocumentSync] FAILED root node: id=${resolved.documentNodeId}:`, error);
            skipped++;
          }

          const total = flatNodes.length + 1; // +1 for root

          // Build lookup: manifest backlog_id → remote_updated_at
          // Also build reverse lookup: backlog_id → relativePath
          const manifestByBacklogId = new Map<
            string,
            { updatedAt: string; relativePath: string }
          >();
          for (const [relPath, entry] of Object.entries(manifest)) {
            manifestByBacklogId.set(String(entry.backlog_id), {
              updatedAt: entry.remote_updated_at,
              relativePath: relPath,
            });
          }

          // Track which backlog_ids exist in the remote tree
          const remoteIds = new Set<string>();
          remoteIds.add(resolved.documentNodeId); // root node

          for (const node of flatNodes) {
            if (token.isCancellationRequested) {
              break;
            }

            remoteIds.add(String(node.id));

            progress.report({
              increment: (1 / total) * 100,
              message: `${node.name || node.id} (${pulled + unchanged + skipped + 1}/${total})`,
            });

            // Skip documents whose remote updated_at hasn't changed
            const existing = manifestByBacklogId.get(String(node.id));
            if (existing && node.updated && existing.updatedAt === node.updated) {
              unchanged++;
              continue;
            }

            try {
              await this.pullSingleDocument(node, localDir, resolved.projectKey, manifest);
              pulled++;
            } catch (error) {
              console.error(`[DocumentSync] FAILED: id=${node.id}, name=${node.name}:`, error);
              skipped++;
            }

            // Rate limit 対策
            await this.delay(100);
          }

          // Remove local files for documents deleted on remote
          for (const [relPath, entry] of Object.entries(manifest)) {
            if (remoteIds.has(String(entry.backlog_id))) {
              continue;
            }
            const absPath = path.join(localDir, relPath);
            if (!fs.existsSync(absPath)) {
              delete manifest[relPath];
              deleted++;
              continue;
            }
            // Only delete if no local modifications
            const localHash = this.syncService.computeLocalFileHash(absPath);
            if (localHash === entry.content_hash) {
              fs.unlinkSync(absPath);
              delete manifest[relPath];
              deleted++;
            } else {
              console.log(`Keeping ${relPath}: locally modified but deleted on remote`);
            }
          }

          this.syncService.saveManifest(localDir, manifest);
          this.remoteContentProvider.invalidateCache();
          this.decorationProvider?.refresh();

          const parts = [`${pulled} 件更新`];
          if (unchanged > 0) {
            parts.push(`${unchanged} 件変更なし`);
          }
          if (deleted > 0) {
            parts.push(`${deleted} 件削除`);
          }
          if (skipped > 0) {
            parts.push(`${skipped} 件スキップ`);
          }
          vscode.window.showInformationMessage(`[Nulab] Pull 完了: ${parts.join(', ')}`);
        }
      );
    } finally {
      this.isPulling = false;
    }
  }

  /**
   * Pull root (mapped) document as index.bdoc in localDir.
   */
  private async pullRootDocument(
    documentNodeId: string,
    localDir: string,
    projectKey: string,
    manifest: SyncManifest
  ): Promise<void> {
    const relativePath = 'index.bdoc';
    await this.pullDocumentToPath(documentNodeId, relativePath, localDir, projectKey, manifest);
  }

  private async pullSingleDocument(
    node: Entity.Document.DocumentTreeNode & { _treePath: string[] },
    localDir: string,
    projectKey: string,
    manifest: SyncManifest
  ): Promise<void> {
    const doc = await this.backlogApi.getDocument(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const title = doc.title || node.name || node.id;

    const relativePath = path.relative(
      localDir,
      this.syncService.resolveLocalPath(localDir, node._treePath, title, hasChildren)
    );

    await this.pullDocumentToPath(node.id, relativePath, localDir, projectKey, manifest);
  }

  private async pullDocumentToPath(
    documentId: string,
    relativePath: string,
    localDir: string,
    projectKey: string,
    manifest: SyncManifest
  ): Promise<void> {
    const doc = await this.backlogApi.getDocument(documentId);
    const title = doc.title || documentId;
    const absolutePath = path.join(localDir, relativePath);

    // ローカル変更がある場合はスキップ
    const existingEntry = manifest[relativePath];
    if (existingEntry && fs.existsSync(absolutePath)) {
      const localHash = this.syncService.computeLocalFileHash(absolutePath);
      if (localHash !== existingEntry.content_hash) {
        console.log(`Skipping ${relativePath}: local modifications detected`);
        return;
      }
    }

    // ディレクトリ作成
    const dir = path.dirname(absolutePath);
    fs.mkdirSync(dir, { recursive: true });

    // ProseMirror JSON → Markdown 変換（画像参照を含む）
    let content = doc.plain || '';
    const jsonContent = doc.json
      ? typeof doc.json === 'string'
        ? JSON.parse(doc.json)
        : doc.json
      : null;

    if (jsonContent && jsonContent.type === 'doc') {
      const imagesDir = path.join(dir, '.images');
      const { markdown, images } = proseMirrorToMarkdown(jsonContent, (src) => {
        const idMatch = src.match(/\/file\/(\d+)/);
        if (idMatch) {
          return `.images/${idMatch[1]}`;
        }
        return src;
      });

      // 画像をローカルにダウンロード
      if (images.length > 0) {
        fs.mkdirSync(imagesDir, { recursive: true });
        await Promise.all(
          images.map(async (img) => {
            if (!img.attachmentId || !doc.id) {
              return;
            }
            const localImagePath = path.join(imagesDir, String(img.attachmentId));
            if (fs.existsSync(localImagePath)) {
              return;
            }
            try {
              const buffer = await this.backlogApi.downloadDocumentAttachment(
                doc.id,
                img.attachmentId
              );
              fs.writeFileSync(localImagePath, buffer);
            } catch (e) {
              console.error(`[DocumentSync] Failed to download image ${img.attachmentId}:`, e);
            }
          })
        );
      }

      if (markdown.trim()) {
        content = markdown;
      }
    }

    const now = new Date().toISOString();
    const frontmatter = this.syncService.buildFrontmatter({
      title,
      backlog_id: doc.id,
      project: projectKey,
      synced_at: now,
      updated_at: doc.updated || now,
    });

    fs.writeFileSync(absolutePath, frontmatter + content, 'utf-8');

    const contentHash = this.syncService.computeHash(content);
    manifest[relativePath] = {
      backlog_id: doc.id,
      backlog_path: title,
      project: projectKey,
      synced_at: now,
      remote_updated_at: doc.updated || now,
      content_hash: contentHash,
    };
  }

  async status(mapping?: DocumentSyncMapping): Promise<void> {
    const resolved = mapping || (await this.resolveMapping());
    if (!resolved) {
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    const localDir = path.join(workspaceRoot, resolved.localPath);
    const manifest = this.syncService.loadManifest(localDir);

    // リモートの更新日時を取得
    const remoteUpdates = new Map<string, string>();
    try {
      const projectId = await this.resolveProjectId(resolved.projectKey);
      if (projectId) {
        const flatNodes = await this.backlogApi.getDocumentSubtree(
          projectId,
          resolved.documentNodeId
        );
        for (const node of flatNodes) {
          if (node.updated) {
            remoteUpdates.set(node.id, node.updated);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch remote updates:', error);
    }

    const statuses = this.syncService.getAllStatuses(localDir, manifest, remoteUpdates);

    if (statuses.length === 0) {
      vscode.window.showInformationMessage(
        '[Nulab] 同期済みファイルがありません。まず Pull を実行してください。'
      );
      return;
    }

    const statusIcons: Record<string, string> = {
      unchanged: '$(check)',
      local_modified: '$(edit)',
      remote_modified: '$(cloud-download)',
      conflict: '$(warning)',
      new_local: '$(add)',
      not_synced: '$(circle-slash)',
    };

    const items = statuses.map((entry) => ({
      label: `${statusIcons[entry.status] || ''} ${entry.relativePath}`,
      description: entry.status,
      detail: entry.manifestEntry?.backlog_id,
      entry,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Sync Status — ファイルを選択してアクションを実行',
    });

    if (selected) {
      const filePath = path.join(localDir, selected.entry.relativePath);
      if (selected.entry.status === 'local_modified' || selected.entry.status === 'conflict') {
        await this.diff(filePath);
      } else if (selected.entry.status === 'remote_modified') {
        // リモート変更ありの場合は pull を提案
        const action = await vscode.window.showInformationMessage(
          `[Nulab] ${selected.entry.relativePath} にリモート更新があります。Pull しますか？`,
          'Pull'
        );
        if (action === 'Pull') {
          await this.pull(resolved);
        }
      }
    }
  }

  async diff(filePath?: string): Promise<void> {
    const targetPath = filePath || this.getActiveFilePath();
    if (!targetPath) {
      vscode.window.showWarningMessage('[Nulab] 差分を表示するファイルを選択してください。');
      return;
    }

    if (!fs.existsSync(targetPath)) {
      vscode.window.showWarningMessage('[Nulab] ファイルが見つかりません。');
      return;
    }

    const text = fs.readFileSync(targetPath, 'utf-8');
    const { meta, body } = this.syncService.parseFrontmatter(text);

    if (!meta.backlog_id) {
      vscode.window.showWarningMessage(
        '[Nulab] このファイルには backlog_id がありません。Pull 済みのファイルを選択してください。'
      );
      return;
    }

    const projectKey = meta.project || 'UNKNOWN';
    const title = meta.title || path.basename(targetPath, '.bdoc');

    // Clear caches to ensure fresh content
    this.remoteContentProvider.invalidateCache(meta.backlog_id);

    const remoteUri = BacklogRemoteContentProvider.buildUri(projectKey, meta.backlog_id, title);

    // Write body (frontmatter stripped) to a temp .md file so the diff is
    // clean and editable (.bdoc custom editor would intercept .bdoc files).
    const tmpDir = require('os').tmpdir();
    const safeName = this.syncService.sanitizeFileName(title);
    const tmpPath = path.join(tmpDir, `backlog-diff-${safeName}.md`);
    fs.writeFileSync(tmpPath, body, 'utf-8');
    const localUri = vscode.Uri.file(tmpPath);

    // Notify VSCode that virtual document content has changed (bust cache)
    this.remoteContentProvider.fireDidChange(remoteUri);

    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        remoteUri,
        localUri,
        `Backlog (Remote) ↔ Local: ${title}`
      );

      // Watch for saves on the temp file → write back to original .bdoc with frontmatter
      const watcher = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.fsPath === tmpPath) {
          const newBody = doc.getText();
          const frontmatter = this.syncService.buildFrontmatter({
            title: meta.title || title,
            backlog_id: meta.backlog_id,
            project: meta.project || projectKey,
            synced_at: meta.synced_at || new Date().toISOString(),
            updated_at: meta.updated_at || new Date().toISOString(),
          });
          fs.writeFileSync(targetPath, frontmatter + newBody, 'utf-8');
        }
      });

      // Clean up watcher when diff editor closes
      const closeWatcher = vscode.window.onDidChangeVisibleTextEditors((editors) => {
        const stillOpen = editors.some((e) => e.document.uri.fsPath === tmpPath);
        if (!stillOpen) {
          watcher.dispose();
          closeWatcher.dispose();
          // Clean up temp file
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
        }
      });
    } catch (error) {
      vscode.window.showErrorMessage(
        `[Nulab] Diff を開けませんでした: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  async copyAndOpen(filePath?: string): Promise<void> {
    const targetPath = filePath || this.getActiveFilePath();
    if (!targetPath) {
      vscode.window.showWarningMessage('[Nulab] ファイルを選択してください。');
      return;
    }

    const text = fs.readFileSync(targetPath, 'utf-8');
    const { meta, body } = this.syncService.parseFrontmatter(text);

    if (!meta.backlog_id) {
      vscode.window.showWarningMessage(
        '[Nulab] このファイルには backlog_id がありません。新規ドキュメントには Push コマンドを使用してください。'
      );
      return;
    }

    // クリップボードにコピー
    await vscode.env.clipboard.writeText(body);

    // Backlog エディタ URL を構築して開く
    const domain = this.backlogConfig.getDomain();
    if (!domain) {
      vscode.window.showWarningMessage('[Nulab] Backlog ドメインが設定されていません。');
      return;
    }

    const hostOnly = domain.replace(/https?:\/\//, '').split('/')[0];
    const projectKey = meta.project || 'UNKNOWN';
    const url = `https://${hostOnly}/document/${projectKey}/${meta.backlog_id}`;
    await vscode.env.openExternal(vscode.Uri.parse(url));

    vscode.window.showInformationMessage(
      '[Nulab] コンテンツをクリップボードにコピーしました。ブラウザで Backlog エディタを開きます。'
    );
  }

  async push(filePath?: string): Promise<void> {
    const targetPath = filePath || this.getActiveFilePath();
    if (!targetPath) {
      vscode.window.showWarningMessage('[Nulab] Push するファイルを選択してください。');
      return;
    }

    const text = fs.readFileSync(targetPath, 'utf-8');
    const { meta, body } = this.syncService.parseFrontmatter(text);

    if (meta.backlog_id) {
      vscode.window.showWarningMessage(
        '[Nulab] このファイルは既に Backlog にリンクされています。更新には Copy & Open を使用してください。'
      );
      return;
    }

    // マッピングの解決
    const resolved = await this.resolveMapping();
    if (!resolved) {
      return;
    }

    const projectId = await this.resolveProjectId(resolved.projectKey);
    if (!projectId) {
      vscode.window.showErrorMessage(`[Nulab] Project ${resolved.projectKey} not found`);
      return;
    }

    const title = meta.title || path.basename(targetPath, '.bdoc');

    const confirm = await vscode.window.showInformationMessage(
      `[Nulab] "${title}" を Backlog に新規作成しますか？`,
      'Create'
    );
    if (confirm !== 'Create') {
      return;
    }

    try {
      const created = await this.backlogApi.postDocument({
        projectId,
        title,
        content: body,
        parentId: resolved.documentNodeId,
        addLast: true,
      });

      // Frontmatter を更新してファイルに書き戻す
      const workspaceRoot = this.getWorkspaceRoot();
      if (!workspaceRoot) {
        return;
      }

      const localDir = path.join(workspaceRoot, resolved.localPath);
      const now = new Date().toISOString();

      const newFrontmatter = this.syncService.buildFrontmatter({
        title: created.title || title,
        backlog_id: created.id,
        project: resolved.projectKey,
        synced_at: now,
        updated_at: created.updated || now,
      });

      fs.writeFileSync(targetPath, newFrontmatter + body, 'utf-8');

      // Manifest 更新
      const manifest = this.syncService.loadManifest(localDir);
      const relativePath = path.relative(localDir, targetPath);
      manifest[relativePath] = {
        backlog_id: created.id,
        backlog_path: title,
        project: resolved.projectKey,
        synced_at: now,
        remote_updated_at: created.updated || now,
        content_hash: this.syncService.computeHash(body),
      };
      this.syncService.saveManifest(localDir, manifest);
      this.decorationProvider?.refresh();

      vscode.window.showInformationMessage(`[Nulab] "${title}" を Backlog に作成しました。`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `[Nulab] Push に失敗しました: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * 1ファイルだけ Pull する。確認ダイアログ付き。
   */
  async pullFile(filePath?: string): Promise<void> {
    const targetPath = filePath || this.getActiveFilePath();
    if (!targetPath) {
      vscode.window.showWarningMessage('[Nulab] Pull するファイルを開いてください。');
      return;
    }

    if (!fs.existsSync(targetPath)) {
      vscode.window.showWarningMessage('[Nulab] ファイルが見つかりません。');
      return;
    }

    const text = fs.readFileSync(targetPath, 'utf-8');
    const { meta } = this.syncService.parseFrontmatter(text);

    if (!meta.backlog_id) {
      vscode.window.showWarningMessage(
        '[Nulab] このファイルには backlog_id がありません。Pull 済みのファイルを選択してください。'
      );
      return;
    }

    const title = meta.title || require('path').basename(targetPath, '.bdoc');

    // 確認ダイアログ
    const confirm = await vscode.window.showWarningMessage(
      `[Nulab] "${title}" をリモートから上書きしますか？ローカルの変更は失われます。`,
      { modal: true },
      'Pull'
    );
    if (confirm !== 'Pull') {
      return;
    }

    try {
      const doc = await this.backlogApi.getDocument(meta.backlog_id);
      const projectKey = meta.project || '';

      // ProseMirror JSON → Markdown 変換（画像含む）
      const dir = path.dirname(targetPath);
      let content = doc.plain || '';
      const jsonContent = doc.json
        ? typeof doc.json === 'string'
          ? JSON.parse(doc.json)
          : doc.json
        : null;

      if (jsonContent && jsonContent.type === 'doc') {
        const imagesDir = path.join(dir, '.images');
        const { markdown, images } = proseMirrorToMarkdown(jsonContent, (src) => {
          const idMatch = src.match(/\/file\/(\d+)/);
          if (idMatch) {
            return `.images/${idMatch[1]}`;
          }
          return src;
        });

        if (images.length > 0) {
          fs.mkdirSync(imagesDir, { recursive: true });
          await Promise.all(
            images.map(async (img) => {
              if (!img.attachmentId || !doc.id) {
                return;
              }
              const localImagePath = path.join(imagesDir, String(img.attachmentId));
              try {
                const buffer = await this.backlogApi.downloadDocumentAttachment(
                  doc.id,
                  img.attachmentId
                );
                fs.writeFileSync(localImagePath, buffer);
              } catch (e) {
                console.error(`[DocumentSync] Failed to download image ${img.attachmentId}:`, e);
              }
            })
          );
        }

        if (markdown.trim()) {
          content = markdown;
        }
      }

      const now = new Date().toISOString();
      const frontmatter = this.syncService.buildFrontmatter({
        title: doc.title || title,
        backlog_id: doc.id,
        project: projectKey,
        synced_at: now,
        updated_at: doc.updated || now,
      });

      fs.writeFileSync(targetPath, frontmatter + content, 'utf-8');

      // Manifest 更新
      const resolved = await this.resolveMapping();
      if (resolved) {
        const workspaceRoot = this.getWorkspaceRoot();
        if (workspaceRoot) {
          const localDir = path.join(workspaceRoot, resolved.localPath);
          const manifest = this.syncService.loadManifest(localDir);
          const relativePath = path.relative(localDir, targetPath);
          manifest[relativePath] = {
            backlog_id: doc.id,
            backlog_path: meta.title || title,
            project: projectKey,
            synced_at: now,
            remote_updated_at: doc.updated || now,
            content_hash: this.syncService.computeHash(content),
          };
          this.syncService.saveManifest(localDir, manifest);
          this.decorationProvider?.refresh();
        }
      }

      vscode.window.showInformationMessage(`[Nulab] "${doc.title || title}" を Pull しました。`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `[Nulab] Pull に失敗しました: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // ---- Helpers ----

  private async resolveMapping(): Promise<DocumentSyncMapping | undefined> {
    const mappings = this.fileStore.getDocumentSyncMappings();
    if (mappings.length === 0) {
      vscode.window.showWarningMessage(
        '[Nulab] Document Sync マッピングが設定されていません。Documents ビューからフォルダを右クリックして設定してください。'
      );
      return undefined;
    }

    if (mappings.length === 1) {
      return mappings[0];
    }

    const selected = await vscode.window.showQuickPick(
      mappings.map((m) => ({
        label: m.documentNodeName || m.documentNodeId,
        description: `${m.projectKey} → ${m.localPath}`,
        mapping: m,
      })),
      { placeHolder: '同期するマッピングを選択' }
    );

    return selected?.mapping;
  }

  private async resolveProjectId(projectKey: string): Promise<number | undefined> {
    const projects = await this.backlogApi.getProjects();
    const project = projects.find((p) => p.projectKey.toUpperCase() === projectKey.toUpperCase());
    return project?.id;
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('[Nulab] ワークスペースを開いてください。');
      return undefined;
    }
    return folders[0].uri.fsPath;
  }

  private getActiveFilePath(): string | undefined {
    return vscode.window.activeTextEditor?.document.uri.fsPath;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
