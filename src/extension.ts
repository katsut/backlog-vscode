import * as vscode from 'vscode';
import { BacklogTreeViewProvider } from './providers/treeViewProvider';
import { BacklogWebviewProvider } from './providers/webviewProvider';
import { BacklogProjectsWebviewProvider } from './providers/projectsWebviewProvider';
import { BacklogIssuesTreeViewProvider } from './providers/issuesTreeViewProvider';
import { BacklogWikiTreeViewProvider } from './providers/wikiTreeViewProvider';
import { BacklogDocumentsTreeViewProvider } from './providers/documentsTreeViewProvider';
import { ConfigService } from './services/configService';
import { BacklogApiService } from './services/backlogApi';

let backlogTreeViewProvider: BacklogTreeViewProvider;
let backlogWebviewProvider: BacklogWebviewProvider;
let backlogProjectsWebviewProvider: BacklogProjectsWebviewProvider;
let backlogIssuesProvider: BacklogIssuesTreeViewProvider;
let backlogWikiProvider: BacklogWikiTreeViewProvider;
let backlogDocumentsProvider: BacklogDocumentsTreeViewProvider;

// 開いているIssue Webviewを追跡
const openIssueWebviews: Map<string, vscode.WebviewPanel> = new Map();

export function activate(context: vscode.ExtensionContext) {
  console.log('Backlog extension is now active!');

  // Initialize services
  const configService = new ConfigService(context.secrets);
  const backlogApi = new BacklogApiService(configService);

  // Initialize providers
  backlogTreeViewProvider = new BacklogTreeViewProvider(backlogApi);
  backlogWebviewProvider = new BacklogWebviewProvider(context.extensionUri, backlogApi);
  backlogProjectsWebviewProvider = new BacklogProjectsWebviewProvider(context.extensionUri, backlogApi);
  backlogIssuesProvider = new BacklogIssuesTreeViewProvider(backlogApi);
  backlogWikiProvider = new BacklogWikiTreeViewProvider(backlogApi);
  backlogDocumentsProvider = new BacklogDocumentsTreeViewProvider(backlogApi);

  // Register tree views
  const projectsTreeView = vscode.window.createTreeView('backlogProjects', {
    treeDataProvider: backlogTreeViewProvider,
    showCollapseAll: true,
  });

  const issuesTreeView = vscode.window.createTreeView('backlogIssues', {
    treeDataProvider: backlogIssuesProvider,
    showCollapseAll: true,
  });

  const wikiTreeView = vscode.window.createTreeView('backlogWiki', {
    treeDataProvider: backlogWikiProvider,
    showCollapseAll: true,
  });

  const documentsTreeView = vscode.window.createTreeView('backlogDocuments', {
    treeDataProvider: backlogDocumentsProvider,
    showCollapseAll: true,
  });

  // Enable the views
  vscode.commands.executeCommand('setContext', 'backlogExplorer.enabled', true);
  vscode.commands.executeCommand('setContext', 'backlogProjectFocused', false);

  // Register commands
  const refreshCommand = vscode.commands.registerCommand('backlog.refreshProjects', () => {
    // 全てのプロバイダーをリフレッシュ
    backlogTreeViewProvider.refresh();
    backlogProjectsWebviewProvider.refresh();
    backlogIssuesProvider.refresh();
    backlogWikiProvider.refresh();
    backlogDocumentsProvider.refresh();
  });

  // 個別のリフレッシュコマンド
  const refreshIssuesCommand = vscode.commands.registerCommand('backlog.refreshIssues', () => {
    backlogIssuesProvider.refresh();
    vscode.window.showInformationMessage('Issues refreshed');
  });

  const refreshWikiCommand = vscode.commands.registerCommand('backlog.refreshWiki', () => {
    backlogWikiProvider.refresh();
    vscode.window.showInformationMessage('Wiki refreshed');
  });

  const refreshDocumentsCommand = vscode.commands.registerCommand('backlog.refreshDocuments', () => {
    backlogDocumentsProvider.refresh();
    vscode.window.showInformationMessage('Documents refreshed');
  });

  const openIssueCommand = vscode.commands.registerCommand('backlog.openIssue', async (issue) => {
    const issueKey = issue.issueKey || `${issue.id}`;
    
    // 既に開いているWebviewがあるかチェック
    const existingPanel = openIssueWebviews.get(issueKey);
    if (existingPanel) {
      // 既存のパネルをフォーカスしてリフレッシュ
      existingPanel.reveal(vscode.ViewColumn.One);
      
      // コンテンツをリフレッシュ
      try {
        const issueDetail = await backlogApi.getIssue(issue.id);
        const issueComments = await backlogApi.getIssueComments(issue.id);
        existingPanel.webview.html = getIssueWebviewContent(existingPanel.webview, context.extensionUri, issueDetail, issueComments);
        vscode.window.showInformationMessage(`Issue ${issueKey} refreshed`);
      } catch (error) {
        existingPanel.webview.html = getErrorWebviewContent(`Failed to load issue: ${error}`);
      }
      return;
    }

    // 新しいWebviewを作成
    const panel = vscode.window.createWebviewPanel(
      'backlogIssue',
      `Issue ${issueKey}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    // Webviewを追跡に追加
    openIssueWebviews.set(issueKey, panel);

    // パネルが閉じられた時に追跡から削除
    panel.onDidDispose(() => {
      openIssueWebviews.delete(issueKey);
    });

    // Webviewの内容を設定
    try {
      const issueDetail = await backlogApi.getIssue(issue.id);
      const issueComments = await backlogApi.getIssueComments(issue.id);
      
      panel.webview.html = getIssueWebviewContent(panel.webview, context.extensionUri, issueDetail, issueComments);
    } catch (error) {
      panel.webview.html = getErrorWebviewContent(`Failed to load issue: ${error}`);
    }
  });

  const openSettingsCommand = vscode.commands.registerCommand('backlog.openSettings', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', 'backlog');
  });

  const setApiKeyCommand = vscode.commands.registerCommand('backlog.setApiKey', async () => {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your Backlog API Key',
      password: true,
      placeHolder: 'Your API Key will be stored securely',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'API Key cannot be empty';
        }
        return null;
      },
    });

    if (apiKey) {
      await configService.setApiKey(apiKey.trim());
      await backlogApi.reinitialize();
      backlogTreeViewProvider.refresh();
      vscode.window.showInformationMessage(
        'API Key has been set successfully and stored securely.'
      );
    }
  });

  // プロジェクト検索コマンド
  const searchProjectsCommand = vscode.commands.registerCommand('backlog.searchProjects', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search projects by name or key',
      placeHolder: 'Enter search query (name, key, or description)',
    });

    if (query !== undefined) {
      await backlogTreeViewProvider.search(query);
      if (query) {
        vscode.window.showInformationMessage(`Searching projects: "${query}"`);
      } else {
        vscode.window.showInformationMessage('Project search cleared');
      }
    }
  });

  // プロジェクト検索クリア
  const clearProjectSearchCommand = vscode.commands.registerCommand('backlog.clearProjectSearch', () => {
    backlogTreeViewProvider.search('');
    vscode.window.showInformationMessage('Project search cleared');
  });

  // 課題検索コマンド
  const searchCommand = vscode.commands.registerCommand('backlog.search', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search issues by keyword',
      placeHolder: 'Enter search query (title, key, or description)',
    });

    if (query !== undefined) {
      await backlogIssuesProvider.searchIssues(query);
      if (query) {
        vscode.window.showInformationMessage(`Searching issues: "${query}"`);
      } else {
        vscode.window.showInformationMessage('Issue search cleared');
      }
    }
  });

  // フィルタコマンド
  const filterCommand = vscode.commands.registerCommand('backlog.filter', async () => {
    const filterOptions = [
      'Status Filter',
      'Priority Filter',
      'Assignee Filter'
    ];

    const selectedFilter = await vscode.window.showQuickPick(filterOptions, {
      placeHolder: 'Select filter type'
    });

    if (!selectedFilter) {
      return;
    }

    switch (selectedFilter) {
      case 'Status Filter':
        const statusOptions = ['Open', 'In Progress', 'Resolved', 'Closed', 'オープン', '処理中', '解決済み', 'クローズ'];
        const selectedStatuses = await vscode.window.showQuickPick(statusOptions, {
          canPickMany: true,
          placeHolder: 'Select statuses to filter'
        });
        if (selectedStatuses) {
          await backlogTreeViewProvider.setStatusFilter(selectedStatuses);
          vscode.window.showInformationMessage(`Status filter applied: ${selectedStatuses.join(', ')}`);
        }
        break;

      case 'Priority Filter':
        const priorityOptions = ['High', 'Medium', 'Low', '高', '中', '低'];
        const selectedPriorities = await vscode.window.showQuickPick(priorityOptions, {
          canPickMany: true,
          placeHolder: 'Select priorities to filter'
        });
        if (selectedPriorities) {
          await backlogTreeViewProvider.setPriorityFilter(selectedPriorities);
          vscode.window.showInformationMessage(`Priority filter applied: ${selectedPriorities.join(', ')}`);
        }
        break;

      case 'Assignee Filter':
        // Note: In a real implementation, you would get the list of assignees from the API
        const assigneeInput = await vscode.window.showInputBox({
          prompt: 'Enter assignee names (comma-separated)',
          placeHolder: 'e.g., John Doe, Jane Smith, or "Unassigned"'
        });
        if (assigneeInput) {
          const assignees = assigneeInput.split(',').map(a => a.trim());
          await backlogTreeViewProvider.setAssigneeFilter(assignees);
          vscode.window.showInformationMessage(`Assignee filter applied: ${assignees.join(', ')}`);
        }
        break;
    }
  });

  // ソートコマンド
  const sortCommand = vscode.commands.registerCommand('backlog.sort', async () => {
    const sortOptions = [
      { label: 'Updated Date (Newest First)', value: 'updated-desc' },
      { label: 'Updated Date (Oldest First)', value: 'updated-asc' },
      { label: 'Created Date (Newest First)', value: 'created-desc' },
      { label: 'Created Date (Oldest First)', value: 'created-asc' },
      { label: 'Priority (High to Low)', value: 'priority-desc' },
      { label: 'Priority (Low to High)', value: 'priority-asc' },
      { label: 'Status (A-Z)', value: 'status-asc' },
      { label: 'Status (Z-A)', value: 'status-desc' },
      { label: 'Summary (A-Z)', value: 'summary-asc' },
      { label: 'Summary (Z-A)', value: 'summary-desc' }
    ];

    const selected = await vscode.window.showQuickPick(sortOptions, {
      placeHolder: 'Select sort order'
    });

    if (selected) {
      const [sortBy, order] = selected.value.split('-') as ['updated' | 'created' | 'priority' | 'status' | 'summary', 'asc' | 'desc'];
      await backlogTreeViewProvider.sort(sortBy, order);
      vscode.window.showInformationMessage(`Sorted by: ${selected.label}`);
    }
  });

  // フィルタクリアコマンド
  const clearFiltersCommand = vscode.commands.registerCommand('backlog.clearFilters', () => {
    backlogTreeViewProvider.clearFilters();
    vscode.window.showInformationMessage('All filters and search cleared');
  });

  // プロジェクトフォーカスコマンド（新しいプロバイダー対応）
  const focusProjectCommand = vscode.commands.registerCommand('backlog.focusProject', async (projectId: number) => {
    try {
      console.log('focusProject command called with projectId:', projectId);
      
      // 各プロバイダーにプロジェクトを設定
      console.log('Setting project for issues provider...');
      await backlogIssuesProvider.setProject(projectId);
      
      console.log('Setting project for wiki provider...');
      await backlogWikiProvider.setProject(projectId);
      
      console.log('Setting project for documents provider...');
      await backlogDocumentsProvider.setProject(projectId);
      
      // プロジェクトフォーカス状態を有効にする
      console.log('Setting context backlogProjectFocused to true...');
      await vscode.commands.executeCommand('setContext', 'backlogProjectFocused', true);
      
      // 旧プロバイダーも更新（後方互換性のため）
      console.log('Updating old tree view provider...');
      await backlogTreeViewProvider.focusProject(projectId);
      
      console.log('Project focus completed successfully');
      vscode.window.showInformationMessage(`Focused on project ID: ${projectId}`);
    } catch (error) {
      console.error('Error in focusProject command:', error);
      vscode.window.showErrorMessage(`Failed to focus project: ${error}`);
    }
  });

  // プロジェクトフォーカス解除コマンド
  const unfocusProjectCommand = vscode.commands.registerCommand('backlog.unfocusProject', () => {
    // 各プロバイダーをクリア
    backlogIssuesProvider.clearProject();
    backlogWikiProvider.clearProject();
    backlogDocumentsProvider.clearProject();
    
    // プロジェクトフォーカス状態を無効にする
    vscode.commands.executeCommand('setContext', 'backlogProjectFocused', false);
    
    // 旧プロバイダーも更新
    backlogTreeViewProvider.unfocusProject();
    
    vscode.window.showInformationMessage('Returned to projects view');
  });

  // Wikiを開くコマンド - エディタでWebviewを開く
  const openWikiCommand = vscode.commands.registerCommand('backlog.openWiki', async (wiki) => {
    if (wiki) {
      // エディタでWebviewを開く
      const panel = vscode.window.createWebviewPanel(
        'backlogWiki',
        `Wiki: ${wiki.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      // Webviewの内容を設定
      panel.webview.html = getWikiWebviewContent(panel.webview, context.extensionUri, wiki);
    }
  });

  // ドキュメントを開くコマンド - エディタでWebviewを開く
  const openDocumentCommand = vscode.commands.registerCommand('backlog.openDocument', async (document) => {
    if (document) {
      // エディタでWebviewを開く
      const panel = vscode.window.createWebviewPanel(
        'backlogDocument',
        `Document: ${document.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      // Webviewの内容を設定
      panel.webview.html = getDocumentWebviewContent(panel.webview, context.extensionUri, document, configService);
    }
  });

  // MCP統合コマンド: 課題更新後に自動オープン・リフレッシュ
  const openIssueAfterMCPOperation = vscode.commands.registerCommand('backlog.openIssueAfterMCPOperation', async (issueId: number | string, issueKey?: string) => {
    try {
      // Issues ビューをリフレッシュ
      backlogIssuesProvider.refresh();
      
      // issueIdを数値に変換
      const numericIssueId = typeof issueId === 'string' ? parseInt(issueId, 10) : issueId;
      
      // 課題詳細を取得
      const issueDetail = await backlogApi.getIssue(numericIssueId);
      const resolvedIssueKey = issueKey || issueDetail.issueKey || `${issueId}`;
      
      // 既存のWebviewがあるかチェック
      const existingPanel = openIssueWebviews.get(resolvedIssueKey);
      if (existingPanel) {
        // 既存のパネルをフォーカスしてリフレッシュ
        existingPanel.reveal(vscode.ViewColumn.One);
        
        // コンテンツをリフレッシュ
        const issueComments = await backlogApi.getIssueComments(numericIssueId);
        existingPanel.webview.html = getIssueWebviewContent(existingPanel.webview, context.extensionUri, issueDetail, issueComments);
        vscode.window.showInformationMessage(`Issue ${resolvedIssueKey} updated and refreshed`);
      } else {
        // 新しいWebviewを作成
        const panel = vscode.window.createWebviewPanel(
          'backlogIssue',
          `Issue ${resolvedIssueKey}`,
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true
          }
        );

        // Webviewを追跡に追加
        openIssueWebviews.set(resolvedIssueKey, panel);

        // パネルが閉じられた時に追跡から削除
        panel.onDidDispose(() => {
          openIssueWebviews.delete(resolvedIssueKey);
        });

        // コンテンツを設定
        const issueComments = await backlogApi.getIssueComments(numericIssueId);
        panel.webview.html = getIssueWebviewContent(panel.webview, context.extensionUri, issueDetail, issueComments);
        vscode.window.showInformationMessage(`Issue ${resolvedIssueKey} opened after MCP operation`);
      }
    } catch (error) {
      console.error('Error in openIssueAfterMCPOperation:', error);
      vscode.window.showErrorMessage(`Failed to open issue after MCP operation: ${error}`);
    }
  });

  // キーボードショートカット: プロジェクトキーでプロジェクトを開く (Win/Linux: Alt+Shift+P, macOS: Ctrl+Shift+P)
  const openProjectByKeyCommand = vscode.commands.registerCommand('backlog.openProjectByKey', async () => {
    const projectKey = await vscode.window.showInputBox({
      prompt: 'Enter project key to open',
      placeHolder: 'e.g., PROJ, DEV, TEST',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Project key cannot be empty';
        }
        if (!/^[A-Z][A-Z0-9_]*$/i.test(value.trim())) {
          return 'Project key should contain only letters, numbers, and underscores';
        }
        return null;
      },
    });

    if (projectKey) {
      try {
        // プロジェクト一覧を取得してキーで検索
        const projects = await backlogApi.getProjects();
        const project = projects.find(p => p.projectKey.toLowerCase() === projectKey.trim().toLowerCase());
        
        if (project) {
          // プロジェクトにフォーカス
          await vscode.commands.executeCommand('backlog.focusProject', project.id);
          vscode.window.showInformationMessage(`Opened project: ${project.name} (${project.projectKey})`);
        } else {
          vscode.window.showErrorMessage(`Project not found: ${projectKey}`);
        }
      } catch (error) {
        console.error('Error in openProjectByKey:', error);
        vscode.window.showErrorMessage(`Failed to open project: ${error}`);
      }
    }
  });

  // キーボードショートカット: 課題キーで課題を開く (Win/Linux: Alt+Shift+I, macOS: Ctrl+Shift+I)
  const openIssueByKeyCommand = vscode.commands.registerCommand('backlog.openIssueByKey', async () => {
    const issueKey = await vscode.window.showInputBox({
      prompt: 'Enter issue key to open',
      placeHolder: 'e.g., PROJ-123, DEV-456',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Issue key cannot be empty';
        }
        if (!/^[A-Z][A-Z0-9_]*-\d+$/i.test(value.trim())) {
          return 'Issue key should be in format: PROJECT-123';
        }
        return null;
      },
    });

    if (issueKey) {
      try {
        // 課題キーからプロジェクトキーと課題番号を抽出
        const [projectKey, issueNumber] = issueKey.trim().split('-');
        
        // プロジェクト一覧を取得してプロジェクトIDを見つける
        const projects = await backlogApi.getProjects();
        const project = projects.find((p: any) => p.projectKey.toLowerCase() === projectKey.toLowerCase());
        
        if (!project) {
          vscode.window.showErrorMessage(`Project not found: ${projectKey}`);
          return;
        }

        // MCPサーバーを使用して課題を検索
        try {
          const issueSearchResult = await vscode.commands.executeCommand('backlog.searchIssueByKey', issueKey.trim());
          if (issueSearchResult) {
            await vscode.commands.executeCommand('backlog.openIssue', issueSearchResult);
            vscode.window.showInformationMessage(`Opened issue: ${issueKey}`);
            return;
          }
        } catch (mcpError) {
          console.log('MCP search failed, trying direct API approach:', mcpError);
        }

        // フォールバック: プロジェクトの課題一覧から検索
        await backlogIssuesProvider.setProject(project.id);
        
        // 少し待ってから課題一覧を取得
        setTimeout(async () => {
          try {
            // Issues viewを通じて課題を検索
            await backlogIssuesProvider.searchIssues(issueKey.trim());
            vscode.window.showInformationMessage(`Searched for issue: ${issueKey}. Check the Issues view.`);
          } catch (error) {
            console.error('Error searching issues:', error);
            vscode.window.showErrorMessage(`Failed to search for issue: ${issueKey}`);
          }
        }, 1000);
        
      } catch (error) {
        console.error('Error in openIssueByKey:', error);
        vscode.window.showErrorMessage(`Failed to open issue: ${error}`);
      }
    }
  });

  // Register webview provider
  const webviewProvider = vscode.window.registerWebviewViewProvider(
    'backlogIssueDetail',
    backlogWebviewProvider
  );

  // Add disposables to context
  context.subscriptions.push(
    projectsTreeView,
    issuesTreeView,
    wikiTreeView,
    documentsTreeView,
    refreshCommand,
    refreshIssuesCommand,
    refreshWikiCommand,
    refreshDocumentsCommand,
    searchProjectsCommand,
    clearProjectSearchCommand,
    openIssueCommand,
    openSettingsCommand,
    setApiKeyCommand,
    searchCommand,
    filterCommand,
    sortCommand,
    clearFiltersCommand,
    focusProjectCommand,
    unfocusProjectCommand,
    openWikiCommand,
    openDocumentCommand,
    openIssueAfterMCPOperation,
    openProjectByKeyCommand,
    openIssueByKeyCommand,
    webviewProvider
  );

  // Auto-refresh if enabled
  if (configService.isAutoRefreshEnabled()) {
    const interval = configService.getRefreshInterval();
    const timer = setInterval(() => {
      backlogTreeViewProvider.refresh();
    }, interval * 1000);

    // Clear timer when extension is deactivated
    context.subscriptions.push({
      dispose: () => clearInterval(timer),
    });
  }

  // Check configuration on startup
  checkConfiguration(configService);
}

export function deactivate() {
  console.log('Backlog extension is now deactivated');
}

async function checkConfiguration(configService: ConfigService) {
  const apiUrl = configService.getApiUrl();
  const apiKey = await configService.getApiKey();

  if (!apiUrl || !apiKey) {
    vscode.window
      .showWarningMessage(
        'Backlog API URL and API Key are required. Please configure them.',
        'Open Settings',
        'Set API Key'
      )
      .then((selection) => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'backlog');
        } else if (selection === 'Set API Key') {
          vscode.commands.executeCommand('backlog.setApiKey');
        }
      });
  }
}

function getIssueWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, issue: any, comments: any[]): string {
  const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'reset.css'));
  const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'vscode.css'));
  const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));

  const nonce = getNonce();

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <link href="${styleMainUri}" rel="stylesheet">
        <title>Issue ${issue.issueKey}</title>
    </head>
    <body>
        <div class="issue-header">
            <h1>${escapeHtml(issue.summary)}</h1>
            <div class="issue-meta">
                <span class="issue-key">${escapeHtml(issue.issueKey)}</span>
                <span class="status-badge ${getStatusClass(issue.status)}">${escapeHtml(issue.status.name)}</span>
                <span class="priority-badge ${getPriorityClass(issue.priority)}">${escapeHtml(issue.priority.name)}</span>
            </div>
        </div>

        <div class="issue-details">
            <div class="issue-field">
                <label>Status:</label>
                <span>${escapeHtml(issue.status.name)}</span>
            </div>
            <div class="issue-field">
                <label>Priority:</label>
                <span>${escapeHtml(issue.priority.name)}</span>
            </div>
            ${issue.assignee ? `
            <div class="issue-field">
                <label>Assignee:</label>
                <span>${escapeHtml(issue.assignee.name)}</span>
            </div>
            ` : ''}
            ${issue.dueDate ? `
            <div class="issue-field">
                <label>Due Date:</label>
                <span>${new Date(issue.dueDate).toLocaleDateString()}</span>
            </div>
            ` : ''}
        </div>

        ${issue.description ? `
        <div class="issue-description">
            <h3>Description</h3>
            <div class="issue-description-content">${escapeHtml(issue.description)}</div>
        </div>
        ` : ''}

        ${comments && comments.length > 0 ? `
        <div class="issue-comments">
            <h3>Comments (${comments.length})</h3>
            ${comments.map(comment => `
            <div class="comment">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(comment.createdUser.name)}</span>
                    <span class="comment-date">${new Date(comment.created).toLocaleDateString()}</span>
                </div>
                <div class="comment-content">${escapeHtml(comment.content)}</div>
            </div>
            `).join('')}
        </div>
        ` : ''}
    </body>
    </html>`;
}

function getErrorWebviewContent(errorMessage: string): string {
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                padding: 20px;
                color: var(--vscode-foreground);
                background: var(--vscode-editor-background);
            }
            .error {
                color: var(--vscode-errorForeground);
                background: var(--vscode-inputValidation-errorBackground);
                border: 1px solid var(--vscode-inputValidation-errorBorder);
                padding: 15px;
                border-radius: 4px;
            }
        </style>
    </head>
    <body>
        <div class="error">
            <h2>Error</h2>
            <p>${escapeHtml(errorMessage)}</p>
        </div>
    </body>
    </html>`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function getStatusClass(status: any): string {
  if (!status) return '';
  const name = status.name.toLowerCase();
  if (name.includes('open') || name.includes('オープン')) return 'open';
  if (name.includes('progress') || name.includes('処理中')) return 'in-progress';
  if (name.includes('resolved') || name.includes('解決')) return 'resolved';
  if (name.includes('closed') || name.includes('クローズ')) return 'closed';
  return '';
}

function getPriorityClass(priority: any): string {
  if (!priority) return '';
  const name = priority.name.toLowerCase();
  if (name.includes('high') || name.includes('高')) return 'high';
  if (name.includes('medium') || name.includes('中')) return 'medium';
  if (name.includes('low') || name.includes('低')) return 'low';
  return '';
}

function getWikiWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, wiki: any): string {
  const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'reset.css'));
  const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'vscode.css'));
  const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));

  const nonce = getNonce();

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <link href="${styleMainUri}" rel="stylesheet">
        <title>Wiki: ${escapeHtml(wiki.name)}</title>
    </head>
    <body>
        <div class="wiki-header">
            <h1>${escapeHtml(wiki.name)}</h1>
            <div class="wiki-meta">
                <span>Created: ${wiki.created ? new Date(wiki.created).toLocaleDateString() : 'Unknown'}</span>
                <span>Updated: ${wiki.updated ? new Date(wiki.updated).toLocaleDateString() : 'Unknown'}</span>
            </div>
        </div>

        <div class="wiki-content">
            ${wiki.content ? `<div class="wiki-description">${escapeHtml(wiki.content)}</div>` : '<p>Wiki content not available</p>'}
        </div>
    </body>
    </html>`;
}

function getDocumentWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, document: any, configService: ConfigService): string {
  const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'reset.css'));
  const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'vscode.css'));
  const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));

  const nonce = getNonce();
  const baseUrl = configService.getBaseUrl();
  const docUrl = baseUrl && document.id ? `${baseUrl}/file/${document.id}` : '#';

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <link href="${styleMainUri}" rel="stylesheet">
        <title>Document: ${escapeHtml(document.name)}</title>
    </head>
    <body>
        <div class="document-header">
            <h1>${escapeHtml(document.name)}</h1>
            <div class="document-meta">
                <span>Size: ${document.size || 'Unknown'}</span>
                <span>Created: ${document.created ? new Date(document.created).toLocaleDateString() : 'Unknown'}</span>
                ${baseUrl && document.id ? `<a href="${docUrl}" style="color: var(--vscode-textLink-foreground);">Open in Backlog</a>` : ''}
            </div>
        </div>

        <div class="document-content">
            <p>Document preview is not available in this view.</p>
            ${baseUrl && document.id ? `<p><a href="${docUrl}" style="color: var(--vscode-textLink-foreground);">Click here to view the document in Backlog</a></p>` : ''}
            
            <div class="document-info">
                <h3>Document Information</h3>
                <p><strong>Name:</strong> ${escapeHtml(document.name)}</p>
                <p><strong>Size:</strong> ${document.size || 'Unknown'}</p>
                ${document.created ? `<p><strong>Created:</strong> ${new Date(document.created).toLocaleDateString()}</p>` : ''}
                ${document.createdUser ? `<p><strong>Creator:</strong> ${escapeHtml(document.createdUser.name)}</p>` : ''}
            </div>
        </div>
    </body>
    </html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
