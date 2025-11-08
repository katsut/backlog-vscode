import * as vscode from 'vscode';

export class ConfigService {
  private readonly configSection = 'backlog';
  private readonly secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
  }

  getDomain(): string | undefined {
    return vscode.workspace.getConfiguration(this.configSection).get<string>('domain');
  }

  async getApiKey(): Promise<string | undefined> {
    // Try to get from Secret Storage first (secure)
    const secretKey = await this.secretStorage.get('backlog.apiKey');
    if (secretKey) {
      return secretKey;
    }

    // Fallback to old settings.json method for backward compatibility
    const legacyKey = vscode.workspace.getConfiguration(this.configSection).get<string>('apiKey');
    if (legacyKey) {
      // Migrate to Secret Storage and remove from settings
      await this.setApiKey(legacyKey);
      await vscode.workspace
        .getConfiguration(this.configSection)
        .update('apiKey', undefined, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('API Key has been migrated to secure storage.');
      return legacyKey;
    }

    return undefined;
  }

  isAutoRefreshEnabled(): boolean {
    return vscode.workspace.getConfiguration(this.configSection).get<boolean>('autoRefresh', true);
  }

  getRefreshInterval(): number {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number>('refreshInterval', 300);
  }

  async setDomain(domain: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('domain', domain, vscode.ConfigurationTarget.Global);
  }

  async setApiKey(apiKey: string): Promise<void> {
    // Store in Secret Storage (secure)
    await this.secretStorage.store('backlog.apiKey', apiKey);
  }

  async isConfigured(): Promise<boolean> {
    const apiDomain = this.getDomain();
    const apiKey = await this.getApiKey();
    return !!(apiDomain && apiKey);
  }

  getBaseUrl(): string | undefined {
    const apiUrl = this.getDomain();
    if (!apiUrl) {
      return undefined;
    }
    // Remove trailing slash and /api/v2 if present
    return apiUrl.replace(/\/(api\/v2\/?)?$/, '');
  }
}
