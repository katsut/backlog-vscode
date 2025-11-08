import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';
import { Entity } from 'backlog-js';

// Document Tree type
type DocumentTree = Entity.Document.DocumentTree;

export class BacklogDocumentsTreeViewProvider implements vscode.TreeDataProvider<DocumentTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DocumentTreeItem | undefined | null | void> =
    new vscode.EventEmitter<DocumentTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private documentTree: DocumentTree | null = null; // Tree構造をそのまま保持
  private currentProjectId: number | null = null;

  // Document検索
  private searchQuery: string = '';

  constructor(private backlogApi: BacklogApiService) {}

  // プロジェクトを設定してDocumentを読み込み
  async setProject(projectId: number): Promise<void> {
    this.currentProjectId = projectId;
    await this.loadDocuments();
    this._onDidChangeTreeData.fire();
  }

  // プロジェクトをクリア
  clearProject(): void {
    this.currentProjectId = null;
    this.documentTree = null;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    if (this.currentProjectId) {
      this.loadDocuments();
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: DocumentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DocumentTreeItem): Promise<DocumentTreeItem[]> {
    if (!this.currentProjectId) {
      return [];
    }

    if (!(await this.backlogApi.isConfigured())) {
      return [];
    }

    if (!element) {
      // Root level - show activeTree as a single item
      if (!this.documentTree || !this.documentTree.activeTree) {
        return [];
      }

      // activeTree自体を一つのアイテムとして表示
      const activeTreeItem = new DocumentTreeItem(
        {
          id: this.documentTree.activeTree.id,
          name: 'Documents',
          title: 'Documents',
          type: 'folder'
        },
        vscode.TreeItemCollapsibleState.Collapsed,
        this.documentTree.activeTree.children
      );
      
      return [activeTreeItem];
    } else {
      // Child level - show children of the element
      if (element.children) {
        return this.buildTreeItems(element.children);
      }
      return [];
    }
  }

  // Tree構造からTreeItemを構築
  private buildTreeItems(nodes: any[]): DocumentTreeItem[] {
    return nodes.map((node) => {
      const hasChildren = node.children && Array.isArray(node.children) && node.children.length > 0;
      const collapsibleState = hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

      return new DocumentTreeItem(node, collapsibleState, node.children);
    });
  }

  // Document検索
  async searchDocuments(query: string): Promise<void> {
    this.searchQuery = query.toLowerCase();
    // Tree構造での検索は後で実装
    this._onDidChangeTreeData.fire();
  }

  // フィルタクリア
  clearFilters(): void {
    this.searchQuery = '';
    // Tree構造での検索は後で実装
    this._onDidChangeTreeData.fire();
  }

  private async loadDocuments(): Promise<void> {
    if (!this.currentProjectId || !(await this.backlogApi.isConfigured())) {
      console.log('Documents load skipped - no project or not configured');
      return;
    }

    try {
      console.log('Loading documents for project:', this.currentProjectId);
      console.log('API configured:', await this.backlogApi.isConfigured());

      const documentTree = await this.backlogApi.getDocuments(this.currentProjectId);

      console.log('Raw document tree response:', documentTree);
      console.log('Document tree type:', typeof documentTree);
      console.log('Document tree is array:', Array.isArray(documentTree));

      this.documentTree = documentTree;
      console.log('Document tree loaded successfully');
    } catch (error) {
      console.error('Error loading documents - full error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      // Documentが取得できない場合はnullを設定
      this.documentTree = null;

      // より詳細なエラー情報をユーザーに表示
      vscode.window.showErrorMessage(
        `Failed to load documents: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // Document Tree を取得
  getDocumentTree(): any {
    return this.documentTree;
  }

  // 現在のフィルタ状態を取得
  getFilterState(): {
    searchQuery: string;
  } {
    return {
      searchQuery: this.searchQuery,
    };
  }
}

export class DocumentTreeItem extends vscode.TreeItem {
  public children?: any[];

  constructor(
    public readonly document: any, // Tree構造のnodeを受け取る
    public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    children?: any[]
  ) {
    // document.titleまたはdocument.nameのどちらかが存在する場合に対応
    const displayName = document.title || document.name || 'Unnamed Document';
    super(displayName, collapsibleState);

    this.children = children;
    this.tooltip = this.buildTooltip();

    // Treeノードのタイプに応じてアイコンを設定
    if (document.type === 'folder' || document.type === 'directory') {
      this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
      this.contextValue = 'documentFolder';
    } else {
      this.iconPath = new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue'));
      this.contextValue = 'document';

      // ファイル/ドキュメントの場合のみコマンドを設定
      this.command = {
        command: 'backlog.openDocument',
        title: 'Open Document',
        arguments: [this.document],
      };
    }
  }

  private buildTooltip(): string {
    const name = this.document.title || this.document.name || 'Unnamed Document';
    let tooltip = name;

    if (this.document.type) {
      tooltip += `\nType: ${this.document.type}`;
    }
    if (this.document.created) {
      tooltip += `\nCreated: ${new Date(this.document.created).toLocaleDateString()}`;
    }
    if (this.document.createdUser && this.document.createdUser.name) {
      tooltip += `\nCreated by: ${this.document.createdUser.name}`;
    }
    if (this.document.updated) {
      tooltip += `\nUpdated: ${new Date(this.document.updated).toLocaleDateString()}`;
    }
    if (this.document.updatedUser && this.document.updatedUser.name) {
      tooltip += `\nUpdated by: ${this.document.updatedUser.name}`;
    }

    return tooltip;
  }
}
