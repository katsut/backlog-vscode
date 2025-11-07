import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';

export class BacklogWikiTreeViewProvider implements vscode.TreeDataProvider<WikiTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<WikiTreeItem | undefined | null | void> =
    new vscode.EventEmitter<WikiTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<WikiTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private wikis: any[] = [];
  private filteredWikis: any[] = [];
  private wikiTree: WikiTreeItem[] = [];
  private currentProjectId: number | null = null;
  
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
      return [
        new WikiTreeItem({
          id: 0,
          name: 'No project selected',
          content: '',
          tags: []
        })
      ];
    }

    if (!(await this.backlogApi.isConfigured())) {
      return [
        new WikiTreeItem({
          id: 0,
          name: 'Configuration Required',
          content: '',
          tags: []
        })
      ];
    }

    if (!element) {
      // Root level - show wiki tree structure
      return this.wikiTree;
    }

    // If element has children, return them
    return element.children || [];
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
      filtered = filtered.filter(wiki =>
        wiki.name.toLowerCase().includes(this.searchQuery) ||
        (wiki.content && wiki.content.toLowerCase().includes(this.searchQuery)) ||
        (wiki.tags && wiki.tags.some((tag: any) => tag.name.toLowerCase().includes(this.searchQuery)))
      );
    }

    this.filteredWikis = filtered;
    this.buildWikiTree();
  }

  // Wikiのツリー構造を構築
  private buildWikiTree(): void {
    const rootWikis: WikiTreeItem[] = [];
    const wikiMap = new Map<number, WikiTreeItem>();

    // すべてのWikiアイテムを作成
    this.filteredWikis.forEach(wiki => {
      const item = new WikiTreeItem(wiki);
      wikiMap.set(wiki.id, item);
    });

    // 親子関係を構築
    this.filteredWikis.forEach(wiki => {
      const item = wikiMap.get(wiki.id);
      if (!item) return;

      if (wiki.parentWikiId && wikiMap.has(wiki.parentWikiId)) {
        // 親がある場合
        const parent = wikiMap.get(wiki.parentWikiId);
        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(item);
          parent.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }
      } else {
        // ルートレベル
        rootWikis.push(item);
      }
    });

    // 子がいる場合はソート
    const sortChildren = (items: WikiTreeItem[]) => {
      items.sort((a, b) => a.wiki.name.localeCompare(b.wiki.name));
      items.forEach(item => {
        if (item.children) {
          sortChildren(item.children);
        }
      });
    };

    sortChildren(rootWikis);
    this.wikiTree = rootWikis;
  }

  private async loadWikis(): Promise<void> {
    if (!this.currentProjectId || !(await this.backlogApi.isConfigured())) {
      return;
    }

    try {
      console.log('Loading wikis for project:', this.currentProjectId);
      
      const wikis = await this.backlogApi.getWikiPages(this.currentProjectId);
      
      this.wikis = wikis;
      this.applyFilters();
      console.log('Wikis loaded successfully:', this.wikis.length, 'wikis');
    } catch (error) {
      console.error('Error loading wikis:', error);
      // Wikiが取得できない場合は空の配列を設定
      this.wikis = [];
      this.applyFilters();
    }
  }

  // Wikiを取得
  getWikis(): any[] {
    return this.wikis;
  }

  // フィルタされたWikiを取得
  getFilteredWikis(): any[] {
    return this.filteredWikis;
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

export class WikiTreeItem extends vscode.TreeItem {
  public children?: WikiTreeItem[];

  constructor(
    public readonly wiki: any,
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
      tooltip += `\nTags: ${this.wiki.tags.map((tag: any) => tag.name).join(', ')}`;
    }
    
    return tooltip;
  }
}
