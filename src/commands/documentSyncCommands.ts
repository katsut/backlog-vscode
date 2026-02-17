import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BacklogApiService } from '../services/backlogApi';
import { ConfigService } from '../services/configService';
import { SyncService } from '../services/syncService';
import { BacklogRemoteContentProvider } from '../providers/backlogRemoteContentProvider';
import { DocumentSyncMapping, SyncManifest } from '../types/backlog';
import { Entity } from 'backlog-js';

export class DocumentSyncCommands {
  private syncService: SyncService;
  private isPulling = false;

  constructor(
    private backlogApi: BacklogApiService,
    private configService: ConfigService,
    private remoteContentProvider: BacklogRemoteContentProvider
  ) {
    this.syncService = new SyncService();
  }

  async pull(mapping?: DocumentSyncMapping): Promise<void> {
    if (this.isPulling) {
      vscode.window.showWarningMessage('Pull is already in progress.');
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
          const total = flatNodes.length;
          let pulled = 0;
          let skipped = 0;

          for (const node of flatNodes) {
            if (token.isCancellationRequested) {
              break;
            }

            progress.report({
              increment: (1 / total) * 100,
              message: `${node.name || node.id} (${pulled + skipped + 1}/${total})`,
            });

            try {
              await this.pullSingleDocument(
                node,
                localDir,
                resolved.projectKey,
                manifest
              );
              pulled++;
            } catch (error) {
              console.error(`Failed to pull ${node.name || node.id}:`, error);
              skipped++;
            }

            // Rate limit 対策
            await this.delay(100);
          }

          this.syncService.saveManifest(localDir, manifest);
          this.remoteContentProvider.invalidateCache();

          vscode.window.showInformationMessage(
            `Pull 完了: ${pulled} 件取得, ${skipped} 件スキップ`
          );
        }
      );
    } finally {
      this.isPulling = false;
    }
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
    const absolutePath = path.join(localDir, relativePath);

    // ローカル変更がある場合はスキップ
    const existingEntry = manifest[relativePath];
    if (existingEntry && fs.existsSync(absolutePath)) {
      const localHash = this.syncService.computeLocalFileHash(absolutePath);
      if (localHash !== existingEntry.content_hash) {
        // ローカル変更あり → スキップ
        console.log(`Skipping ${relativePath}: local modifications detected`);
        return;
      }
    }

    const content = doc.plain || '';
    const now = new Date().toISOString();
    const frontmatter = this.syncService.buildFrontmatter({
      title,
      backlog_id: doc.id,
      project: projectKey,
      synced_at: now,
      updated_at: doc.updated || now,
    });

    // ディレクトリ作成
    const dir = path.dirname(absolutePath);
    fs.mkdirSync(dir, { recursive: true });

    // ファイル書き込み
    fs.writeFileSync(absolutePath, frontmatter + content, 'utf-8');

    // Manifest 更新
    const contentHash = this.syncService.computeHash(content);
    manifest[relativePath] = {
      backlog_id: doc.id,
      backlog_path: [...node._treePath, title].join('/'),
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
      vscode.window.showInformationMessage('同期済みファイルがありません。まず Pull を実行してください。');
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
          `${selected.entry.relativePath} にリモート更新があります。Pull しますか？`,
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
      vscode.window.showWarningMessage('差分を表示するファイルを選択してください。');
      return;
    }

    if (!fs.existsSync(targetPath)) {
      vscode.window.showWarningMessage('ファイルが見つかりません。');
      return;
    }

    const text = fs.readFileSync(targetPath, 'utf-8');
    const { meta } = this.syncService.parseFrontmatter(text);

    if (!meta.backlog_id) {
      vscode.window.showWarningMessage(
        'このファイルには backlog_id がありません。Pull 済みのファイルを選択してください。'
      );
      return;
    }

    const projectKey = meta.project || 'UNKNOWN';
    const title = meta.title || path.basename(targetPath, '.bdoc');

    this.remoteContentProvider.invalidateCache(meta.backlog_id);

    const remoteUri = BacklogRemoteContentProvider.buildUri(
      projectKey,
      meta.backlog_id,
      title
    );
    const localUri = vscode.Uri.file(targetPath);

    await vscode.commands.executeCommand(
      'vscode.diff',
      remoteUri,
      localUri,
      `Backlog (Remote) ↔ Local: ${title}`
    );
  }

  async copyAndOpen(filePath?: string): Promise<void> {
    const targetPath = filePath || this.getActiveFilePath();
    if (!targetPath) {
      vscode.window.showWarningMessage('ファイルを選択してください。');
      return;
    }

    const text = fs.readFileSync(targetPath, 'utf-8');
    const { meta, body } = this.syncService.parseFrontmatter(text);

    if (!meta.backlog_id) {
      vscode.window.showWarningMessage(
        'このファイルには backlog_id がありません。新規ドキュメントには Push コマンドを使用してください。'
      );
      return;
    }

    // クリップボードにコピー
    await vscode.env.clipboard.writeText(body);

    // Backlog エディタ URL を構築して開く
    const domain = this.configService.getDomain();
    if (!domain) {
      vscode.window.showWarningMessage('Backlog ドメインが設定されていません。');
      return;
    }

    const hostOnly = domain.replace(/https?:\/\//, '').split('/')[0];
    const url = `https://${hostOnly}/alias/document/${meta.backlog_id}`;
    await vscode.env.openExternal(vscode.Uri.parse(url));

    vscode.window.showInformationMessage(
      'コンテンツをクリップボードにコピーしました。ブラウザで Backlog エディタを開きます。'
    );
  }

  async push(filePath?: string): Promise<void> {
    const targetPath = filePath || this.getActiveFilePath();
    if (!targetPath) {
      vscode.window.showWarningMessage('Push するファイルを選択してください。');
      return;
    }

    const text = fs.readFileSync(targetPath, 'utf-8');
    const { meta, body } = this.syncService.parseFrontmatter(text);

    if (meta.backlog_id) {
      vscode.window.showWarningMessage(
        'このファイルは既に Backlog にリンクされています。更新には Copy & Open を使用してください。'
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
      vscode.window.showErrorMessage(`Project ${resolved.projectKey} not found`);
      return;
    }

    const title = meta.title || path.basename(targetPath, '.bdoc');

    const confirm = await vscode.window.showInformationMessage(
      `"${title}" を Backlog に新規作成しますか？`,
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

      vscode.window.showInformationMessage(`"${title}" を Backlog に作成しました。`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Push に失敗しました: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // ---- Helpers ----

  private async resolveMapping(): Promise<DocumentSyncMapping | undefined> {
    const mappings = this.configService.getDocumentSyncMappings();
    if (mappings.length === 0) {
      vscode.window.showWarningMessage(
        'Document Sync マッピングが設定されていません。Documents ビューからフォルダを右クリックして設定してください。'
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
    const project = projects.find(
      (p) => p.projectKey.toUpperCase() === projectKey.toUpperCase()
    );
    return project?.id;
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('ワークスペースを開いてください。');
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
