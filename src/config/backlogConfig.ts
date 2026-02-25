import * as vscode from 'vscode';
import { SecretsConfig } from './secretsConfig';

/**
 * Backlog-specific configuration: domain, API key, refresh, polling, favorites, auto-TODO.
 */
export class BacklogConfig {
  private readonly configSection = 'nulab';

  constructor(private readonly secrets: SecretsConfig) {}

  getDomain(): string | undefined {
    return vscode.workspace.getConfiguration(this.configSection).get<string>('backlog.domain');
  }

  async setDomain(domain: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('backlog.domain', domain, vscode.ConfigurationTarget.Global);
  }

  async getApiKey(): Promise<string | undefined> {
    const secretKey = await this.secrets.getSecret('nulab.backlog.apiKey');
    if (secretKey) {
      return secretKey;
    }
    // Migrate from legacy settings.json
    const legacyKey = vscode.workspace.getConfiguration(this.configSection).get<string>('apiKey');
    if (legacyKey) {
      await this.setApiKey(legacyKey);
      await vscode.workspace
        .getConfiguration(this.configSection)
        .update('apiKey', undefined, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('[Nulab] API Key has been migrated to secure storage.');
      return legacyKey;
    }
    return undefined;
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.secrets.setSecret('nulab.backlog.apiKey', apiKey);
  }

  async isConfigured(): Promise<boolean> {
    const domain = this.getDomain();
    const apiKey = await this.getApiKey();
    return !!(domain && apiKey);
  }

  getBaseUrl(): string | undefined {
    const apiUrl = this.getDomain();
    if (!apiUrl) {
      return undefined;
    }
    return apiUrl.replace(/\/(api\/v2\/?)?$/, '');
  }

  isAutoRefreshEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('backlog.autoRefresh', true);
  }

  getRefreshInterval(): number {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number>('backlog.refreshInterval', 300);
  }

  getNotificationPollingInterval(): number {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number>('backlog.notificationPollingInterval', 60);
  }

  getFavoriteProjects(): string[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<string[]>('backlog.favoriteProjects', []);
  }

  isFavoriteProject(projectKey: string): boolean {
    return this.getFavoriteProjects().includes(projectKey);
  }

  async toggleFavoriteProject(projectKey: string): Promise<boolean> {
    const favorites = this.getFavoriteProjects();
    const index = favorites.indexOf(projectKey);
    if (index >= 0) {
      favorites.splice(index, 1);
    } else {
      favorites.push(projectKey);
    }
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('backlog.favoriteProjects', favorites, vscode.ConfigurationTarget.Global);
    return index < 0;
  }

  isAutoTodoEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('backlog.autoTodoEnabled', false);
  }

  getAutoTodoReasons(): number[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number[]>('backlog.autoTodoReasons', [1, 2, 9, 10]);
  }
}
