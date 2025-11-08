import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { BacklogTreeViewProvider } from './providers/treeViewProvider';
import { BacklogWebviewProvider } from './providers/webviewProvider';
import { BacklogProjectsWebviewProvider } from './providers/projectsWebviewProvider';
import { BacklogIssuesTreeViewProvider } from './providers/issuesTreeViewProvider';
import { BacklogWikiTreeViewProvider } from './providers/wikiTreeViewProvider';
import { BacklogDocumentsTreeViewProvider } from './providers/documentsTreeViewProvider';
import { ConfigService } from './services/configService';
import { BacklogApiService } from './services/backlogApi';
import { WebviewHelper } from './webviews/common';
import { DocumentWebview } from './webviews/documentWebview';
import { IssueWebview } from './webviews/issueWebview';
import { WikiWebview } from './webviews/wikiWebview';

let backlogTreeViewProvider: BacklogTreeViewProvider;
let backlogWebviewProvider: BacklogWebviewProvider;
let backlogProjectsWebviewProvider: BacklogProjectsWebviewProvider;
let backlogIssuesProvider: BacklogIssuesTreeViewProvider;
let backlogWikiProvider: BacklogWikiTreeViewProvider;
let backlogDocumentsProvider: BacklogDocumentsTreeViewProvider;

// 開いているIssue Webviewを追跡
const openIssueWebviews: Map<string, vscode.WebviewPanel> = new Map();

// 開いているDocument Webviewを追跡
const openDocumentWebviews: Map<string, vscode.WebviewPanel> = new Map();

