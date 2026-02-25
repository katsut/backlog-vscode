import * as vscode from 'vscode';
import { CacooApiService } from '../services/cacooApi';
import { ConfigService } from '../services/configService';
import { CacooFolder, CacooDiagram, CacooSheet, CacooPinnedSheet } from '../types/cacoo';

// Tree item types
type CacooTreeItem = CacooFolderItem | CacooDiagramItem | CacooSheetItem | CacooPinnedSectionItem;

const CACOO_COLOR = new vscode.ThemeColor('cacoo.brandColor');

export class CacooTreeViewProvider implements vscode.TreeDataProvider<CacooTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CacooTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private folders: CacooFolder[] | null = null;
  private allDiagrams: CacooDiagram[] | null = null;
  private sheetCache = new Map<string, CacooSheet[]>();
  private searchKeyword: string | null = null;

  constructor(private cacooApi: CacooApiService, private configService: ConfigService) {}

  refresh(): void {
    this.folders = null;
    this.allDiagrams = null;
    this.sheetCache.clear();
    this.searchKeyword = null;
    this._onDidChangeTreeData.fire();
  }

  async search(): Promise<void> {
    const keyword = await vscode.window.showInputBox({
      prompt: 'フォルダ・図をフィルタ (空欄でクリア)',
      placeHolder: 'キーワードを入力...',
      value: this.searchKeyword || '',
    });
    if (keyword === undefined) {
      return;
    } // cancelled
    this.searchKeyword = keyword || null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CacooTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CacooTreeItem): Promise<CacooTreeItem[]> {
    if (!(await this.cacooApi.isConfigured())) {
      return [];
    }

    if (!element) {
      return this.getRootChildren();
    }

    if (element instanceof CacooPinnedSectionItem) {
      return this.getPinnedSheetItems();
    }

    if (element instanceof CacooFolderItem) {
      return this.getDiagramItems(element.folder);
    }

    if (element instanceof CacooDiagramItem) {
      return this.getSheetItems(element.diagram);
    }

    return [];
  }

  private async getRootChildren(): Promise<CacooTreeItem[]> {
    const items: CacooTreeItem[] = [];
    const filter = this.searchKeyword?.toLowerCase();

    // Filter header
    if (filter) {
      const header = new vscode.TreeItem(`Filter: "${this.searchKeyword}"`);
      header.iconPath = new vscode.ThemeIcon('filter');
      header.description = 'Refresh to clear';
      items.push(header as CacooTreeItem);
    }

    // Pinned sheets section
    if (!filter) {
      const pins = this.configService.getCacooPinnedSheets();
      if (pins.length > 0) {
        items.push(new CacooPinnedSectionItem(pins.length));
      }
    }

    // Folders
    try {
      if (!this.folders) {
        this.folders = await this.cacooApi.getFolders();
      }
      for (const folder of this.folders) {
        if (!filter || folder.folderName.toLowerCase().includes(filter)) {
          items.push(new CacooFolderItem(folder));
        }
      }
    } catch (error) {
      console.error('[Cacoo] Failed to load folders:', error);
    }

    // Personal diagrams (no folder) — preload diagrams so we can check
    try {
      const all = await this.ensureAllDiagrams();
      const personal = all.filter((d) => !d.folderName);
      if (personal.length > 0) {
        const personalFolder: CacooFolder = {
          folderId: -1,
          folderName: '',
          type: 'personal',
          created: '',
          updated: '',
        };
        const item = new CacooFolderItem(personalFolder);
        item.label = `Personal (${personal.length})`;
        item.iconPath = new vscode.ThemeIcon('account', CACOO_COLOR);
        items.push(item);
      }
    } catch {
      // Non-critical — folders are enough
    }

    return items;
  }

  /**
   * Fetch all diagrams once, then filter client-side by folderName.
   * organizationKey is NOT sent to diagrams.json (causes 403), so
   * folderIds differ between org-scoped folders and personal diagrams.
   * We match by folderName instead.
   */
  private async ensureAllDiagrams(): Promise<CacooDiagram[]> {
    if (this.allDiagrams) {
      return this.allDiagrams;
    }

    const all: CacooDiagram[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const resp = await this.cacooApi.getDiagrams({ limit, offset });
      all.push(...(resp.result || []));
      if (all.length >= resp.count || (resp.result?.length || 0) < limit) {
        break;
      }
      offset += limit;
    }

    this.allDiagrams = all;
    return all;
  }

  private async getDiagramItems(folder: CacooFolder): Promise<CacooTreeItem[]> {
    try {
      const all = await this.ensureAllDiagrams();

      // Personal folder (folderId=-1): show diagrams with no folder
      // Org folders: match by folderName (org-scoped folders vs personal diagrams may have different folderIds)
      let diagrams: CacooDiagram[];
      if (folder.folderId === -1) {
        diagrams = all.filter((d) => !d.folderName);
      } else {
        diagrams = all.filter((d) => d.folderName === folder.folderName);
      }

      // Apply search keyword filter
      if (this.searchKeyword) {
        const filter = this.searchKeyword.toLowerCase();
        diagrams = diagrams.filter((d) => d.title.toLowerCase().includes(filter));
      }

      if (diagrams.length === 0) {
        const emptyItem = new vscode.TreeItem(
          this.searchKeyword ? 'No matching diagrams' : 'No diagrams in this folder'
        );
        emptyItem.iconPath = new vscode.ThemeIcon('info');
        return [emptyItem as CacooTreeItem];
      }
      return diagrams.map((d) => new CacooDiagramItem(d));
    } catch (error) {
      console.error(`[Cacoo] Failed to load diagrams for folder ${folder.folderName}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorItem = new vscode.TreeItem(`Error: ${errorMsg}`);
      errorItem.iconPath = new vscode.ThemeIcon('error');
      return [errorItem as CacooTreeItem];
    }
  }

  private async getSheetItems(diagram: CacooDiagram): Promise<CacooTreeItem[]> {
    try {
      if (!this.sheetCache.has(diagram.diagramId)) {
        const detail = await this.cacooApi.getDiagramDetail(diagram.diagramId);
        this.sheetCache.set(diagram.diagramId, detail.sheets || []);
      }

      const sheets = this.sheetCache.get(diagram.diagramId) || [];
      return sheets.map((s) => {
        const isPinned = this.configService.isCacooPinnedSheet(diagram.diagramId, s.uid);
        return new CacooSheetItem(diagram, s, isPinned);
      });
    } catch (error) {
      console.error(`[Cacoo] Failed to load sheets for ${diagram.diagramId}:`, error);
      return [];
    }
  }

  private getPinnedSheetItems(): CacooTreeItem[] {
    const pins = this.configService.getCacooPinnedSheets();
    return pins.map((p) => {
      const item = new vscode.TreeItem(p.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('pinned', CACOO_COLOR);
      item.contextValue = 'cacooSheet';
      item.command = {
        command: 'cacoo.previewSheet',
        title: 'Preview Sheet',
        arguments: [p.diagramId, p.sheetUid, p.label],
      };
      return item as CacooTreeItem;
    });
  }
}

// ---- Tree Item Classes ----

class CacooPinnedSectionItem extends vscode.TreeItem {
  constructor(count: number) {
    super(`Pinned Sheets (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('pinned', CACOO_COLOR);
    this.contextValue = 'cacooPinnedSection';
  }
}

class CacooFolderItem extends vscode.TreeItem {
  constructor(public readonly folder: CacooFolder) {
    super(folder.folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder', CACOO_COLOR);
    this.contextValue = 'cacooFolder';
    this.tooltip = `${folder.folderName} (${folder.type})`;
  }
}

class CacooDiagramItem extends vscode.TreeItem {
  constructor(public readonly diagram: CacooDiagram) {
    super(diagram.title, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('symbol-misc', CACOO_COLOR);
    this.description = `${diagram.sheetCount} sheets`;
    this.contextValue = 'cacooDiagram';
    this.tooltip = [
      diagram.title,
      `Owner: ${diagram.owner?.name || 'unknown'}`,
      `Updated: ${diagram.updated ? new Date(diagram.updated).toLocaleDateString() : ''}`,
      `Sheets: ${diagram.sheetCount}`,
    ].join('\n');
  }
}

class CacooSheetItem extends vscode.TreeItem {
  constructor(
    public readonly diagram: CacooDiagram,
    public readonly sheet: CacooSheet,
    isPinned: boolean
  ) {
    super(sheet.name || 'Sheet', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isPinned ? 'pinned' : 'file-media', CACOO_COLOR);
    this.contextValue = 'cacooSheet';
    this.description = isPinned ? 'pinned' : `${sheet.width}x${sheet.height}`;
    this.tooltip = `${diagram.title} / ${sheet.name}\n${sheet.width}x${sheet.height}`;

    this.command = {
      command: 'nulab.treeItemClicked',
      title: 'Preview Sheet',
      arguments: [
        'cacoo.previewSheet',
        diagram.diagramId,
        sheet.uid,
        `${diagram.title} / ${sheet.name}`,
      ],
    };
  }
}

export { CacooFolderItem, CacooDiagramItem, CacooSheetItem };
