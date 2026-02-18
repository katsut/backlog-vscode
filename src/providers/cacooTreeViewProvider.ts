import * as vscode from 'vscode';
import { CacooApiService } from '../services/cacooApi';
import { ConfigService } from '../services/configService';
import {
  CacooFolder,
  CacooDiagram,
  CacooSheet,
  CacooPinnedSheet,
} from '../types/cacoo';

// Tree item types
type CacooTreeItem = CacooFolderItem | CacooDiagramItem | CacooSheetItem | CacooPinnedSectionItem;

const CACOO_COLOR = new vscode.ThemeColor('cacoo.brandColor');

export class CacooTreeViewProvider implements vscode.TreeDataProvider<CacooTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CacooTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private folders: CacooFolder[] | null = null;
  private diagramCache = new Map<number, CacooDiagram[]>();
  private sheetCache = new Map<string, CacooSheet[]>();

  constructor(
    private cacooApi: CacooApiService,
    private configService: ConfigService
  ) {}

  refresh(): void {
    this.folders = null;
    this.diagramCache.clear();
    this.sheetCache.clear();
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
      return this.getDiagramItems(element.folder.folderId);
    }

    if (element instanceof CacooDiagramItem) {
      return this.getSheetItems(element.diagram);
    }

    return [];
  }

  private async getRootChildren(): Promise<CacooTreeItem[]> {
    const items: CacooTreeItem[] = [];

    // Pinned sheets section
    const pins = this.configService.getCacooPinnedSheets();
    if (pins.length > 0) {
      items.push(new CacooPinnedSectionItem(pins.length));
    }

    // Folders
    try {
      if (!this.folders) {
        this.folders = await this.cacooApi.getFolders();
      }
      for (const folder of this.folders) {
        items.push(new CacooFolderItem(folder));
      }
    } catch (error) {
      console.error('[Cacoo] Failed to load folders:', error);
    }

    return items;
  }

  private async getDiagramItems(folderId: number): Promise<CacooTreeItem[]> {
    try {
      if (!this.diagramCache.has(folderId)) {
        const all: CacooDiagram[] = [];
        let offset = 0;
        const limit = 50;

        while (true) {
          const resp = await this.cacooApi.getDiagrams({
            folderId,
            sortOn: 'updated',
            sortType: 'desc',
            limit,
            offset,
          });
          all.push(...resp.result);
          if (all.length >= resp.count || resp.result.length < limit) {
            break;
          }
          offset += limit;
        }

        this.diagramCache.set(folderId, all);
      }

      return (this.diagramCache.get(folderId) || []).map(
        (d) => new CacooDiagramItem(d)
      );
    } catch (error) {
      console.error(`[Cacoo] Failed to load diagrams for folder ${folderId}:`, error);
      return [];
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
    this.iconPath = new vscode.ThemeIcon(
      isPinned ? 'pinned' : 'file-media',
      CACOO_COLOR
    );
    this.contextValue = 'cacooSheet';
    this.description = isPinned ? 'pinned' : `${sheet.width}x${sheet.height}`;
    this.tooltip = `${diagram.title} / ${sheet.name}\n${sheet.width}x${sheet.height}`;
    this.command = {
      command: 'cacoo.previewSheet',
      title: 'Preview Sheet',
      arguments: [diagram.diagramId, sheet.uid, `${diagram.title} / ${sheet.name}`],
    };
  }
}

export { CacooFolderItem, CacooDiagramItem, CacooSheetItem };