export function activate(context: vscode.ExtensionContext) {
  console.log('=== BACKLOG EXTENSION ACTIVATION START ===');
  console.log('Backlog extension is now active!');

  // Create output channel for debugging
  const outputChannel = vscode.window.createOutputChannel('Backlog Extension Debug');
  outputChannel.appendLine('=== EXTENSION ACTIVATION START ===');
  outputChannel.show();

  // Declare variables before try block
  let configService: ConfigService;
  let backlogApi: BacklogApiService;

  try {
    // Initialize services
    console.log('Initializing ConfigService...');
    outputChannel.appendLine('Initializing ConfigService...');
    configService = new ConfigService(context.secrets);

    console.log('Initializing BacklogApiService...');
    outputChannel.appendLine('Initializing BacklogApiService...');
    backlogApi = new BacklogApiService(configService);

    // Initialize providers
    console.log('Initializing TreeViewProvider...');
    outputChannel.appendLine('Initializing TreeViewProvider...');
    backlogTreeViewProvider = new BacklogTreeViewProvider(backlogApi);
    outputChannel.appendLine('TreeViewProvider initialized successfully!');

    console.log('Initializing WebviewProvider...');
    outputChannel.appendLine('Initializing WebviewProvider...');
    backlogWebviewProvider = new BacklogWebviewProvider(context.extensionUri, backlogApi);
    outputChannel.appendLine('WebviewProvider initialized successfully!');
  } catch (error) {
    console.error('ERROR during extension activation:', error);
    outputChannel.appendLine(`ERROR during extension activation: ${error}`);
    outputChannel.appendLine(`Stack: ${error instanceof Error ? error.stack : 'No stack available'}`);
    vscode.window.showErrorMessage(`Backlog Extension failed to activate: ${error}`);
    return;
  }

  try {
    console.log('Initializing BacklogProjectsWebviewProvider...');
    outputChannel.appendLine('Initializing BacklogProjectsWebviewProvider...');
    backlogProjectsWebviewProvider = new BacklogProjectsWebviewProvider(
      context.extensionUri,
      backlogApi
    );
    outputChannel.appendLine('BacklogProjectsWebviewProvider initialized successfully!');

    console.log('Initializing BacklogIssuesTreeViewProvider...');
    outputChannel.appendLine('Initializing BacklogIssuesTreeViewProvider...');
    backlogIssuesProvider = new BacklogIssuesTreeViewProvider(backlogApi);
    outputChannel.appendLine('BacklogIssuesTreeViewProvider initialized successfully!');

    console.log('Initializing BacklogWikiTreeViewProvider...');
    outputChannel.appendLine('Initializing BacklogWikiTreeViewProvider...');
    backlogWikiProvider = new BacklogWikiTreeViewProvider(backlogApi);
    outputChannel.appendLine('BacklogWikiTreeViewProvider initialized successfully!');

    console.log('Initializing BacklogDocumentsTreeViewProvider...');
    outputChannel.appendLine('Initializing BacklogDocumentsTreeViewProvider...');
    backlogDocumentsProvider = new BacklogDocumentsTreeViewProvider(backlogApi);
    outputChannel.appendLine('BacklogDocumentsTreeViewProvider initialized successfully!');
  } catch (error) {
    console.error('ERROR during additional providers initialization:', error);
    outputChannel.appendLine(`ERROR during additional providers initialization: ${error}`);
    outputChannel.appendLine(`Stack: ${error instanceof Error ? error.stack : 'No stack available'}`);
    vscode.window.showErrorMessage(`Backlog Extension failed to initialize providers: ${error}`);
    return;
  }

  // Register tree views
  console.log('Registering tree views...');
  outputChannel.appendLine('Registering tree views...');

  const projectsTreeView = vscode.window.createTreeView('backlogProjects', {
    treeDataProvider: backlogTreeViewProvider,
    showCollapseAll: true,
  });
  outputChannel.appendLine('Projects tree view registered successfully!');

  const issuesTreeView = vscode.window.createTreeView('backlogIssues', {
    treeDataProvider: backlogIssuesProvider,
    showCollapseAll: true,
  });
  outputChannel.appendLine('Issues tree view registered successfully!');

  const wikiTreeView = vscode.window.createTreeView('backlogWiki', {
    treeDataProvider: backlogWikiProvider,
    showCollapseAll: true,
  });
  outputChannel.appendLine('Wiki tree view registered successfully!');

  const documentsTreeView = vscode.window.createTreeView('backlogDocuments', {
    treeDataProvider: backlogDocumentsProvider,
    showCollapseAll: true,
  });
  outputChannel.appendLine('Documents tree view registered successfully!');

  // Enable the views
  console.log('Enabling views...');
  outputChannel.appendLine('Enabling views...');
  vscode.commands.executeCommand('setContext', 'backlogExplorer.enabled', true);
  vscode.commands.executeCommand('setContext', 'backlogProjectFocused', false);
  outputChannel.appendLine('Views enabled successfully!');

  // Register commands
  console.log('Registering commands...');
  outputChannel.appendLine('Registering commands...');

  const refreshCommand = vscode.commands.registerCommand('backlog.refreshProjects', () => {
    // 全てのプロバイダーをリフレッシュ
    backlogTreeViewProvider.refresh();
    backlogProjectsWebviewProvider.refresh();
    backlogIssuesProvider.refresh();
    backlogWikiProvider.refresh();
    backlogDocumentsProvider.refresh();
  });
  outputChannel.appendLine('Refresh command registered successfully!');

  // 個別のリフレッシュコマンド
  const refreshIssuesCommand = vscode.commands.registerCommand('backlog.refreshIssues', () => {
    backlogIssuesProvider.refresh();
  });

  const refreshWikiCommand = vscode.commands.registerCommand('backlog.refreshWiki', () => {
    backlogWikiProvider.refresh();
  });

  const refreshDocumentsCommand = vscode.commands.registerCommand(
    'backlog.refreshDocuments',
    async () => {
      backlogDocumentsProvider.refresh();
    }
  );

  const openIssueCommand = vscode.commands.registerCommand(
    'backlog.openIssue',
    async (issue: Entity.Issue.Issue) => {
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
          existingPanel.webview.html = IssueWebview.getWebviewContent(
            existingPanel.webview,
            context.extensionUri,
            issueDetail,
            issueComments
          );
          // Success - no notification needed for regular refresh
        } catch (error) {
          existingPanel.webview.html = WebviewHelper.getErrorWebviewContent(`Failed to load issue: ${error}`);
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
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
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

        panel.webview.html = IssueWebview.getWebviewContent(
          panel.webview,
          context.extensionUri,
          issueDetail,
          issueComments,
          configService.getBaseUrl()
        );

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
          async message => {
            switch (message.command) {
              case 'openExternal':
                vscode.env.openExternal(vscode.Uri.parse(message.url));
                break;
              case 'refreshIssue':
                try {
                  // Fetch updated issue details
                  const refreshedIssue = await backlogApi.getIssue(message.issueId);
                  const refreshedComments = await backlogApi.getIssueComments(message.issueId);
                  // Update webview content
                  panel.webview.html = IssueWebview.getWebviewContent(
                    panel.webview,
                    context.extensionUri,
                    refreshedIssue,
                    refreshedComments,
                    configService.getBaseUrl()
                  );
                } catch (error) {
                  console.error('Error refreshing issue:', error);
                  vscode.window.showErrorMessage(`Failed to refresh issue: ${error}`);
                }
                break;
            }
          },
          undefined,
          context.subscriptions
        );
      } catch (error) {
        panel.webview.html = WebviewHelper.getErrorWebviewContent(`Failed to load issue: ${error}`);
      }
    }
  );

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
  const searchProjectsCommand = vscode.commands.registerCommand(
    'backlog.searchProjects',
    async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search projects by name or key',
        placeHolder: 'Enter search query (name, key, or description)',
      });

      if (query !== undefined) {
        await backlogTreeViewProvider.search(query);
      }
    }
  );

  // プロジェクト検索クリア
  const clearProjectSearchCommand = vscode.commands.registerCommand(
    'backlog.clearProjectSearch',
    () => {
      backlogTreeViewProvider.search('');
    }
  );

  // 課題検索コマンド
  const searchCommand = vscode.commands.registerCommand('backlog.search', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search issues by keyword',
      placeHolder: 'Enter search query (title, key, or description)',
    });

    if (query !== undefined) {
      await backlogIssuesProvider.searchIssues(query);
    }
  });

  // フィルタコマンド
  const filterCommand = vscode.commands.registerCommand('backlog.filter', async () => {
    const filterOptions = [
      { label: '🔴 Open Issues Only', description: 'Show only unresolved issues', value: 'open' },
      { label: '🔍 Non-Closed Issues', description: 'Show all issues except closed ones', value: 'nonClosed' },
      { label: '👤 My Issues', description: 'Show issues assigned to me', value: 'my' },
      { label: '⏰ Overdue Issues', description: 'Show issues past due date', value: 'overdue' },
      { label: '🎯 Status Filter', description: 'Filter by specific status', value: 'status' },
      { label: '🔥 Priority Filter', description: 'Filter by priority level', value: 'priority' },
      { label: '👥 Assignee Filter', description: 'Filter by assignee', value: 'assignee' },
      { label: '🧹 Clear All Filters', description: 'Remove all filters and show all issues', value: 'clear' },
    ];

    const selectedFilter = await vscode.window.showQuickPick(filterOptions, {
      placeHolder: 'Select filter type',
    });

    if (!selectedFilter) {
      return;
    }

    switch (selectedFilter.value) {
      case 'open': {
        await backlogIssuesProvider.filterOpenIssues();
        break;
      }

      case 'nonClosed': {
        await backlogIssuesProvider.filterNonClosedIssues();
        break;
      }

      case 'my': {
        await backlogIssuesProvider.filterMyIssues();
        break;
      }

      case 'overdue': {
        await backlogIssuesProvider.filterOverdueIssues();
        break;
      }

      case 'status': {
        const statusOptions = [
          'Open',
          'In Progress',
          'Resolved',
          'Closed',
          'オープン',
          '処理中',
          '解決済み',
          'クローズ',
        ];
        const selectedStatuses = await vscode.window.showQuickPick(statusOptions, {
          canPickMany: true,
          placeHolder: 'Select statuses to filter',
        });
        if (selectedStatuses) {
          await backlogIssuesProvider.filterByStatus(selectedStatuses);
        }
        break;
      }

      case 'priority': {
        const priorityOptions = ['High', 'Medium', 'Low', '高', '中', '低'];
        const selectedPriorities = await vscode.window.showQuickPick(priorityOptions, {
          canPickMany: true,
          placeHolder: 'Select priorities to filter',
        });
        if (selectedPriorities) {
          await backlogIssuesProvider.filterByPriority(selectedPriorities);
        }
        break;
      }

      case 'assignee': {
        const assigneeInput = await vscode.window.showInputBox({
          prompt: 'Enter assignee names (comma-separated)',
          placeHolder: 'e.g., John Doe, Jane Smith, or "Unassigned"',
        });
        if (assigneeInput) {
          const assignees = assigneeInput.split(',').map((a) => a.trim());
          await backlogIssuesProvider.filterByAssignee(assignees);
        }
        break;
      }

      case 'clear': {
        backlogIssuesProvider.clearFilters();
        break;
      }
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
      { label: 'Summary (Z-A)', value: 'summary-desc' },
    ];

    const selected = await vscode.window.showQuickPick(sortOptions, {
      placeHolder: 'Select sort order',
    });

    if (selected) {
      const [sortBy, order] = selected.value.split('-') as [
        'updated' | 'created' | 'priority' | 'status' | 'summary',
        'asc' | 'desc'
      ];
      await backlogTreeViewProvider.sort(sortBy, order);
    }
  });

  // フィルタクリアコマンド
  const clearFiltersCommand = vscode.commands.registerCommand('backlog.clearFilters', () => {
    backlogIssuesProvider.clearFilters();
    backlogTreeViewProvider.clearFilters(); // 後方互換性のため
  });

  // プロジェクトフォーカスコマンド（新しいプロバイダー対応）
  const focusProjectCommand = vscode.commands.registerCommand(
    'backlog.focusProject',
    async (projectId: number) => {
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

        // Focus Backlog sidebar
        await vscode.commands.executeCommand('workbench.view.extension.backlogContainer');

      } catch (error) {
        console.error('Error in focusProject command:', error);
        vscode.window.showErrorMessage(`Failed to focus project: ${error}`);
      }
    }
  );

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

  });

  // Wikiを開くコマンド - エディタでWebviewを開く（選択時に詳細データを取得）
  const openWikiCommand = vscode.commands.registerCommand(
    'backlog.openWiki',
    async (wiki: Entity.Wiki.WikiListItem) => {
      if (wiki) {
        // エディタでWebviewを開く
        const panel = vscode.window.createWebviewPanel(
          'backlogWiki',
          `Wiki: ${wiki.name}`,
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri],
          }
        );

        // Wiki詳細を取得してWebviewの内容を設定
        try {
          const wikiDetail = await backlogApi.getWiki(wiki.id);
          panel.webview.html = WikiWebview.getWebviewContent(
            panel.webview,
            context.extensionUri,
            wikiDetail,
            configService.getBaseUrl()
          );

          // Handle messages from the webview
          panel.webview.onDidReceiveMessage(
            async message => {
              switch (message.command) {
                case 'openExternal':
                  vscode.env.openExternal(vscode.Uri.parse(message.url));
                  break;
                case 'refreshWiki':
                  try {
                    // Fetch updated wiki details
                    const refreshedWiki = await backlogApi.getWiki(message.wikiId);
                    // Update webview content
                    panel.webview.html = WikiWebview.getWebviewContent(
                      panel.webview,
                      context.extensionUri,
                      refreshedWiki,
                      configService.getBaseUrl()
                    );
                  } catch (error) {
                    console.error('Error refreshing wiki:', error);
                    vscode.window.showErrorMessage(`Failed to refresh wiki: ${error}`);
                  }
                  break;
              }
            },
            undefined,
            context.subscriptions
          );
        } catch (error) {
          panel.webview.html = WebviewHelper.getErrorWebviewContent(`Failed to load wiki: ${error}`);
        }
      }
    }
  );

  // ドキュメントを開くコマンド - エディタでWebviewを開く
  const openDocumentCommand = vscode.commands.registerCommand(
    'backlog.openDocument',
    async (document: Entity.Document.DocumentTreeNode) => {
      if (document) {
        // ドキュメントの適切なタイトルを取得（ツリーノードのnameプロパティを使用）
        const documentTitle = document.name || 'Unnamed Document';
        const documentKey = document.id ? document.id.toString() : documentTitle;

        // 既に開いているWebviewがあるかチェック
        const existingPanel = openDocumentWebviews.get(documentKey);
        if (existingPanel) {
          // 既存のパネルをフォーカスしてリフレッシュ
          existingPanel.reveal(vscode.ViewColumn.One);
          return;
        }

        // エディタでWebviewを開く
        const panel = vscode.window.createWebviewPanel(
          'backlogDocument',
          `Document: ${documentTitle}`,
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri],
          }
        );

        // Webviewを追跡に追加
        openDocumentWebviews.set(documentKey, panel);

        // パネルが閉じられた時に追跡から削除
        panel.onDidDispose(() => {
          openDocumentWebviews.delete(documentKey);
        });

        // ドキュメント詳細を取得してWebviewの内容を設定
        try {
          let projectKey = '';

          // プロジェクト情報を取得してプロジェクトキーを特定
          try {
            // 現在フォーカス中のプロジェクトのキーを取得
            projectKey = backlogDocumentsProvider.getCurrentProjectKey() || '';
          } catch (error) {
            console.log('Could not get project key:', error);
          }

          // ドキュメントIDを使って詳細情報を必ず取得
          if (!document.id) {
            throw new Error('Document ID is required to load document details');
          }

          const documentDetail = await backlogApi.getDocument(document.id.toString());

          panel.webview.html = DocumentWebview.getWebviewContent(
            panel.webview,
            context.extensionUri,
            documentDetail,
            configService,
            projectKey
          );

          // Handle messages from the webview
          panel.webview.onDidReceiveMessage(
            async message => {
              switch (message.command) {
                case 'openExternal':
                  vscode.env.openExternal(vscode.Uri.parse(message.url));
                  break;
                case 'refreshDocument':
                  try {
                    // Fetch updated document details
                    const refreshedDocument = await backlogApi.getDocument(message.documentId);
                    // Get project key
                    let refreshProjectKey = '';
                    try {
                      refreshProjectKey = backlogDocumentsProvider.getCurrentProjectKey() || '';
                    } catch (error) {
                      console.log('Could not get project key for refresh:', error);
                    }
                    // Update webview content
                    panel.webview.html = DocumentWebview.getWebviewContent(
                      panel.webview,
                      context.extensionUri,
                      refreshedDocument,
                      configService,
                      refreshProjectKey
                    );
                  } catch (error) {
                    console.error('Error refreshing document:', error);
                    vscode.window.showErrorMessage(`Failed to refresh document: ${error}`);
                  }
                  break;
              }
            },
            undefined,
            context.subscriptions
          );
        } catch (error) {
          panel.webview.html = WebviewHelper.getErrorWebviewContent(`Failed to load document: ${error}`);
        }
      }
    }
  );

  // MCP統合コマンド: 課題更新後に自動オープン・リフレッシュ
  const openIssueAfterMCPOperation = vscode.commands.registerCommand(
    'backlog.openIssueAfterMCPOperation',
    async (issueId: number | string, issueKey?: string) => {
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
          existingPanel.webview.html = IssueWebview.getWebviewContent(
            existingPanel.webview,
            context.extensionUri,
            issueDetail,
            issueComments
          );
        } else {
          // 新しいWebviewを作成
          const panel = vscode.window.createWebviewPanel(
            'backlogIssue',
            `Issue ${resolvedIssueKey}`,
            vscode.ViewColumn.One,
            {
              enableScripts: true,
              retainContextWhenHidden: true,
              localResourceRoots: [context.extensionUri],
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
          panel.webview.html = IssueWebview.getWebviewContent(
            panel.webview,
            context.extensionUri,
            issueDetail,
            issueComments
          );
        }
      } catch (error) {
        console.error('Error in openIssueAfterMCPOperation:', error);
        vscode.window.showErrorMessage(`Failed to open issue after MCP operation: ${error}`);
      }
    }
  );

  // キーボードショートカット: プロジェクトキーでプロジェクトを開く (Win/Linux: Alt+Shift+P, macOS: Ctrl+Shift+P)
  const openProjectByKeyCommand = vscode.commands.registerCommand(
    'backlog.openProjectByKey',
    async () => {
      const projectKey = await vscode.window.showInputBox({
        prompt: 'Enter Backlog project key to open',
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
          const project = projects.find(
            (p) => p.projectKey.toLowerCase() === projectKey.trim().toLowerCase()
          );

          if (project) {
            // プロジェクトにフォーカス
            await vscode.commands.executeCommand('backlog.focusProject', project.id);
          } else {
            vscode.window.showErrorMessage(`Project not found: ${projectKey}`);
          }
        } catch (error) {
          console.error('Error in openProjectByKey:', error);
          vscode.window.showErrorMessage(`Failed to open project: ${error}`);
        }
      }
    }
  );

  // キーボードショートカット: 課題キーで課題を開く (Win/Linux: Alt+Shift+I, macOS: Ctrl+Shift+I)
  const openIssueByKeyCommand = vscode.commands.registerCommand(
    'backlog.openIssueByKey',
    async () => {
      const issueKey = await vscode.window.showInputBox({
        prompt: 'Enter Backlog issue key to open',
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
          // 課題キーからプロジェクトキーを抽出
          const [projectKey] = issueKey.trim().split('-');

          // プロジェクト一覧を取得してプロジェクトIDを見つける
          const projects = await backlogApi.getProjects();
          const project = projects.find(
            (p: Entity.Project.Project) => p.projectKey.toLowerCase() === projectKey.toLowerCase()
          );

          if (!project) {
            vscode.window.showErrorMessage(`Project not found: ${projectKey}`);
            return;
          }

          // MCPサーバーを使用して課題を検索
          try {
            const issueSearchResult = await vscode.commands.executeCommand(
              'backlog.searchIssueByKey',
              issueKey.trim()
            );
            if (issueSearchResult) {
              await vscode.commands.executeCommand('backlog.openIssue', issueSearchResult);
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
    }
  );

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
  console.log('Checking configuration...');
  outputChannel.appendLine('Checking configuration...');
  checkConfiguration(configService);

  console.log('=== BACKLOG EXTENSION ACTIVATION COMPLETED ===');
  outputChannel.appendLine('=== BACKLOG EXTENSION ACTIVATION COMPLETED ===');
  outputChannel.appendLine('Extension is ready to use!');
}

export function deactivate() {
  console.log('Backlog extension is now deactivated');
}

async function checkConfiguration(configService: ConfigService) {
  const domain = configService.getDomain();
  const apiKey = await configService.getApiKey();

  if (!domain || !apiKey) {
    vscode.window
      .showWarningMessage(
        'Backlog domain and API Key are required. Please configure them.',
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
