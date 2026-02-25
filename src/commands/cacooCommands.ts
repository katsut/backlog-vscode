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
        vscode.window.showWarningMessage('[Nulab] Organization が見つかりません。');
        return;
      }

      if (orgs.length === 1) {
        await this.configService.setCacooOrganizationKey(orgs[0].key);
        vscode.window.showInformationMessage(
          `[Nulab] Cacoo API Key を設定しました。Organization: ${orgs[0].name}`
        );
      } else {
        const selected = await vscode.window.showQuickPick(
          orgs.map((o) => ({ label: o.name, description: o.key, orgKey: o.key })),
          { placeHolder: 'Organization を選択してください' }
        );
        if (selected) {
          await this.configService.setCacooOrganizationKey(selected.orgKey);
          vscode.window.showInformationMessage(
            `[Nulab] Cacoo API Key を設定しました。Organization: ${selected.label}`
          );
        }
      }

      await this.cacooApi.reinitialize();
    } catch (error) {
      vscode.window.showErrorMessage(
        `[Nulab] Organization の取得に失敗しました: ${
          error instanceof Error ? error.message : error
        }`
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
      panel.webview.html = `<html><body><p>Error: ${
        error instanceof Error ? error.message : error
      }</p></body></html>`;
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
      pinned
        ? `[Nulab] "${sheet.label}" をピン留めしました`
        : `[Nulab] "${sheet.label}" のピンを外しました`
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
        vscode.window.showErrorMessage(`[Nulab] フォルダの取得に失敗しました: ${error}`);
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
    vscode.window.showInformationMessage(
      `[Nulab] マッピングを設定しました: ${folderName} → ${localPath}`
    );
  }

  // ---- Pull (pinned sheets only) ----

  async pull(): Promise<void> {
    if (this.isPulling) {
      vscode.window.showWarningMessage('[Nulab] Pull is already in progress.');
      return;
    }

    const pinnedSheets = this.configService.getCacooPinnedSheets();
    if (pinnedSheets.length === 0) {
      vscode.window.showWarningMessage(
        '[Nulab] ピン留めされたシートがありません。ツリーからシートをピン留めしてください。'
      );
      return;
    }

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    // Determine local directory: use mapping if exists, otherwise default
    const mappings = this.configService.getCacooSyncMappings();
    const localPath = mappings.length > 0 ? mappings[0].localPath : 'cacoo-sheets';
    const localDir = path.join(workspaceRoot, localPath);

    this.isPulling = true;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Pulling pinned Cacoo sheets...',
          cancellable: true,
        },
        async (progress, token) => {
          const manifest = this.syncService.loadManifest(localDir);
          let pulled = 0;
          let unchanged = 0;
          let skipped = 0;
          const total = pinnedSheets.length;

          for (let i = 0; i < pinnedSheets.length; i++) {
            if (token.isCancellationRequested) {
              break;
            }
            const pin = pinnedSheets[i];

            progress.report({
              increment: (1 / total) * 100,
              message: `${pin.label} (${i + 1}/${total})`,
            });

            // Parse label "DiagramTitle / SheetName" for file path
            const parts = pin.label.split(' / ');
            const diagramTitle = parts.length > 1 ? parts.slice(0, -1).join(' / ') : pin.diagramId;
            const sheetName = parts.length > 1 ? parts[parts.length - 1] : pin.sheetUid;

            const relativePath = path.relative(
              localDir,
              this.syncService.resolveSheetPath(localDir, diagramTitle, sheetName)
            );

            try {
              const buffer = await this.cacooApi.downloadSheetImage(pin.diagramId, pin.sheetUid);

              // Check if content changed via hash
              const newHash = this.syncService.computeImageHash(buffer);
              const existing = manifest[relativePath];
              if (existing && existing.content_hash === newHash) {
                unchanged++;
                continue;
              }

              const absolutePath = path.join(localDir, relativePath);
              fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
              fs.writeFileSync(absolutePath, buffer);

              manifest[relativePath] = {
                diagramId: pin.diagramId,
                sheetUid: pin.sheetUid,
                sheetName: sheetName,
                diagramTitle: diagramTitle,
                synced_at: new Date().toISOString(),
                remote_updated_at: new Date().toISOString(),
                content_hash: newHash,
              };
              pulled++;
            } catch (error) {
              console.error(`[Cacoo] Failed to download ${pin.label}:`, error);
              skipped++;
            }

            await this.delay(100);
          }

          this.syncService.saveManifest(localDir, manifest);

          const summary = [`${pulled} 件ダウンロード`];
          if (unchanged > 0) {
            summary.push(`${unchanged} 件変更なし`);
          }
          if (skipped > 0) {
            summary.push(`${skipped} 件スキップ`);
          }
          vscode.window.showInformationMessage(`[Nulab] Cacoo Pull 完了: ${summary.join(', ')}`);
        }
      );
    } finally {
      this.isPulling = false;
    }
  }

  // ---- Helpers ----

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('[Nulab] ワークスペースを開いてください。');
      return undefined;
    }
    return folders[0].uri.fsPath;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
