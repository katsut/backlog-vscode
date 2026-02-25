import * as vscode from 'vscode';
import { SlackApiService } from '../services/slackApi';
import { SlackMessage } from '../types/workspace';

type SlackTreeItem = vscode.TreeItem;

export class SlackTreeViewProvider implements vscode.TreeDataProvider<SlackTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SlackTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mentions: SlackMessage[] = [];
  private mentionsError: string | null = null;
  private configured: boolean | null = null;
  private loaded = false;

  constructor(private slackApi: SlackApiService) {}

  /** Clear cache and re-render (triggers loading spinner until fetchAndRefresh completes) */
  refresh(): void {
    this.loaded = false;
    this.mentions = [];
    this.mentionsError = null;
    this._onDidChangeTreeData.fire();
  }

  /** Fetch mentions, then update tree. Returns mention count. */
  async fetchAndRefresh(): Promise<number> {
    this.configured = await this.slackApi.isConfigured();
    if (!this.configured) {
      this.loaded = true;
      this._onDidChangeTreeData.fire();
      return 0;
    }

    this.mentionsError = null;

    try {
      this.mentions = await this.slackApi.getMentions();
    } catch (error) {
      this.mentionsError = error instanceof Error ? error.message : String(error);
      this.mentions = [];
    }

    this.loaded = true;
    this._onDidChangeTreeData.fire();
    return this.mentions.length;
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

    // No mentions
    if (this.mentions.length === 0) {
      const noDataItem = new vscode.TreeItem('新しい通知はありません');
      noDataItem.iconPath = new vscode.ThemeIcon('check');
      return [noDataItem];
    }

    // Mention items (flat list, no sections)
    return this.mentions.map((m) => new SlackMentionItem(m));
  }
}

export class SlackMentionItem extends vscode.TreeItem {
  constructor(public readonly message: SlackMessage) {
    const preview = message.text.substring(0, 60) + (message.text.length > 60 ? '...' : '');
    const sender = message.userName || message.user;
    super(`${sender}: ${preview}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('mention', new vscode.ThemeColor('charts.orange'));
    this.description = formatSlackTime(message.ts);
    this.tooltip = `${sender}\n${message.text}`;
    this.contextValue = 'slackMention';
    this.command = {
      command: 'workspace.openSlackThread',
      title: 'Open Thread',
      arguments: [message.channel, message.thread_ts || message.ts, `Thread: ${sender}`],
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
