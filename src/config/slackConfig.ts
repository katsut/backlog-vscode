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
}
