import * as vscode from 'vscode';
import { GoogleApiService } from '../services/googleApi';
import { GoogleDriveFile } from '../types/google';

export class DriveFileItem extends vscode.TreeItem {
  constructor(public readonly file: GoogleDriveFile) {
    super(file.name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'driveFile';
    this.description = getDriveMimeLabel(file.mimeType);
    this.tooltip = new vscode.MarkdownString(
      `**${file.name}**\n\n${getDriveMimeLabel(file.mimeType)}\n\n更新: ${formatModifiedTime(
        file.modifiedTime
      )}`
    );
    this.iconPath = getDriveMimeThemeIcon(file.mimeType);

    this.command = {
      command: 'nulab.google.openDriveFile',
      title: 'Open Drive File',
      arguments: [file],
    };
  }
}

export class GoogleDriveSearchTreeViewProvider implements vscode.TreeDataProvider<DriveFileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DriveFileItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private results: GoogleDriveFile[] = [];
  private lastQuery = '';
  private searching = false;

  constructor(private googleApi: GoogleApiService) {}

  async search(query: string): Promise<void> {
    if (!query || this.searching) return;
    this.searching = true;
    this.lastQuery = query;

    try {
      this.results = await this.googleApi.searchDriveFiles(query);
    } catch (error) {
      this.results = [];
      vscode.window.showErrorMessage(
        `Google Drive 検索に失敗しました: ${error instanceof Error ? error.message : error}`
      );
    } finally {
      this.searching = false;
      this._onDidChangeTreeData.fire();
    }
  }

  clear(): void {
    this.results = [];
    this.lastQuery = '';
    this._onDidChangeTreeData.fire();
  }

  getLastQuery(): string {
    return this.lastQuery;
  }

  getTreeItem(element: DriveFileItem): vscode.TreeItem {
    return element;
  }

  getChildren(): DriveFileItem[] {
    return this.results.map((file) => new DriveFileItem(file));
  }
}

function getDriveMimeThemeIcon(mimeType: string): vscode.ThemeIcon {
  if (mimeType === 'application/vnd.google-apps.document') return new vscode.ThemeIcon('file-text');
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return new vscode.ThemeIcon('table');
  if (mimeType === 'application/vnd.google-apps.presentation')
    return new vscode.ThemeIcon('preview');
  if (mimeType === 'application/vnd.google-apps.folder') return new vscode.ThemeIcon('folder');
  if (mimeType === 'application/pdf') return new vscode.ThemeIcon('file-pdf');
  if (mimeType.startsWith('image/')) return new vscode.ThemeIcon('file-media');
  if (mimeType.startsWith('video/')) return new vscode.ThemeIcon('device-camera-video');
  if (mimeType.startsWith('text/')) return new vscode.ThemeIcon('file-code');
  return new vscode.ThemeIcon('file');
}

function getDriveMimeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    'application/vnd.google-apps.document': 'Google ドキュメント',
    'application/vnd.google-apps.spreadsheet': 'Google スプレッドシート',
    'application/vnd.google-apps.presentation': 'Google スライド',
    'application/vnd.google-apps.form': 'Google フォーム',
    'application/vnd.google-apps.drawing': 'Google 図形描画',
    'application/pdf': 'PDF',
  };
  if (map[mimeType]) return map[mimeType];
  if (mimeType.startsWith('image/')) return '画像';
  if (mimeType.startsWith('video/')) return '動画';
  if (mimeType.startsWith('text/')) return 'テキスト';
  return mimeType;
}

function formatModifiedTime(modifiedTime: string): string {
  if (!modifiedTime) return '';
  const d = new Date(modifiedTime);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return '今日';
  if (diffDays === 1) return '昨日';
  if (diffDays < 7) return `${diffDays}日前`;
  return d.toLocaleDateString('ja-JP');
}
