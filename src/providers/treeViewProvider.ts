import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';

export class BacklogTreeViewProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> =
    new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private projects: any[] = [];
  private filteredProjects: any[] = [];
  private projectIssues: Map<number, any[]> = new Map();
  private filteredIssues: Map<number, any[]> = new Map();
  private projectWikis: Map<number, any[]> = new Map();
  private projectDocuments: Map<number, any[]> = new Map();
  
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
    this.loadInitialData();
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
        const focusedProject = this.projects.find(p => p.id === this.focusedProjectId);
        if (focusedProject) {
          return [
            new CategoryTreeItem('Issues', 'issues', this.focusedProjectId),
            new CategoryTreeItem('Wiki', 'wiki', this.focusedProjectId),
            new CategoryTreeItem('Documents', 'documents', this.focusedProjectId)
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

    if (element instanceof ProjectTreeItem) {
      // Project level - show filtered issues
      const filteredIssues = this.filteredIssues.get(element.project.id);
      const issues = filteredIssues || this.projectIssues.get(element.project.id) || [];
      return issues.map((issue) => new IssueTreeItem(issue));
    }

    if (element instanceof CategoryTreeItem) {
      switch (element.category) {
        case 'issues':
          const filteredIssues = this.filteredIssues.get(element.projectId);
          const issues = filteredIssues || this.projectIssues.get(element.projectId) || [];
          return issues.map((issue) => new IssueTreeItem(issue));
        case 'wiki':
          const wikis = this.projectWikis.get(element.projectId) || [];
          return wikis.map((wiki) => new WikiTreeItem(wiki));
        case 'documents':
          const documents = this.projectDocuments.get(element.projectId) || [];
          return documents.map((doc) => new DocumentTreeItem(doc));
      }
    }

    return [];
  }

  // プロジェクトにフォーカスする
  async focusProject(projectId: number): Promise<void> {
    this.focusedProjectId = projectId;
    
    // 課題、Wiki、ドキュメントを読み込み
    try {
      const [issues, wikis, documents] = await Promise.all([
        this.backlogApi.getProjectIssues(projectId, { count: 50 }),
        this.backlogApi.getWikiPages(projectId),
        this.backlogApi.getDocuments(projectId)
      ]);
      
      this.projectIssues.set(projectId, issues);
      this.projectWikis.set(projectId, wikis);
      this.projectDocuments.set(projectId, documents);
      
      this.applyFilters();
    } catch (error) {
      console.error('Error loading project data:', error);
      vscode.window.showErrorMessage(`Failed to load project data: ${error}`);
    }
    
    this._onDidChangeTreeData.fire();
  }

  // プロジェクトフォーカスを解除
  unfocusProject(): void {
    this.focusedProjectId = null;
    this._onDidChangeTreeData.fire();
  }

  private async loadInitialData(): Promise<void> {
    console.log('loadInitialData called');
    
    const isConfigured = await this.backlogApi.isConfigured();
    console.log('loadInitialData - API configured:', isConfigured);
    
    if (!isConfigured) {
      console.log('loadInitialData - API not configured, returning early');
      this._onDidChangeTreeData.fire();
      return;
    }

    try {
      console.log('Starting to load Backlog data...');
      
      // まず直接fetch APIでテスト
      const testResult = await this.backlogApi.testApiConnection();
      console.log('API connection test result:', testResult);
      
      if (testResult.success) {
        console.log('API connection successful, using test data for now');
        // テストが成功した場合、直接取得したデータを使用
        this.projects = testResult.data || [];
        console.log('Projects loaded:', this.projects.length, 'projects');
        vscode.window.showInformationMessage(testResult.message);
        
        // データが更新されたことを通知
        this._onDidChangeTreeData.fire();
      } else {
        console.error('API connection test failed:', testResult.message);
        vscode.window.showErrorMessage(`API Connection Failed: ${testResult.message}`);
        return;
      }

      // Issues loading is commented out for now to focus on project loading
      /*
      // Load issues for each project (limit to avoid API rate limits)
      for (const project of this.projects.slice(0, 5)) {
        try {
          const issues = await this.backlogApi.getProjectIssues(project.id, {
            count: 20, // Limit to recent 20 issues
            sort: 'updated',
            order: 'desc',
          });
          this.projectIssues.set(project.id, issues);
        } catch (error) {
          console.error(`Error loading issues for project ${project.name}:`, error);
        }
      }
      */
      
    } catch (error) {
      console.error('Error loading projects:', error);
      vscode.window.showErrorMessage(`Failed to load Backlog data: ${error}`);
    }
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
  async sort(sortBy: 'updated' | 'created' | 'priority' | 'status' | 'summary', order: 'asc' | 'desc'): Promise<void> {
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
      this.filteredProjects = this.projects.filter(project =>
        project.name.toLowerCase().includes(this.searchQuery) ||
        project.projectKey.toLowerCase().includes(this.searchQuery) ||
        (project.description && project.description.toLowerCase().includes(this.searchQuery))
      );
    } else {
      this.filteredProjects = [...this.projects];
    }

    this.filteredIssues.clear();

    for (const [projectId, issues] of this.projectIssues) {
      let filtered = [...issues];

      // 検索フィルタ
      if (this.searchQuery) {
        filtered = filtered.filter(issue =>
          issue.summary.toLowerCase().includes(this.searchQuery) ||
          issue.issueKey.toLowerCase().includes(this.searchQuery) ||
          (issue.description && issue.description.toLowerCase().includes(this.searchQuery))
        );
      }

      // ステータスフィルタ
      if (this.statusFilter.length > 0) {
        filtered = filtered.filter(issue =>
          this.statusFilter.includes(issue.status.name)
        );
      }

      // 優先度フィルタ
      if (this.priorityFilter.length > 0) {
        filtered = filtered.filter(issue =>
          this.priorityFilter.includes(issue.priority.name)
        );
      }

      // 担当者フィルタ
      if (this.assigneeFilter.length > 0) {
        filtered = filtered.filter(issue => {
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
      sortOrder: this.sortOrder
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
  constructor(public readonly project: any) {
    super(
      project.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      `${project.name} (${project.projectKey})\nDouble-click to focus on this project`,
      new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'))
    );
    this.contextValue = 'project';
    
    // ダブルクリックでプロジェクトにフォーカス
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
    super(
      label,
      vscode.TreeItemCollapsibleState.Collapsed,
      `${label} for project`,
      icon
    );
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
  constructor(public readonly issue: any) {
    const statusIcon = IssueTreeItem.getStatusIcon(issue.status.name);
    const priorityColor = IssueTreeItem.getPriorityColor(issue.priority.name);

    super(
      `${issue.issueKey}: ${issue.summary}`,
      vscode.TreeItemCollapsibleState.None,
      `${issue.summary}\nStatus: ${issue.status.name}\nPriority: ${
        issue.priority.name
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
  constructor(public readonly wiki: any) {
    super(
      wiki.name,
      vscode.TreeItemCollapsibleState.None,
      `${wiki.name}\nCreated: ${new Date(wiki.created).toLocaleDateString()}\nUpdated: ${new Date(wiki.updated).toLocaleDateString()}`,
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
  constructor(public readonly document: any) {
    super(
      document.name,
      vscode.TreeItemCollapsibleState.None,
      `${document.name}\nSize: ${document.size || 'Unknown'}\nCreated: ${new Date(document.created).toLocaleDateString()}`,
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
