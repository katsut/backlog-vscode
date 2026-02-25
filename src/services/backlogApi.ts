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

  constructor(configService: ConfigService) {
    this.configService = configService;
    this.serviceState = { state: 'uninitialized' };
    this.checkInitialConfiguration();
  }

  private async downloadFromUrl(url: string): Promise<Buffer> {
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
          resolve(buffer);
        });

        response.on('error', (error) => {
          reject(error);
        });
      });

      request.on('error', (error) => {
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
      console.error(
        'Failed to initialize Backlog API:',
        error instanceof Error ? error.message : error
      );
      vscode.window.showErrorMessage(
        `[Nulab] Failed to initialize Backlog API: ${
          error instanceof Error ? error.message : error
        }`
      );
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

  async getProjectIssues(
    projectId: number,
    options: Option.Issue.GetIssuesParams = {}
  ): Promise<Entity.Issue.Issue[]> {
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

  async postIssueComment(
    issueIdOrKey: string | number,
    params: { content: string; notifiedUserId?: number[] }
  ): Promise<Entity.Issue.Comment> {
    const initializedService = await this.ensureInitialized();
    return await initializedService.backlog.postIssueComments(issueIdOrKey, params);
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
      const response = await initializedService.backlog.downloadDocumentAttachment(
        documentId,
        attachmentId
      );

      // Backlog APIは常に {body: {}, url: "...", filename: "..."} 形式を返す
      if (
        response &&
        typeof response === 'object' &&
        'url' in response &&
        typeof response.url === 'string'
      ) {
        return await this.downloadFromUrl(response.url);
      }

      throw new Error(`Unexpected response format from Backlog API`);
    } catch (error) {
      throw new Error(
        `Failed to download attachment ${attachmentId}: ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }

  async postDocument(params: {
    projectId: number;
    title: string;
    content: string;
    emoji?: string;
    parentId?: string;
    addLast?: boolean;
  }): Promise<Entity.Document.Document> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.post<Entity.Document.Document>(
      '/api/v2/documents',
      params as unknown as Record<string, string | number | string[] | number[]>
    );
    return response;
  }

  async deleteDocument(documentId: string): Promise<Entity.Document.Document> {
    const initializedService = await this.ensureInitialized();
    const response = await initializedService.backlog.delete<Entity.Document.Document>(
      `/api/v2/documents/${documentId}`
    );
    return response;
  }

  async getDocumentSubtree(
    projectId: number,
    rootNodeId: string
  ): Promise<Array<Entity.Document.DocumentTreeNode & { _treePath: string[] }>> {
    const initializedService = await this.ensureInitialized();
    const tree = await initializedService.backlog.getDocumentTree(projectId);
    const children = tree.activeTree?.children || [];
    const rootNode = this.findNodeById(children, rootNodeId);
    if (!rootNode) {
      throw new Error(`Document node ${rootNodeId} not found in project tree`);
    }

    // Root node itself is handled separately by the caller (as index.bdoc).
    // Here we only return its descendants.
    const results: Array<Entity.Document.DocumentTreeNode & { _treePath: string[] }> = [];
    if (rootNode.children) {
      for (const child of rootNode.children) {
        results.push(...this.flattenTree(child, []));
      }
    }
    return results;
  }

  private findNodeById(
    nodes: Entity.Document.DocumentTreeNode[],
    targetId: string
  ): Entity.Document.DocumentTreeNode | null {
    for (const node of nodes) {
      if (node.id === targetId) {
        return node;
      }
      if (node.children && node.children.length > 0) {
        const found = this.findNodeById(node.children, targetId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  private flattenTree(
    node: Entity.Document.DocumentTreeNode,
    parentPath: string[]
  ): Array<Entity.Document.DocumentTreeNode & { _treePath: string[] }> {
    const results: Array<Entity.Document.DocumentTreeNode & { _treePath: string[] }> = [];
    const hasChildren = node.children && node.children.length > 0;

    // ノード自体を追加（Active/Trash ルートを除く）
    if (node.id !== 'Active' && node.id !== 'Trash') {
      results.push(Object.assign({}, node, { _treePath: parentPath }));
    }

    if (node.children) {
      const childPath =
        node.id !== 'Active' && node.id !== 'Trash' && hasChildren
          ? [...parentPath, node.name || node.id]
          : parentPath;
      for (const child of node.children) {
        results.push(...this.flattenTree(child, childPath));
      }
    }

    return results;
  }

  // ---- My Tasks (cross-project) ----

  async getMyIssuesAcrossProjects(): Promise<Entity.Issue.Issue[]> {
    const initializedService = await this.ensureInitialized();
    const myself = await initializedService.backlog.getMyself();
    const response = await initializedService.backlog.getIssues({
      assigneeId: [myself.id],
      statusId: [1, 2, 3], // Open, In Progress, Resolved (exclude Closed=4)
      count: 100,
      sort: 'updated',
      order: 'desc',
    });
    return response || [];
  }

  // ---- Notifications ----

  async getNotifications(params?: { count?: number; order?: 'asc' | 'desc' }): Promise<any[]> {
    const initializedService = await this.ensureInitialized();
    const response = await (initializedService.backlog as any).getNotifications(params || {});
    return response || [];
  }

  async getNotificationsCount(): Promise<number> {
    const initializedService = await this.ensureInitialized();
    const result = await (initializedService.backlog as any).getNotificationsCount({
      alreadyRead: false,
      resourceAlreadyRead: false,
    });
    return result?.count || 0;
  }

  async markNotificationAsRead(id: number): Promise<void> {
    const initializedService = await this.ensureInitialized();
    await (initializedService.backlog as any).markAsReadNotification(id);
  }

  async markAllNotificationsAsRead(): Promise<void> {
    const initializedService = await this.ensureInitialized();
    await (initializedService.backlog as any).resetNotificationsMarkAsRead();
  }

  /**
   * Download an image from a Backlog URL (relative or absolute) and return as data URL.
   * Uses Document Attachment API for /document/backend/ URLs, apiKey param for others.
   */
  async downloadImageAsDataUrl(imageUrl: string): Promise<string | null> {
    try {
      const initializedService = await this.ensureInitialized();

      // Check if this is a document backend URL: /document/backend/{project}/{docId}/file/{attachmentId}
      const docBackendMatch = imageUrl.match(/\/document\/backend\/[^/]+\/([^/]+)\/file\/(\d+)/);
      if (docBackendMatch) {
        const docId = docBackendMatch[1];
        const attachmentId = Number(docBackendMatch[2]);
        const buffer = await this.downloadDocumentAttachment(docId, attachmentId);
        const mime = this.detectMimeFromBuffer(buffer);
        return `data:${mime};base64,${buffer.toString('base64')}`;
      }

      // Generic URL download with apiKey
      const apiKey = await this.configService.getApiKey();
      if (!apiKey) {
        return null;
      }

      let fullUrl: string;
      if (imageUrl.startsWith('http')) {
        const separator = imageUrl.includes('?') ? '&' : '?';
        fullUrl = `${imageUrl}${separator}apiKey=${apiKey}`;
      } else {
        fullUrl = `https://${initializedService.host}${imageUrl}?apiKey=${apiKey}`;
      }

      const buffer = await this.downloadFromUrl(fullUrl);
      const mime = this.detectMimeFromBuffer(buffer);
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (error) {
      console.error(`Failed to download image: ${imageUrl}`, error);
      return null;
    }
  }

  private detectMimeFromBuffer(buf: Buffer): string {
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      return 'image/png';
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      return 'image/jpeg';
    }
    if (buf[0] === 0x47 && buf[1] === 0x49) {
      return 'image/gif';
    }
    if (buf[0] === 0x52 && buf[1] === 0x49) {
      return 'image/webp';
    }
    return 'image/png'; // fallback
  }

  /**
   * Resolve all Backlog image URLs in markdown content to data URLs.
   * Scans for ![...](url) patterns where url points to the Backlog host.
   */
  async resolveBacklogImages(markdown: string): Promise<string> {
    const initializedService = await this.ensureInitialized();
    const host = initializedService.host;

    // Match markdown image patterns: ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const replacements: { full: string; alt: string; url: string; dataUrl: string | null }[] = [];

    let match;
    while ((match = imageRegex.exec(markdown)) !== null) {
      const [full, alt, url] = match;
      // Check if URL is a Backlog URL (relative or matching host)
      const isBacklogUrl =
        url.startsWith('/document/') ||
        url.startsWith('/api/v2/') ||
        url.startsWith('/downloadAttachment/') ||
        url.includes(host);

      if (isBacklogUrl) {
        replacements.push({ full, alt, url, dataUrl: null });
      }
    }

    if (replacements.length === 0) {
      return markdown;
    }

    // Download all images in parallel
    await Promise.all(
      replacements.map(async (r) => {
        r.dataUrl = await this.downloadImageAsDataUrl(r.url);
      })
    );

    // Replace in content
    let result = markdown;
    for (const r of replacements) {
      if (r.dataUrl) {
        result = result.replace(r.full, `![${r.alt}](${r.dataUrl})`);
      }
    }
    return result;
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
