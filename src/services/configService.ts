import * as vscode from 'vscode';
import { DocumentSyncMapping } from '../types/backlog';
import { CacooSyncMapping, CacooPinnedSheet } from '../types/cacoo';

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

  getFavoriteProjects(): string[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<string[]>('favoriteProjects', []);
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
        .update('favoriteProjects', favorites, vscode.ConfigurationTarget.Global);
      return false;
    } else {
      favorites.push(projectKey);
      await vscode.workspace
        .getConfiguration(this.configSection)
        .update('favoriteProjects', favorites, vscode.ConfigurationTarget.Global);
      return true;
    }
  }

  getDocumentSyncMappings(): DocumentSyncMapping[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<DocumentSyncMapping[]>('documentSync.mappings', []);
  }

  getMappingForProject(projectKey: string): DocumentSyncMapping | undefined {
    return this.getDocumentSyncMappings().find((m) => m.projectKey === projectKey);
  }

  async addDocumentSyncMapping(mapping: DocumentSyncMapping): Promise<void> {
    const mappings = this.getDocumentSyncMappings();
    // 同じプロジェクト+ノードの既存マッピングを置換
    const idx = mappings.findIndex(
      (m) => m.projectKey === mapping.projectKey && m.documentNodeId === mapping.documentNodeId
    );
    if (idx >= 0) {
      mappings[idx] = mapping;
    } else {
      mappings.push(mapping);
    }
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('documentSync.mappings', mappings, vscode.ConfigurationTarget.Workspace);
  }

  async removeDocumentSyncMapping(projectKey: string, documentNodeId: string): Promise<void> {
    const mappings = this.getDocumentSyncMappings().filter(
      (m) => !(m.projectKey === projectKey && m.documentNodeId === documentNodeId)
    );
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('documentSync.mappings', mappings, vscode.ConfigurationTarget.Workspace);
  }

  // ---- Cacoo ----

  async getCacooApiKey(): Promise<string | undefined> {
    return await this.secretStorage.get('cacoo.apiKey');
  }

  async setCacooApiKey(apiKey: string): Promise<void> {
    await this.secretStorage.store('cacoo.apiKey', apiKey);
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
}
