import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ConfigService } from '../services/configService';
import { WorkspaceTodoItem, TodoContext, TodoStatus } from '../types/workspace';

type TodoTreeNode = TodoSectionItem | TodoTreeItem;

export class TodoTreeViewProvider implements vscode.TreeDataProvider<TodoTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TodoTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private todos: WorkspaceTodoItem[] = [];

  constructor(private configService: ConfigService) {
    this.todos = this.loadAndMigrate();
  }

  refresh(): void {
    this.todos = this.loadAndMigrate();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TodoTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TodoTreeNode): Promise<TodoTreeNode[]> {
    if (!element) {
      return this.getRootChildren();
    }
    if (element instanceof TodoSectionItem) {
      return element.items.map((todo) => new TodoTreeItem(todo));
    }
    return [];
  }

  private getRootChildren(): TodoTreeNode[] {
    const sorted = [...this.todos].sort((a, b) => a.order - b.order);

    const inProgress = sorted.filter((t) => t.status === 'in_progress');
    const waiting = sorted.filter((t) => t.status === 'waiting');
    const open = sorted.filter((t) => t.status === 'open');
    const done = sorted.filter((t) => t.status === 'done');

    const sections: TodoTreeNode[] = [];

    if (inProgress.length > 0) {
      sections.push(
        new TodoSectionItem(
          `進行中 (${inProgress.length})`,
          inProgress,
          'sync',
          'charts.blue',
          true
        )
      );
    }
    if (waiting.length > 0) {
      sections.push(
        new TodoSectionItem(`待ち (${waiting.length})`, waiting, 'clock', 'charts.yellow', true)
      );
    }
    if (open.length > 0) {
      sections.push(
        new TodoSectionItem(`未着手 (${open.length})`, open, 'circle-outline', undefined, true)
      );
    }
    if (done.length > 0) {
      sections.push(
        new TodoSectionItem(
          `完了 (${done.length})`,
          done,
          'pass-filled',
          'charts.green',
          false // collapsed by default
        )
      );
    }

    // No sections needed if everything is flat (all same status)
    if (sections.length === 1) {
      return (sections[0] as TodoSectionItem).items.map(
        (todo: WorkspaceTodoItem) => new TodoTreeItem(todo)
      );
    }

    return sections;
  }

  // ---- CRUD ----

  addTodo(text: string, context?: TodoContext): void {
    const maxOrder = this.todos.reduce((max, t) => Math.max(max, t.order), 0);
    const item: WorkspaceTodoItem = {
      id: crypto.randomUUID(),
      text,
      status: 'open',
      createdAt: new Date().toISOString(),
      order: maxOrder + 1,
    };
    if (context) {
      item.context = context;
    }
    this.todos.push(item);
    this.save();
  }

  /**
   * Auto-create TODO from Backlog notification. Returns false if dedup match found.
   */
  addFromBacklogNotification(notification: {
    id: number;
    issueKey: string;
    issueId: number;
    issueSummary: string;
    reason: string;
    sender: string;
    commentId?: number;
    commentContent?: string;
  }): boolean {
    // Dedup: find existing non-done TODO for the same issueKey
    const existing = this.todos.find(
      (t) =>
        t.status !== 'done' &&
        t.context?.source === 'backlog-notification' &&
        t.context?.issueKey === notification.issueKey
    );

    if (existing && existing.context) {
      // Update existing with latest notification info
      existing.context.notificationId = notification.id;
      existing.context.sender = notification.sender;
      existing.context.reason = notification.reason;
      existing.context.comment = notification.commentContent;
      existing.replied = false; // new comment → needs reply again
      this.save();
      return false;
    }

    this.addTodo(`[${notification.issueKey}] ${notification.issueSummary}`, {
      source: 'backlog-notification',
      issueKey: notification.issueKey,
      issueId: notification.issueId,
      issueSummary: notification.issueSummary,
      notificationId: notification.id,
      reason: notification.reason,
      sender: notification.sender,
      comment: notification.commentContent,
    });
    return true;
  }

  /**
   * Auto-create TODO from Slack mention. Returns false if dedup match found.
   */
  addFromSlackMention(mention: {
    channel: string;
    threadTs: string;
    messageTs: string;
    senderName: string;
    messagePreview: string;
    channelName?: string;
  }): boolean {
    // Dedup: same channel + messageTs
    const existing = this.todos.find(
      (t) =>
        t.context?.source === 'slack-mention' &&
        t.context?.slackChannel === mention.channel &&
        t.context?.slackMessageTs === mention.messageTs
    );
    if (existing) {
      return false;
    }

    const channelDisplay = mention.channelName || mention.channel;
    this.addTodo(
      `@${mention.senderName} in #${channelDisplay}: ${mention.messagePreview.substring(0, 80)}`,
      {
        source: 'slack-mention',
        slackChannel: mention.channel,
        slackThreadTs: mention.threadTs,
        slackMessageTs: mention.messageTs,
        slackUserName: mention.senderName,
        slackText: mention.messagePreview,
      }
    );
    return true;
  }

  setStatus(id: string, status: TodoStatus): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    todo.status = status;
    if (status === 'done') {
      todo.completedAt = new Date().toISOString();
    } else {
      todo.completedAt = undefined;
    }
    this.save();
  }

  cycleStatus(id: string): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    const cycle: TodoStatus[] = ['open', 'in_progress', 'done'];
    const idx = cycle.indexOf(todo.status);
    todo.status = cycle[(idx + 1) % cycle.length];
    if (todo.status === 'done') {
      todo.completedAt = new Date().toISOString();
    } else {
      todo.completedAt = undefined;
    }
    this.save();
  }

  editNotes(id: string, notes: string): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    todo.notes = notes || undefined;
    this.save();
  }

  markReplied(id: string): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    todo.replied = true;
    todo.repliedAt = new Date().toISOString();
    this.save();
  }

  /**
   * Find and mark as replied by Slack channel + threadTs.
   */
  markRepliedBySlack(channel: string, threadTs: string): void {
    const todo = this.todos.find(
      (t) =>
        t.context?.source === 'slack-mention' &&
        t.context?.slackChannel === channel &&
        (t.context?.slackThreadTs === threadTs || t.context?.slackMessageTs === threadTs)
    );
    if (todo) {
      todo.replied = true;
      todo.repliedAt = new Date().toISOString();
      this.save();
    }
  }

  // Legacy compat
  toggleTodo(id: string): void {
    this.cycleStatus(id);
  }

  editTodo(id: string, newText: string): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    todo.text = newText;
    this.save();
  }

  deleteTodo(id: string): void {
    this.todos = this.todos.filter((t) => t.id !== id);
    this.save();
  }

  clearCompleted(): void {
    this.todos = this.todos.filter((t) => t.status !== 'done');
    this.save();
  }

  reorder(id: string, direction: 'up' | 'down'): void {
    const sorted = this.todos.sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((t) => t.id === id);
    if (idx < 0) {
      return;
    }
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) {
      return;
    }
    const tmpOrder = sorted[idx].order;
    sorted[idx].order = sorted[swapIdx].order;
    sorted[swapIdx].order = tmpOrder;
    this.save();
  }

  getTodos(): WorkspaceTodoItem[] {
    return this.todos;
  }

  findTodoById(id: string): WorkspaceTodoItem | undefined {
    return this.todos.find((t) => t.id === id);
  }

  // ---- Persistence ----

  private save(): void {
    this.configService.setWorkspaceTodos(this.todos);
    this._onDidChangeTreeData.fire();
  }

  /**
   * Load from config and migrate legacy items (completed → status).
   */
  private loadAndMigrate(): WorkspaceTodoItem[] {
    const raw = this.configService.getWorkspaceTodos();
    return raw.map((item: any) => {
      if (!item.status) {
        // Legacy migration
        return {
          ...item,
          status: item.completed ? 'done' : 'open',
        };
      }
      return item;
    });
  }
}

