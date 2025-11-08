import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';
import { Entity } from 'backlog-js';

export class BacklogTreeViewProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> =
    new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private projects: Entity.Project.Project[] = [];
  private filteredProjects: Entity.Project.Project[] = [];
  private projectIssues: Map<number, Entity.Issue.Issue[]> = new Map();
  private filteredIssues: Map<number, Entity.Issue.Issue[]> = new Map();
  private projectWikis: Map<number, Entity.Wiki.WikiListItem[]> = new Map();
  private projectDocuments: Map<number, Entity.Document.DocumentTree | null> = new Map();

  // フォーカス状態
  private focusedProjectId: number | null = null;

  // フィルタ・検索・ソート状態
  private searchQuery: string = '';
  private statusFilter: string[] = [];
  private priorityFilter: string[] = [];
  private assigneeFilter: string[] = [];
  private sortBy: 'updated' | 'created' | 'priority' | 'status' | 'summary' = 'updated';
  private sortOrder: 'asc' | 'desc' = 'desc';

  constructor(private backlogApi: BacklogApiService) {
    console.log('=== BacklogTreeViewProvider constructor called ===');
    // 初期データ読み込みを非同期で実行
    this.loadInitialData().catch(error => {
      console.error('Error in loadInitialData from constructor:', error);
    });
    console.log('=== BacklogTreeViewProvider constructor completed ===');
  }

  refresh(): void {
    this.loadInitialData();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    console.log('TreeViewProvider.getChildren called with element:', element?.label || 'root');

    const isConfigured = await this.backlogApi.isConfigured();
    console.log('API configured:', isConfigured);

    if (!isConfigured) {
      console.log('API not configured, showing configuration required message');
      return [
        new TreeItem(
          'Configuration Required',
          vscode.TreeItemCollapsibleState.None,
          'Configure Backlog API URL and API Key in settings',
          'warning'
        ),
      ];
    }

    if (!element) {
      // Root level - フォーカスされたプロジェクトがある場合はそのプロジェクトのみ表示
      if (this.focusedProjectId) {
        const focusedProject = this.projects.find((p) => p.id === this.focusedProjectId);
        if (focusedProject) {
          return [
            new CategoryTreeItem('Issues', 'issues', this.focusedProjectId),
            new CategoryTreeItem('Wiki', 'wiki', this.focusedProjectId),
            new CategoryTreeItem('Documents', 'documents', this.focusedProjectId),
          ];
        }
      }
      // 通常時はプロジェクト一覧を表示（検索フィルタ適用）
      const displayProjects = this.searchQuery ? this.filteredProjects : this.projects;
      console.log('Returning projects list, count:', displayProjects.length);
      console.log('Search query:', this.searchQuery);
      console.log('Projects data:', displayProjects);
      return displayProjects.map((project) => new ProjectTreeItem(project));
    }

    if (element instanceof CategoryTreeItem) {
      switch (element.category) {
        case 'issues': {
          // 課題データが未読み込みの場合のみ取得
          if (!this.projectIssues.has(element.projectId)) {
            const issues = await this.backlogApi.getProjectIssues(element.projectId, { count: 100 });
            this.projectIssues.set(element.projectId, issues);
          }
          const filteredIssues = this.filteredIssues.get(element.projectId);
          const issues = filteredIssues || this.projectIssues.get(element.projectId) || [];
          // 親課題のみを表示（子課題は親課題の下にツリー表示）
          const parentIssues = issues.filter((issue) => !issue.parentIssueId);
          return parentIssues.map((issue) => new IssueTreeItem(issue, issues));
        }
        case 'wiki': {
          // Wikiデータが未読み込みの場合のみ取得
          if (!this.projectWikis.has(element.projectId)) {
            const wikis = await this.backlogApi.getWikiPages(element.projectId);
            this.projectWikis.set(element.projectId, wikis);
          }
          const wikis = this.projectWikis.get(element.projectId) || [];
          return wikis.map((wiki) => new WikiTreeItem(wiki));
        }
        case 'documents': {
          // ドキュメントデータが未読み込みの場合のみ取得
          if (!this.projectDocuments.has(element.projectId)) {
            const documents = await this.backlogApi.getDocuments(element.projectId);
            this.projectDocuments.set(element.projectId, documents);
          }
          const documentTree = this.projectDocuments.get(element.projectId);
          if (!documentTree || !documentTree.activeTree) {
            return [];
          }
          return this.convertDocumentTreeToItems(documentTree.activeTree.children, element.projectId);
        }
      }
    }

    // IssueTreeItemの子課題を処理
    if (element instanceof IssueTreeItem) {
      const childIssues = element.getChildIssues();
      return childIssues.map((childIssue) => new IssueTreeItem(childIssue, element.allIssues));
    }

    // DocumentTreeItemの子ノードを処理
    if (element instanceof DocumentTreeNodeItem) {
      return this.convertDocumentTreeToItems(element.node.children, element.projectId);
    }

    return [];
  }

  // プロジェクトにフォーカスする（データは遅延読み込み）
  async focusProject(projectId: number): Promise<void> {
    this.focusedProjectId = projectId;
    // データは各カテゴリが展開された時に取得する
    this._onDidChangeTreeData.fire();
  }

  // プロジェクトフォーカスを解除
  unfocusProject(): void {
    this.focusedProjectId = null;
    // プロジェクトデータもクリアして課題などが表示されないようにする
    this.projectIssues.clear();
    this.projectWikis.clear();
    this.projectDocuments.clear();
    this.filteredIssues.clear();
    this._onDidChangeTreeData.fire();
  }

  private async loadInitialData(): Promise<void> {
    console.log('=== loadInitialData START ===');

    // 設定状況を詳細に確認
    const domain = this.backlogApi['configService'].getDomain();
    const apiKey = await this.backlogApi['configService'].getApiKey();
    console.log('Config details:');
    console.log('- Domain:', domain ? `configured (${domain})` : 'NOT CONFIGURED');
    console.log('- API Key:', apiKey ? 'configured (length: ' + apiKey.length + ')' : 'NOT CONFIGURED');

    const isConfigured = await this.backlogApi.isConfigured();
    console.log('API configured (final result):', isConfigured);

    if (!isConfigured) {
      console.log('API not configured, showing configuration message');
      console.log('=== loadInitialData END (NOT CONFIGURED) ===');
      this._onDidChangeTreeData.fire();
      return;
    }

    console.log('Configuration OK, attempting to get projects...');
    try {
      this.projects = await this.backlogApi.getProjects();
      console.log('Projects loaded successfully:', this.projects.length, 'projects');
      if (this.projects.length > 0) {
        console.log('Sample project:', this.projects[0].name, '(' + this.projects[0].projectKey + ')');
      }
    } catch (error) {
      console.error('Error loading projects:', error);
      console.error('Error details:', error instanceof Error ? error.stack : 'No stack');
      this.projects = [];

      // ユーザーにエラーを表示
      vscode.window.showErrorMessage(`Failed to load Backlog projects: ${error instanceof Error ? error.message : error}`);
    }

    console.log('Firing tree data change event...');
    this._onDidChangeTreeData.fire();
    console.log('=== loadInitialData END ===');
  }

  // 検索機能
  async search(query: string): Promise<void> {
    this.searchQuery = query.toLowerCase();
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // フィルタ機能
  async setStatusFilter(statuses: string[]): Promise<void> {
    this.statusFilter = statuses;
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  async setPriorityFilter(priorities: string[]): Promise<void> {
    this.priorityFilter = priorities;
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  async setAssigneeFilter(assignees: string[]): Promise<void> {
    this.assigneeFilter = assignees;
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // ソート機能
  async sort(
    sortBy: 'updated' | 'created' | 'priority' | 'status' | 'summary',
    order: 'asc' | 'desc'
  ): Promise<void> {
    this.sortBy = sortBy;
    this.sortOrder = order;
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // フィルタクリア
  clearFilters(): void {
    this.searchQuery = '';
    this.statusFilter = [];
    this.priorityFilter = [];
    this.assigneeFilter = [];
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // フィルタとソートの適用
  private applyFilters(): void {
    // プロジェクト検索フィルタ
    if (this.searchQuery) {
      this.filteredProjects = this.projects.filter(
        (project) =>
          project.name.toLowerCase().includes(this.searchQuery) ||
          project.projectKey.toLowerCase().includes(this.searchQuery)
      );
    } else {
      this.filteredProjects = [...this.projects];
    }

    this.filteredIssues.clear();

    for (const [projectId, issues] of this.projectIssues) {
      let filtered = [...issues];

      // 検索フィルタ
      if (this.searchQuery) {
        filtered = filtered.filter(
          (issue) =>
            issue.summary.toLowerCase().includes(this.searchQuery) ||
            issue.issueKey.toLowerCase().includes(this.searchQuery) ||
            (issue.description && issue.description.toLowerCase().includes(this.searchQuery))
        );
      }

      // ステータスフィルタ
      if (this.statusFilter.length > 0) {
        filtered = filtered.filter((issue) => this.statusFilter.includes(issue.status.name));
      }

      // 優先度フィルタ
      if (this.priorityFilter.length > 0) {
        filtered = filtered.filter((issue) => this.priorityFilter.includes(issue.priority.name));
      }

      // 担当者フィルタ
      if (this.assigneeFilter.length > 0) {
        filtered = filtered.filter((issue) => {
          const assigneeName = issue.assignee?.name || 'Unassigned';
          return this.assigneeFilter.includes(assigneeName);
        });
      }

      // ソート
      filtered.sort((a, b) => {
        let comparison = 0;

        switch (this.sortBy) {
          case 'updated':
            comparison = new Date(a.updated).getTime() - new Date(b.updated).getTime();
            break;
          case 'created':
            comparison = new Date(a.created).getTime() - new Date(b.created).getTime();
            break;
          case 'priority':
            comparison = a.priority.id - b.priority.id;
            break;
          case 'status':
            comparison = a.status.name.localeCompare(b.status.name);
            break;
          case 'summary':
            comparison = a.summary.localeCompare(b.summary);
            break;
        }

        return this.sortOrder === 'asc' ? comparison : -comparison;
      });

      this.filteredIssues.set(projectId, filtered);
    }
  }

  // DocumentTreeNodeをTreeItemに変換するヘルパーメソッド
  private convertDocumentTreeToItems(nodes: Entity.Document.DocumentTreeNode[], projectId: number): TreeItem[] {
    return nodes.map((node) => {
      if (node.children && node.children.length > 0) {
        // フォルダノード
        return new DocumentTreeNodeItem(
          node.name || node.id,
          vscode.TreeItemCollapsibleState.Collapsed,
          `Folder: ${node.name || node.id}`,
          new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue')),
          node,
          projectId
        );
      } else {
        // ドキュメントノード（遅延読み込み対応）
        return new DocumentTreeNodeItem(
          node.name || node.id,
          vscode.TreeItemCollapsibleState.None,
          `Document: ${node.name || node.id}${node.updated ? `\nUpdated: ${new Date(node.updated).toLocaleDateString()}` : ''
          }`,
          new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue')),
          node,
          projectId
        );
      }
    });
  }

  // 現在のフィルタ状態を取得
  getFilterState(): {
    searchQuery: string;
    statusFilter: string[];
    priorityFilter: string[];
    assigneeFilter: string[];
    sortBy: string;
    sortOrder: string;
  } {
    return {
      searchQuery: this.searchQuery,
      statusFilter: [...this.statusFilter],
      priorityFilter: [...this.priorityFilter],
      assigneeFilter: [...this.assigneeFilter],
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
    };
  }
}

export class TreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly tooltip?: string,
    public readonly iconPath?: string | vscode.ThemeIcon
  ) {
    super(label, collapsibleState);
    this.tooltip = tooltip;
    this.iconPath = iconPath;
  }
}

export class ProjectTreeItem extends TreeItem {
  constructor(public readonly project: Entity.Project.Project) {
    super(
      `${project.projectKey}: ${project.name}`,
      vscode.TreeItemCollapsibleState.None,
      `${project.name} (${project.projectKey})\nClick to focus on this project`,
      new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'))
    );
    this.contextValue = 'project';

    // クリックでプロジェクトにフォーカス
    this.command = {
      command: 'backlog.focusProject',
      title: 'Focus Project',
      arguments: [this.project.id],
    };
  }
}

export class CategoryTreeItem extends TreeItem {
  constructor(
    label: string,
    public readonly category: 'issues' | 'wiki' | 'documents',
    public readonly projectId: number
  ) {
    const icon = CategoryTreeItem.getCategoryIcon(category);
    super(label, vscode.TreeItemCollapsibleState.Collapsed, `${label} for project`, icon);
    this.contextValue = 'category';
  }

  private static getCategoryIcon(category: 'issues' | 'wiki' | 'documents'): vscode.ThemeIcon {
    switch (category) {
      case 'issues':
        return new vscode.ThemeIcon('issues', new vscode.ThemeColor('charts.orange'));
      case 'wiki':
        return new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.green'));
      case 'documents':
        return new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue'));
    }
  }
}

export class IssueTreeItem extends TreeItem {
  constructor(
    public readonly issue: Entity.Issue.Issue,
    public readonly allIssues?: Entity.Issue.Issue[]
  ) {
    const statusIcon = IssueTreeItem.getStatusIcon(issue.status.name);
    const priorityColor = IssueTreeItem.getPriorityColor(issue.priority.name);

    // 子課題があるかチェック
    const hasChildren = allIssues ? allIssues.some((i) => i.parentIssueId === issue.id) : false;

    super(
      `${issue.issueKey}: ${issue.summary}`,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      `${issue.summary}\nStatus: ${issue.status.name}\nPriority: ${issue.priority.name
      }\nAssignee: ${issue.assignee?.name || 'Unassigned'}`,
      new vscode.ThemeIcon(statusIcon, priorityColor)
    );

    this.contextValue = 'issue';
    this.command = {
      command: 'backlog.openIssue',
      title: 'Open Issue',
      arguments: [this.issue],
    };
  }

  // 子課題を取得するヘルパーメソッド
  getChildIssues(): Entity.Issue.Issue[] {
    if (!this.allIssues) {
      return [];
    }
    return this.allIssues.filter((issue) => issue.parentIssueId === this.issue.id);
  }

  private static getStatusIcon(statusName: string): string {
    switch (statusName.toLowerCase()) {
      case 'open':
      case 'オープン':
        return 'circle-outline';
      case 'in progress':
      case '処理中':
        return 'sync';
      case 'resolved':
      case '解決済み':
        return 'check';
      case 'closed':
      case 'クローズ':
        return 'circle-filled';
      default:
        return 'circle-outline';
    }
  }

  private static getPriorityColor(priorityName: string): vscode.ThemeColor {
    switch (priorityName.toLowerCase()) {
      case 'high':
      case '高':
        return new vscode.ThemeColor('charts.red');
      case 'medium':
      case '中':
        return new vscode.ThemeColor('charts.orange');
      case 'low':
      case '低':
        return new vscode.ThemeColor('charts.green');
      default:
        return new vscode.ThemeColor('foreground');
    }
  }
}

export class WikiTreeItem extends TreeItem {
  constructor(public readonly wiki: Entity.Wiki.WikiListItem) {
    super(
      wiki.name,
      vscode.TreeItemCollapsibleState.None,
      `${wiki.name}\nCreated: ${new Date(wiki.created).toLocaleDateString()}\nUpdated: ${new Date(
        wiki.updated
      ).toLocaleDateString()}`,
      new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.green'))
    );

    this.contextValue = 'wiki';
    this.command = {
      command: 'backlog.openWiki',
      title: 'Open Wiki',
      arguments: [this.wiki],
    };
  }
}

export class DocumentTreeItem extends TreeItem {
  constructor(public readonly document: Entity.Document.Document) {
    super(
      document.title,
      vscode.TreeItemCollapsibleState.None,
      `${document.title}\nCreated: ${new Date(document.created).toLocaleDateString()}`,
      new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue'))
    );

    this.contextValue = 'document';
    this.command = {
      command: 'backlog.openDocument',
      title: 'Open Document',
      arguments: [this.document],
    };
  }
}

export class DocumentTreeNodeItem extends TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    tooltip: string,
    iconPath: vscode.ThemeIcon,
    public readonly node: Entity.Document.DocumentTreeNode,
    public readonly projectId: number
  ) {
    super(label, collapsibleState, tooltip, iconPath);
    this.contextValue = node.children && node.children.length > 0 ? 'documentFolder' : 'documentFile';

    // ドキュメントファイルの場合、クリックで開く
    if (!(node.children && node.children.length > 0)) {
      this.command = {
        command: 'backlog.openDocumentFromNode',
        title: 'Open Document',
        arguments: [this.node.id, this.projectId],
      };
    }
  }
}
