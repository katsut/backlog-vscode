import * as vscode from 'vscode';
import { Backlog } from 'backlog-js';
import { ConfigService } from './configService';

export class BacklogApiService {
  private backlog: any;
  private configService: ConfigService;
  private initializationPromise: Promise<void> | null = null;

  constructor(configService: ConfigService) {
    this.configService = configService;
    // 初期化を開始するが、Promiseを保存して完了を待てるようにする
    this.initializationPromise = this.initializeClient();
  }

  private async initializeClient(): Promise<void> {
    const apiUrl = this.configService.getApiUrl();
    const apiKey = await this.configService.getApiKey();

    console.log('Initializing Backlog API client...');
    console.log('API URL:', apiUrl ? 'configured' : 'not configured');
    console.log('API Key:', apiKey ? 'configured' : 'not configured');

    if (apiUrl && apiKey) {
      try {
        // URLの正規化と検証
        const normalizedUrl = this.normalizeApiUrl(apiUrl);
        console.log('Normalized API URL:', normalizedUrl);

        this.backlog = new Backlog({
          host: normalizedUrl,
          apiKey: apiKey,
        });
        
        console.log('Backlog API client initialized successfully');
      } catch (error) {
        console.error('Error initializing Backlog API client:', error);
        vscode.window.showErrorMessage(`Failed to initialize Backlog API: ${error}`);
      }
    } else {
      console.log('Backlog API client not initialized: missing configuration');
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  private normalizeApiUrl(apiUrl: string): string {
    // Remove trailing slash
    let normalized = apiUrl.replace(/\/$/, '');
    
    // Ensure https protocol
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }

    // For Backlog, we need the base domain without '/api/v2'
    normalized = normalized.replace(/\/api\/v2.*$/, '');
    
    return normalized;
  }

  async getProjects(): Promise<any[]> {
    // 初期化完了を待つ
    await this.ensureInitialized();
    
    if (!this.backlog) {
      const apiUrl = this.configService.getApiUrl();
      const apiKey = await this.configService.getApiKey();
      
      console.error('Backlog API client is not initialized');
      console.error('Current API URL:', apiUrl || 'not set');
      console.error('Current API Key:', apiKey ? 'set' : 'not set');
      
      throw new Error(
        'Backlog API client is not initialized. Please configure API URL and API Key in VS Code settings.'
      );
    }

    try {
      console.log('Fetching projects from Backlog API using backlog-js...');
      const response = await this.backlog.getProjects();
      console.log('Projects fetched successfully with backlog-js:', response.body?.length || 0, 'projects');
      return response.body || [];
    } catch (error: any) {
      console.error('Error with backlog-js, trying direct fetch API:', error);
      
      // backlog-jsでエラーが発生した場合、直接fetch APIを使用してフォールバック
      try {
        console.log('Falling back to direct fetch API...');
        const testResult = await this.testApiConnection();
        
        if (testResult.success && testResult.data) {
          console.log('Fallback successful, got', testResult.data.length, 'projects');
          return testResult.data;
        } else {
          throw new Error(testResult.message);
        }
      } catch (fallbackError: any) {
        console.error('Fallback also failed:', fallbackError);
        
        // より詳細なエラー情報を提供
        let errorMessage = 'Failed to fetch projects';
        if (error?.message) {
          errorMessage += `: ${error.message}`;
        }
        if (error?.code) {
          errorMessage += ` (Code: ${error.code})`;
        }
        
        // ネットワークエラーの場合の特別な処理
        if (error?.message?.includes('fetch failed') || error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
          errorMessage += '\n\nTried both backlog-js and direct fetch API. Possible causes:\n- Check your internet connection\n- Verify the Backlog API URL is correct\n- Ensure the Backlog service is accessible';
        }
        
        throw new Error(errorMessage);
      }
    }
  }

  async getProjectIssues(projectId: number, options?: any): Promise<any[]> {
    // 初期化完了を待つ
    await this.ensureInitialized();
    
    if (!this.backlog) {
      throw new Error(
        'Backlog API client is not initialized. Please configure API URL and API Key.'
      );
    }

    try {
      console.log('Fetching issues from Backlog API using backlog-js...');
      const response = await this.backlog.getIssues({
        projectId: [projectId],
        ...options,
      });
      console.log('Issues fetched successfully with backlog-js:', response.body?.length || 0, 'issues');
      return response.body || [];
    } catch (error: any) {
      console.error('Error with backlog-js for issues, trying direct fetch API:', error);
      
      // backlog-jsでエラーが発生した場合、直接fetch APIを使用してフォールバック
      try {
        console.log('Falling back to direct fetch API for issues...');
        const issuesResult = await this.fetchIssuesDirectly(projectId, options);
        
        if (issuesResult.length >= 0) {
          console.log('Fallback successful for issues, got', issuesResult.length, 'issues');
          return issuesResult;
        } else {
          throw new Error('No issues data received from fallback API');
        }
      } catch (fallbackError: any) {
        console.error('Fallback also failed for issues:', fallbackError);
        throw new Error(`Failed to fetch issues: ${error.message || error}`);
      }
    }
  }

  // 直接fetch APIを使用してIssuesを取得するヘルパーメソッド
  private async fetchIssuesDirectly(projectId: number, options?: any): Promise<any[]> {
    const apiUrl = this.configService.getApiUrl();
    const apiKey = await this.configService.getApiKey();

    if (!apiUrl || !apiKey) {
      throw new Error('API URL or API Key is not configured');
    }

    const normalizedUrl = this.normalizeApiUrl(apiUrl);
    let issuesUrl = `${normalizedUrl}/api/v2/issues?apiKey=${apiKey}&projectId[]=${projectId}`;
    
    // オプションパラメータを追加
    if (options) {
      const params = new URLSearchParams();
      Object.keys(options).forEach(key => {
        if (key === 'projectId') return; // すでに追加済み
        const value = options[key];
        if (Array.isArray(value)) {
          value.forEach(v => params.append(`${key}[]`, v));
        } else {
          params.append(key, value);
        }
      });
      if (params.toString()) {
        issuesUrl += '&' + params.toString();
      }
    }
    
    console.log('Direct fetch issues URL:', issuesUrl.replace(apiKey, '[HIDDEN]'));
    
    const response = await fetch(issuesUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VS Code Backlog Extension'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data || [];
  }

  async getIssue(issueId: number): Promise<any> {
    // 初期化完了を待つ
    await this.ensureInitialized();
    
    if (!this.backlog) {
      throw new Error(
        'Backlog API client is not initialized. Please configure API URL and API Key.'
      );
    }

    try {
      console.log('Fetching issue from Backlog API using backlog-js...');
      const response = await this.backlog.getIssue(issueId);
      console.log('Issue fetched successfully with backlog-js');
      return response.body;
    } catch (error: any) {
      console.error('Error with backlog-js for issue, trying direct fetch API:', error);
      
      // backlog-jsでエラーが発生した場合、直接fetch APIを使用してフォールバック
      try {
        console.log('Falling back to direct fetch API for issue...');
        const issueResult = await this.fetchIssueDirectly(issueId);
        
        if (issueResult) {
          console.log('Fallback successful for issue');
          return issueResult;
        } else {
          throw new Error('No issue data received from fallback API');
        }
      } catch (fallbackError: any) {
        console.error('Fallback also failed for issue:', fallbackError);
        throw new Error(`Failed to fetch issue: ${error.message || error}`);
      }
    }
  }

  async getIssueComments(issueId: number): Promise<any[]> {
    // 初期化完了を待つ
    await this.ensureInitialized();
    
    if (!this.backlog) {
      throw new Error(
        'Backlog API client is not initialized. Please configure API URL and API Key.'
      );
    }

    try {
      console.log('Fetching issue comments from Backlog API using backlog-js...');
      const response = await this.backlog.getIssueComments(issueId);
      console.log('Issue comments fetched successfully with backlog-js:', response.body?.length || 0, 'comments');
      return response.body || [];
    } catch (error: any) {
      console.error('Error with backlog-js for issue comments, trying direct fetch API:', error);
      
      // backlog-jsでエラーが発生した場合、直接fetch APIを使用してフォールバック
      try {
        console.log('Falling back to direct fetch API for issue comments...');
        const commentsResult = await this.fetchIssueCommentsDirectly(issueId);
        
        if (commentsResult.length >= 0) {
          console.log('Fallback successful for issue comments, got', commentsResult.length, 'comments');
          return commentsResult;
        } else {
          throw new Error('No comments data received from fallback API');
        }
      } catch (fallbackError: any) {
        console.error('Fallback also failed for issue comments:', fallbackError);
        // コメントが取得できない場合は空配列を返す
        return [];
      }
    }
  }

  // 直接fetch APIを使用してIssueを取得するヘルパーメソッド
  private async fetchIssueDirectly(issueId: number): Promise<any> {
    const apiUrl = this.configService.getApiUrl();
    const apiKey = await this.configService.getApiKey();

    if (!apiUrl || !apiKey) {
      throw new Error('API URL or API Key is not configured');
    }

    const normalizedUrl = this.normalizeApiUrl(apiUrl);
    const issueUrl = `${normalizedUrl}/api/v2/issues/${issueId}?apiKey=${apiKey}`;
    
    console.log('Direct fetch issue URL:', issueUrl.replace(apiKey, '[HIDDEN]'));
    
    const response = await fetch(issueUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VS Code Backlog Extension'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data;
  }

  // 直接fetch APIを使用してIssue Commentsを取得するヘルパーメソッド
  private async fetchIssueCommentsDirectly(issueId: number): Promise<any[]> {
    const apiUrl = this.configService.getApiUrl();
    const apiKey = await this.configService.getApiKey();

    if (!apiUrl || !apiKey) {
      throw new Error('API URL or API Key is not configured');
    }

    const normalizedUrl = this.normalizeApiUrl(apiUrl);
    const commentsUrl = `${normalizedUrl}/api/v2/issues/${issueId}/comments?apiKey=${apiKey}`;
    
    console.log('Direct fetch issue comments URL:', commentsUrl.replace(apiKey, '[HIDDEN]'));
    
    const response = await fetch(commentsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VS Code Backlog Extension'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data || [];
  }

  async getUser(): Promise<any> {
    if (!this.backlog) {
      throw new Error(
        'Backlog API client is not initialized. Please configure API URL and API Key.'
      );
    }

    try {
      const response = await this.backlog.getUser();
      return response.body;
    } catch (error) {
      console.error('Error fetching user:', error);
      throw new Error(`Failed to fetch user: ${error}`);
    }
  }

  async getWikiPages(projectId: number): Promise<any[]> {
    // 初期化完了を待つ
    await this.ensureInitialized();
    
    if (!this.backlog) {
      throw new Error(
        'Backlog API client is not initialized. Please configure API URL and API Key.'
      );
    }

    try {
      console.log('Fetching wiki pages from Backlog API using backlog-js...');
      // backlog-jsの正しい関数名を使用
      const response = await this.backlog.getWikis({
        projectIdOrKey: projectId
      });
      console.log('Wiki pages fetched successfully with backlog-js:', response.body?.length || 0, 'pages');
      return response.body || [];
    } catch (error: any) {
      console.error('Error with backlog-js for wiki pages, trying direct fetch API:', error);
      
      // backlog-jsでエラーが発生した場合、直接fetch APIを使用してフォールバック
      try {
        console.log('Falling back to direct fetch API for wiki pages...');
        const wikisResult = await this.fetchWikisDirectly(projectId);
        
        if (wikisResult.length >= 0) {
          console.log('Fallback successful for wiki pages, got', wikisResult.length, 'pages');
          return wikisResult;
        } else {
          throw new Error('No wiki data received from fallback API');
        }
      } catch (fallbackError: any) {
        console.error('Fallback also failed for wiki pages:', fallbackError);
        // Wikiが存在しない場合や権限がない場合は空配列を返す
        return [];
      }
    }
  }

  // 直接fetch APIを使用してWikiを取得するヘルパーメソッド
  private async fetchWikisDirectly(projectId: number): Promise<any[]> {
    const apiUrl = this.configService.getApiUrl();
    const apiKey = await this.configService.getApiKey();

    if (!apiUrl || !apiKey) {
      throw new Error('API URL or API Key is not configured');
    }

    const normalizedUrl = this.normalizeApiUrl(apiUrl);
    const wikisUrl = `${normalizedUrl}/api/v2/wikis?apiKey=${apiKey}&projectIdOrKey=${projectId}`;
    
    console.log('Direct fetch wikis URL:', wikisUrl.replace(apiKey, '[HIDDEN]'));
    
    const response = await fetch(wikisUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VS Code Backlog Extension'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data || [];
  }

  async getDocuments(projectId: number): Promise<any[]> {
    // 初期化完了を待つ
    await this.ensureInitialized();
    
    if (!this.backlog) {
      throw new Error(
        'Backlog API client is not initialized. Please configure API URL and API Key.'
      );
    }

    try {
      console.log('Fetching documents from Backlog API using shared files...');
      // Backlog APIでは共有ファイルAPIを使用してドキュメントを取得
      const response = await this.backlog.getSharedFiles({
        projectIdOrKey: projectId
      });
      console.log('Documents fetched successfully with backlog-js:', response.body?.length || 0, 'documents');
      return response.body || [];
    } catch (error: any) {
      console.error('Error with backlog-js for documents, trying direct fetch API:', error);
      
      // backlog-jsでエラーが発生した場合、直接fetch APIを使用してフォールバック
      try {
        console.log('Falling back to direct fetch API for documents...');
        const documentsResult = await this.fetchDocumentsDirectly(projectId);
        
        if (documentsResult.length >= 0) {
          console.log('Fallback successful for documents, got', documentsResult.length, 'documents');
          return documentsResult;
        } else {
          throw new Error('No documents data received from fallback API');
        }
      } catch (fallbackError: any) {
        console.error('Fallback also failed for documents:', fallbackError);
        // ドキュメントが存在しない場合や権限がない場合は空配列を返す
        return [];
      }
    }
  }

  // 直接fetch APIを使用してドキュメント（共有ファイル）を取得するヘルパーメソッド
  private async fetchDocumentsDirectly(projectId: number): Promise<any[]> {
    const apiUrl = this.configService.getApiUrl();
    const apiKey = await this.configService.getApiKey();

    if (!apiUrl || !apiKey) {
      throw new Error('API URL or API Key is not configured');
    }

    const normalizedUrl = this.normalizeApiUrl(apiUrl);
    const documentsUrl = `${normalizedUrl}/api/v2/projects/${projectId}/files/metadata?apiKey=${apiKey}`;
    
    console.log('Direct fetch documents URL:', documentsUrl.replace(apiKey, '[HIDDEN]'));
    
    const response = await fetch(documentsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'VS Code Backlog Extension'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data || [];
  }

  async reinitialize(): Promise<void> {
    await this.initializeClient();
  }

  async isConfigured(): Promise<boolean> {
    return await this.configService.isConfigured();
  }

  // デバッグ用: 直接fetch APIを使ったテスト
  async testApiConnection(): Promise<{ success: boolean; message: string; data?: any }> {
    const apiUrl = this.configService.getApiUrl();
    const apiKey = await this.configService.getApiKey();

    if (!apiUrl || !apiKey) {
      return {
        success: false,
        message: 'API URL or API Key is not configured'
      };
    }

    try {
      const normalizedUrl = this.normalizeApiUrl(apiUrl);
      const testUrl = `${normalizedUrl}/api/v2/projects?apiKey=${apiKey}`;
      
      console.log('Testing API connection with URL:', testUrl.replace(apiKey, '[HIDDEN]'));
      
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'VS Code Backlog Extension'
        }
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('Error response body:', errorText);
        return {
          success: false,
          message: `HTTP ${response.status}: ${response.statusText} - ${errorText}`
        };
      }

      const data = await response.json();
      console.log('API test successful, received', data.length, 'projects');
      
      return {
        success: true,
        message: `Successfully connected to Backlog API. Found ${data.length} projects.`,
        data: data
      };

    } catch (error: any) {
      console.error('API connection test failed:', error);
      return {
        success: false,
        message: `Connection failed: ${error.message}`
      };
    }
  }
}