// ---- Tree Items ----

export class TodoSectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly items: WorkspaceTodoItem[],
    iconId: string,
    colorId: string | undefined,
    expanded: boolean
  ) {
    super(
      label,
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.iconPath = colorId
      ? new vscode.ThemeIcon(iconId, new vscode.ThemeColor(colorId))
      : new vscode.ThemeIcon(iconId);
    this.contextValue = 'todoSection';
  }
}

export class TodoTreeItem extends vscode.TreeItem {
  constructor(public readonly todo: WorkspaceTodoItem) {
    super(todo.text, vscode.TreeItemCollapsibleState.None);

    const ctx = todo.context;

    // Icon based on status + source
    this.iconPath = this.resolveIcon(todo);

    // Description
    const descParts: string[] = [];
    if (todo.status === 'done') {
      descParts.push('done');
    }
    if (todo.replied) {
      descParts.push('replied');
    }
    if (ctx && todo.status !== 'done') {
      if (ctx.source === 'backlog-notification' && ctx.issueKey) {
        descParts.unshift(ctx.issueKey);
      } else if (
        (ctx.source === 'slack-mention' || ctx.source === 'slack-search') &&
        ctx.slackUserName
      ) {
        descParts.unshift(`Slack: ${ctx.slackUserName}`);
      }
    }
    if (todo.notes) {
      descParts.push('\u{1F4DD}');
    }
    this.description = descParts.join(' ');

    // Tooltip
    const tooltipLines = [todo.text];
    tooltipLines.push(`Status: ${todo.status}`);
    if (todo.replied) {
      tooltipLines.push(`Replied: ${todo.repliedAt || 'yes'}`);
    }
    if (todo.notes) {
      tooltipLines.push('');
      tooltipLines.push(`Notes: ${todo.notes.substring(0, 200)}`);
    }
    if (ctx) {
      tooltipLines.push('');
      if (ctx.source === 'backlog-notification') {
        if (ctx.issueKey && ctx.issueSummary) {
          tooltipLines.push(`Issue: [${ctx.issueKey}] ${ctx.issueSummary}`);
        }
        if (ctx.sender && ctx.reason) {
          tooltipLines.push(`${ctx.sender} — ${ctx.reason}`);
        }
        if (ctx.comment) {
          tooltipLines.push(`Comment: ${ctx.comment.substring(0, 200)}`);
        }
      } else if (ctx.source === 'slack-mention' || ctx.source === 'slack-search') {
        if (ctx.slackUserName) {
          tooltipLines.push(`From: ${ctx.slackUserName}`);
        }
        if (ctx.slackText) {
          tooltipLines.push(ctx.slackText.substring(0, 300));
        }
      }
    }
    this.tooltip = tooltipLines.join('\n');

    // Context value for menus
    const parts = ['todoItem'];
    if (todo.status === 'done') {
      parts.push('done');
    }
    if (ctx?.source === 'backlog-notification') {
      parts.push('backlog');
    } else if (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') {
      parts.push('slack');
    }
    this.contextValue = parts.join('_');

    // Click command
    this.command = {
      command: 'workspace.openTodoDetail',
      title: 'Open Detail',
      arguments: [todo.id],
    };
  }

  private resolveIcon(todo: WorkspaceTodoItem): vscode.ThemeIcon {
    if (todo.status === 'done') {
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    }
    if (todo.status === 'in_progress') {
      return new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.blue'));
    }
    if (todo.status === 'waiting') {
      return new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.yellow'));
    }

    const ctx = todo.context;
    if (!ctx) {
      return new vscode.ThemeIcon('circle-outline');
    }

    if (ctx.source === 'backlog-notification') {
      if (ctx.reason === 'assigned') {
        return new vscode.ThemeIcon('person-add', new vscode.ThemeColor('charts.orange'));
      }
      return new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.orange'));
    }
    if (ctx.source === 'slack-mention') {
      return new vscode.ThemeIcon('mention', new vscode.ThemeColor('charts.orange'));
    }

    return new vscode.ThemeIcon('circle-outline');
  }
}
