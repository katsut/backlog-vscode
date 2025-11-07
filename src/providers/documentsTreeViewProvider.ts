import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';

export class BacklogDocumentsTreeViewProvider implements vscode.TreeDataProvider<DocumentTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DocumentTreeItem | undefined | null | void> =
    new vscode.EventEmitter<DocumentTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<DocumentTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private documents: any[] = [];
  private filteredDocuments: any[] = [];
  private documentTree: DocumentTreeItem[] = [];
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
    this.documents = [];
    this.filteredDocuments = [];
    this.documentTree = [];
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
      return [
        new DocumentTreeItem({
          id: 0,
          name: 'No project selected',
          dir: '/',
          size: 0
        })
      ];
    }

    if (!(await this.backlogApi.isConfigured())) {
      return [
        new DocumentTreeItem({
          id: 0,
          name: 'Configuration Required', 
          dir: '/',
          size: 0
        })
      ];
    }

    if (!element) {
      // Root level - show document tree structure
      return this.documentTree;
    }

    // If element has children, return them
    return element.children || [];
  }

  // Document検索
  async searchDocuments(query: string): Promise<void> {
    this.searchQuery = query.toLowerCase();
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // フィルタクリア
  clearFilters(): void {
    this.searchQuery = '';
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // フィルタの適用とツリー構造の再構築
  private applyFilters(): void {
    let filtered = [...this.documents];

    // 検索フィルタ
    if (this.searchQuery) {
      filtered = filtered.filter(document =>
        document.name.toLowerCase().includes(this.searchQuery) ||
        (document.dir && document.dir.toLowerCase().includes(this.searchQuery))
      );
    }

    this.filteredDocuments = filtered;
    this.buildDocumentTree();
  }

  // Documentのツリー構造を構築（ディレクトリ構造で）
  private buildDocumentTree(): void {
    const rootItems: DocumentTreeItem[] = [];
    const dirMap = new Map<string, DocumentTreeItem>();

    // ディレクトリ構造を構築
    this.filteredDocuments.forEach(document => {
      const pathParts = document.dir.split('/').filter((part: string) => part);
      let currentPath = '';
      let currentParent: DocumentTreeItem | null = null;

      // パス階層を作成
      pathParts.forEach((part: string, index: number) => {
        currentPath += '/' + part;
        
        if (!dirMap.has(currentPath)) {
          const dirItem = new DocumentTreeItem(
            {
              id: 0,
              name: part,
              dir: currentPath,
              size: 0,
              isDirectory: true
            },
            vscode.TreeItemCollapsibleState.Collapsed
          );
          dirMap.set(currentPath, dirItem);
        }

        const dirItem = dirMap.get(currentPath)!;

        if (index === 0) {
          // ルートディレクトリ
          if (!rootItems.includes(dirItem)) {
            rootItems.push(dirItem);
          }
          currentParent = dirItem;
        } else {
          // サブディレクトリ
          if (currentParent && !currentParent.children?.includes(dirItem)) {
            if (!currentParent.children) {
              currentParent.children = [];
            }
            currentParent.children.push(dirItem);
          }
          currentParent = dirItem;
        }
      });

      // ファイルを適切なディレクトリに追加
      const fileItem = new DocumentTreeItem(document);
      
      if (pathParts.length === 0) {
        // ルートにあるファイル
        rootItems.push(fileItem);
      } else {
        // ディレクトリ内のファイル
        const parentDir = dirMap.get(document.dir);
        if (parentDir) {
          if (!parentDir.children) {
            parentDir.children = [];
          }
          parentDir.children.push(fileItem);
        }
      }
    });

    // ソート（ディレクトリ優先、名前順）
    const sortItems = (items: DocumentTreeItem[]) => {
      items.sort((a, b) => {
        // ディレクトリを優先
        if (a.document.isDirectory && !b.document.isDirectory) return -1;
        if (!a.document.isDirectory && b.document.isDirectory) return 1;
        return a.document.name.localeCompare(b.document.name);
      });
      
      items.forEach(item => {
        if (item.children) {
          sortItems(item.children);
        }
      });
    };

    sortItems(rootItems);
    this.documentTree = rootItems;
  }

  private async loadDocuments(): Promise<void> {
    if (!this.currentProjectId || !(await this.backlogApi.isConfigured())) {
      return;
    }

    try {
      console.log('Loading documents for project:', this.currentProjectId);
      
      const documents = await this.backlogApi.getDocuments(this.currentProjectId);
      
      this.documents = documents;
      this.applyFilters();
      console.log('Documents loaded successfully:', this.documents.length, 'documents');
    } catch (error) {
      console.error('Error loading documents:', error);
      // Documentが取得できない場合は空の配列を設定
      this.documents = [];
      this.applyFilters();
    }
  }

  // Documentを取得
  getDocuments(): any[] {
    return this.documents;
  }

  // フィルタされたDocumentを取得
  getFilteredDocuments(): any[] {
    return this.filteredDocuments;
  }

  // 現在のフィルタ状態を取得
  getFilterState(): {
    searchQuery: string;
  } {
    return {
      searchQuery: this.searchQuery
    };
  }
}

export class DocumentTreeItem extends vscode.TreeItem {
  public children?: DocumentTreeItem[];

  constructor(
    public readonly document: any,
    public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(document.name, collapsibleState);
    
    this.tooltip = this.buildTooltip();
    
    if (document.isDirectory) {
      this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
      this.contextValue = 'documentDirectory';
    } else {
      this.iconPath = new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue'));
      this.contextValue = 'document';
      
      if (document.id && document.id > 0) {
        this.command = {
          command: 'backlog.openDocument',
          title: 'Open Document',
          arguments: [this.document],
        };
      }
    }
  }

  private buildTooltip(): string {
    let tooltip = this.document.name;
    
    if (!this.document.isDirectory) {
      if (this.document.size) {
        tooltip += `\nSize: ${this.formatFileSize(this.document.size)}`;
      }
      if (this.document.created) {
        tooltip += `\nCreated: ${new Date(this.document.created).toLocaleDateString()}`;
      }
      if (this.document.createdUser) {
        tooltip += `\nCreated by: ${this.document.createdUser.name}`;
      }
    } else {
      tooltip += '\nDirectory';
    }
    
    return tooltip;
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
