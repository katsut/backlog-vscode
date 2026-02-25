import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SyncService } from '../services/syncService';
import { ConfigService } from '../services/configService';
import { SyncManifest } from '../types/backlog';

export class SyncFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  // Cache to avoid repeated file I/O
  private manifestCache = new Map<string, { manifest: SyncManifest; mtime: number }>();

  constructor(private syncService: SyncService, private configService: ConfigService) {}

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file' || !uri.fsPath.endsWith('.bdoc')) {
      return undefined;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return undefined;
    }

    const mappings = this.configService.getDocumentSyncMappings();

    for (const mapping of mappings) {
      const localDir = path.join(workspaceRoot, mapping.localPath);
      if (!uri.fsPath.startsWith(localDir + path.sep) && uri.fsPath !== localDir) {
        continue;
      }

      const manifest = this.getManifest(localDir);
      const relativePath = path.relative(localDir, uri.fsPath);
      const entry = manifest[relativePath];

      if (!entry) {
        return new vscode.FileDecoration(
          'N',
          'New (未同期)',
          new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
        );
      }

      if (!fs.existsSync(uri.fsPath)) {
        return undefined;
      }

      try {
        const localHash = this.syncService.computeLocalFileHash(uri.fsPath);
        if (localHash !== entry.content_hash) {
          return new vscode.FileDecoration(
            'M',
            'Modified (ローカル変更あり)',
            new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
          );
        }
      } catch {
        return undefined;
      }

      // Synced and unchanged — no decoration
      return undefined;
    }

    return undefined;
  }

  refresh(): void {
    this.manifestCache.clear();
    this._onDidChangeFileDecorations.fire(undefined);
  }

  private getManifest(localDir: string): SyncManifest {
    const manifestPath = path.join(localDir, '.sync-manifest.json');
    try {
      const stat = fs.statSync(manifestPath);
      const cached = this.manifestCache.get(localDir);
      if (cached && cached.mtime === stat.mtimeMs) {
        return cached.manifest;
      }
      const manifest = this.syncService.loadManifest(localDir);
      this.manifestCache.set(localDir, { manifest, mtime: stat.mtimeMs });
      return manifest;
    } catch {
      return {};
    }
  }
}
