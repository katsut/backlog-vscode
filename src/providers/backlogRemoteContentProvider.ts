import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';

export class BacklogRemoteContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private cache = new Map<string, string>();
  private localBodyCache = new Map<string, string>();

  constructor(private backlogApi: BacklogApiService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const pathParts = uri.path.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      return '// Error: Invalid URI';
    }

    const documentId = pathParts[1];

    // backlog-local: return cached local body (frontmatter stripped)
    if (uri.scheme === 'backlog-local') {
      return this.localBodyCache.get(documentId) || '';
    }

    // backlog-remote: fetch from Backlog API

    if (this.cache.has(documentId)) {
      return this.cache.get(documentId)!;
    }

    try {
      const doc = await this.backlogApi.getDocument(documentId);
      const content = doc.plain || '';
      this.cache.set(documentId, content);
      return content;
    } catch (error) {
      return `// Error fetching remote document: ${error}`;
    }
  }

  setLocalBody(key: string, body: string): void {
    this.localBodyCache.set(key, body);
  }

  invalidateCache(documentId?: string): void {
    if (documentId) {
      this.cache.delete(documentId);
      this.localBodyCache.delete(documentId);
    } else {
      this.cache.clear();
      this.localBodyCache.clear();
    }
  }

  fireDidChange(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  static buildUri(projectKey: string, documentId: string, title: string, scheme = 'backlog-remote'): vscode.Uri {
    const safeName = title.replace(/[/\\:*?"<>|]/g, '-') + '.md';
    return vscode.Uri.parse(
      `${scheme}:/${encodeURIComponent(projectKey)}/${encodeURIComponent(documentId)}/${encodeURIComponent(safeName)}`
    );
  }
}
