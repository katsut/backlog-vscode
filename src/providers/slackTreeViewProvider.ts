import * as vscode from 'vscode';
import { SlackApiService } from '../services/slackApi';
import { SlackConfig } from '../config/slackConfig';
import { SlackMessage } from '../types/workspace';

type SlackTreeItem = vscode.TreeItem;

export class SlackTreeViewProvider implements vscode.TreeDataProvider<SlackTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SlackTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mentions: SlackMessage[] = [];
  private mentionsError: string | null = null;
  private configured: boolean | null = null;
  private loaded = false;
  /** Epoch seconds of the newest message seen at previous poll */
  private lastSeenTs = 0;
  /** Set of "channel:ts" keys the user has already opened */
  private readKeys: Set<string>;
  private filterUnreadOnly: boolean;
  /** Set of "channel:messageTs" keys that have active TODOs */
  private todoKeys: Set<string> = new Set();

  constructor(private slackApi: SlackApiService, private slackConfig: SlackConfig) {
    this.readKeys = new Set(slackConfig.getReadKeys());
    this.filterUnreadOnly = slackConfig.getSlackFilterUnread();
  }

  setTodoKeys(keys: Set<string>): void {
    if (keys.size === this.todoKeys.size && [...keys].every((k) => this.todoKeys.has(k))) {
      return;
    }
    this.todoKeys = keys;
    this._onDidChangeTreeData.fire();
  }

  toggleFilterUnread(): boolean {
    this.filterUnreadOnly = !this.filterUnreadOnly;
    this.slackConfig.setSlackFilterUnread(this.filterUnreadOnly);
    this._onDidChangeTreeData.fire();
    return this.filterUnreadOnly;
  }

  isFilterUnreadActive(): boolean {
    return this.filterUnreadOnly;
  }

  /** Clear cache and re-render (triggers loading spinner until fetchAndRefresh completes) */
  refresh(): void {
    this.loaded = false;
    this.mentions = [];
    this.mentionsError = null;
    this._onDidChangeTreeData.fire();
  }

  /** Fetch mentions, then update tree. Returns { newCount, mentions }. */
  async fetchAndRefresh(options?: {
    includeDMs?: boolean;
  }): Promise<{ newCount: number; mentions: SlackMessage[] }> {
    this.configured = await this.slackApi.isConfigured();
    if (!this.configured) {
      this.loaded = true;
      this._onDidChangeTreeData.fire();
      return { newCount: 0, mentions: [] };
    }

    this.mentionsError = null;

    const prevNewest = this.lastSeenTs;
    try {
      this.mentions = await this.slackApi.getMentions({
        includeDMs: options?.includeDMs,
        onProgress: (partial) => {
          this.mentions = partial;
          this.loaded = true;
          this._onDidChangeTreeData.fire();
        },
      });
    } catch (error) {
      this.mentionsError = error instanceof Error ? error.message : String(error);
      this.mentions = [];
    }

    // Track newest ts for "new" badge
    if (this.mentions.length > 0) {
      const newest = Math.max(...this.mentions.map((m) => parseFloat(m.ts) || 0));
      this.lastSeenTs = newest;
    }

    this.loaded = true;
    this._onDidChangeTreeData.fire();

    // Count messages newer than previous newest
    let newCount: number;
    if (prevNewest > 0) {
      newCount = this.mentions.filter((m) => (parseFloat(m.ts) || 0) > prevNewest).length;
    } else {
      newCount = this.mentions.length;
    }
    return { newCount, mentions: this.mentions };
  }

  getTreeItem(element: SlackTreeItem): vscode.TreeItem {
    return element;
  }

  /** Returns cached data only — never makes async API calls */
  getChildren(element?: SlackTreeItem): SlackTreeItem[] | vscode.TreeItem[] {
    if (!this.loaded) {
      return [];
    }

    if (this.configured === false) {
      const hint = new vscode.TreeItem('Slack トークンが未設定です');
      hint.iconPath = new vscode.ThemeIcon('key');
      hint.command = {
        command: 'workspace.setSlackToken',
        title: 'Set Slack Token',
      };
      return [hint];
    }

    if (element) {
      return [];
    }

    // Error
    if (this.mentionsError) {
      const errorItem = new vscode.TreeItem(`エラー: ${this.mentionsError}`);
      errorItem.iconPath = new vscode.ThemeIcon('error');
      errorItem.tooltip = this.mentionsError;
      return [errorItem];
    }

    // Bot token hint
    const tokenType = this.slackApi.getTokenType();
    if (tokenType === 'bot') {
      const hint = new vscode.TreeItem('Bot token: 通知の取得は利用不可');
      hint.iconPath = new vscode.ThemeIcon('info');
      hint.tooltip = 'search.messages はユーザートークン (xoxp-) でのみ利用可能です';
      return [hint];
    }

    // Filter by unread if active
    let mentions = this.mentions;
    if (this.filterUnreadOnly) {
      mentions = mentions.filter((m) => !this.readKeys.has(`${m.channel}:${m.ts}`));
    }

    // No mentions
    if (mentions.length === 0) {
      const label = this.filterUnreadOnly ? '未読はありません' : '新しい通知はありません';
      const noDataItem = new vscode.TreeItem(label);
      noDataItem.iconPath = new vscode.ThemeIcon('check');
      return [noDataItem];
    }

    // Mention items (flat list, no sections)
    return mentions.map((m) => {
      const key = `${m.channel}:${m.ts}`;
      const hasTodo = this.todoKeys.has(key);
      return new SlackMentionItem(m, this.readKeys.has(key), hasTodo);
    });
  }

  /** Mark a message as read and refresh the tree */
  markAsRead(channel: string, ts: string): void {
    const key = `${channel}:${ts}`;
    if (this.readKeys.has(key)) {
      return;
    }
    this.readKeys.add(key);
    // Keep only keys that are in the current mentions to avoid unbounded growth
    const mentionKeys = new Set(this.mentions.map((m) => `${m.channel}:${m.ts}`));
    const pruned = [...this.readKeys].filter((k) => mentionKeys.has(k));
    this.readKeys = new Set(pruned);
    this.readKeys.add(key);
    this.slackConfig.setReadKeys([...this.readKeys]);
    this._onDidChangeTreeData.fire();
  }
}

