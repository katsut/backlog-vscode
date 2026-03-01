import * as vscode from 'vscode';
import { SecretsConfig } from './secretsConfig';
import { WorkspaceFileStore } from './workspaceFileStore';

/**
 * Slack-specific configuration: token, polling, DMs, auto-TODO, search keywords.
 */
export class SlackConfig {
  private static readonly FILE_SLACK_SEARCH_KEYWORDS = 'slack-search-keywords.json';
  private static readonly FILE_FAVORITE_CHANNELS = 'slack-favorite-channels.json';
  private readonly configSection = 'nulab';

  constructor(
    private readonly secrets: SecretsConfig,
    private readonly fileStore: WorkspaceFileStore
  ) {}

  async getToken(): Promise<string | undefined> {
    return await this.secrets.getSecret('nulab.slack.token');
  }

  async setToken(token: string): Promise<void> {
    await this.secrets.setSecret('nulab.slack.token', token);
  }

  getPollingInterval(): number {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number>('slack.pollingInterval', 180);
  }

  isIncludeDMs(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('slack.includeDMs', true);
  }

  isAutoTodoEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('slack.autoTodoEnabled', false);
  }

  isAutoTodoDMs(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('slack.autoTodoDMs', false);
  }

  getSearchKeywords(): string[] {
    return this.fileStore.readJsonFile<string[]>(SlackConfig.FILE_SLACK_SEARCH_KEYWORDS, []);
  }

  setSearchKeywords(keywords: string[]): void {
    this.fileStore.writeJsonFile(SlackConfig.FILE_SLACK_SEARCH_KEYWORDS, keywords);
  }

  getFavoriteChannels(): { id: string; name: string }[] {
    return this.fileStore.readJsonFile<{ id: string; name: string }[]>(
      SlackConfig.FILE_FAVORITE_CHANNELS,
      []
    );
  }

  setFavoriteChannels(channels: { id: string; name: string }[]): void {
    this.fileStore.writeJsonFile(SlackConfig.FILE_FAVORITE_CHANNELS, channels);
  }

  getSearchViewMode(): 'grouped' | 'flat' {
    const val = this.fileStore.readJsonFile<string>('slack-search-view-mode.json', 'grouped');
    return val === 'flat' ? 'flat' : 'grouped';
  }

  setSearchViewMode(mode: 'grouped' | 'flat'): void {
    this.fileStore.writeJsonFile('slack-search-view-mode.json', mode);
  }

  // ---- Cached user group IDs (persisted to survive restarts) ----

  private static readonly FILE_MY_GROUP_IDS = 'slack-my-group-ids.json';

  getMyGroupIds(): string[] {
    return this.fileStore.readJsonFile<string[]>(SlackConfig.FILE_MY_GROUP_IDS, []);
  }

  setMyGroupIds(ids: string[]): void {
    this.fileStore.writeJsonFile(SlackConfig.FILE_MY_GROUP_IDS, ids);
  }

  // ---- Slack read state ----

  private static readonly FILE_READ_KEYS = 'slack-read-keys.json';
  private static readonly FILE_SEARCH_READ_KEYS = 'slack-search-read-keys.json';
  private static readonly FILE_FILTER_STATE = 'filter-state.json';

  getReadKeys(): string[] {
    return this.fileStore.readJsonFile<string[]>(SlackConfig.FILE_READ_KEYS, []);
  }

  setReadKeys(keys: string[]): void {
    this.fileStore.writeJsonFile(SlackConfig.FILE_READ_KEYS, keys);
  }

  getSearchReadKeys(): string[] {
    return this.fileStore.readJsonFile<string[]>(SlackConfig.FILE_SEARCH_READ_KEYS, []);
  }

  setSearchReadKeys(keys: string[]): void {
    this.fileStore.writeJsonFile(SlackConfig.FILE_SEARCH_READ_KEYS, keys);
  }

  // ---- Filter state persistence ----

  private getFilterState(key: string): boolean {
    const state = this.fileStore.readJsonFile<Record<string, boolean>>(
      SlackConfig.FILE_FILTER_STATE,
      {}
    );
    return state[key] ?? false;
  }

  private setFilterState(key: string, value: boolean): void {
    const state = this.fileStore.readJsonFile<Record<string, boolean>>(
      SlackConfig.FILE_FILTER_STATE,
      {}
    );
    state[key] = value;
    this.fileStore.writeJsonFile(SlackConfig.FILE_FILTER_STATE, state);
  }

  getNotificationFilterUnread(): boolean {
    return this.getFilterState('notificationUnreadOnly');
  }
  setNotificationFilterUnread(v: boolean): void {
    this.setFilterState('notificationUnreadOnly', v);
  }

  getSlackFilterUnread(): boolean {
    return this.getFilterState('slackUnreadOnly');
  }
  setSlackFilterUnread(v: boolean): void {
    this.setFilterState('slackUnreadOnly', v);
  }

  getSlackSearchFilterUnread(): boolean {
    return this.getFilterState('slackSearchUnreadOnly');
  }
  setSlackSearchFilterUnread(v: boolean): void {
    this.setFilterState('slackSearchUnreadOnly', v);
  }
}
