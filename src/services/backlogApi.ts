import * as vscode from 'vscode';
import * as https from 'https';
import { Backlog, Entity, Option } from 'backlog-js';
import { ConfigService } from './configService';
import { BacklogServiceState, isInitialized, isInitializing } from '../types/backlog';

// Backlog.jsの型を使用した初期化済みサービス
interface InitializedBacklogService {
  readonly state: 'initialized';
  readonly backlog: Backlog;
  readonly host: string;
}

export class BacklogApiService {
  private serviceState: BacklogServiceState;
  private configService: ConfigService;
  private outputChannel: vscode.OutputChannel;

  constructor(configService: ConfigService) {
    this.configService = configService;
    // VS Code Output Channel for debugging
    this.outputChannel = vscode.window.createOutputChannel('Backlog Extension Debug');
    // 初期状態は未初期化
    this.serviceState = { state: 'uninitialized' };
    // 同期的に基本設定をチェック
    this.checkInitialConfiguration();
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    this.outputChannel.appendLine(logMessage);
  }

  private async downloadFromUrl(url: string): Promise<Buffer> {
    this.log(`Starting download from URL: ${url}`);

    return new Promise<Buffer>((resolve, reject) => {
      const request = https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const chunks: Buffer[] = [];
        let totalLength = 0;

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          totalLength += chunk.length;
        });

        response.on('end', () => {
          const buffer = Buffer.concat(chunks, totalLength);
          this.log(`Download completed, size: ${buffer.length} bytes`);
          resolve(buffer);
        });

        response.on('error', (error) => {
          this.log(`Download response error: ${error}`);
          reject(error);
        });
      });

      request.on('error', (error) => {
        this.log(`Download request error: ${error}`);
        reject(error);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout after 30 seconds'));
      });
    });
  }

  private checkInitialConfiguration(): void {
    const domain = this.configService.getDomain();

    if (!domain) {
      this.serviceState = {
        state: 'uninitialized',
        error: new Error('Backlog domain is not configured'),
      };
    }
  }

  private async initializeService(): Promise<InitializedBacklogService> {
    const domain = this.configService.getDomain();
    const apiKey = await this.configService.getApiKey();

    if (!domain) {
      throw new Error('Backlog domain is not configured');
    }

    if (!apiKey) {
      throw new Error('API Key is not configured');
    }

    try {
      // backlog-jsにはホスト名のみを渡す必要がある（プロトコルなし）
      let hostOnly = domain;
      if (hostOnly.startsWith('https://')) {
        hostOnly = hostOnly.replace('https://', '');
      }
      if (hostOnly.startsWith('http://')) {
        hostOnly = hostOnly.replace('http://', '');
      }
      // パスの部分も削除
      hostOnly = hostOnly.split('/')[0];

      const backlog = new Backlog({
        host: hostOnly,
        apiKey: apiKey,
      });

      return {
        state: 'initialized',
        backlog,
        host: hostOnly,
      };
    } catch (error) {
      console.error('Failed to initialize Backlog API:', error instanceof Error ? error.message : error);
      vscode.window.showErrorMessage(`Failed to initialize Backlog API: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<InitializedBacklogService> {
    if (isInitialized(this.serviceState)) {
      return this.serviceState;
    }

    if (isInitializing(this.serviceState)) {
      return await this.serviceState.initializationPromise;
    }

    // 初期化を開始
    const initializationPromise = this.initializeService();
    this.serviceState = {
      state: 'initializing',
      initializationPromise,
    };

    try {
      const initializedService = await initializationPromise;
      this.serviceState = initializedService;
      return initializedService;
    } catch (error) {
      this.serviceState = {
        state: 'uninitialized',
        error: error as Error,
      };
      throw error;
    }
  }


  async getProjects(): Promise<Entity.Project.Project[]> {
    try {
      const initializedService = await this.ensureInitialized();
      const response = await initializedService.backlog.getProjects();
      return response || [];
    } catch (error) {
      console.error('Failed to fetch projects:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  async getProjectIssues(projectId: number, options: Option.Issue.GetIssuesParams = {}): Promise<Entity.Issue.Issue[]> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.getIssues({
      projectId: [projectId],
      ...options,
    });
    return response || [];
  }

  async getIssue(issueId: number): Promise<Entity.Issue.Issue> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.getIssue(issueId);
    return response;
  }

  async getIssueComments(issueId: number): Promise<Entity.Issue.Comment[]> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.getIssueComments(issueId, {});
    return response || [];
  }

  async getUser(): Promise<Entity.User.User> {
    const initializedService = await this.ensureInitialized();
    return await initializedService.backlog.getMyself();
  }

  async getWikiPages(projectId: number): Promise<Entity.Wiki.WikiListItem[]> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.getWikis({
      projectIdOrKey: projectId,
    });
    return response || [];
  }

  async getWiki(wikiId: number): Promise<Entity.Wiki.Wiki> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.getWiki(wikiId);
    return response;
  }

  async getDocuments(projectId: number): Promise<Entity.Document.DocumentTree> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.getDocumentTree(projectId);
    return response;
  }

  async getDocument(documentId: string): Promise<Entity.Document.Document> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.getDocument(documentId);
    return response;
  }

  async downloadDocumentAttachment(documentId: string, attachmentId: number): Promise<Buffer> {
    const initializedService = await this.ensureInitialized();

    try {
      const response = await initializedService.backlog.downloadDocumentAttachment(documentId, attachmentId);

      // Backlog APIは常に {body: {}, url: "...", filename: "..."} 形式を返す
      if (response && typeof response === 'object' && 'url' in response && typeof response.url === 'string') {
        return await this.downloadFromUrl(response.url);
      }

      throw new Error(`Unexpected response format from Backlog API`);
    } catch (error) {
      throw new Error(`Failed to download attachment ${attachmentId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async reinitialize(): Promise<void> {
    // 状態をリセットして再初期化
    this.serviceState = { state: 'uninitialized' };
    this.checkInitialConfiguration();

    // 新しい初期化を強制実行
    await this.ensureInitialized();
  }

  async isConfigured(): Promise<boolean> {
    return await this.configService.isConfigured();
  }
}
