// Cacoo API response types

export interface CacooOrganization {
  id: number;
  key: string;
  name: string;
  created: string;
  updated: string;
}

export interface CacooFolder {
  folderId: number;
  folderName: string;
  type: string; // "normal" | "shared"
  created: string;
  updated: string;
}

export interface CacooOwner {
  name: string;
  nickname: string;
  type: string;
  imageUrl: string;
}

export interface CacooDiagram {
  url: string;
  imageUrl: string;
  imageUrlForApi: string;
  diagramId: string;
  title: string;
  description: string;
  security: string; // "private" | "url" | "public"
  type: string; // "normal" | "stencil" | "template"
  owner: CacooOwner;
  editing: boolean;
  own: boolean;
  shared: boolean;
  folderId: number;
  folderName: string;
  sheetCount: number;
  created: string;
  updated: string;
}

export interface CacooSheet {
  url: string;
  imageUrl: string;
  imageUrlForApi: string;
  width: number;
  height: number;
  name: string;
  uid: string;
}

export interface CacooDiagramDetail extends CacooDiagram {
  sheets: CacooSheet[];
}

export interface CacooDiagramsResponse {
  result: CacooDiagram[];
  count: number;
}

// Sync mapping
export interface CacooSyncMapping {
  /** ワークスペースからの相対パス */
  localPath: string;
  /** Cacoo Organization Key */
  organizationKey: string;
  /** Cacoo Folder ID */
  folderId: number;
  /** フォルダ名 (表示用) */
  folderName: string;
}

// Sync manifest
export interface CacooSyncManifestEntry {
  diagramId: string;
  sheetUid: string;
  sheetName: string;
  diagramTitle: string;
  synced_at: string;
  remote_updated_at: string;
  content_hash: string;
}

export type CacooSyncManifest = Record<string, CacooSyncManifestEntry>;

// Pinned sheets (local favorites)
export interface CacooPinnedSheet {
  diagramId: string;
  sheetUid: string;
  label: string; // "DiagramTitle / SheetName"
}

// Service state types
export interface UninitializedCacooService {
  readonly state: 'uninitialized';
  readonly error?: Error;
}

export interface InitializedCacooService {
  readonly state: 'initialized';
  readonly apiKey: string;
  readonly organizationKey: string;
}

export interface InitializingCacooService {
  readonly state: 'initializing';
  readonly initializationPromise: Promise<InitializedCacooService>;
}

export type CacooServiceState =
  | UninitializedCacooService
  | InitializingCacooService
  | InitializedCacooService;
