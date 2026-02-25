import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentSyncMapping } from '../types/backlog';

/**
 * Handles .nulab/ directory file I/O for workspace-local data.
 */
export class WorkspaceFileStore {
  getNulabDir(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return undefined;
    }
    return path.join(root, '.nulab');
  }

  readJsonFile<T>(fileName: string, fallback: T): T {
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

  writeJsonFile<T>(fileName: string, data: T): void {
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

  // ---- Document Sync Mappings ----

  private static readonly FILE_DOC_SYNC_MAPPINGS = 'document-sync-mappings.json';

  getDocumentSyncMappings(): DocumentSyncMapping[] {
    return this.readJsonFile<DocumentSyncMapping[]>(WorkspaceFileStore.FILE_DOC_SYNC_MAPPINGS, []);
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
    this.writeJsonFile(WorkspaceFileStore.FILE_DOC_SYNC_MAPPINGS, mappings);
  }

  removeDocumentSyncMapping(projectKey: string, documentNodeId: string): void {
    const mappings = this.getDocumentSyncMappings().filter(
      (m) => !(m.projectKey === projectKey && m.documentNodeId === documentNodeId)
    );
    this.writeJsonFile(WorkspaceFileStore.FILE_DOC_SYNC_MAPPINGS, mappings);
  }
}
