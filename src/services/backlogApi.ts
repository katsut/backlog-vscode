import * as vscode from 'vscode';
import { Backlog, Entity } from 'backlog-js';
import { ConfigService } from './configService';
import { BacklogServiceState, isInitialized, isInitializing } from '../types/backlog';

// Backlog.jsの型を使用した初期化済みサービス
interface InitializedBacklogService {
  readonly state: 'initialized';
  readonly backlog: Backlog;
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
    console.log('=== INITIALIZE SERVICE START ===');
    
    const domain = this.configService.getDomain();
    const apiKey = await this.configService.getApiKey();

    console.log('Initializing Backlog API client...');
    console.log('Domain:', domain || 'NOT CONFIGURED');
    console.log('API Key length:', apiKey ? apiKey.length : 'NOT CONFIGURED');

    if (!domain) {
      throw new Error('Backlog domain is not configured');
    }

    if (!apiKey) {
      throw new Error('API Key is not configured');
    }

    try {
      console.log('=== BACKLOG CLIENT CREATION START ===');
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
      
      console.log('Original domain:', domain);
      console.log('Host for backlog-js:', hostOnly);
      
      const backlog = new Backlog({
        host: hostOnly,
        apiKey: apiKey,
      });
      console.log('Backlog client created successfully with host:', hostOnly);
      console.log('=== BACKLOG CLIENT CREATION END ===');

      console.log('=== INITIALIZE SERVICE END (SUCCESS) ===');
      return {
        state: 'initialized',
        backlog,
      };
    } catch (error) {
      console.error('=== INITIALIZE SERVICE ERROR ===');
      console.error('Error type:', typeof error);
      console.error('Error name:', error instanceof Error ? error.name : 'Unknown');
      console.error('Error message:', error instanceof Error ? error.message : error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      console.error('=== INITIALIZE SERVICE ERROR END ===');
      
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
    console.log('=== getProjects START ===');

    // 初期化完了を待つ
    console.log('Waiting for service initialization...');
    try {
      const initializedService = await this.ensureInitialized();
      console.log('Service initialized successfully');

      console.log('=== API REQUEST DETAILS ===');
      console.log('Backlog client host:', (initializedService.backlog as any).host);
      console.log('API Key present:', !!(initializedService.backlog as any).apiKey);
      console.log('User-Agent:', (initializedService.backlog as any).userAgent || 'Not set');

      console.log('Fetching projects from Backlog API using backlog-js...');
      const response = await initializedService.backlog.getProjects();
      console.log('Projects fetched successfully with backlog-js:', response.length || 0, 'projects');
      console.log('First project data:', response[0] ? JSON.stringify(response[0], null, 2) : 'No projects');
      console.log('=== getProjects END (SUCCESS) ===');
      return response || [];
    } catch (error) {
      console.error('=== getProjects ERROR ===');
      console.error('Error type:', typeof error);
      console.error('Error name:', error instanceof Error ? error.name : 'Unknown');
      console.error('Error message:', error instanceof Error ? error.message : error);
      console.error('Error cause:', (error as any).cause || 'No cause');
      console.error('Error code:', (error as any).code || 'No code');
      console.error('Error errno:', (error as any).errno || 'No errno');
      console.error('Error syscall:', (error as any).syscall || 'No syscall');
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      
      // より詳細なエラー解析
      if (error instanceof Error) {
        if (error.message.includes('fetch failed')) {
          console.error('FETCH FAILED ERROR DETECTED:');
          console.error('This typically indicates:');
          console.error('1. Network connectivity issues');
          console.error('2. DNS resolution problems');
          console.error('3. SSL/TLS certificate issues');
          console.error('4. Server not responding');
          console.error('5. Firewall blocking the request');
          
          // 追加の診断情報
          const apiUrl = this.configService.getDomain();
          if (apiUrl) {
            console.error('Problematic URL:', apiUrl);
            
            try {
              // APIのURLが完全でない場合、httpsを付加して解析
              let testUrl = apiUrl;
              if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
                testUrl = 'https://' + testUrl;
              }
              const url = new URL(testUrl);
              console.error('URL breakdown:');
              console.error('- Protocol:', url.protocol);
              console.error('- Hostname:', url.hostname);
              console.error('- Port:', url.port || (url.protocol === 'https:' ? '443' : '80'));
              console.error('- Pathname:', url.pathname);
            } catch (urlError) {
              console.error('URL parsing failed:', urlError);
            }
          }
        }
      }
      
      console.error('=== getProjects ERROR END ===');
      throw error;
    }
  }

