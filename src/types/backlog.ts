// Essential types for nulab-vscode extension
// Entity types are directly imported from backlog-js where needed

import { Backlog } from 'backlog-js';

// Document sync mapping
export interface DocumentSyncMapping {
  /** ワークスペースからの相対パス */
  localPath: string;
  /** Backlog プロジェクトキー */
  projectKey: string;
  /** マッピング先の Backlog ドキュメントノード ID */
  documentNodeId: string;
  /** ドキュメントノード名 (表示用) */
  documentNodeName?: string;
}

// Document sync manifest
export interface SyncManifestEntry {
  backlog_id: string;
  backlog_path: string;
  project: string;
  synced_at: string;
  remote_updated_at: string;
  content_hash: string;
}

export type SyncManifest = Record<string, SyncManifestEntry>;

export type SyncStatus =
  | 'unchanged'
  | 'local_modified'
  | 'remote_modified'
  | 'conflict'
  | 'new_local'
  | 'not_synced';

export interface SyncStatusEntry {
  relativePath: string;
  status: SyncStatus;
  manifestEntry?: SyncManifestEntry;
  localHash?: string;
  remoteUpdatedAt?: string;
}

// Service state types for better type safety
export interface UninitializedBacklogService {
  readonly state: 'uninitialized';
  readonly error?: Error;
}

export interface InitializedBacklogService {
  readonly state: 'initialized';
  readonly backlog: Backlog;
  readonly host: string;
}

export interface InitializingBacklogService {
  readonly state: 'initializing';
  readonly initializationPromise: Promise<InitializedBacklogService>;
}

export type BacklogServiceState =
  | UninitializedBacklogService
  | InitializingBacklogService
  | InitializedBacklogService;

// Type guards for service state
export function isInitialized(service: BacklogServiceState): service is InitializedBacklogService {
  return service.state === 'initialized';
}

export function isInitializing(
  service: BacklogServiceState
): service is InitializingBacklogService {
  return service.state === 'initializing';
}

export function isUninitialized(
  service: BacklogServiceState
): service is UninitializedBacklogService {
  return service.state === 'uninitialized';
}
