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

  private documentTree: DocumentTree | null = null;
  private currentProjectId: number | null = null;
  private currentProjectKey: string | null = null;
  private documentNotAvailable: boolean = false;
  private errorMessage: string | null = null;

  constructor(private backlogApi: BacklogApiService) { }

  // プロジェクトを設定してDocumentを読み込み
  async setProject(projectId: number): Promise<void> {
    this.currentProjectId = projectId;

    // プロジェクトキーも取得して保存
    try {
      const projects = await this.backlogApi.getProjects();
      const currentProject = projects.find((p) => p.id === projectId);
      this.currentProjectKey = currentProject ? currentProject.projectKey : null;
    } catch (error) {
      this.currentProjectKey = null;
    }

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
      // Root level

      // Document機能が利用できない場合はメッセージを表示
      if (this.documentNotAvailable) {
        const messageItem = new DocumentTreeItem(
          {
            id: '0',
            name: 'Document機能が利用できません',
            statusId: 0,
            updated: new Date().toISOString(),
            emoji: undefined,
            children: []
          } as Entity.Document.DocumentTreeNode,
          vscode.TreeItemCollapsibleState.None
        );
        messageItem.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('foreground'));
        messageItem.contextValue = 'documentNotAvailable';
        messageItem.command = undefined;
        messageItem.tooltip = 'このプロジェクトではDocument機能が有効になっていません';
        return [messageItem];
      }

      // show activeTree's children directly
      if (!this.documentTree || !this.documentTree.activeTree || !this.documentTree.activeTree.children) {
        return [];
      }

      // activeTreeの子要素を直接ルートレベルに表示
      return this.buildTreeItems(this.documentTree.activeTree.children);
    } else {
      // Child level - show children of the element
      if (element.children) {
        return this.buildTreeItems(element.children);
      }
      return [];
    }
  }

  // Tree構造からTreeItemを構築
  private buildTreeItems(nodes: Entity.Document.DocumentTreeNode[]): DocumentTreeItem[] {
    return nodes.map((node) => {
      const hasChildren = node.children && Array.isArray(node.children) && node.children.length > 0;
      const collapsibleState = hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

      return new DocumentTreeItem(node, collapsibleState, node.children);
    });
  }

  private async loadDocuments(): Promise<void> {
    if (!this.currentProjectId || !(await this.backlogApi.isConfigured())) {
      return;
    }

    // Reset flags
    this.documentNotAvailable = false;
    this.errorMessage = null;

    try {
      const documentTree = await this.backlogApi.getDocuments(this.currentProjectId);
      this.documentTree = documentTree;
    } catch (error) {
      this.documentTree = null;

      // Improve error message for common cases
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('Not Found') || errorMessage.includes('404')) {
        // Document機能が有効でない場合
        this.documentNotAvailable = true;
        this.errorMessage = errorMessage;
        // エラーメッセージは表示しない（Document機能が無効なプロジェクトは正常）
      } else {
        // その他のエラーの場合のみ表示
        this.errorMessage = errorMessage;
        vscode.window.showErrorMessage(
          `Failed to load documents: ${errorMessage}`
        );
      }
    }
  }

  getDocumentTree(): DocumentTree | null {
    return this.documentTree;
  }

  getCurrentProjectKey(): string | null {
    return this.currentProjectKey;
  }
}

export class DocumentTreeItem extends vscode.TreeItem {
  public children?: Entity.Document.DocumentTreeNode[];

  constructor(
    public readonly document:
      | Entity.Document.DocumentTreeNode
      | (Entity.Document.DocumentTreeNode & { title?: string; type?: string }),
    public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    children?: Entity.Document.DocumentTreeNode[]
  ) {
    // document.nameまたはdocument.titleのどちらかが存在する場合に対応
    const displayName =
      document.name || ('title' in document ? document.title : undefined) || 'Unnamed Document';
    super(displayName, collapsibleState);

    this.children = children;
    this.tooltip = this.buildTooltip();

    // childrenがある場合はフォルダとして扱うが、親ドキュメント自体もドキュメントとして機能する
    const hasChildren = children && children.length > 0;
    const isOnlyFolder =
      ('type' in document && (document.type === 'folder' || document.type === 'directory')) &&
      !hasChildren;

    if (isOnlyFolder) {
      // 純粋なフォルダ（子要素なし）
      this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
      this.contextValue = 'documentFolder';
    } else if (hasChildren) {
      // 子要素を持つドキュメント（親ドキュメント）
      this.iconPath = new vscode.ThemeIcon('file-submodule', new vscode.ThemeColor('charts.blue'));
      this.contextValue = 'documentWithChildren';
      // 親ドキュメントもクリックでコンテンツを開けるようにコマンドを設定
      this.command = {
        command: 'backlog.openDocument',
        title: 'Open Document',
        arguments: [this.document],
      };
    } else {
      // 通常のドキュメント（子要素なし）
      this.iconPath = new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue'));
      this.contextValue = 'document';
      this.command = {
        command: 'backlog.openDocument',
        title: 'Open Document',
        arguments: [this.document],
      };
    }
  }

  private buildTooltip(): string {
    const name =
      this.document.name ||
      ('title' in this.document ? this.document.title : undefined) ||
      'Unnamed Document';
    let tooltip = name;

    if ('type' in this.document && this.document.type) {
      tooltip += `\nType: ${this.document.type}`;
    }
    if (this.document.updated) {
      tooltip += `\nUpdated: ${new Date(this.document.updated).toLocaleDateString()}`;
    }
    if (this.document.statusId) {
      tooltip += `\nStatus ID: ${this.document.statusId}`;
    }
    if (this.document.emoji) {
      tooltip += `\nEmoji: ${this.document.emoji}`;
    }

    return tooltip;
  }
}
