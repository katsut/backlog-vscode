import * as vscode from 'vscode';
import { SlackApiService } from '../services/slackApi';
import { SlackConfig } from '../config/slackConfig';
import { SlackMessage } from '../types/workspace';
import { formatSlackTime } from './slackTreeViewProvider';

type SearchTreeItem = SearchSectionItem | SearchResultItem;

const DRAG_MIME = 'application/vnd.code.tree.workspaceSlackSearch';

export class SlackSearchTreeViewProvider
  implements
    vscode.TreeDataProvider<SearchTreeItem>,
    vscode.TreeDragAndDropController<SearchTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SearchTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dragMimeTypes = [DRAG_MIME];
  readonly dropMimeTypes = [DRAG_MIME];

  private keywordResults = new Map<string, SlackMessage[]>();
  private keywordErrors = new Map<string, string>();
  private configured: boolean | null = null;
  private loaded = false;
  private _viewMode: 'grouped' | 'flat' = 'grouped';

  constructor(private slackApi: SlackApiService, private configService: SlackConfig) {
    vscode.commands.executeCommand('setContext', 'nulab.slackSearch.viewMode', this._viewMode);
  }

  get viewMode(): 'grouped' | 'flat' {
    return this._viewMode;
  }

  toggleViewMode(): void {
    this._viewMode = this._viewMode === 'grouped' ? 'flat' : 'grouped';
    vscode.commands.executeCommand('setContext', 'nulab.slackSearch.viewMode', this._viewMode);
    this._onDidChangeTreeData.fire();
  }

  // ---- Drag & Drop ----

  handleDrag(source: readonly SearchTreeItem[], dataTransfer: vscode.DataTransfer): void {
    const section = source.find((s) => s instanceof SearchSectionItem) as
      | SearchSectionItem
      | undefined;
    if (section) {
      dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(section.keyword));
    }
  }

  handleDrop(target: SearchTreeItem | undefined, dataTransfer: vscode.DataTransfer): void {
    const item = dataTransfer.get(DRAG_MIME);
    if (!item) return;

    const draggedKeyword = item.value as string;
    const keywords = this.configService.getSearchKeywords();
    const fromIndex = keywords.indexOf(draggedKeyword);
    if (fromIndex === -1) return;

    let toIndex: number;
    if (!target || !(target instanceof SearchSectionItem)) {
      toIndex = keywords.length - 1;
    } else {
      toIndex = keywords.indexOf(target.keyword);
      if (toIndex === -1) return;
    }

    if (fromIndex === toIndex) return;

    const reordered = [...keywords];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);
    this.configService.setSearchKeywords(reordered);
    this._onDidChangeTreeData.fire();
  }

  // ---- Data ----

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

    const keywords = this.configService.getSearchKeywords();
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

    const keywords = this.configService.getSearchKeywords();
    if (keywords.length === 0) {
      return [];
    }

    if (!element) {
      return this._viewMode === 'grouped'
        ? this.getRootChildrenGrouped(keywords)
        : this.getRootChildrenFlat(keywords);
    }

    if (element instanceof SearchSectionItem) {
      return this.getResultItems(element.keyword);
    }

    return [];
  }

  private getRootChildrenGrouped(keywords: string[]): SearchTreeItem[] {
    if (this.slackApi.getTokenType() === 'bot') {
      return [this.botHintItem()];
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

  private getRootChildrenFlat(keywords: string[]): SearchTreeItem[] {
    if (this.slackApi.getTokenType() === 'bot') {
      return [this.botHintItem()];
    }

    const all: { keyword: string; message: SlackMessage }[] = [];
    for (const keyword of keywords) {
      if (this.keywordErrors.has(keyword)) continue;
      const results = this.keywordResults.get(keyword) || [];
      for (const m of results) {
        all.push({ keyword, message: m });
      }
    }

    // Sort by timestamp descending (newest first)
    all.sort((a, b) => {
      const tsA = parseFloat(a.message.ts) || 0;
      const tsB = parseFloat(b.message.ts) || 0;
      return tsB - tsA;
    });

    return all.map(({ keyword, message }) => new SearchResultItem(message, keyword));
  }

  private botHintItem(): SearchTreeItem {
    const hint = new vscode.TreeItem('Bot token: 検索は利用不可');
    hint.iconPath = new vscode.ThemeIcon('info');
    hint.tooltip = 'search.messages はユーザートークン (xoxp-) でのみ利用可能です';
    return hint as SearchTreeItem;
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
  constructor(public readonly message: SlackMessage, keyword?: string) {
    const preview = message.text.substring(0, 60) + (message.text.length > 60 ? '...' : '');
    const sender = message.userName || message.user;
    super(`${sender}: ${preview}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.blue'));
    const time = formatSlackTime(message.ts);
    this.description = keyword ? `[${keyword}] ${time}` : time;
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
