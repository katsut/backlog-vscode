import * as vscode from 'vscode';

/**
 * Manages secret storage with globalState fallback and legacy key migration.
 */
export class SecretsConfig {
  private static readonly LEGACY_KEY_MAP: Record<string, string> = {
    'nulab.backlog.apiKey': 'backlog.apiKey',
    'nulab.cacoo.apiKey': 'cacoo.apiKey',
    'nulab.slack.token': 'slack.token',
  };

  constructor(
    private readonly secretStorage: vscode.SecretStorage,
    private readonly globalState: vscode.Memento
  ) {}

  async getSecret(key: string): Promise<string | undefined> {
    const value = await this.secretStorage.get(key);
    if (value) {
      return value;
    }
    // Fallback: globalState survives reinstall
    const fallback = this.globalState.get<string>(`secret.${key}`);
    if (fallback) {
      await this.secretStorage.store(key, fallback);
      return fallback;
    }
    // Migrate from legacy key names
    const legacyKey = SecretsConfig.LEGACY_KEY_MAP[key];
    if (legacyKey) {
      const legacyValue =
        (await this.secretStorage.get(legacyKey)) ||
        this.globalState.get<string>(`secret.${legacyKey}`);
      if (legacyValue) {
        await this.setSecret(key, legacyValue);
        await this.secretStorage.delete(legacyKey);
        await this.globalState.update(`secret.${legacyKey}`, undefined);
        return legacyValue;
      }
    }
    return undefined;
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.secretStorage.store(key, value);
    await this.globalState.update(`secret.${key}`, value);
  }
}
