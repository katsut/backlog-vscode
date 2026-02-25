import * as vscode from 'vscode';
import { SlackApiService } from '../services/slackApi';
import { ConfigService } from '../services/configService';
import { SlackMessage } from '../types/workspace';
import { formatSlackTime } from './slackTreeViewProvider';

type SearchTreeItem = SearchSectionItem | SearchResultItem;

export class SlackSearchTreeViewProvider implements vscode.TreeDataProvider<SearchTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SearchTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private keywordResults = new Map<string, SlackMessage[]>();
  private keywordErrors = new Map<string, string>();
  private configured: boolean | null = null;
  private loaded = false;

  constructor(private slackApi: SlackApiService, private configService: ConfigService) {}

  /** Clear cache and re-render (triggers loading spinner until fetchAndRefresh completes) */
  refresh(): void {
    this.loaded = false;
    this.keywordResults.clear();
    this.keywordErrors.clear();
    this._onDidChangeTreeData.fire();
  }

  /** Fetch data first, then update tree (no loading spinner) */
  async fetchAndRefresh(): Promise<void> {
    this.configured = await this.slackApi.isConfigured();
    if (!this.configured) {
      this.loaded = true;
      this._onDidChangeTreeData.fire();
      return;
    }

    const keywords = this.configService.getSlackSearchKeywords();
    this.keywordResults.clear();
    this.keywordErrors.clear();

    await Promise.all(
      keywords.map(async (kw) => {
        try {
          const results = await this.slackApi.searchMessages(kw);
          this.keywordResults.set(kw, results);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.keywordErrors.set(kw, errMsg);
          this.keywordResults.set(kw, []);
        }
      })
    );

    this.loaded = true;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SearchTreeItem): vscode.TreeItem {
    return element;
  }

  /** Returns cached data only — never makes async API calls */
  getChildren(element?: SearchTreeItem): SearchTreeItem[] {
    if (!this.loaded) {
      return [];
    }

    if (this.configured === false) {
      return [];
    }

    const keywords = this.configService.getSlackSearchKeywords();
    if (keywords.length === 0) {
      return [];
    }

    if (!element) {
      return this.getRootChildren(keywords);
    }

    if (element instanceof SearchSectionItem) {
      return this.getResultItems(element.keyword);
    }

    return [];
  }

  private getRootChildren(keywords: string[]): SearchTreeItem[] {
    if (this.slackApi.getTokenType() === 'bot') {
      const hint = new vscode.TreeItem('Bot token: 検索は利用不可');
      hint.iconPath = new vscode.ThemeIcon('info');
      hint.tooltip = 'search.messages はユーザートークン (xoxp-) でのみ利用可能です';
      return [hint as SearchTreeItem];
    }

    const items: SearchTreeItem[] = [];
    for (const keyword of keywords) {
      const error = this.keywordErrors.get(keyword);
      if (error) {
        const errorItem = new vscode.TreeItem(`${keyword}: ${error}`);
        errorItem.iconPath = new vscode.ThemeIcon('error');
        errorItem.tooltip = error;
        items.push(errorItem as SearchTreeItem);
      } else {
        const results = this.keywordResults.get(keyword) || [];
        items.push(new SearchSectionItem(keyword, results.length));
      }
    }

    return items;
  }

  private getResultItems(keyword: string): SearchTreeItem[] {
    const results = this.keywordResults.get(keyword) || [];
    return results.map((m) => new SearchResultItem(m));
  }
}

class SearchSectionItem extends vscode.TreeItem {
  constructor(public readonly keyword: string, count: number) {
    super(`${keyword} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('search');
    this.contextValue = 'slackSearchSection';
  }
}

class SearchResultItem extends vscode.TreeItem {
  constructor(public readonly message: SlackMessage) {
    const preview = message.text.substring(0, 60) + (message.text.length > 60 ? '...' : '');
    const sender = message.userName || message.user;
    super(`${sender}: ${preview}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.blue'));
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
