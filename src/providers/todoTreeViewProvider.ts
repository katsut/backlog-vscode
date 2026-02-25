import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SessionFileService } from '../services/session/sessionFileService';
import { TodoPersistenceService } from '../services/session/todoPersistenceService';
import { WorkspaceTodoItem, TodoContext, TodoStatus } from '../types/workspace';

type TodoTreeNode = TodoSectionItem | TodoTreeItem;

export class TodoTreeViewProvider implements vscode.TreeDataProvider<TodoTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TodoTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private todos: WorkspaceTodoItem[] = [];

  constructor(
    private fileService: SessionFileService,
    private todoPersistence: TodoPersistenceService,
    private log: (msg: string) => void = () => {}
  ) {
    this.todos = this.todoPersistence.loadAllTodos();
  }

  refresh(): void {
    this.todos = this.todoPersistence.loadAllTodos();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TodoTreeNode): vscode.TreeItem {
    return element;
  }

  getParent(element: TodoTreeNode): TodoTreeNode | undefined {
    if (element instanceof TodoTreeItem) {
      const children = this.getRootChildren();
      for (const child of children) {
        if (child instanceof TodoSectionItem) {
          if (child.items.some((t) => t.id === element.todo.id)) {
            return child;
          }
        }
      }
    }
    return undefined;
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

  addTodo(text: string, context?: TodoContext): WorkspaceTodoItem {
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
    this.todoPersistence.createSessionFromTodo(item);
    this._onDidChangeTreeData.fire();
    return item;
  }

  /**
   * Auto-create TODO from Backlog notification.
   * Fetches full issue context (details, comments, change logs) from the API.
   */
  async addFromBacklogNotification(notification: {
    id: number;
    issueKey: string;
    issueId: number;
    issueSummary: string;
    reason: string;
    sender: string;
    commentId?: number;
    commentContent?: string;
  }): Promise<void> {
    this.log(`addFromBacklogNotification: ${notification.issueKey} notifId=${notification.id}`);
    // Dedup: find existing non-done TODO for the same issueKey
    const existing = this.todos.find(
      (t) =>
        t.status !== 'done' &&
        t.context?.source === 'backlog-notification' &&
        t.context?.issueKey === notification.issueKey
    );

    if (existing && existing.context) {
      const sameNotification = existing.context.notificationId === notification.id;
      const parsed = this.fileService.parseSession(
        this.fileService.getSessionFilePath(existing.id)
      );
      const hasFullContext = parsed?.meta.contextFull === true;

      if (sameNotification && hasFullContext) {
        return;
      }

      // Update notification info
      existing.context.notificationId = notification.id;
      existing.context.sender = notification.sender;
      existing.context.reason = notification.reason;
      existing.context.comment = notification.commentContent;
      if (!sameNotification) {
        existing.replied = false;
      }
      this.fileService.updateFrontmatter(existing.id, {
        notificationId: notification.id,
        sender: notification.sender,
        reason: notification.reason,
        comment: notification.commentContent,
        ...(sameNotification ? {} : { replied: false }),
      });

      // Fetch full context from Backlog API
      await this.todoPersistence.startBacklogSession(existing);
      this._onDidChangeTreeData.fire();
      return;
    }

    // New TODO
    const todo = this.addTodo(`[${notification.issueKey}] ${notification.issueSummary}`, {
      source: 'backlog-notification',
      issueKey: notification.issueKey,
      issueId: notification.issueId,
      issueSummary: notification.issueSummary,
      notificationId: notification.id,
      reason: notification.reason,
      sender: notification.sender,
      comment: notification.commentContent,
    });

    // Fetch full context from Backlog API (overwrites light context)
    await this.todoPersistence.startBacklogSession(todo);
  }

  /**
   * Auto-create TODO from Slack mention.
   * Fetches full thread context from the Slack API.
   */
  async addFromSlackMention(mention: {
    channel: string;
    threadTs: string;
    messageTs: string;
    senderName: string;
    messagePreview: string;
    channelName?: string;
  }): Promise<void> {
    // Dedup: same channel + messageTs
    const existing = this.todos.find(
      (t) =>
        t.context?.source === 'slack-mention' &&
        t.context?.slackChannel === mention.channel &&
        t.context?.slackMessageTs === mention.messageTs
    );
    if (existing) {
      return;
    }

    const channelDisplay = mention.channelName || mention.channel;
    const todo = this.addTodo(
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

    // Fetch full thread context from Slack API
    await this.todoPersistence.startSlackSession(todo);
  }

  setStatus(id: string, status: TodoStatus): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    todo.status = status;
    const updates: Record<string, unknown> = { status };
    if (status === 'done') {
      todo.completedAt = new Date().toISOString();
      updates.completedAt = todo.completedAt;
    } else {
      todo.completedAt = undefined;
      updates.completedAt = undefined;
    }
    this.fileService.updateFrontmatter(id, updates);
    this._onDidChangeTreeData.fire();
  }

  cycleStatus(id: string): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    const cycle: TodoStatus[] = ['open', 'in_progress', 'done'];
    const idx = cycle.indexOf(todo.status);
    todo.status = cycle[(idx + 1) % cycle.length];
    const updates: Record<string, unknown> = { status: todo.status };
    if (todo.status === 'done') {
      todo.completedAt = new Date().toISOString();
      updates.completedAt = todo.completedAt;
    } else {
      todo.completedAt = undefined;
      updates.completedAt = undefined;
    }
    this.fileService.updateFrontmatter(id, updates);
    this._onDidChangeTreeData.fire();
  }

  editNotes(id: string, notes: string): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    todo.notes = notes || undefined;
    this.fileService.updateFrontmatter(id, { notes: todo.notes });
    this._onDidChangeTreeData.fire();
  }

  markReplied(id: string): void {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) {
      return;
    }
    todo.replied = true;
    todo.repliedAt = new Date().toISOString();
    this.fileService.updateFrontmatter(id, { replied: true, repliedAt: todo.repliedAt });
    this._onDidChangeTreeData.fire();
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
      this.fileService.updateFrontmatter(todo.id, { replied: true, repliedAt: todo.repliedAt });
      this._onDidChangeTreeData.fire();
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
    this.fileService.updateFrontmatter(id, { text: newText });
    this._onDidChangeTreeData.fire();
  }

  deleteTodo(id: string): void {
    this.todos = this.todos.filter((t) => t.id !== id);
    this.fileService.deleteTodoFile(id);
    this._onDidChangeTreeData.fire();
  }

  clearCompleted(): void {
    const done = this.todos.filter((t) => t.status === 'done');
    for (const todo of done) {
      this.fileService.deleteTodoFile(todo.id);
    }
    this.todos = this.todos.filter((t) => t.status !== 'done');
    this._onDidChangeTreeData.fire();
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
    this.fileService.updateFrontmatter(sorted[idx].id, { order: sorted[idx].order });
    this.fileService.updateFrontmatter(sorted[swapIdx].id, { order: sorted[swapIdx].order });
    this._onDidChangeTreeData.fire();
  }

  getTodos(): WorkspaceTodoItem[] {
    return this.todos;
  }

  findTodoById(id: string): WorkspaceTodoItem | undefined {
    return this.todos.find((t) => t.id === id);
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

    this.command = {
      command: 'nulab.treeItemClicked',
      title: 'Open Detail',
      arguments: ['workspace.openTodoDetail', todo.id],
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
