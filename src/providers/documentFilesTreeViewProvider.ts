import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '../services/configService';
import { SyncService } from '../services/syncService';
import { DocumentSyncMapping, SyncManifest } from '../types/backlog';

type DocFileTreeItem = MappingItem | FileItem | FolderItem;

export class DocumentFilesTreeViewProvider implements vscode.TreeDataProvider<DocFileTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    DocFileTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private configService: ConfigService, private syncService: SyncService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DocFileTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DocFileTreeItem): Promise<DocFileTreeItem[]> {
    const mappings = this.configService.getDocumentSyncMappings();
    if (mappings.length === 0) {
      return [];
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    if (!element) {
      // Root level: one item per mapping
      return mappings.map((m) => new MappingItem(m, rootPath));
    }

    if (element instanceof MappingItem) {
      return this.getMappingChildren(element.mapping, rootPath, '');
    }

    if (element instanceof FolderItem) {
      return this.getMappingChildren(element.mapping, rootPath, element.relativePath);
    }

    return [];
  }

  private getMappingChildren(
    mapping: DocumentSyncMapping,
    rootPath: string,
    relativeDir: string
  ): DocFileTreeItem[] {
    const localDir = path.join(rootPath, mapping.localPath);
    const scanDir = relativeDir ? path.join(localDir, relativeDir) : localDir;

    if (!fs.existsSync(scanDir)) {
      return [];
    }

    const manifest = this.syncService.loadManifest(localDir);
    const items: DocFileTreeItem[] = [];
    const entries = fs.readdirSync(scanDir, { withFileTypes: true });

    // Sort: folders first, then files
    const sorted = entries
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of sorted) {
      const entryRelPath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Check if directory contains any .bdoc files (recursively)
        const dirPath = path.join(scanDir, entry.name);
        if (this.hasBdocFiles(dirPath)) {
          items.push(new FolderItem(entry.name, mapping, entryRelPath));
        }
      } else if (entry.name.endsWith('.bdoc')) {
        const syncStatus = this.getFileSyncStatus(entryRelPath, manifest, localDir);
        const absolutePath = path.join(scanDir, entry.name);
        items.push(new FileItem(entry.name, mapping, entryRelPath, absolutePath, syncStatus));
      }
    }

    return items;
  }

  private hasBdocFiles(dirPath: string): boolean {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          if (this.hasBdocFiles(path.join(dirPath, entry.name))) return true;
        } else if (entry.name.endsWith('.bdoc')) {
          return true;
        }
      }
    } catch {
      // Directory not readable
    }
    return false;
  }

  private getFileSyncStatus(
    relativePath: string,
    manifest: SyncManifest,
    localDir: string
  ): 'synced' | 'local_modified' | 'new_local' {
    const entry = manifest[relativePath];
    if (!entry) {
      return 'new_local';
    }

    try {
      const absolutePath = path.join(localDir, relativePath);
      const localHash = this.syncService.computeLocalFileHash(absolutePath);
      if (localHash !== entry.content_hash) {
        return 'local_modified';
      }
    } catch {
      // File might not exist
    }
    return 'synced';
  }
}

export class MappingItem extends vscode.TreeItem {
  constructor(public readonly mapping: DocumentSyncMapping, rootPath: string) {
    const label = mapping.documentNodeName
      ? `${mapping.projectKey} / ${mapping.documentNodeName}`
      : `${mapping.projectKey} / ${mapping.documentNodeId}`;
    super(label, vscode.TreeItemCollapsibleState.Expanded);

    const localDir = path.join(rootPath, mapping.localPath);
    this.description = mapping.localPath;
    this.tooltip = `Project: ${mapping.projectKey}\nNode: ${
      mapping.documentNodeName || mapping.documentNodeId
    }\nLocal: ${localDir}`;
    this.iconPath = new vscode.ThemeIcon(
      'folder-library',
      new vscode.ThemeColor('nulab.brandColor')
    );
    this.contextValue = 'docSyncMapping';
  }
}

class FolderItem extends vscode.TreeItem {
  constructor(
    name: string,
    public readonly mapping: DocumentSyncMapping,
    public readonly relativePath: string
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('nulab.brandColor'));
    this.contextValue = 'docSyncFolder';
  }
}

class FileItem extends vscode.TreeItem {
  constructor(
    name: string,
    public readonly mapping: DocumentSyncMapping,
    relativePath: string,
    absolutePath: string,
    syncStatus: 'synced' | 'local_modified' | 'new_local'
  ) {
    super(name.replace(/\.bdoc$/, ''), vscode.TreeItemCollapsibleState.None);

    this.resourceUri = vscode.Uri.file(absolutePath);
    this.contextValue = 'docSyncFile';

    // Open the .bdoc file with the custom editor on click
    this.command = {
      command: 'vscode.openWith',
      title: 'Open Document',
      arguments: [vscode.Uri.file(absolutePath), 'nulab.bdocEditor'],
    };

    // Sync status decoration
    if (syncStatus === 'local_modified') {
      this.iconPath = new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.orange'));
      this.description = 'M';
    } else if (syncStatus === 'new_local') {
      this.iconPath = new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.green'));
      this.description = 'N';
    } else {
      this.iconPath = new vscode.ThemeIcon('file-text', new vscode.ThemeColor('nulab.brandColor'));
      this.description = '✓';
    }
  }
}
