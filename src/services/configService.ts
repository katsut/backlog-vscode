import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentSyncMapping } from '../types/backlog';
import { CacooSyncMapping, CacooPinnedSheet } from '../types/cacoo';
export class ConfigService {
  private readonly configSection = 'nulab';
  private readonly secretStorage: vscode.SecretStorage;
  private readonly globalState: vscode.Memento;

  /** File names under .nulab/ for workspace-local data */
  private static readonly FILE_DOC_SYNC_MAPPINGS = 'document-sync-mappings.json';
  private static readonly FILE_SLACK_SEARCH_KEYWORDS = 'slack-search-keywords.json';

  constructor(secretStorage: vscode.SecretStorage, globalState: vscode.Memento) {
    this.secretStorage = secretStorage;
    this.globalState = globalState;
  }

  // ---- .nulab/ file helpers ----

  private getNulabDir(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return undefined;
    }
    return path.join(root, '.nulab');
  }

  private readJsonFile<T>(fileName: string, fallback: T): T {
    const dir = this.getNulabDir();
    if (!dir) {
      return fallback;
    }
    const filePath = path.join(dir, fileName);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return fallback;
    }
  }

  private writeJsonFile<T>(fileName: string, data: T): void {
    const dir = this.getNulabDir();
    if (!dir) {
      return;
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  /** Legacy key mapping for migration from old key names */
  private static readonly LEGACY_KEY_MAP: Record<string, string> = {
    'nulab.backlog.apiKey': 'backlog.apiKey',
    'nulab.cacoo.apiKey': 'cacoo.apiKey',
    'nulab.slack.token': 'slack.token',
  };

  /** Get a secret with globalState fallback (survives extension reinstall) */
  private async getSecret(key: string): Promise<string | undefined> {
    const value = await this.secretStorage.get(key);
    if (value) {
      return value;
    }
    // Fallback: globalState survives reinstall
    const fallback = this.globalState.get<string>(`secret.${key}`);
    if (fallback) {
      // Restore to SecretStorage
      await this.secretStorage.store(key, fallback);
      return fallback;
    }
    // Migrate from legacy key names (backlog.apiKey → nulab.backlog.apiKey etc.)
    const legacyKey = ConfigService.LEGACY_KEY_MAP[key];
    if (legacyKey) {
      const legacyValue =
        (await this.secretStorage.get(legacyKey)) ||
        this.globalState.get<string>(`secret.${legacyKey}`);
      if (legacyValue) {
        await this.setSecret(key, legacyValue);
        // Clean up old keys
        await this.secretStorage.delete(legacyKey);
        await this.globalState.update(`secret.${legacyKey}`, undefined);
        return legacyValue;
      }
    }
    return undefined;
  }

  /** Store a secret in both SecretStorage and globalState */
  private async setSecret(key: string, value: string): Promise<void> {
    await this.secretStorage.store(key, value);
    await this.globalState.update(`secret.${key}`, value);
  }

  getDomain(): string | undefined {
    return vscode.workspace.getConfiguration(this.configSection).get<string>('backlog.domain');
  }

  async getApiKey(): Promise<string | undefined> {
    // Try to get from Secret Storage first (secure)
    const secretKey = await this.getSecret('nulab.backlog.apiKey');
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
      vscode.window.showInformationMessage('[Nulab] API Key has been migrated to secure storage.');
      return legacyKey;
    }

    return undefined;
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

  async setDomain(domain: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('backlog.domain', domain, vscode.ConfigurationTarget.Global);
  }

  async setApiKey(apiKey: string): Promise<void> {
    // Store in Secret Storage (secure)
    await this.setSecret('nulab.backlog.apiKey', apiKey);
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
      await vscode.workspace
        .getConfiguration(this.configSection)
        .update('backlog.favoriteProjects', favorites, vscode.ConfigurationTarget.Global);
      return false;
    } else {
      favorites.push(projectKey);
      await vscode.workspace
        .getConfiguration(this.configSection)
        .update('backlog.favoriteProjects', favorites, vscode.ConfigurationTarget.Global);
      return true;
    }
  }

  getDocumentSyncMappings(): DocumentSyncMapping[] {
    return this.readJsonFile<DocumentSyncMapping[]>(ConfigService.FILE_DOC_SYNC_MAPPINGS, []);
  }

  getMappingForProject(projectKey: string): DocumentSyncMapping | undefined {
    return this.getDocumentSyncMappings().find((m) => m.projectKey === projectKey);
  }

  addDocumentSyncMapping(mapping: DocumentSyncMapping): void {
    const mappings = this.getDocumentSyncMappings();
    const idx = mappings.findIndex(
      (m) => m.projectKey === mapping.projectKey && m.documentNodeId === mapping.documentNodeId
    );
    if (idx >= 0) {
      mappings[idx] = mapping;
    } else {
      mappings.push(mapping);
    }
    this.writeJsonFile(ConfigService.FILE_DOC_SYNC_MAPPINGS, mappings);
  }

  removeDocumentSyncMapping(projectKey: string, documentNodeId: string): void {
    const mappings = this.getDocumentSyncMappings().filter(
      (m) => !(m.projectKey === projectKey && m.documentNodeId === documentNodeId)
    );
    this.writeJsonFile(ConfigService.FILE_DOC_SYNC_MAPPINGS, mappings);
  }

  // ---- Cacoo ----

  async getCacooApiKey(): Promise<string | undefined> {
    return await this.getSecret('nulab.cacoo.apiKey');
  }

  async setCacooApiKey(apiKey: string): Promise<void> {
    await this.setSecret('nulab.cacoo.apiKey', apiKey);
  }

  getCacooOrganizationKey(): string | undefined {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<string>('cacoo.organizationKey');
  }

  async setCacooOrganizationKey(key: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('cacoo.organizationKey', key, vscode.ConfigurationTarget.Global);
  }

  getCacooSyncMappings(): CacooSyncMapping[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<CacooSyncMapping[]>('cacoo.syncMappings', []);
  }

  async addCacooSyncMapping(mapping: CacooSyncMapping): Promise<void> {
    const mappings = this.getCacooSyncMappings();
    const idx = mappings.findIndex((m) => m.folderId === mapping.folderId);
    if (idx >= 0) {
      mappings[idx] = mapping;
    } else {
      mappings.push(mapping);
    }
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('cacoo.syncMappings', mappings, vscode.ConfigurationTarget.Workspace);
  }

  async removeCacooSyncMapping(folderId: number): Promise<void> {
    const mappings = this.getCacooSyncMappings().filter((m) => m.folderId !== folderId);
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('cacoo.syncMappings', mappings, vscode.ConfigurationTarget.Workspace);
  }

  getCacooPinnedSheets(): CacooPinnedSheet[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<CacooPinnedSheet[]>('cacoo.pinnedSheets', []);
  }

  isCacooPinnedSheet(diagramId: string, sheetUid: string): boolean {
    return this.getCacooPinnedSheets().some(
      (s) => s.diagramId === diagramId && s.sheetUid === sheetUid
    );
  }

  async toggleCacooPinnedSheet(sheet: CacooPinnedSheet): Promise<boolean> {
    const pins = this.getCacooPinnedSheets();
    const idx = pins.findIndex(
      (s) => s.diagramId === sheet.diagramId && s.sheetUid === sheet.sheetUid
    );
    if (idx >= 0) {
      pins.splice(idx, 1);
      await vscode.workspace
        .getConfiguration(this.configSection)
        .update('cacoo.pinnedSheets', pins, vscode.ConfigurationTarget.Global);
      return false;
    } else {
      pins.push(sheet);
      await vscode.workspace
        .getConfiguration(this.configSection)
        .update('cacoo.pinnedSheets', pins, vscode.ConfigurationTarget.Global);
      return true;
    }
  }

  // ---- Slack ----

  async getSlackToken(): Promise<string | undefined> {
    return await this.getSecret('nulab.slack.token');
  }

  async setSlackToken(token: string): Promise<void> {
    await this.setSecret('nulab.slack.token', token);
  }

  // ---- Workspace Polling ----

  getNotificationPollingInterval(): number {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number>('backlog.notificationPollingInterval', 60);
  }

  getSlackPollingInterval(): number {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number>('slack.pollingInterval', 180);
  }

  // ---- Auto TODO ----

  isBacklogAutoTodoEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('backlog.autoTodoEnabled', false);
  }

  getAutoTodoReasons(): number[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<number[]>('backlog.autoTodoReasons', [1, 2, 9, 10]);
  }

  isSlackIncludeDMs(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('slack.includeDMs', true);
  }

  isSlackAutoTodoEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('slack.autoTodoEnabled', false);
  }

  isSlackAutoTodoDMs(): boolean {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<boolean>('slack.autoTodoDMs', false);
  }

  getSlackSearchKeywords(): string[] {
    return this.readJsonFile<string[]>(ConfigService.FILE_SLACK_SEARCH_KEYWORDS, []);
  }

  setSlackSearchKeywords(keywords: string[]): void {
    this.writeJsonFile(ConfigService.FILE_SLACK_SEARCH_KEYWORDS, keywords);
  }

  // ---- Google (OAuth) ----

  async getGoogleClientSecret(): Promise<string | undefined> {
    return await this.getSecret('nulab.google.clientSecret');
  }

  async setGoogleClientSecret(secret: string): Promise<void> {
    await this.setSecret('nulab.google.clientSecret', secret);
  }

  async getGoogleRefreshToken(): Promise<string | undefined> {
    return await this.getSecret('nulab.google.refreshToken');
  }

  async setGoogleRefreshToken(token: string): Promise<void> {
    await this.setSecret('nulab.google.refreshToken', token);
  }

  async clearGoogleTokens(): Promise<void> {
    await this.setSecret('nulab.google.refreshToken', '');
  }

  getGoogleClientId(): string | undefined {
    return vscode.workspace.getConfiguration(this.configSection).get<string>('google.clientId');
  }

  getGoogleCalendarId(): string {
    return (
      vscode.workspace.getConfiguration(this.configSection).get<string>('google.calendarId') ||
      'primary'
    );
  }
}
