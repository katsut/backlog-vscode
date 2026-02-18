import * as https from 'https';
import { ConfigService } from './configService';
import {
  CacooServiceState,
  InitializedCacooService,
  CacooOrganization,
  CacooFolder,
  CacooDiagram,
  CacooDiagramDetail,
  CacooDiagramsResponse,
} from '../types/cacoo';

interface DiagramListOptions {
  folderId?: number;
  type?: string;
  sortOn?: string;
  sortType?: string;
  limit?: number;
  offset?: number;
  keyword?: string;
}

export class CacooApiService {
  private serviceState: CacooServiceState;

  constructor(private configService: ConfigService) {
    this.serviceState = { state: 'uninitialized' };
  }

  private async initializeService(): Promise<InitializedCacooService> {
    const apiKey = await this.configService.getCacooApiKey();
    const organizationKey = this.configService.getCacooOrganizationKey();

    if (!apiKey) {
      throw new Error('Cacoo API Key is not configured');
    }
    if (!organizationKey) {
      throw new Error('Cacoo Organization Key is not configured');
    }

    return { state: 'initialized', apiKey, organizationKey };
  }

  private async ensureInitialized(): Promise<InitializedCacooService> {
    if (this.serviceState.state === 'initialized') {
      return this.serviceState;
    }
    if (this.serviceState.state === 'initializing') {
      return await this.serviceState.initializationPromise;
    }

    const initializationPromise = this.initializeService();
    this.serviceState = { state: 'initializing', initializationPromise };

    try {
      const initialized = await initializationPromise;
      this.serviceState = initialized;
      return initialized;
    } catch (error) {
      this.serviceState = { state: 'uninitialized', error: error as Error };
      throw error;
    }
  }

  async isConfigured(): Promise<boolean> {
    const apiKey = await this.configService.getCacooApiKey();
    const orgKey = this.configService.getCacooOrganizationKey();
    return !!(apiKey && orgKey);
  }

  async reinitialize(): Promise<void> {
    this.serviceState = { state: 'uninitialized' };
    await this.ensureInitialized();
  }

  // ---- API Methods ----

  async getOrganizations(): Promise<CacooOrganization[]> {
    const { apiKey } = await this.ensureInitialized();
    const data = await this.apiGet<{ result: CacooOrganization[] }>(
      '/api/v1/organizations.json',
      { apiKey }
    );
    return data.result || [];
  }

  async getFolders(): Promise<CacooFolder[]> {
    const { apiKey, organizationKey } = await this.ensureInitialized();
    const data = await this.apiGet<{ result: CacooFolder[] }>(
      '/api/v1/folders.json',
      { apiKey, organizationKey }
    );
    return data.result || [];
  }

  async getDiagrams(opts: DiagramListOptions = {}): Promise<CacooDiagramsResponse> {
    const { apiKey, organizationKey } = await this.ensureInitialized();
    const params: Record<string, string> = { apiKey, organizationKey };

    if (opts.folderId !== undefined) { params.folderId = String(opts.folderId); }
    if (opts.type) { params.type = opts.type; }
    if (opts.sortOn) { params.sortOn = opts.sortOn; }
    if (opts.sortType) { params.sortType = opts.sortType; }
    if (opts.limit !== undefined) { params.limit = String(opts.limit); }
    if (opts.offset !== undefined) { params.offset = String(opts.offset); }
    if (opts.keyword) { params.keyword = opts.keyword; }

    return await this.apiGet<CacooDiagramsResponse>(
      '/api/v1/diagrams.json',
      params
    );
  }

  async getDiagramDetail(diagramId: string): Promise<CacooDiagramDetail> {
    const { apiKey } = await this.ensureInitialized();
    return await this.apiGet<CacooDiagramDetail>(
      `/api/v1/diagrams/${encodeURIComponent(diagramId)}.json`,
      { apiKey }
    );
  }

  async downloadSheetImage(
    diagramId: string,
    sheetUid?: string,
    width?: number,
    height?: number
  ): Promise<Buffer> {
    const { apiKey } = await this.ensureInitialized();
    const pathPart = sheetUid
      ? `/api/v1/diagrams/${encodeURIComponent(diagramId)}-${encodeURIComponent(sheetUid)}.png`
      : `/api/v1/diagrams/${encodeURIComponent(diagramId)}.png`;

    const params: Record<string, string> = { apiKey };
    if (width) { params.width = String(width); }
    if (height) { params.height = String(height); }

    return await this.downloadBinary(pathPart, params);
  }

  // ---- HTTP Helpers ----

  private apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams(params).toString();
    const url = `https://cacoo.com${path}?${query}`;

    return new Promise<T>((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Cacoo API error: HTTP ${response.statusCode} for ${path}`));
          response.resume();
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(new Error(`Failed to parse Cacoo API response: ${error}`));
          }
        });
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Cacoo API request timeout'));
      });
    });
  }

  private downloadBinary(path: string, params: Record<string, string>): Promise<Buffer> {
    const query = new URLSearchParams(params).toString();
    const url = `https://cacoo.com${path}?${query}`;

    return new Promise<Buffer>((resolve, reject) => {
      const request = https.get(url, (response) => {
        // Follow redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            response.resume();
            this.downloadFromUrl(redirectUrl).then(resolve, reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Cacoo download error: HTTP ${response.statusCode}`));
          response.resume();
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Cacoo download timeout'));
      });
    });
  }

  private downloadFromUrl(url: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          response.resume();
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }
}
