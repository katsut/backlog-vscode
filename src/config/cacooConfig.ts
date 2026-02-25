import * as vscode from 'vscode';
import { SecretsConfig } from './secretsConfig';
import { CacooSyncMapping, CacooPinnedSheet } from '../types/cacoo';

/**
 * Cacoo-specific configuration: API key, organization, sync mappings, pinned sheets.
 */
export class CacooConfig {
  private readonly configSection = 'nulab';

  constructor(private readonly secrets: SecretsConfig) {}

  async getApiKey(): Promise<string | undefined> {
    return await this.secrets.getSecret('nulab.cacoo.apiKey');
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.secrets.setSecret('nulab.cacoo.apiKey', apiKey);
  }

  getOrganizationKey(): string | undefined {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<string>('cacoo.organizationKey');
  }

  async setOrganizationKey(key: string): Promise<void> {
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('cacoo.organizationKey', key, vscode.ConfigurationTarget.Global);
  }

  getSyncMappings(): CacooSyncMapping[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<CacooSyncMapping[]>('cacoo.syncMappings', []);
  }

  async addSyncMapping(mapping: CacooSyncMapping): Promise<void> {
    const mappings = this.getSyncMappings();
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

  async removeSyncMapping(folderId: number): Promise<void> {
    const mappings = this.getSyncMappings().filter((m) => m.folderId !== folderId);
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('cacoo.syncMappings', mappings, vscode.ConfigurationTarget.Workspace);
  }

  getPinnedSheets(): CacooPinnedSheet[] {
    return vscode.workspace
      .getConfiguration(this.configSection)
      .get<CacooPinnedSheet[]>('cacoo.pinnedSheets', []);
  }

  isPinnedSheet(diagramId: string, sheetUid: string): boolean {
    return this.getPinnedSheets().some((s) => s.diagramId === diagramId && s.sheetUid === sheetUid);
  }

  async togglePinnedSheet(sheet: CacooPinnedSheet): Promise<boolean> {
    const pins = this.getPinnedSheets();
    const idx = pins.findIndex(
      (s) => s.diagramId === sheet.diagramId && s.sheetUid === sheet.sheetUid
    );
    if (idx >= 0) {
      pins.splice(idx, 1);
    } else {
      pins.push(sheet);
    }
    await vscode.workspace
      .getConfiguration(this.configSection)
      .update('cacoo.pinnedSheets', pins, vscode.ConfigurationTarget.Global);
    return idx < 0;
  }
}
