import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';

export class BacklogProjectsTreeViewProvider implements vscode.TreeDataProvider<ProjectTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ProjectTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ProjectTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ProjectTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private projects: any[] = [];
  private filteredProjects: any[] = [];
  
  // プロジェクト検索とフィルタ
  private searchQuery: string = '';
  private projectKeyFilter: string = '';

  constructor(private backlogApi: BacklogApiService) {
    this.loadProjects();
  }

  refresh(): void {
    this.loadProjects();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ProjectTreeItem): Promise<ProjectTreeItem[]> {
    if (!(await this.backlogApi.isConfigured())) {
      return [
        new ProjectTreeItem({
          id: 0,
          name: 'Configuration Required',
          projectKey: '',
          description: 'Configure Backlog API URL and API Key in settings'
        })
      ];
    }

    if (!element) {
      // Root level - show filtered projects
      return this.filteredProjects.map((project) => new ProjectTreeItem(project));
    }

    return [];
  }

  // プロジェクト検索
  async searchProjects(query: string): Promise<void> {
    this.searchQuery = query.toLowerCase();
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // プロジェクトキーフィルタ
  async filterByProjectKey(projectKey: string): Promise<void> {
    this.projectKeyFilter = projectKey.toLowerCase();
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // フィルタクリア
  clearFilters(): void {
    this.searchQuery = '';
    this.projectKeyFilter = '';
    this.applyFilters();
    this._onDidChangeTreeData.fire();
  }

  // フィルタの適用
  private applyFilters(): void {
    let filtered = [...this.projects];

    // 検索フィルタ
    if (this.searchQuery) {
      filtered = filtered.filter(project =>
        project.name.toLowerCase().includes(this.searchQuery) ||
        project.projectKey.toLowerCase().includes(this.searchQuery) ||
        (project.description && project.description.toLowerCase().includes(this.searchQuery))
      );
    }

    // プロジェクトキーフィルタ
    if (this.projectKeyFilter) {
      filtered = filtered.filter(project =>
        project.projectKey.toLowerCase().includes(this.projectKeyFilter)
      );
    }

    this.filteredProjects = filtered;
  }

  private async loadProjects(): Promise<void> {
    if (!(await this.backlogApi.isConfigured())) {
      return;
    }

    try {
      console.log('Loading projects for project view...');
      
      // 直接getProjects APIを使用
      const projects = await this.backlogApi.getProjects();
      
      this.projects = projects || [];
      this.applyFilters();
      console.log('Projects loaded successfully:', this.projects.length, 'projects');
    } catch (error) {
      console.error('Error loading projects:', error);
      // プロジェクトが取得できない場合は空の配列を設定
      this.projects = [];
      this.applyFilters();
      vscode.window.showErrorMessage(`Failed to load projects: ${error}`);
    }
  }

  // プロジェクトを取得
  getProjects(): any[] {
    return this.projects;
  }

  // フィルタされたプロジェクトを取得
  getFilteredProjects(): any[] {
    return this.filteredProjects;
  }

  // 現在のフィルタ状態を取得
  getFilterState(): {
    searchQuery: string;
    projectKeyFilter: string;
  } {
    return {
      searchQuery: this.searchQuery,
      projectKeyFilter: this.projectKeyFilter
    };
  }
}

export class ProjectTreeItem extends vscode.TreeItem {
  constructor(public readonly project: any) {
    super(
      project.name,
      vscode.TreeItemCollapsibleState.None
    );
    
    this.tooltip = `${project.name} (${project.projectKey})\nClick to focus on this project`;
    this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
    this.contextValue = 'project';
    
    // クリックでプロジェクトにフォーカス
    this.command = {
      command: 'backlog.focusProject',
      title: 'Focus Project',
      arguments: [this.project.id],
    };
  }
}
