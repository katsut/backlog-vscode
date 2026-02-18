import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CacooApiService } from '../services/cacooApi';
import { ConfigService } from '../services/configService';
import { CacooSyncService } from '../services/cacooSyncService';
import { CacooSheetWebview } from '../webviews/cacooSheetWebview';
import { CacooSyncMapping, CacooPinnedSheet } from '../types/cacoo';
import {
  CacooFolderItem,
  CacooDiagramItem,
  CacooSheetItem,
} from '../providers/cacooTreeViewProvider';

export class CacooCommands {
  private isPulling = false;

  constructor(
    private cacooApi: CacooApiService,
    private configService: ConfigService,
    private syncService: CacooSyncService
  ) {}

  // ---- API Key Setup ----

  async setApiKey(): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Cacoo API Key を入力してください',
      password: true,
      ignoreFocusOut: true,
    });
    if (!apiKey) {
      return;
    }
    await this.configService.setCacooApiKey(apiKey);

    // Organization selection
    try {
      await this.cacooApi.reinitialize();
    } catch {
      // organizationKey might not be set yet, that's OK
    }

    // Try to fetch organizations and let user pick one
    const tempApiKey = apiKey;
    try {
      const orgs = await this.cacooApi.getOrganizations();
      if (orgs.length === 0) {
        vscode.window.showWarningMessage('Organization が見つかりません。');
        return;
      }

      if (orgs.length === 1) {
        await this.configService.setCacooOrganizationKey(orgs[0].key);
        vscode.window.showInformationMessage(
          `Cacoo API Key を設定しました。Organization: ${orgs[0].name}`
        );
      } else {
        const selected = await vscode.window.showQuickPick(
          orgs.map((o) => ({ label: o.name, description: o.key, orgKey: o.key })),
          { placeHolder: 'Organization を選択してください' }
        );
        if (selected) {
          await this.configService.setCacooOrganizationKey(selected.orgKey);
          vscode.window.showInformationMessage(
            `Cacoo API Key を設定しました。Organization: ${selected.label}`
          );
        }
      }

      await this.cacooApi.reinitialize();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Organization の取得に失敗しました: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // ---- Preview ----

  async previewSheet(
    context: vscode.ExtensionContext,
    openPanels: Map<string, vscode.WebviewPanel>,
    diagramId: string,
    sheetUid: string,
    title: string
  ): Promise<void> {
    const panelKey = `${diagramId}-${sheetUid}`;
    const existing = openPanels.get(panelKey);
    if (existing) {
      existing.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'cacooSheet',
      `Cacoo: ${title}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      }
    );

    openPanels.set(panelKey, panel);
    panel.onDidDispose(() => openPanels.delete(panelKey));

    // Message handler
    panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'openExternal' && message.url) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
      },
      undefined,
      context.subscriptions
    );

    // Download and show
    try {
      panel.webview.html = '<html><body><p>Loading...</p></body></html>';
      const buffer = await this.cacooApi.downloadSheetImage(diagramId, sheetUid);
      const base64 = buffer.toString('base64');
      const diagramUrl = `https://cacoo.com/diagrams/${diagramId}`;

      panel.webview.html = CacooSheetWebview.getWebviewContent(
        panel.webview,
        context.extensionUri,
        title,
        base64,
        diagramUrl
      );
    } catch (error) {
      panel.webview.html = `<html><body><p>Error: ${error instanceof Error ? error.message : error}</p></body></html>`;
    }
  }

  // ---- Open in Browser ----

  async openInBrowser(item: CacooDiagramItem | CacooSheetItem): Promise<void> {
    let diagramId: string;
    if (item instanceof CacooDiagramItem) {
      diagramId = item.diagram.diagramId;
    } else if (item instanceof CacooSheetItem) {
      diagramId = item.diagram.diagramId;
    } else {
      return;
    }
    const url = `https://cacoo.com/diagrams/${diagramId}`;
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  // ---- Pin/Unpin ----

  async togglePin(item: CacooSheetItem): Promise<void> {
    if (!(item instanceof CacooSheetItem)) {
      return;
    }
    const sheet: CacooPinnedSheet = {
      diagramId: item.diagram.diagramId,
      sheetUid: item.sheet.uid,
      label: `${item.diagram.title} / ${item.sheet.name}`,
    };
    const pinned = await this.configService.toggleCacooPinnedSheet(sheet);
    vscode.window.showInformationMessage(
      pinned ? `"${sheet.label}" をピン留めしました` : `"${sheet.label}" のピンを外しました`
    );
  }

  // ---- Sync Mapping ----

  async setSyncMapping(item?: CacooFolderItem): Promise<void> {
    let folderId: number;
    let folderName: string;
    let organizationKey: string;

    if (item instanceof CacooFolderItem) {
      folderId = item.folder.folderId;
      folderName = item.folder.folderName;
      organizationKey = this.configService.getCacooOrganizationKey() || '';
    } else {
      // Interactive folder selection
      try {
        const folders = await this.cacooApi.getFolders();
        const selected = await vscode.window.showQuickPick(
          folders.map((f) => ({
            label: f.folderName,
            description: f.type,
            folder: f,
          })),
          { placeHolder: '同期するフォルダを選択' }
        );
        if (!selected) {
          return;
        }
        folderId = selected.folder.folderId;
        folderName = selected.folder.folderName;
        organizationKey = this.configService.getCacooOrganizationKey() || '';
      } catch (error) {
        vscode.window.showErrorMessage(`フォルダの取得に失敗しました: ${error}`);
        return;
      }
    }

    const localPath = await vscode.window.showInputBox({
      prompt: 'ローカルディレクトリのパス（ワークスペースからの相対パス）',
      value: `cacoo-sheets/${this.syncService.sanitizeFileName(folderName)}`,
      ignoreFocusOut: true,
    });
    if (!localPath) {
      return;
    }

    const mapping: CacooSyncMapping = {
      localPath,
      organizationKey,
      folderId,
      folderName,
    };
    await this.configService.addCacooSyncMapping(mapping);
    vscode.window.showInformationMessage(`マッピングを設定しました: ${folderName} → ${localPath}`);
  }

  // ---- Pull ----

  async pull(mapping?: CacooSyncMapping): Promise<void> {
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
          title: 'Pulling Cacoo sheets...',
          cancellable: true,
        },
        async (progress, token) => {
          // 1. Get all diagrams in the folder
          const allDiagrams: Array<{ diagramId: string; title: string; updated: string }> = [];
          let offset = 0;
          const limit = 50;

          while (true) {
            if (token.isCancellationRequested) { break; }
            const resp = await this.cacooApi.getDiagrams({
              folderId: resolved.folderId,
              sortOn: 'updated',
              sortType: 'desc',
              limit,
              offset,
            });
            allDiagrams.push(...resp.result.map((d) => ({
              diagramId: d.diagramId,
              title: d.title,
              updated: d.updated,
            })));
            if (allDiagrams.length >= resp.count || resp.result.length < limit) {
              break;
            }
            offset += limit;
          }

          progress.report({ message: `${allDiagrams.length} diagrams found` });

          const manifest = this.syncService.loadManifest(localDir);
          let pulled = 0;
          let unchanged = 0;
          let skipped = 0;

          // 2. For each diagram, get sheets and download images
          for (let di = 0; di < allDiagrams.length; di++) {
            if (token.isCancellationRequested) { break; }
            const diagram = allDiagrams[di];

            progress.report({
              increment: (1 / allDiagrams.length) * 100,
              message: `${diagram.title} (${di + 1}/${allDiagrams.length})`,
            });

            let detail;
            try {
              detail = await this.cacooApi.getDiagramDetail(diagram.diagramId);
            } catch (error) {
              console.error(`[Cacoo] Failed to get detail for ${diagram.diagramId}:`, error);
              skipped++;
              continue;
            }

            for (const sheet of detail.sheets || []) {
              if (token.isCancellationRequested) { break; }

              const relativePath = path.relative(
                localDir,
                this.syncService.resolveSheetPath(localDir, diagram.title, sheet.name)
              );

              // Check manifest for unchanged
              const existing = manifest[relativePath];
              if (existing && existing.remote_updated_at === diagram.updated) {
                unchanged++;
                continue;
              }

              try {
                const buffer = await this.cacooApi.downloadSheetImage(
                  diagram.diagramId,
                  sheet.uid
                );
                const absolutePath = path.join(localDir, relativePath);
                fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
                fs.writeFileSync(absolutePath, buffer);

                const now = new Date().toISOString();
                manifest[relativePath] = {
                  diagramId: diagram.diagramId,
                  sheetUid: sheet.uid,
                  sheetName: sheet.name,
                  diagramTitle: diagram.title,
                  synced_at: now,
                  remote_updated_at: diagram.updated,
                  content_hash: this.syncService.computeImageHash(buffer),
                };
                pulled++;
              } catch (error) {
                console.error(`[Cacoo] Failed to download sheet ${sheet.name}:`, error);
                skipped++;
              }

              await this.delay(100);
            }

            await this.delay(100);
          }

          this.syncService.saveManifest(localDir, manifest);

          const parts = [`${pulled} 件ダウンロード`];
          if (unchanged > 0) { parts.push(`${unchanged} 件変更なし`); }
          if (skipped > 0) { parts.push(`${skipped} 件スキップ`); }
          vscode.window.showInformationMessage(`Cacoo Pull 完了: ${parts.join(', ')}`);
        }
      );
    } finally {
      this.isPulling = false;
    }
  }

  // ---- Helpers ----

  private async resolveMapping(): Promise<CacooSyncMapping | undefined> {
    const mappings = this.configService.getCacooSyncMappings();
    if (mappings.length === 0) {
      vscode.window.showWarningMessage(
        'Cacoo Sync マッピングが設定されていません。フォルダを右クリックして設定してください。'
      );
      return undefined;
    }

    if (mappings.length === 1) {
      return mappings[0];
    }

    const selected = await vscode.window.showQuickPick(
      mappings.map((m) => ({
        label: m.folderName || String(m.folderId),
        description: m.localPath,
        mapping: m,
      })),
      { placeHolder: '同期するマッピングを選択' }
    );

    return selected?.mapping;
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('ワークスペースを開いてください。');
      return undefined;
    }
    return folders[0].uri.fsPath;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
