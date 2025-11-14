import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';
import { Entity } from 'backlog-js';

export class BacklogWikiTreeViewProvider implements vscode.TreeDataProvider<WikiTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<WikiTreeItem | undefined | null | void> =
    new vscode.EventEmitter<WikiTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<WikiTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private wikis: Entity.Wiki.WikiListItem[] = [];
  private filteredWikis: Entity.Wiki.WikiListItem[] = [];
  private wikiTree: WikiTreeItem[] = [];
  private currentProjectId: number | null = null;
  private wikiNotAvailable: boolean = false;
  private errorMessage: string | null = null;

  // Wiki検索
  private searchQuery: string = '';

  constructor(private backlogApi: BacklogApiService) {}

  // プロジェクトを設定してWikiを読み込み
  async setProject(projectId: number): Promise<void> {
    this.currentProjectId = projectId;
    await this.loadWikis();
    this._onDidChangeTreeData.fire();
  }

  // プロジェクトをクリア
  clearProject(): void {
    this.currentProjectId = null;
    this.wikis = [];
    this.filteredWikis = [];
    this.wikiTree = [];
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    if (this.currentProjectId) {
      this.loadWikis();
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: WikiTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WikiTreeItem): Promise<WikiTreeItem[]> {
    if (!this.currentProjectId) {
      return [];
    }

    if (!(await this.backlogApi.isConfigured())) {
      return [];
    }

    if (!element) {
      // Root level
      
      // Wiki機能が利用できない場合はメッセージを表示
      if (this.wikiNotAvailable) {
        const messageItem = new WikiTreeItem(
          {
            id: 0,
            name: 'Wiki機能が利用できません',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            createdUser: { 
              id: 0, 
              userId: 'system',
              name: 'System',
              roleType: 1,
              lang: 'ja',
              mailAddress: '',
              lastLoginTime: new Date().toISOString()
            },
            updatedUser: { 
              id: 0, 
              userId: 'system',
              name: 'System',
              roleType: 1,
              lang: 'ja',
              mailAddress: '',
              lastLoginTime: new Date().toISOString()
            },
            tags: [],
            projectId: this.currentProjectId || 0
          } as unknown as Entity.Wiki.WikiListItem,
          vscode.TreeItemCollapsibleState.None
        );
        messageItem.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('foreground'));
        messageItem.contextValue = 'wikiNotAvailable';
        messageItem.command = undefined;
        messageItem.tooltip = 'このプロジェクトではWiki機能が有効になっていません';
        return [messageItem];
      }
      
      // show filtered wikis
      return this.filteredWikis.map((wiki) => new WikiTreeItem(wiki));
    }

    return [];
  }

  // Wiki検索
  async searchWikis(query: string): Promise<void> {
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
    let filtered = [...this.wikis];

    // 検索フィルタ
    if (this.searchQuery) {
      filtered = filtered.filter(
        (wiki) =>
          wiki.name.toLowerCase().includes(this.searchQuery) ||
          (wiki.tags &&
            wiki.tags.some((tag: Entity.Wiki.Tag) =>
              tag.name.toLowerCase().includes(this.searchQuery)
            ))
      );
    }

    this.filteredWikis = filtered;
    this.buildWikiTree();
  }

  // Wikiのツリー構造を構築（フラットリスト）
  private buildWikiTree(): void {
    // フィルタされたWikiをソートしてフラットリストとして表示
    const wikiItems = this.filteredWikis.map((wiki) => new WikiTreeItem(wiki));

    // 名前順でソート
    wikiItems.sort((a, b) => a.wiki.name.localeCompare(b.wiki.name));

    this.wikiTree = wikiItems;
  }

  private async loadWikis(): Promise<void> {
    if (!this.currentProjectId || !(await this.backlogApi.isConfigured())) {
      return;
    }

    // Reset flags
    this.wikiNotAvailable = false;
    this.errorMessage = null;

    try {
      const wikis = await this.backlogApi.getWikiPages(this.currentProjectId);
      this.wikis = wikis;
      this.applyFilters();
    } catch (error) {
      this.wikis = [];
      
      // Improve error message for common cases
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('Not Found') || errorMessage.includes('404') || errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        // Wiki機能が有効でない場合、またはアクセス権限がない場合
        this.wikiNotAvailable = true;
        this.errorMessage = errorMessage;
        console.log('Wiki feature may not be enabled or accessible for this project:', this.currentProjectId);
        // エラーメッセージは表示しない（Wiki機能が無効なプロジェクトやアクセス権限がない場合は正常）
      } else {
        // その他のエラーの場合のみ表示
        this.errorMessage = errorMessage;
        console.error('Error loading wikis:', error);
        vscode.window.showErrorMessage(`Failed to load wikis: ${errorMessage}`);
      }
      
      this.applyFilters();
    }
  }

  // Wikiを取得
  getWikis(): Entity.Wiki.WikiListItem[] {
    return this.wikis;
  }

  // フィルタされたWikiを取得
  getFilteredWikis(): Entity.Wiki.WikiListItem[] {
    return this.filteredWikis;
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

export class WikiTreeItem extends vscode.TreeItem {
  public children?: WikiTreeItem[];

  constructor(
    public readonly wiki: Entity.Wiki.WikiListItem,
    public collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(wiki.name, collapsibleState);

    this.tooltip = this.buildTooltip();
    this.iconPath = new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.green'));
    this.contextValue = 'wiki';

    if (wiki.id && wiki.id > 0) {
      this.command = {
        command: 'backlog.openWiki',
        title: 'Open Wiki',
        arguments: [this.wiki],
      };
    }
  }

  private buildTooltip(): string {
    let tooltip = this.wiki.name;

    if (this.wiki.created) {
      tooltip += `\nCreated: ${new Date(this.wiki.created).toLocaleDateString()}`;
    }
    if (this.wiki.updated) {
      tooltip += `\nUpdated: ${new Date(this.wiki.updated).toLocaleDateString()}`;
    }
    if (this.wiki.createdUser) {
      tooltip += `\nCreated by: ${this.wiki.createdUser.name}`;
    }
    if (this.wiki.tags && this.wiki.tags.length > 0) {
      tooltip += `\nTags: ${this.wiki.tags.map((tag) => tag.name).join(', ')}`;
    }

    return tooltip;
  }
}