export class SlackMentionItem extends vscode.TreeItem {
  constructor(public readonly message: SlackMessage, isRead: boolean, hasTodo = false) {
    const preview = message.text.substring(0, 60) + (message.text.length > 60 ? '...' : '');
    const sender = message.userName || message.user || 'Unknown';
    super(`${sender}: ${preview}`, vscode.TreeItemCollapsibleState.None);

    const iconColor = hasTodo ? 'charts.purple' : isRead ? 'disabledForeground' : 'charts.orange';
    this.iconPath = message.is_dm
      ? new vscode.ThemeIcon('mail', new vscode.ThemeColor(iconColor))
      : new vscode.ThemeIcon('mention', new vscode.ThemeColor(iconColor));
    const descParts: string[] = [];
    if (hasTodo) {
      descParts.push('TODO');
    }
    descParts.push(formatSlackTime(message.ts));
    this.description = descParts.join(' · ');
    this.tooltip = `${sender}\n${message.text}`;
    this.contextValue = 'slackMention';

    this.command = {
      command: 'nulab.treeItemClicked',
      title: 'Open Thread',
      arguments: [
        'workspace.openSlackThread',
        message.channel,
        message.thread_ts || message.ts,
        `Thread: ${sender}`,
      ],
    };
  }
}

function formatSlackTime(ts: string): string {
  const epoch = parseFloat(ts) * 1000;
  if (isNaN(epoch)) {
    return '';
  }
  const diffMin = Math.floor((Date.now() - epoch) / 60000);
  if (diffMin < 1) {
    return 'now';
  }
  if (diffMin < 60) {
    return `${diffMin}m`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h`;
  }
  return `${Math.floor(diffHour / 24)}d`;
}

export { formatSlackTime };
