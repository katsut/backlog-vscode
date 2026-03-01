import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';
import { NOTIFICATION_REASONS } from '../types/workspace';

// Backlog notification shape (backlog-js doesn't fully type this)
interface BacklogNotification {
  id: number;
  alreadyRead: boolean;
  reason: number;
  resourceAlreadyRead: boolean;
  project?: { projectKey: string; name: string };
  issue?: { issueKey: string; summary: string; id: number };
  comment?: { id: number; content: string };
  sender?: { id: number; name: string; userId: string };
  created: string;
  updated: string;
}

export class NotificationsTreeViewProvider
  implements vscode.TreeDataProvider<NotificationTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    NotificationTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private notifications: BacklogNotification[] | null = null;
  private filterUnreadOnly: boolean;
  private todoIssueKeys: Set<string> = new Set();

  constructor(
    private backlogApi: BacklogApiService,
    private getPersistedFilter: () => boolean,
    private setPersistedFilter: (v: boolean) => void
  ) {
    this.filterUnreadOnly = this.getPersistedFilter();
  }

  /** Update the set of issueKeys that have active TODOs */
  setTodoIssueKeys(keys: Set<string>): void {
    if (
      keys.size === this.todoIssueKeys.size &&
      [...keys].every((k) => this.todoIssueKeys.has(k))
    ) {
      return; // no change
    }
    this.todoIssueKeys = keys;
    this._onDidChangeTreeData.fire();
  }

  /** Clear cache and re-render (triggers loading spinner) */
  refresh(): void {
    this.notifications = null;
    this._onDidChangeTreeData.fire();
  }

  /** Fetch data first, then update tree (no loading spinner) */
  async fetchAndRefresh(): Promise<void> {
    if (!(await this.backlogApi.isConfigured())) {
      return;
    }
    try {
      this.notifications = await this.backlogApi.getNotifications({
        count: 50,
        order: 'desc',
      });
    } catch (error) {
      console.error('[Workspace] Failed to load notifications:', error);
      this.notifications = [];
    }
    this._onDidChangeTreeData.fire();
  }

  toggleFilterUnread(): boolean {
    this.filterUnreadOnly = !this.filterUnreadOnly;
    this.setPersistedFilter(this.filterUnreadOnly);
    this._onDidChangeTreeData.fire();
    return this.filterUnreadOnly;
  }

  isFilterUnreadActive(): boolean {
    return this.filterUnreadOnly;
  }

  getTreeItem(element: NotificationTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<NotificationTreeItem[]> {
    if (!(await this.backlogApi.isConfigured())) {
      return [];
    }

    if (!this.notifications) {
      try {
        this.notifications = await this.backlogApi.getNotifications({
          count: 50,
          order: 'desc',
        });
      } catch (error) {
        console.error('[Workspace] Failed to load notifications:', error);
        return [];
      }
    }

    let items = this.notifications;
    if (this.filterUnreadOnly) {
      items = items.filter((n) => !n.alreadyRead);
    }

    return items.map((n) => {
      const hasTodo = !!(n.issue?.issueKey && this.todoIssueKeys.has(n.issue.issueKey));
      return new NotificationTreeItem(n, hasTodo);
    });
  }

  async getUnreadCount(): Promise<number> {
    try {
      return await this.backlogApi.getNotificationsCount();
    } catch {
      return 0;
    }
  }

  async markAsRead(id: number): Promise<void> {
    try {
      await this.backlogApi.markNotificationAsRead(id);
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`[Nulab] 既読にできませんでした: ${error}`);
    }
  }

  async markAllAsRead(): Promise<void> {
    try {
      await this.backlogApi.markAllNotificationsAsRead();
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`[Nulab] 一括既読にできませんでした: ${error}`);
    }
  }

  /** Build a TODO-friendly summary string from a notification */
  static getNotificationSummary(notification: BacklogNotification): string {
    const issueKey = notification.issue?.issueKey || '';
    const summary = notification.issue?.summary || '';
    const reason = NOTIFICATION_REASONS[notification.reason] || '';
    if (issueKey && summary) {
      return `[${issueKey}] ${summary}`;
    }
    if (issueKey) {
      return `${issueKey} ${reason}`;
    }
    return `${notification.sender?.name || ''} ${reason}`.trim();
  }
}

export class NotificationTreeItem extends vscode.TreeItem {
  public readonly notification: BacklogNotification;
  public readonly todoSummary: string = '';

  constructor(notification: BacklogNotification, hasTodo: boolean) {
    const sender = notification.sender?.name || 'Unknown';
    const reason = NOTIFICATION_REASONS[notification.reason] || `reason:${notification.reason}`;
    const issueKey = notification.issue?.issueKey || '';
    const label = issueKey ? `${sender} ${reason} ${issueKey}` : `${sender} ${reason}`;

    super(label, vscode.TreeItemCollapsibleState.None);
    this.notification = notification;

    // Icon
    if (hasTodo) {
      this.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.purple'));
    } else if (notification.alreadyRead) {
      this.iconPath = new vscode.ThemeIcon('bell', new vscode.ThemeColor('disabledForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.green'));
    }

    // Description: relative time + state badges
    const parts: string[] = [];
    if (hasTodo) {
      parts.push('TODO');
    }
    parts.push(formatRelativeTime(notification.created));
    if (notification.alreadyRead) {
      parts.push('既読');
    }
    this.description = parts.join(' · ');

    // Tooltip
    const lines = [label];
    if (notification.comment?.content) {
      lines.push(notification.comment.content.substring(0, 100));
    }
    if (notification.issue?.summary) {
      lines.push(`Issue: ${notification.issue.summary}`);
    }
    this.tooltip = lines.join('\n');

    // contextValue: notificationRead / notificationUnread + optional _todo suffix
    const base = notification.alreadyRead ? 'notificationRead' : 'notificationUnread';
    this.contextValue = hasTodo ? `${base}_todo` : base;

    // Store summary for TODO conversion
    this.todoSummary = NotificationsTreeViewProvider.getNotificationSummary(notification);

    if (notification.issue) {
      this.command = {
        command: 'nulab.treeItemClicked',
        title: 'Open Issue',
        arguments: ['nulab.openIssue', notification.issue],
      };
    }
  }
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) {
    return 'just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) {
    return `${diffDay}d ago`;
  }
  return new Date(dateString).toLocaleDateString();
}
