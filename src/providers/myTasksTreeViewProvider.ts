import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';
import { Entity } from 'backlog-js';

export class MyTasksTreeViewProvider implements vscode.TreeDataProvider<MyTaskTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    MyTaskTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private issues: Entity.Issue.Issue[] | null = null;

  constructor(private backlogApi: BacklogApiService) {}

  refresh(): void {
    this.issues = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MyTaskTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<MyTaskTreeItem[]> {
    if (!(await this.backlogApi.isConfigured())) {
      return [];
    }

    if (!this.issues) {
      try {
        this.issues = await this.backlogApi.getMyIssuesAcrossProjects();
      } catch (error) {
        console.error('[Workspace] Failed to load my tasks:', error);
        return [];
      }
    }

    return this.issues.map((issue) => new MyTaskTreeItem(issue));
  }
}

class MyTaskTreeItem extends vscode.TreeItem {
  constructor(public readonly issue: Entity.Issue.Issue) {
    const label = `[${issue.issueKey}] ${issue.summary}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    // Status icon
    const statusName = issue.status?.name || '';
    if (statusName === 'Closed' || statusName === 'クローズ') {
      this.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    } else if (statusName === 'Resolved' || statusName === '解決済み') {
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    } else if (statusName === 'In Progress' || statusName === '処理中') {
      this.iconPath = new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.blue'));
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline');
    }

    // Description: priority / status
    const priority = issue.priority?.name || '';
    this.description = `${priority} / ${statusName}`;

    // Tooltip
    this.tooltip = [
      `${issue.issueKey}: ${issue.summary}`,
      `Status: ${statusName}`,
      `Priority: ${priority}`,
      issue.dueDate ? `Due: ${new Date(issue.dueDate).toLocaleDateString()}` : '',
      issue.updated ? `Updated: ${new Date(issue.updated).toLocaleDateString()}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.contextValue = 'myTask';
    this.command = {
      command: 'nulab.openIssue',
      title: 'Open Issue',
      arguments: [issue],
    };
  }
}