  async getProjectIssues(projectId: number, options?: any): Promise<Entity.Issue.Issue[]> {
    // 初期化完了を待つ
    const initializedService = await this.ensureInitialized();

    console.log('Fetching issues from Backlog API using backlog-js...');
    const response = await initializedService.backlog.getIssues({
      projectId: [projectId],
      ...options,
    });
    console.log('Issues fetched successfully with backlog-js:', response.length || 0, 'issues');
    return response || [];
  }

  async getIssue(issueId: number): Promise<Entity.Issue.Issue> {
    // 初期化完了を待つ
    const initializedService = await this.ensureInitialized();

    console.log('Fetching issue from Backlog API using backlog-js...');
    const response = await initializedService.backlog.getIssue(issueId);
    console.log('Issue fetched successfully with backlog-js');
    return response;
  }

  async getIssueComments(issueId: number): Promise<Entity.Issue.Comment[]> {
    // 初期化完了を待つ
    const initializedService = await this.ensureInitialized();

    console.log('Fetching issue comments from Backlog API using backlog-js...');
    const response = await initializedService.backlog.getIssueComments(issueId, {});
    console.log(
      'Issue comments fetched successfully with backlog-js:',
      response.length || 0,
      'comments'
    );
    return response || [];
  }

  async getUser(): Promise<Entity.User.User> {
    const initializedService = await this.ensureInitialized();
    return await initializedService.backlog.getMyself();
  }

  async getWikiPages(projectId: number): Promise<Entity.Wiki.WikiListItem[]> {
    // 初期化完了を待つ
    const initializedService = await this.ensureInitialized();

    console.log('Fetching wiki pages from Backlog API using backlog-js...');
    // backlog-jsの正しい関数名を使用
    const response = await initializedService.backlog.getWikis({
      projectIdOrKey: projectId,
    });
    console.log('Wiki pages fetched successfully with backlog-js:', response.length || 0, 'pages');
    return response || [];
  }

  async getWiki(wikiId: number): Promise<Entity.Wiki.Wiki> {
    // 初期化完了を待つ
    const initializedService = await this.ensureInitialized();

    console.log('Fetching wiki details from Backlog API using backlog-js...');
    const response = await initializedService.backlog.getWiki(wikiId);
    console.log('Wiki details fetched successfully with backlog-js');
    return response;
  }

  async getDocuments(projectId: number): Promise<Entity.Document.DocumentTree> {
    this.log('=== DOCUMENTS API DEBUG START ===');
    this.log(`getDocuments called with projectId: ${projectId}`);
    this.log(`Project ID type: ${typeof projectId}`);

    // 初期化完了を待つ
    const initializedService = await this.ensureInitialized();
    this.log('API service initialized successfully');

    this.log('=== CALLING BACKLOG-JS getDocumentTree ===');
    this.log(`Calling backlog.getDocumentTree with projectId: ${projectId}`);

    // ドキュメントツリーAPIを使用（backlog-jsに既存のメソッド）
    const response = await initializedService.backlog.getDocumentTree(projectId);
    this.log('Document tree API call successful');
    this.log(`Response type: ${typeof response}`);
    this.log(`Response is array: ${Array.isArray(response)}`);
    this.log(`Document tree raw response: ${JSON.stringify(response, null, 2)}`);

    this.log('=== DOCUMENTS API DEBUG END (SUCCESS) ===');
    // Tree構造をそのまま返す
    return response;
  }

  async getDocument(documentId: string): Promise<Entity.Document.Document> {
    this.log('=== GET DOCUMENT API DEBUG START ===');
    this.log(`getDocument called with documentId: ${documentId}`);

    // 初期化完了を待つ
    const initializedService = await this.ensureInitialized();
    this.log('API service initialized successfully');

    this.log('=== CALLING BACKLOG-JS getDocument ===');
    this.log(`Calling backlog.getDocument with documentId: ${documentId}`);

    // ドキュメント詳細APIを使用
    const response = await initializedService.backlog.getDocument(documentId);
    this.log('Document API call successful');
    this.log(`Document response: ${JSON.stringify(response, null, 2)}`);

    this.log('=== GET DOCUMENT API DEBUG END (SUCCESS) ===');
    return response;
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
