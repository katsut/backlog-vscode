import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';
import { Entity } from 'backlog-js';

export class BacklogIssuesTreeViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> =
    new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private issues: Entity.Issue.Issue[] = [];
  private filteredIssues: Entity.Issue.Issue[] = [];
  private currentProjectId: number | null = null;

  // 課題検索とフィルタ
  private searchQuery: string = '';
  private statusFilter: string[] = [];
  private priorityFilter: string[] = [];
  private assigneeFilter: string[] = [];
  private sortBy: 'updated' | 'created' | 'priority' | 'status' | 'summary' = 'updated';
  private sortOrder: 'asc' | 'desc' = 'desc';

  constructor(private backlogApi: BacklogApiService) {}

  // プロジェクトを設定して課題を読み込み
  async setProject(projectId: number): Promise<void> {
    this.currentProjectId = projectId;
    await this.loadIssues();
    this._onDidChangeTreeData.fire();
  }

  // プロジェクトをクリア
  clearProject(): void {
    this.currentProjectId = null;
    this.issues = [];
    this.filteredIssues = [];
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    if (this.currentProjectId) {
      this.loadIssues();
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    // プロジェクトが選択されていない場合は空を返す
    if (!this.currentProjectId) {
      return [];
    }

    // Backlogが設定されていない場合は設定を促すアイテムを表示
    // ただし、既に課題がロードされている場合は設定済みとみなす
    if (!(await this.backlogApi.isConfigured()) && this.issues.length === 0) {
      return [this.createConfigurationItem()];
    }

    if (!element) {
      // Root level - show filtered issues
      return this.filteredIssues.map((issue) => new IssueTreeItem(issue));
    }

    return [];
  }

  // 設定を促すTreeItemを作成
  private createConfigurationItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      'Configure Backlog Settings',
      vscode.TreeItemCollapsibleState.None
    );
    item.description = 'Click to configure API settings';
    item.iconPath = new vscode.ThemeIcon('gear', new vscode.ThemeColor('charts.orange'));
    item.tooltip = 'Configure Backlog API URL and credentials to start using the extension';
    item.command = {
      command: 'backlog.openSettings',
      title: 'Open Settings',
      arguments: [],
    };
    item.contextValue = 'configuration';
    return item;
  }

  // 課題検索
  async searchIssues(query: string): Promise<void> {
    this.searchQuery = query.toLowerCase();
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // ステータスフィルタ
  async filterByStatus(statuses: string[]): Promise<void> {
    this.statusFilter = statuses;
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // 優先度フィルタ
  async filterByPriority(priorities: string[]): Promise<void> {
    this.priorityFilter = priorities;
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // 担当者フィルタ
  async filterByAssignee(assignees: string[]): Promise<void> {
    this.assigneeFilter = assignees;
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // ソート
  async sortIssues(
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

  // クイックフィルタ: クローズされていない課題
  async filterOpenIssues(): Promise<void> {
    this.statusFilter = ['Open', 'In Progress', 'オープン', '処理中'];
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // クイックフィルタ: 自分が担当の課題
  async filterMyIssues(): Promise<void> {
    try {
      const user = await this.backlogApi.getUser();
      this.assigneeFilter = [user.name];
      this.applyFilters();
      this._onDidChangeTreeData.fire();
    } catch (error) {
      console.error('Error getting user for filter:', error);
    }
  }

  // クイックフィルタ: 期限切れの課題
  async filterOverdueIssues(): Promise<void> {
    // まず全ての課題をロードしてから期限切れをフィルタ
    let filtered = [...this.issues];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    filtered = filtered.filter((issue) => {
      if (!issue.dueDate) {
        return false;
      }
      const dueDate = new Date(issue.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return (
        dueDate < today &&
        !['Resolved', 'Closed', '解決済み', 'クローズ'].includes(issue.status.name)
      );
    });

    this.filteredIssues = filtered;
    this._onDidChangeTreeData.fire();
  }

  // フィルタとソートの適用
  private applyFilters(): void {
    let filtered = [...this.issues];

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

    this.filteredIssues = filtered;
  }

  private async loadIssues(): Promise<void> {
    if (!this.currentProjectId || !(await this.backlogApi.isConfigured())) {
      return;
    }

    try {
      console.log('Loading issues for project:', this.currentProjectId);

      const issues = await this.backlogApi.getProjectIssues(this.currentProjectId, {
        count: 100,
        sort: 'updated',
        order: 'desc',
      });

      this.issues = issues;
      this.applyFilters();
      console.log('Issues loaded successfully:', this.issues.length, 'issues');
    } catch (error) {
      console.error('Error loading issues:', error);
      vscode.window.showErrorMessage(`Failed to load issues: ${error}`);
    }
  }

  // 課題を取得
  getIssues(): Entity.Issue.Issue[] {
    return this.issues;
  }

  // フィルタされた課題を取得
  getFilteredIssues(): Entity.Issue.Issue[] {
    return this.filteredIssues;
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

export class IssueTreeItem extends vscode.TreeItem {
  constructor(public readonly issue: Entity.Issue.Issue) {
    const statusIcon = IssueTreeItem.getStatusIcon(issue.status.name);
    const priorityColor = IssueTreeItem.getPriorityColor(issue.priority.name);

    super(`${issue.issueKey}: ${issue.summary}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${issue.summary}\nStatus: ${issue.status.name}\nPriority: ${
      issue.priority.name
    }\nAssignee: ${issue.assignee?.name || 'Unassigned'}`;
    this.iconPath = new vscode.ThemeIcon(statusIcon, priorityColor);
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
