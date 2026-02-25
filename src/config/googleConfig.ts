import * as vscode from 'vscode';
import { SecretsConfig } from './secretsConfig';

/**
 * Google-specific configuration: OAuth client, calendar, tokens.
 */
export class GoogleConfig {
  private readonly configSection = 'nulab';

  constructor(private readonly secrets: SecretsConfig) {}

  getClientId(): string | undefined {
    return vscode.workspace.getConfiguration(this.configSection).get<string>('google.clientId');
  }

  getCalendarId(): string {
    return (
      vscode.workspace.getConfiguration(this.configSection).get<string>('google.calendarId') ||
      'primary'
    );
  }

  async getClientSecret(): Promise<string | undefined> {
    return await this.secrets.getSecret('nulab.google.clientSecret');
  }

  async setClientSecret(secret: string): Promise<void> {
    await this.secrets.setSecret('nulab.google.clientSecret', secret);
  }

  async getRefreshToken(): Promise<string | undefined> {
    return await this.secrets.getSecret('nulab.google.refreshToken');
  }

  async setRefreshToken(token: string): Promise<void> {
    await this.secrets.setSecret('nulab.google.refreshToken', token);
  }

  async clearTokens(): Promise<void> {
    await this.secrets.setSecret('nulab.google.refreshToken', '');
  }
}
