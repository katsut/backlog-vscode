import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { BacklogTreeViewProvider, ProjectTreeItem } from './providers/treeViewProvider';
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
import { DocumentSyncCommands } from './commands/documentSyncCommands';
import { BacklogRemoteContentProvider } from './providers/backlogRemoteContentProvider';
import { SyncService } from './services/syncService';
import { SyncMappingEditorWebview } from './webviews/syncMappingEditorWebview';
import { DocumentEditorWebview } from './webviews/documentEditorWebview';
import { MarkdownRenderer } from './utils/markdownRenderer';
import { BacklogDocumentEditorProvider } from './providers/backlogDocumentEditorProvider';
import { SyncFileDecorationProvider } from './providers/syncFileDecorationProvider';
import { CacooApiService } from './services/cacooApi';
import { CacooSyncService } from './services/cacooSyncService';
import { CacooCommands } from './commands/cacooCommands';
import { CacooTreeViewProvider } from './providers/cacooTreeViewProvider';
import { TodoTreeViewProvider, TodoTreeItem } from './providers/todoTreeViewProvider';
import { MyTasksTreeViewProvider } from './providers/myTasksTreeViewProvider';
import {
  NotificationsTreeViewProvider,
  NotificationTreeItem,
} from './providers/notificationsTreeViewProvider';
import { SlackApiService } from './services/slackApi';
import { SlackTreeViewProvider, SlackMentionItem } from './providers/slackTreeViewProvider';
import { SlackSearchTreeViewProvider } from './providers/slackSearchTreeViewProvider';
import {
  DocumentFilesTreeViewProvider,
  MappingItem,
} from './providers/documentFilesTreeViewProvider';
import { SlackThreadWebview } from './webviews/slackThreadWebview';
import { TodoWebview } from './webviews/todoWebview';
import { PollingService } from './services/pollingService';
import { GoogleApiService } from './services/googleApi';
import {
  GoogleCalendarTreeViewProvider,
  DocumentItem,
  EventItem,
} from './providers/googleCalendarTreeViewProvider';
import { MeetingNotesWebview } from './webviews/meetingNotesWebview';
import { GoogleDriveFile, GoogleCalendarEvent } from './types/google';
import * as fs from 'fs';
import * as path from 'path';
import { NOTIFICATION_REASONS, SlackMessage, TodoContext, TodoStatus } from './types/workspace';
import { AnthropicService } from './services/anthropicService';
import { SessionService } from './services/sessionService';
import { SessionCodeLensProvider } from './providers/sessionCodeLensProvider';

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

// 開いているCacoo Sheet Webviewを追跡
const openCacooSheetPanels: Map<string, vscode.WebviewPanel> = new Map();

export function activate(context: vscode.ExtensionContext) {
  console.log('Backlog extension activating...');
  let configService: ConfigService;
  let backlogApi: BacklogApiService;

  try {
    configService = new ConfigService(context.secrets, context.globalState);
    backlogApi = new BacklogApiService(configService);
    backlogTreeViewProvider = new BacklogTreeViewProvider(backlogApi, configService);
    backlogWebviewProvider = new BacklogWebviewProvider(context.extensionUri, backlogApi);
  } catch (error) {
    console.error('ERROR during extension activation:', error);
    vscode.window.showErrorMessage(`[Nulab] Backlog Extension failed to activate: ${error}`);
    return;
  }

  backlogProjectsWebviewProvider = new BacklogProjectsWebviewProvider(
    context.extensionUri,
    backlogApi
  );
  backlogIssuesProvider = new BacklogIssuesTreeViewProvider(backlogApi);
  backlogWikiProvider = new BacklogWikiTreeViewProvider(backlogApi);
  const syncService = new SyncService();
  backlogDocumentsProvider = new BacklogDocumentsTreeViewProvider(
    backlogApi,
    configService,
    syncService
  );

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

  vscode.commands.executeCommand('setContext', 'nulabExplorer.enabled', true);
  vscode.commands.executeCommand('setContext', 'nulabProjectFocused', false);

  const refreshCommand = vscode.commands.registerCommand('nulab.refreshProjects', () => {
    backlogTreeViewProvider.refresh();
    backlogProjectsWebviewProvider.refresh();
    backlogIssuesProvider.refresh();
    backlogWikiProvider.refresh();
    backlogDocumentsProvider.refresh();
  });

  // 個別のリフレッシュコマンド
  const refreshIssuesCommand = vscode.commands.registerCommand('nulab.refreshIssues', () => {
    backlogIssuesProvider.refresh();
  });

  const refreshWikiCommand = vscode.commands.registerCommand('nulab.refreshWiki', () => {
    backlogWikiProvider.refresh();
  });

  const refreshDocumentsCommand = vscode.commands.registerCommand(
    'nulab.refreshDocuments',
    async () => {
      backlogDocumentsProvider.refresh();
    }
  );

  const filterModifiedDocumentsCommand = vscode.commands.registerCommand(
    'nulab.filterModifiedDocuments',
    () => {
      const active = backlogDocumentsProvider.toggleFilterModified();
      vscode.window.showInformationMessage(
        active ? '[Nulab] Documents: 変更ありのみ表示' : '[Nulab] Documents: フィルタ解除'
      );
    }
  );

  const openIssueCommand = vscode.commands.registerCommand(
    'nulab.openIssue',
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
          existingPanel.webview.html = await IssueWebview.getWebviewContent(
            existingPanel.webview,
            context.extensionUri,
            issueDetail,
            issueComments,
            undefined,
            backlogApi
          );
          // Success - no notification needed for regular refresh
        } catch (error) {
          existingPanel.webview.html = WebviewHelper.getErrorWebviewContent(
            `Failed to load issue: ${error}`
          );
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

        panel.webview.html = await IssueWebview.getWebviewContent(
          panel.webview,
          context.extensionUri,
          issueDetail,
          issueComments,
          configService.getBaseUrl(),
          backlogApi
        );

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
          async (message) => {
            switch (message.command) {
              case 'openExternal':
                vscode.env.openExternal(vscode.Uri.parse(message.url));
                break;
              case 'addToTodo': {
                const defaultText = `[${issue.issueKey}] ${issue.summary}`;
                const text = await vscode.window.showInputBox({
                  prompt: 'TODO を入力',
                  value: defaultText,
                });
                if (text) {
                  todoProvider.addTodo(text, {
                    source: 'backlog-notification',
                    issueKey: issue.issueKey,
                    issueId: issue.id,
                    issueSummary: issue.summary,
                  });
                  vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
                }
                break;
              }
              case 'refreshIssue':
                try {
                  // Fetch updated issue details
                  const refreshedIssue = await backlogApi.getIssue(message.issueId);
                  const refreshedComments = await backlogApi.getIssueComments(message.issueId);
                  // Update webview content
                  panel.webview.html = await IssueWebview.getWebviewContent(
                    panel.webview,
                    context.extensionUri,
                    refreshedIssue,
                    refreshedComments,
                    configService.getBaseUrl(),
                    backlogApi
                  );
                } catch (error) {
                  console.error('Error refreshing issue:', error);
                  vscode.window.showErrorMessage(`[Nulab] Failed to refresh issue: ${error}`);
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

  const openSettingsCommand = vscode.commands.registerCommand('nulab.openSettings', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', 'nulab');
  });

  const setApiKeyCommand = vscode.commands.registerCommand('nulab.setApiKey', async () => {
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
        '[Nulab] API Key has been set successfully and stored securely.'
      );
    }
  });

  // プロジェクト検索コマンド
  const searchProjectsCommand = vscode.commands.registerCommand(
    'nulab.searchProjects',
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
    'nulab.clearProjectSearch',
    () => {
      backlogTreeViewProvider.search('');
    }
  );

  // 課題検索コマンド
  const searchCommand = vscode.commands.registerCommand('nulab.search', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search issues by keyword',
      placeHolder: 'Enter search query (title, key, or description)',
    });

    if (query !== undefined) {
      await backlogIssuesProvider.searchIssues(query);
    }
  });

  // フィルタコマンド
  const filterCommand = vscode.commands.registerCommand('nulab.filter', async () => {
    const filterOptions = [
      { label: '🔴 Open Issues Only', description: 'Show only unresolved issues', value: 'open' },
      {
        label: '🔍 Non-Closed Issues',
        description: 'Show all issues except closed ones',
        value: 'nonClosed',
      },
      { label: '👤 My Issues', description: 'Show issues assigned to me', value: 'my' },
      { label: '⏰ Overdue Issues', description: 'Show issues past due date', value: 'overdue' },
      { label: '🎯 Status Filter', description: 'Filter by specific status', value: 'status' },
      { label: '🔥 Priority Filter', description: 'Filter by priority level', value: 'priority' },
      { label: '👥 Assignee Filter', description: 'Filter by assignee', value: 'assignee' },
      {
        label: '🧹 Clear All Filters',
        description: 'Remove all filters and show all issues',
        value: 'clear',
      },
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
  const sortCommand = vscode.commands.registerCommand('nulab.sort', async () => {
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
  const clearFiltersCommand = vscode.commands.registerCommand('nulab.clearFilters', () => {
    backlogIssuesProvider.clearFilters();
    backlogTreeViewProvider.clearFilters(); // 後方互換性のため
  });

  // プロジェクトフォーカスコマンド（新しいプロバイダー対応）
  const focusProjectCommand = vscode.commands.registerCommand(
    'nulab.focusProject',
    async (projectId: number) => {
      try {
        await backlogIssuesProvider.setProject(projectId);
        await backlogWikiProvider.setProject(projectId);
        await backlogDocumentsProvider.setProject(projectId);
        await vscode.commands.executeCommand('setContext', 'nulabProjectFocused', true);
        await backlogTreeViewProvider.focusProject(projectId);
        await vscode.commands.executeCommand('workbench.view.extension.backlogContainer');
      } catch (error) {
        console.error('Error in focusProject command:', error);
        vscode.window.showErrorMessage(`[Nulab] Failed to focus project: ${error}`);
      }
    }
  );

  // プロジェクトフォーカス解除コマンド
  const unfocusProjectCommand = vscode.commands.registerCommand('nulab.unfocusProject', () => {
    // 各プロバイダーをクリア
    backlogIssuesProvider.clearProject();
    backlogWikiProvider.clearProject();
    backlogDocumentsProvider.clearProject();

    // プロジェクトフォーカス状態を無効にする
    vscode.commands.executeCommand('setContext', 'nulabProjectFocused', false);

    // 旧プロバイダーも更新
    backlogTreeViewProvider.unfocusProject();
  });

  // Wikiを開くコマンド - エディタでWebviewを開く（選択時に詳細データを取得）
  const openWikiCommand = vscode.commands.registerCommand(
    'nulab.openWiki',
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
          panel.webview.html = await WikiWebview.getWebviewContent(
            panel.webview,
            context.extensionUri,
            wikiDetail,
            configService.getBaseUrl(),
            backlogApi
          );

          // Handle messages from the webview
          panel.webview.onDidReceiveMessage(
            async (message) => {
              switch (message.command) {
                case 'openExternal':
                  vscode.env.openExternal(vscode.Uri.parse(message.url));
                  break;
                case 'refreshWiki':
                  try {
                    // Fetch updated wiki details
                    const refreshedWiki = await backlogApi.getWiki(message.wikiId);
                    // Update webview content
                    panel.webview.html = await WikiWebview.getWebviewContent(
                      panel.webview,
                      context.extensionUri,
                      refreshedWiki,
                      configService.getBaseUrl(),
                      backlogApi
                    );
                  } catch (error) {
                    console.error('Error refreshing wiki:', error);
                    vscode.window.showErrorMessage(`[Nulab] Failed to refresh wiki: ${error}`);
                  }
                  break;
              }
            },
            undefined,
            context.subscriptions
          );
        } catch (error) {
          panel.webview.html = WebviewHelper.getErrorWebviewContent(
            `Failed to load wiki: ${error}`
          );
        }
      }
    }
  );

  // Helper: find synced .bdoc file by Backlog document ID
  function findSyncedFile(documentId: string): string | null {
    const mappings = configService.getDocumentSyncMappings();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || mappings.length === 0) {
      return null;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    for (const mapping of mappings) {
      const localDir = require('path').resolve(rootPath, mapping.localPath);
      const manifest = syncService.loadManifest(localDir);
      for (const [relativePath, entry] of Object.entries(manifest)) {
        if (entry.backlog_id === documentId) {
          return require('path').join(localDir, relativePath);
        }
      }
    }
    return null;
  }

  // ドキュメントを開くコマンド - エディタでWebviewを開く
  const openDocumentCommand = vscode.commands.registerCommand(
    'nulab.openDocument',
    async (document: Entity.Document.DocumentTreeNode) => {
      if (document) {
        // ドキュメントの適切なタイトルを取得（ツリーノードのnameプロパティを使用）
        const documentTitle = document.name || 'Unnamed Document';
        const documentKey = document.id ? document.id.toString() : documentTitle;

        // 既に開いているWebviewがあるかチェック
        const existingPanel = openDocumentWebviews.get(documentKey);
        if (existingPanel) {
          // 既存のパネルをフォーカスしてコンテンツを再描画
          existingPanel.reveal(vscode.ViewColumn.One);
          try {
            const projectKey = backlogDocumentsProvider.getCurrentProjectKey() || '';
            const documentDetail = await backlogApi.getDocument(document.id!.toString());
            existingPanel.webview.html = await DocumentWebview.getWebviewContent(
              existingPanel.webview,
              context.extensionUri,
              documentDetail,
              configService,
              backlogApi,
              projectKey
            );
          } catch (error) {
            console.error('Error refreshing existing document panel:', error);
          }
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
          // 現在フォーカス中のプロジェクトのキーを取得
          const projectKey = backlogDocumentsProvider.getCurrentProjectKey() || '';

          // ドキュメントIDを使って詳細情報を必ず取得
          if (!document.id) {
            throw new Error('Document ID is required to load document details');
          }

          const documentDetail = await backlogApi.getDocument(document.id.toString());

          panel.webview.html = await DocumentWebview.getWebviewContent(
            panel.webview,
            context.extensionUri,
            documentDetail,
            configService,
            backlogApi,
            projectKey
          );

          // Handle messages from the webview
          panel.webview.onDidReceiveMessage(
            async (message) => {
              switch (message.command) {
                case 'openExternal':
                  vscode.env.openExternal(vscode.Uri.parse(message.url));
                  break;
                case 'refreshDocument':
                  try {
                    const refreshedDocument = await backlogApi.getDocument(message.documentId);
                    const refreshProjectKey = backlogDocumentsProvider.getCurrentProjectKey() || '';
                    panel.webview.html = await DocumentWebview.getWebviewContent(
                      panel.webview,
                      context.extensionUri,
                      refreshedDocument,
                      configService,
                      backlogApi,
                      refreshProjectKey
                    );
                  } catch (error) {
                    console.error('Error refreshing document:', error);
                    vscode.window.showErrorMessage(`[Nulab] Failed to refresh document: ${error}`);
                  }
                  break;
                case 'switchMode': {
                  const docId = message.documentId;
                  if (message.mode === 'pull') {
                    // Pull doesn't need a local file — delegates to Pull command
                    await vscode.commands.executeCommand('nulab.documentSync.pull');
                    break;
                  }
                  if (message.mode === 'copyOpen') {
                    const localFile = findSyncedFile(docId);
                    if (localFile) {
                      await vscode.commands.executeCommand(
                        'nulab.documentSync.copyAndOpen',
                        localFile
                      );
                    } else {
                      vscode.window.showWarningMessage(
                        '[Nulab] ローカルファイルが見つかりません。先に Pull してください。'
                      );
                    }
                    break;
                  }
                  // edit / diff — need local file
                  const syncedFile = findSyncedFile(docId);
                  if (!syncedFile) {
                    vscode.window.showWarningMessage(
                      '[Nulab] ローカルファイルが見つかりません。先に Pull してください。'
                    );
                    break;
                  }
                  if (message.mode === 'edit') {
                    await vscode.commands.executeCommand(
                      'vscode.open',
                      vscode.Uri.file(syncedFile)
                    );
                  } else if (message.mode === 'diff') {
                    await vscode.commands.executeCommand('nulab.documentSync.diff', syncedFile);
                  }
                  break;
                }
              }
            },
            undefined,
            context.subscriptions
          );
        } catch (error) {
          panel.webview.html = WebviewHelper.getErrorWebviewContent(
            `Failed to load document: ${error}`
          );
        }
      }
    }
  );

  // MCP統合コマンド: 課題更新後に自動オープン・リフレッシュ
  const openIssueAfterMCPOperation = vscode.commands.registerCommand(
    'nulab.openIssueAfterMCPOperation',
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
          existingPanel.webview.html = await IssueWebview.getWebviewContent(
            existingPanel.webview,
            context.extensionUri,
            issueDetail,
            issueComments,
            undefined,
            backlogApi
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
          panel.webview.html = await IssueWebview.getWebviewContent(
            panel.webview,
            context.extensionUri,
            issueDetail,
            issueComments,
            undefined,
            backlogApi
          );

          panel.webview.onDidReceiveMessage(
            async (message) => {
              if (message.command === 'openExternal' && message.url) {
                vscode.env.openExternal(vscode.Uri.parse(message.url));
              }
              if (message.command === 'addToTodo') {
                const defaultText = `[${issueDetail.issueKey}] ${issueDetail.summary}`;
                const text = await vscode.window.showInputBox({
                  prompt: 'TODO を入力',
                  value: defaultText,
                });
                if (text) {
                  todoProvider.addTodo(text, {
                    source: 'backlog-notification',
                    issueKey: issueDetail.issueKey,
                    issueId: issueDetail.id,
                    issueSummary: issueDetail.summary,
                  });
                  vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
                }
              }
            },
            undefined,
            context.subscriptions
          );
        }
      } catch (error) {
        console.error('Error in openIssueAfterMCPOperation:', error);
        vscode.window.showErrorMessage(
          `[Nulab] Failed to open issue after MCP operation: ${error}`
        );
      }
    }
  );

  // キーボードショートカット: プロジェクトキーでプロジェクトを開く (Win/Linux: Alt+Shift+P, macOS: Ctrl+Shift+P)
  const openProjectByKeyCommand = vscode.commands.registerCommand(
    'nulab.openProjectByKey',
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
            await vscode.commands.executeCommand('nulab.focusProject', project.id);
          } else {
            vscode.window.showErrorMessage(`[Nulab] Project not found: ${projectKey}`);
          }
        } catch (error) {
          console.error('Error in openProjectByKey:', error);
          vscode.window.showErrorMessage(`[Nulab] Failed to open project: ${error}`);
        }
      }
    }
  );

  // キーボードショートカット: 課題キーで課題を開く (Win/Linux: Alt+Shift+I, macOS: Ctrl+Shift+I)
  const openIssueByKeyCommand = vscode.commands.registerCommand(
    'nulab.openIssueByKey',
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
          const trimmedKey = issueKey.trim();

          // 既に開いているWebviewがあるかチェック
          const existingPanel = openIssueWebviews.get(trimmedKey);
          if (existingPanel) {
            existingPanel.reveal(vscode.ViewColumn.One);
            return;
          }

          // 新しいWebviewを作成
          const panel = vscode.window.createWebviewPanel(
            'backlogIssue',
            `Issue ${trimmedKey}`,
            vscode.ViewColumn.One,
            {
              enableScripts: true,
              retainContextWhenHidden: true,
              localResourceRoots: [context.extensionUri],
            }
          );

          // Webviewを追跡に追加
          openIssueWebviews.set(trimmedKey, panel);

          // パネルが閉じられた時に追跡から削除
          panel.onDidDispose(() => {
            openIssueWebviews.delete(trimmedKey);
          });

          // 読み込み中表示
          panel.webview.html = WebviewHelper.getLoadingWebviewContent('Loading issue...');

          try {
            let issueSearchResult: Entity.Issue.Issue | null = null;
            const projectKey = trimmedKey.split('-')[0];

            try {
              // Get projects and find the matching project
              const projects = await backlogApi.getProjects();
              const project = projects.find(
                (p: Entity.Project.Project) =>
                  p.projectKey.toLowerCase() === projectKey.toLowerCase()
              );

              if (project) {
                // Focus the project first
                await vscode.commands.executeCommand('nulab.focusProject', project.id);

                // Search for the specific issue by key
                const issues = await backlogApi.getProjectIssues(project.id, {
                  keyword: trimmedKey,
                });

                // Find exact match
                issueSearchResult =
                  issues.find((issue: Entity.Issue.Issue) => issue.issueKey === trimmedKey) || null;
              }
            } catch (apiError) {
              console.error('API search failed:', apiError);
            }

            if (issueSearchResult) {
              // プロジェクトがフォーカスされていない場合はフォーカス
              const projectKey = trimmedKey.split('-')[0];
              const projects = await backlogApi.getProjects();
              const project = projects.find(
                (p: Entity.Project.Project) =>
                  p.projectKey.toLowerCase() === projectKey.toLowerCase()
              );

              if (project) {
                // プロジェクトをフォーカス（既にフォーカス済みでも問題なし）
                await vscode.commands.executeCommand('nulab.focusProject', project.id);
              }

              // 課題詳細とコメントを取得
              const [issueDetail, issueComments] = await Promise.all([
                backlogApi.getIssue(issueSearchResult.id),
                backlogApi.getIssueComments(issueSearchResult.id),
              ]);

              panel.webview.html = await IssueWebview.getWebviewContent(
                panel.webview,
                context.extensionUri,
                issueDetail,
                issueComments,
                configService.getBaseUrl(),
                backlogApi
              );

              // Handle messages from the webview
              panel.webview.onDidReceiveMessage(
                async (message) => {
                  switch (message.command) {
                    case 'openExternal':
                      vscode.env.openExternal(vscode.Uri.parse(message.url));
                      break;
                    case 'addToTodo': {
                      const defaultText = `[${issueDetail.issueKey}] ${issueDetail.summary}`;
                      const text = await vscode.window.showInputBox({
                        prompt: 'TODO を入力',
                        value: defaultText,
                      });
                      if (text) {
                        todoProvider.addTodo(text, {
                          source: 'backlog-notification',
                          issueKey: issueDetail.issueKey,
                          issueId: issueDetail.id,
                          issueSummary: issueDetail.summary,
                        });
                        vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
                      }
                      break;
                    }
                    case 'refreshIssue':
                      try {
                        const [refreshedIssue, refreshedComments] = await Promise.all([
                          backlogApi.getIssue(message.issueId),
                          backlogApi.getIssueComments(message.issueId),
                        ]);
                        panel.webview.html = await IssueWebview.getWebviewContent(
                          panel.webview,
                          context.extensionUri,
                          refreshedIssue,
                          refreshedComments,
                          configService.getBaseUrl(),
                          backlogApi
                        );
                      } catch (error) {
                        console.error('Error refreshing issue:', error);
                        vscode.window.showErrorMessage(`[Nulab] Failed to refresh issue: ${error}`);
                      }
                      break;
                  }
                },
                undefined,
                context.subscriptions
              );
            } else {
              panel.webview.html = WebviewHelper.getErrorWebviewContent(
                `Issue not found: ${trimmedKey}. Please check the issue key and project permissions.`
              );
            }
          } catch (error) {
            console.error('Failed to find issue:', error);
            panel.webview.html = WebviewHelper.getErrorWebviewContent(
              `Failed to find issue: ${trimmedKey}. Error: ${error}`
            );
          }
        } catch (error) {
          console.error('Error in openIssueByKey:', error);
          vscode.window.showErrorMessage(`[Nulab] Failed to open issue: ${error}`);
        }
      }
    }
  );

  // Toggle Favorite command
  const toggleFavoriteCommand = vscode.commands.registerCommand(
    'nulab.toggleFavorite',
    (item: ProjectTreeItem) => {
      if (item?.project?.projectKey) {
        backlogTreeViewProvider.toggleFavorite(item.project.projectKey);
      }
    }
  );

  // Set Document Sync Mapping command
  const setDocumentSyncMappingCommand = vscode.commands.registerCommand(
    'nulab.setDocumentSyncMapping',
    async (item?: { document?: { id?: string; name?: string } }) => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('[Nulab] ワークスペースを開いてください。');
        return;
      }

      const projectKey = backlogDocumentsProvider.getCurrentProjectKey();
      if (!projectKey) {
        vscode.window.showWarningMessage('[Nulab] プロジェクトをフォーカスしてください。');
        return;
      }

      // ドキュメントノード情報を取得 (右クリックから or 手動入力)
      let documentNodeId: string | undefined;
      let documentNodeName: string | undefined;

      if (item?.document?.id) {
        documentNodeId = item.document.id;
        documentNodeName = item.document.name;
      } else {
        documentNodeId = await vscode.window.showInputBox({
          prompt: 'Backlog ドキュメントノード ID を入力',
          placeHolder: '例: 01934345404771adb2113d7792bb4351',
        });
        if (!documentNodeId) {
          return;
        }
      }

      // ローカルディレクトリの入力（デフォルトパスを提案）
      const suggestedName = (documentNodeName || 'documents').replace(/[<>:"/\\|?*]/g, '-');
      const defaultPath = `docs/${projectKey}/${suggestedName}`;

      const localPath = await vscode.window.showInputBox({
        prompt: 'ワークスペースからの相対パスを入力',
        value: defaultPath,
        placeHolder: '例: docs/PROJECT/folder-name',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'パスを入力してください';
          }
          if (value.startsWith('/') || value.includes('..')) {
            return 'ワークスペース内の相対パスを入力してください';
          }
          return null;
        },
      });

      if (!localPath) {
        return;
      }

      configService.addDocumentSyncMapping({
        localPath,
        projectKey,
        documentNodeId,
        documentNodeName,
      });

      vscode.window.showInformationMessage(
        `[Nulab] マッピングを設定しました: ${localPath} ↔ ${documentNodeName || documentNodeId}`
      );
    }
  );

  // Register content providers for diff view
  const remoteContentProvider = new BacklogRemoteContentProvider(backlogApi);
  const remoteProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
    'backlog-remote',
    remoteContentProvider
  );
  const localProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
    'backlog-local',
    remoteContentProvider
  );

  // File decoration provider for .bdoc sync status
  const syncDecorationProvider = new SyncFileDecorationProvider(syncService, configService);
  const decorationProviderDisposable =
    vscode.window.registerFileDecorationProvider(syncDecorationProvider);

  // Document sync commands
  const syncCommands = new DocumentSyncCommands(
    backlogApi,
    configService,
    remoteContentProvider,
    syncDecorationProvider
  );

  const syncPullCommand = vscode.commands.registerCommand('nulab.documentSync.pull', () =>
    syncCommands.pull()
  );

  const syncStatusCommand = vscode.commands.registerCommand('nulab.documentSync.status', () =>
    syncCommands.status()
  );

  const syncDiffCommand = vscode.commands.registerCommand(
    'nulab.documentSync.diff',
    (filePath?: string) => syncCommands.diff(filePath)
  );

  const syncCopyAndOpenCommand = vscode.commands.registerCommand(
    'nulab.documentSync.copyAndOpen',
    (filePath?: string) => syncCommands.copyAndOpen(filePath)
  );

  const syncPushCommand = vscode.commands.registerCommand(
    'nulab.documentSync.push',
    (filePath?: string) => syncCommands.push(filePath)
  );

  const syncPullFileCommand = vscode.commands.registerCommand(
    'nulab.documentSync.pullFile',
    (filePath?: string) => syncCommands.pullFile(filePath)
  );

  // Edit Document Sync Mapping editor
  let mappingEditorPanel: vscode.WebviewPanel | undefined;
  const editDocumentSyncMappingCommand = vscode.commands.registerCommand(
    'nulab.editDocumentSyncMapping',
    async () => {
      if (mappingEditorPanel) {
        mappingEditorPanel.reveal(vscode.ViewColumn.One);
        return;
      }

      mappingEditorPanel = vscode.window.createWebviewPanel(
        'backlogSyncMappingEditor',
        'Document Sync Mapping',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        }
      );

      mappingEditorPanel.onDidDispose(() => {
        mappingEditorPanel = undefined;
      });

      try {
        const projects = await backlogApi.getProjects();
        const currentProjectKey = backlogDocumentsProvider.getCurrentProjectKey();
        let documentTree = null;

        if (currentProjectKey) {
          const project = projects.find((p) => p.projectKey === currentProjectKey);
          if (project) {
            try {
              documentTree = await backlogApi.getDocuments(project.id);
            } catch {
              // Documents may be disabled for this project
            }
          }
        }

        const mappings = configService.getDocumentSyncMappings();
        const favorites = configService.getFavoriteProjects();
        mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
          mappingEditorPanel.webview,
          context.extensionUri,
          projects,
          documentTree,
          mappings,
          currentProjectKey || undefined,
          favorites
        );

        mappingEditorPanel.webview.onDidReceiveMessage(
          async (message) => {
            if (!mappingEditorPanel) {
              return;
            }

            switch (message.command) {
              case 'selectProject': {
                let tree = null;
                try {
                  tree = await backlogApi.getDocuments(message.projectId);
                } catch {
                  // Documents may be disabled for this project
                }
                const currentMappings = configService.getDocumentSyncMappings();
                mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
                  mappingEditorPanel.webview,
                  context.extensionUri,
                  projects,
                  tree,
                  currentMappings,
                  message.projectKey,
                  configService.getFavoriteProjects()
                );
                break;
              }
              case 'addMapping': {
                configService.addDocumentSyncMapping({
                  localPath: message.localPath,
                  projectKey: message.projectKey,
                  documentNodeId: message.documentNodeId,
                  documentNodeName: message.documentNodeName,
                });
                // Re-fetch tree to update mapped badges
                let addTree = null;
                try {
                  const proj = projects.find((p) => p.projectKey === message.projectKey);
                  if (proj) {
                    addTree = await backlogApi.getDocuments(proj.id);
                  }
                } catch {
                  /* ignore */
                }
                mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
                  mappingEditorPanel.webview,
                  context.extensionUri,
                  projects,
                  addTree,
                  configService.getDocumentSyncMappings(),
                  message.projectKey,
                  configService.getFavoriteProjects()
                );
                break;
              }
              case 'removeMapping': {
                configService.removeDocumentSyncMapping(message.projectKey, message.documentNodeId);
                // Re-render full page to update both tree buttons and mappings list
                let removeTree = null;
                try {
                  const proj = projects.find((p) => p.projectKey === message.projectKey);
                  if (proj) {
                    removeTree = await backlogApi.getDocuments(proj.id);
                  }
                } catch {
                  /* ignore */
                }
                mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
                  mappingEditorPanel.webview,
                  context.extensionUri,
                  projects,
                  removeTree,
                  configService.getDocumentSyncMappings(),
                  message.projectKey,
                  configService.getFavoriteProjects()
                );
                break;
              }
              case 'updateMappingPath': {
                // Find existing mapping and update its path
                const allMappings = configService.getDocumentSyncMappings();
                const existing = allMappings.find(
                  (m) =>
                    m.projectKey === message.projectKey &&
                    m.documentNodeId === message.documentNodeId
                );
                if (existing) {
                  configService.addDocumentSyncMapping({
                    ...existing,
                    localPath: message.localPath,
                  });
                }
                break;
              }
            }
          },
          undefined,
          context.subscriptions
        );
      } catch (error) {
        mappingEditorPanel.webview.html = WebviewHelper.getErrorWebviewContent(
          `Failed to load: ${error}`
        );
      }
    }
  );

  // Custom editor provider for .bdoc files
  const markdownRenderer = MarkdownRenderer.getInstance();
  const bdocEditorProvider = new BacklogDocumentEditorProvider(
    context,
    syncService,
    configService,
    markdownRenderer
  );
  const bdocEditorRegistration = vscode.window.registerCustomEditorProvider(
    BacklogDocumentEditorProvider.viewType,
    bdocEditorProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // Document Editor command (fallback for .bdoc files opened via command)
  const openDocumentEditors: Map<string, vscode.WebviewPanel> = new Map();

  const documentSyncEditCommand = vscode.commands.registerCommand(
    'nulab.documentSync.edit',
    async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showWarningMessage('[Nulab] エディタでファイルを開いてください。');
        return;
      }

      const filePath = activeEditor.document.uri.fsPath;
      if (!filePath.endsWith('.bdoc') && !filePath.endsWith('.md')) {
        vscode.window.showWarningMessage('[Nulab] .bdoc または .md ファイルを開いてください。');
        return;
      }

      // Check if already open
      const existingPanel = openDocumentEditors.get(filePath);
      if (existingPanel) {
        existingPanel.reveal(vscode.ViewColumn.One);
        return;
      }

      const text = fs.readFileSync(filePath, 'utf-8');
      const { meta, body } = syncService.parseFrontmatter(text);

      const title =
        meta.title ||
        require('path').basename(filePath, filePath.endsWith('.bdoc') ? '.bdoc' : '.md');

      const docDir = require('path').dirname(filePath);
      const panel = vscode.window.createWebviewPanel(
        'backlogDocumentEditor',
        `Edit: ${title}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri, vscode.Uri.file(docDir)],
        }
      );

      openDocumentEditors.set(filePath, panel);
      panel.onDidDispose(() => {
        openDocumentEditors.delete(filePath);
      });

      // Pre-render preview HTML with local image resolution
      const resolveLocalImages = (content: string, webview: vscode.Webview) => {
        return content.replace(
          /!\[([^\]]*)\]\((\.images\/[^)]+)\)/g,
          (_m: string, alt: string, rel: string) => {
            const abs = require('path').join(docDir, rel);
            if (fs.existsSync(abs)) {
              return `![${alt}](${webview.asWebviewUri(vscode.Uri.file(abs))})`;
            }
            return _m;
          }
        );
      };
      const resolveLocalImagesInHtml = (html: string, webview: vscode.Webview) => {
        return html.replace(/src="(\.images\/[^"]+)"/g, (_m: string, rel: string) => {
          const abs = require('path').join(docDir, rel);
          if (fs.existsSync(abs)) {
            return `src="${webview.asWebviewUri(vscode.Uri.file(abs))}"`;
          }
          return _m;
        });
      };

      const processedBody = resolveLocalImages(body, panel.webview);
      let initialPreviewHtml = markdownRenderer.renderMarkdown(processedBody);
      initialPreviewHtml = resolveLocalImagesInHtml(initialPreviewHtml, panel.webview);

      panel.webview.html = DocumentEditorWebview.getWebviewContent(
        panel.webview,
        context.extensionUri,
        {
          title,
          backlogId: meta.backlog_id || '',
          project: meta.project || '',
          syncedAt: meta.synced_at || '',
          updatedAt: meta.updated_at || '',
          filePath,
        },
        body,
        initialPreviewHtml
      );

      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case 'save': {
              try {
                const frontmatter = syncService.buildFrontmatter({
                  title: meta.title || title,
                  backlog_id: meta.backlog_id || '',
                  project: meta.project || '',
                  synced_at: meta.synced_at || '',
                  updated_at: meta.updated_at || '',
                });
                fs.writeFileSync(filePath, frontmatter + message.content, 'utf-8');
                panel.webview.postMessage({ type: 'saved' });
              } catch (error) {
                panel.webview.postMessage({
                  type: 'saveError',
                  error: error instanceof Error ? error.message : String(error),
                });
              }
              break;
            }
            case 'requestPreview': {
              const resolved = resolveLocalImages(message.content, panel.webview);
              let html = markdownRenderer.renderMarkdown(resolved);
              html = resolveLocalImagesInHtml(html, panel.webview);
              panel.webview.postMessage({ type: 'previewReady', html });
              break;
            }
            case 'pull': {
              await vscode.commands.executeCommand('nulab.documentSync.pullFile', filePath);
              break;
            }
            case 'diff': {
              await vscode.commands.executeCommand('nulab.documentSync.diff', filePath);
              break;
            }
            case 'copyAndOpen': {
              await vscode.env.clipboard.writeText(message.content);
              const domain = configService.getDomain();
              if (domain && meta.backlog_id) {
                const hostOnly = domain.replace(/https?:\/\//, '').split('/')[0];
                const projectKey = meta.project || '';
                const url = `https://${hostOnly}/document/${projectKey}/${meta.backlog_id}`;
                await vscode.env.openExternal(vscode.Uri.parse(url));
              }
              vscode.window.showInformationMessage(
                '[Nulab] コンテンツをクリップボードにコピーしました。'
              );
              break;
            }
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  // ---- Cacoo Integration ----
  const cacooApi = new CacooApiService(configService);
  const cacooSyncService = new CacooSyncService();
  const cacooCommands = new CacooCommands(cacooApi, configService, cacooSyncService);
  const cacooTreeProvider = new CacooTreeViewProvider(cacooApi, configService);

  const cacooTreeView = vscode.window.createTreeView('cacooDiagrams', {
    treeDataProvider: cacooTreeProvider,
    showCollapseAll: true,
  });

  const cacooRefreshCommand = vscode.commands.registerCommand('cacoo.refreshDiagrams', () => {
    cacooTreeProvider.refresh();
  });

  const cacooSearchCommand = vscode.commands.registerCommand('cacoo.searchDiagrams', () => {
    cacooTreeProvider.search();
  });

  const cacooSetApiKeyCommand = vscode.commands.registerCommand('cacoo.setApiKey', () => {
    cacooCommands.setApiKey();
  });

  const cacooPreviewSheetCommand = vscode.commands.registerCommand(
    'cacoo.previewSheet',
    (diagramId: string, sheetUid: string, title: string) => {
      cacooCommands.previewSheet(context, openCacooSheetPanels, diagramId, sheetUid, title);
    }
  );

  const cacooOpenInBrowserCommand = vscode.commands.registerCommand(
    'cacoo.openInBrowser',
    (item) => {
      cacooCommands.openInBrowser(item);
    }
  );

  const cacooTogglePinCommand = vscode.commands.registerCommand('cacoo.togglePin', (item) => {
    cacooCommands.togglePin(item);
  });

  const cacooPullCommand = vscode.commands.registerCommand('cacoo.pull', () => {
    cacooCommands.pull();
  });

  const cacooSetSyncMappingCommand = vscode.commands.registerCommand(
    'cacoo.setSyncMapping',
    (item) => {
      cacooCommands.setSyncMapping(item);
    }
  );

  // ---- Workspace Integration ----
  const pollingService = new PollingService();
  const todoProvider = new TodoTreeViewProvider(configService);
  const myTasksProvider = new MyTasksTreeViewProvider(backlogApi);
  const notificationsProvider = new NotificationsTreeViewProvider(backlogApi);

  const todosTreeView = vscode.window.createTreeView('workspaceTodos', {
    treeDataProvider: todoProvider,
  });

  const myTasksTreeView = vscode.window.createTreeView('workspaceMyTasks', {
    treeDataProvider: myTasksProvider,
    showCollapseAll: true,
  });

  const notificationsTreeView = vscode.window.createTreeView('workspaceNotifications', {
    treeDataProvider: notificationsProvider,
  });

  // Document Files tree view (mapped local files)
  const documentFilesProvider = new DocumentFilesTreeViewProvider(configService, syncService);
  const documentFilesTreeView = vscode.window.createTreeView('workspaceDocumentFiles', {
    treeDataProvider: documentFilesProvider,
    showCollapseAll: true,
  });

  // Status Bar: Backlog notifications
  const backlogStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
  backlogStatusBar.command = 'workspaceNotifications.focus';
  backlogStatusBar.tooltip = 'Backlog 通知';

  // Status Bar: Slack unread
  const slackStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 199);
  slackStatusBar.command = 'workspaceSlack.focus';
  slackStatusBar.tooltip = 'Slack 未読';

  // Polling: notifications badge + status bar + toast
  let previousBacklogCount = -1;
  pollingService.register(
    'backlog-notifications',
    async () => {
      await notificationsProvider.fetchAndRefresh();
      const count = await notificationsProvider.getUnreadCount();
      notificationsTreeView.badge = {
        value: count,
        tooltip: `${count} unread notification${count !== 1 ? 's' : ''}`,
      };

      // Status Bar
      if (count > 0) {
        backlogStatusBar.text = `$(bell) ${count}`;
        backlogStatusBar.show();
      } else {
        backlogStatusBar.hide();
      }

      // Auto-TODO from notifications
      if (configService.isBacklogAutoTodoEnabled()) {
        try {
          const notifications = await backlogApi.getNotifications({ count: 20, order: 'desc' });
          const targetReasons = configService.getAutoTodoReasons();
          for (const n of notifications) {
            if (n.alreadyRead) {
              continue;
            }
            if (!targetReasons.includes(n.reason)) {
              continue;
            }
            if (!n.issue) {
              continue;
            }
            todoProvider.addFromBacklogNotification({
              id: n.id,
              issueKey: n.issue.issueKey,
              issueId: n.issue.id,
              issueSummary: n.issue.summary,
              reason: NOTIFICATION_REASONS[n.reason] || `reason:${n.reason}`,
              sender: n.sender?.name || 'Unknown',
              commentId: n.comment?.id,
              commentContent: n.comment?.content?.substring(0, 500),
            });
          }
        } catch {
          /* skip auto-todo errors */
        }
      }

      // Toast: only when count increased
      if (previousBacklogCount >= 0 && count > previousBacklogCount) {
        const diff = count - previousBacklogCount;
        const action = await vscode.window.showInformationMessage(
          `[Nulab] Backlog: ${diff}件の新しい通知`,
          '開く'
        );
        if (action === '開く') {
          vscode.commands.executeCommand('workspaceNotifications.focus');
        }
      }
      previousBacklogCount = count;
    },
    configService.getNotificationPollingInterval() * 1000
  );

  // Polling: my tasks (5 min)
  pollingService.register(
    'backlog-myTasks',
    () => {
      myTasksProvider.refresh();
    },
    300_000
  );

  // TODO commands
  const wsAddTodoCommand = vscode.commands.registerCommand('workspace.addTodo', async () => {
    const text = await vscode.window.showInputBox({
      prompt: 'TODO を入力',
      placeHolder: 'タスクの内容',
    });
    if (text) {
      todoProvider.addTodo(text);
    }
  });

  const wsToggleTodoCommand = vscode.commands.registerCommand(
    'workspace.toggleTodo',
    (id: string) => {
      todoProvider.toggleTodo(id);
    }
  );

  const wsEditTodoCommand = vscode.commands.registerCommand(
    'workspace.editTodo',
    async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const newText = await vscode.window.showInputBox({
        prompt: 'TODO を編集',
        value: item.todo.text,
      });
      if (newText !== undefined) {
        todoProvider.editTodo(item.todo.id, newText);
      }
    }
  );

  const wsDeleteTodoCommand = vscode.commands.registerCommand(
    'workspace.deleteTodo',
    (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      todoProvider.deleteTodo(item.todo.id);
    }
  );

  const wsMoveTodoUpCommand = vscode.commands.registerCommand(
    'workspace.moveTodoUp',
    (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      todoProvider.reorder(item.todo.id, 'up');
    }
  );

  const wsMoveTodoDownCommand = vscode.commands.registerCommand(
    'workspace.moveTodoDown',
    (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      todoProvider.reorder(item.todo.id, 'down');
    }
  );

  const wsClearCompletedCommand = vscode.commands.registerCommand(
    'workspace.clearCompletedTodos',
    () => {
      todoProvider.clearCompleted();
    }
  );

  const openTodoPanels = new Map<string, vscode.WebviewPanel>();

  function renderTodoPanel(panel: vscode.WebviewPanel, todoId: string): void {
    const todo = todoProvider.findTodoById(todoId);
    if (!todo) {
      panel.webview.html = '<html><body><p>TODO が見つかりません</p></body></html>';
      return;
    }
    panel.webview.html = TodoWebview.getWebviewContent(
      panel.webview,
      context.extensionUri,
      todo,
      configService.getBaseUrl()
    );
  }

  const wsCycleTodoStatusCommand = vscode.commands.registerCommand(
    'workspace.cycleTodoStatus',
    (id: string) => {
      todoProvider.cycleStatus(id);
      const panel = openTodoPanels.get(id);
      if (panel) {
        renderTodoPanel(panel, id);
      }
    }
  );

  const wsOpenTodoSourceCommand = vscode.commands.registerCommand(
    'workspace.openTodoSource',
    async (todoId: string) => {
      const todo = todoProvider.findTodoById(todoId);
      if (!todo) {
        return;
      }
      // Open the TODO detail panel
      vscode.commands.executeCommand('workspace.openTodoDetail', todoId);
    }
  );

  const wsOpenTodoDetailCommand = vscode.commands.registerCommand(
    'workspace.openTodoDetail',
    async (todoIdOrItem: string | TodoTreeItem) => {
      const todoId = typeof todoIdOrItem === 'string' ? todoIdOrItem : todoIdOrItem?.todo?.id;
      if (!todoId) {
        return;
      }
      const todo = todoProvider.findTodoById(todoId);
      if (!todo) {
        return;
      }

      const existing = openTodoPanels.get(todoId);
      if (existing) {
        existing.reveal(vscode.ViewColumn.One);
        renderTodoPanel(existing, todoId);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'todoDetail',
        `TODO: ${todo.text.substring(0, 40)}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        }
      );

      openTodoPanels.set(todoId, panel);
      panel.onDidDispose(() => openTodoPanels.delete(todoId));

      renderTodoPanel(panel, todoId);

      panel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === 'setStatus') {
            todoProvider.setStatus(todoId, message.status);
            renderTodoPanel(panel, todoId);
          }
          if (message.command === 'markReplied') {
            todoProvider.markReplied(todoId);
            renderTodoPanel(panel, todoId);
          }
          if (message.command === 'saveNotes') {
            todoProvider.editNotes(todoId, message.notes);
            vscode.window.showInformationMessage('[Nulab] Notes を保存しました');
          }
          if (message.command === 'delete') {
            todoProvider.deleteTodo(todoId);
            panel.dispose();
          }
          if (message.command === 'openExternal' && message.url) {
            vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
          if (message.command === 'openSlackThread') {
            const ctx = todo.context;
            if (ctx?.slackChannel) {
              const ts = ctx.slackThreadTs || ctx.slackMessageTs || '';
              const sender = ctx.slackUserName || 'Thread';
              vscode.commands.executeCommand(
                'workspace.openSlackThread',
                ctx.slackChannel,
                ts,
                `Thread: ${sender}`
              );
            }
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  const wsSetTodoStatusCommand = vscode.commands.registerCommand(
    'workspace.setTodoStatus',
    async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: '○ 未着手', status: 'open' as const },
          { label: '◉ 進行中', status: 'in_progress' as const },
          { label: '◷ 待ち', status: 'waiting' as const },
          { label: '✓ 完了', status: 'done' as const },
        ],
        { placeHolder: 'ステータスを選択' }
      );
      if (pick) {
        todoProvider.setStatus(item.todo.id, pick.status);
        const panel = openTodoPanels.get(item.todo.id);
        if (panel) {
          renderTodoPanel(panel, item.todo.id);
        }
      }
    }
  );

  const wsEditTodoNotesCommand = vscode.commands.registerCommand(
    'workspace.editTodoNotes',
    async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const notes = await vscode.window.showInputBox({
        prompt: 'Notes を入力',
        placeHolder: 'メモ',
        value: item.todo.notes || '',
      });
      if (notes !== undefined) {
        todoProvider.editNotes(item.todo.id, notes);
      }
    }
  );

  const wsReplyToTodoIssueCommand = vscode.commands.registerCommand(
    'workspace.replyToTodoIssue',
    async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const ctx = item.todo.context;
      if (ctx?.source === 'backlog-notification' && ctx.issueKey) {
        const baseUrl = configService.getBaseUrl();
        if (baseUrl) {
          const url = `${baseUrl}/view/${ctx.issueKey}#comment`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
          todoProvider.markReplied(item.todo.id);
        }
      }
    }
  );

  const wsReplyToTodoSlackCommand = vscode.commands.registerCommand(
    'workspace.replyToTodoSlack',
    async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const ctx = item.todo.context;
      if (
        (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') &&
        ctx?.slackChannel
      ) {
        const ts = ctx.slackThreadTs || ctx.slackMessageTs || '';
        const sender = ctx.slackUserName || 'Thread';
        vscode.commands.executeCommand(
          'workspace.openSlackThread',
          ctx.slackChannel,
          ts,
          `Thread: ${sender}`
        );
      }
    }
  );

  // My Tasks commands
  const wsRefreshMyTasksCommand = vscode.commands.registerCommand(
    'workspace.refreshMyTasks',
    () => {
      myTasksProvider.refresh();
    }
  );

  // Notifications commands
  const wsRefreshNotificationsCommand = vscode.commands.registerCommand(
    'workspace.refreshNotifications',
    () => {
      notificationsProvider.refresh();
    }
  );

  const wsMarkNotificationReadCommand = vscode.commands.registerCommand(
    'workspace.markNotificationRead',
    (item: NotificationTreeItem) => {
      if (item instanceof NotificationTreeItem) {
        notificationsProvider.markAsRead(item.notification.id);
      }
    }
  );

  const wsMarkAllNotificationsReadCommand = vscode.commands.registerCommand(
    'workspace.markAllNotificationsRead',
    () => {
      notificationsProvider.markAllAsRead();
    }
  );

  const wsToggleNotificationFilterCommand = vscode.commands.registerCommand(
    'workspace.toggleNotificationFilter',
    () => {
      const active = notificationsProvider.toggleFilterUnread();
      vscode.window.showInformationMessage(
        active ? '[Nulab] Notifications: 未読のみ表示' : '[Nulab] Notifications: フィルタ解除'
      );
    }
  );

  const wsNotificationToTodoCommand = vscode.commands.registerCommand(
    'workspace.notificationToTodo',
    async (item: NotificationTreeItem) => {
      if (!(item instanceof NotificationTreeItem)) {
        return;
      }
      const defaultText = item.todoSummary || item.label?.toString() || '';
      const text = await vscode.window.showInputBox({
        prompt: 'TODO を入力',
        placeHolder: 'タスクの内容',
        value: defaultText,
      });
      if (text) {
        const n = item.notification;
        const context: TodoContext = {
          source: 'backlog-notification',
          issueKey: n.issue?.issueKey,
          issueSummary: n.issue?.summary,
          notificationId: n.id,
          sender: n.sender?.name,
          reason: NOTIFICATION_REASONS[n.reason] || `reason:${n.reason}`,
          comment: n.comment?.content?.substring(0, 500),
        };
        todoProvider.addTodo(text, context);
        vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
      }
    }
  );

  // Slack integration
  const slackApi = new SlackApiService(configService);
  const slackProvider = new SlackTreeViewProvider(slackApi);

  const slackTreeView = vscode.window.createTreeView('workspaceSlack', {
    treeDataProvider: slackProvider,
    showCollapseAll: true,
  });

  // Slack Search (ego-search) view
  const slackSearchProvider = new SlackSearchTreeViewProvider(slackApi, configService);

  const slackSearchTreeView = vscode.window.createTreeView('workspaceSlackSearch', {
    treeDataProvider: slackSearchProvider,
    showCollapseAll: true,
  });

  // Set Slack configured context + search keywords context
  slackApi.isConfigured().then((configured) => {
    vscode.commands.executeCommand('setContext', 'nulab.slack.configured', configured);
  });
  const searchKeywords = configService.getSlackSearchKeywords();
  vscode.commands.executeCommand(
    'setContext',
    'nulab.slackSearch.hasKeywords',
    searchKeywords.length > 0
  );

  // ---- AI Session (Anthropic API) ----
  const anthropicService = new AnthropicService(configService);
  const nulabDirPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.nulab')
    : undefined;
  const sessionService = new SessionService(backlogApi, slackApi, anthropicService, nulabDirPath);
  const sessionCodeLensProvider = new SessionCodeLensProvider(sessionService);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/.nulab/sessions/todo-*.md' },
      sessionCodeLensProvider
    )
  );

  // Cleanup old posted sessions on startup
  sessionService.cleanupSessions();

  const startClaudeSessionCommand = vscode.commands.registerCommand(
    'workspace.startClaudeSession',
    async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const todo = item.todo;
      const ctx = todo.context;
      if (!ctx) {
        vscode.window.showWarningMessage('[Nulab] この TODO にはコンテキスト情報がありません');
        return;
      }

      const apiKey = await anthropicService.ensureApiKey();
      if (!apiKey) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '[Nulab] AI で返信ドラフトを生成中...',
            cancellable: true,
          },
          async (progress, token) => {
            if (ctx.source === 'backlog-notification' && ctx.issueKey && ctx.issueId) {
              await sessionService.startBacklogSession(
                todo,
                () => {
                  progress.report({ increment: 1 });
                },
                token
              );
            } else if (
              (ctx.source === 'slack-mention' || ctx.source === 'slack-search') &&
              ctx.slackChannel
            ) {
              await sessionService.startSlackSession(
                todo,
                () => {
                  progress.report({ increment: 1 });
                },
                token
              );
            } else {
              vscode.window.showWarningMessage('[Nulab] 対応するソースが見つかりません');
              return;
            }

            // Update TODO status to in_progress
            todoProvider.setStatus(todo.id, 'in_progress');
            sessionCodeLensProvider.refresh();
          }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== 'Cancelled') {
          vscode.window.showErrorMessage(`[Nulab] セッション開始に失敗: ${msg}`);
        }
      }
    }
  );

  const postSessionReplyCommand = vscode.commands.registerCommand(
    'nulab.postSessionReply',
    async (filePath: string) => {
      const parsed = sessionService.parseSession(filePath);
      if (!parsed) {
        vscode.window.showErrorMessage('[Nulab] セッションファイルを読み取れません');
        return;
      }

      const label =
        parsed.meta.action === 'slack-reply' ? 'Slack に返信' : 'Backlog にコメント投稿';
      const confirm = await vscode.window.showWarningMessage(
        `${label}しますか？`,
        { modal: true },
        label
      );
      if (confirm !== label) {
        return;
      }

      try {
        if (parsed.meta.action === 'backlog-reply') {
          await sessionService.postBacklogReply(filePath);
        } else if (parsed.meta.action === 'slack-reply') {
          await sessionService.postSlackReply(filePath);
        }

        // Mark TODO as replied
        if (parsed.meta.todoId) {
          todoProvider.markReplied(parsed.meta.todoId);
        }

        sessionCodeLensProvider.refresh();
        vscode.window.showInformationMessage(`[Nulab] ${label}しました`);

        // Close the editor tab
        const editors = vscode.window.visibleTextEditors;
        const draftEditor = editors.find((e) => e.document.uri.fsPath === filePath);
        if (draftEditor) {
          await vscode.window.showTextDocument(draftEditor.document);
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[Nulab] 投稿に失敗: ${msg}`);
      }
    }
  );

  const discardSessionCommand = vscode.commands.registerCommand(
    'nulab.discardSession',
    async (filePath: string) => {
      const confirm = await vscode.window.showWarningMessage(
        'ドラフトを破棄しますか？',
        { modal: true },
        '破棄'
      );
      if (confirm !== '破棄') {
        return;
      }

      try {
        const editors = vscode.window.visibleTextEditors;
        const draftEditor = editors.find((e) => e.document.uri.fsPath === filePath);
        if (draftEditor) {
          await vscode.window.showTextDocument(draftEditor.document);
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
        fs.unlinkSync(filePath);
        vscode.window.showInformationMessage('[Nulab] ドラフトを破棄しました');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[Nulab] 破棄に失敗: ${msg}`);
      }
    }
  );

  const setAnthropicApiKeyCommand = vscode.commands.registerCommand(
    'nulab.setAnthropicApiKey',
    async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Anthropic API Key を入力してください (Team Plan)',
        password: true,
        placeHolder: 'sk-ant-...',
      });
      if (key) {
        await anthropicService.setApiKey(key);
        vscode.window.showInformationMessage('[Nulab] Anthropic API Key を保存しました');
      }
    }
  );

  context.subscriptions.push(
    startClaudeSessionCommand,
    postSessionReplyCommand,
    discardSessionCommand,
    setAnthropicApiKeyCommand
  );

  // Auto-refresh search view when keywords file changes
  {
    const nulabDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (nulabDir) {
      const kwPattern = new vscode.RelativePattern(
        path.join(nulabDir, '.nulab'),
        'slack-search-keywords.json'
      );
      const kwWatcher = vscode.workspace.createFileSystemWatcher(kwPattern);
      const refreshSlackKeywords = () => {
        const kws = configService.getSlackSearchKeywords();
        vscode.commands.executeCommand(
          'setContext',
          'nulab.slackSearch.hasKeywords',
          kws.length > 0
        );
        slackSearchProvider.fetchAndRefresh();
      };
      kwWatcher.onDidChange(refreshSlackKeywords);
      kwWatcher.onDidCreate(refreshSlackKeywords);
      kwWatcher.onDidDelete(refreshSlackKeywords);
      context.subscriptions.push(kwWatcher);
    }
  }

  // Slack polling (only when configured) + status bar + toast
  let previousSlackUnread = -1;
  pollingService.register(
    'slack',
    async () => {
      if (!(await slackApi.isConfigured())) {
        return;
      }

      // Fetch mentions + search results
      const [mentionCount, , slackMentions] = await Promise.all([
        slackProvider.fetchAndRefresh(),
        slackSearchProvider.fetchAndRefresh(),
        slackApi.isConfigured().then((ok) => (ok ? slackApi.getMentions() : [])),
      ]);

      // Auto-TODO from Slack mentions
      if (configService.isSlackAutoTodoEnabled() && slackMentions.length > 0) {
        for (const m of slackMentions) {
          todoProvider.addFromSlackMention({
            channel: m.channel,
            threadTs: m.thread_ts || m.ts,
            messageTs: m.ts,
            senderName: m.userName || m.user || 'Unknown',
            messagePreview: m.text.substring(0, 200),
          });
        }
      }

      // Status Bar
      if (mentionCount > 0) {
        slackStatusBar.text = `$(mention) ${mentionCount}`;
        slackStatusBar.show();
      } else {
        slackStatusBar.hide();
      }

      // Toast: only when count increased
      if (previousSlackUnread >= 0 && mentionCount > previousSlackUnread) {
        const diff = mentionCount - previousSlackUnread;
        const action = await vscode.window.showInformationMessage(
          `[Nulab] Slack: ${diff}件の新しい通知`,
          '開く'
        );
        if (action === '開く') {
          vscode.commands.executeCommand('workspaceSlack.focus');
        }
      }
      previousSlackUnread = mentionCount;
    },
    configService.getSlackPollingInterval() * 1000
  );

  const openSlackThreadPanels = new Map<string, vscode.WebviewPanel>();

  const wsSetSlackTokenCommand = vscode.commands.registerCommand(
    'workspace.setSlackToken',
    async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Slack User OAuth Token (xoxp-...) を入力',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (value && !value.startsWith('xoxp-') && !value.startsWith('xoxb-')) {
            return 'トークンは xoxp- または xoxb- で始まる必要があります';
          }
          return null;
        },
      });
      if (!token) {
        return;
      }
      await configService.setSlackToken(token);
      try {
        await slackApi.reinitialize();
        const testResult = await slackApi.testConnection();
        if (testResult.ok) {
          vscode.commands.executeCommand('setContext', 'nulab.slack.configured', true);
          await slackProvider.fetchAndRefresh();
          await slackSearchProvider.fetchAndRefresh();
          const typeLabel = testResult.tokenType === 'bot' ? ' (Bot token — 通知の取得不可)' : '';
          vscode.window.showInformationMessage(
            `[Nulab] Slack 接続成功: ${testResult.user} @ ${testResult.team}${typeLabel}`
          );
        } else {
          vscode.window.showErrorMessage(`[Nulab] Slack 認証エラー: ${testResult.error}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`[Nulab] Slack の初期化に失敗しました: ${error}`);
      }
    }
  );

  const wsRefreshSlackCommand = vscode.commands.registerCommand(
    'workspace.refreshSlack',
    async () => {
      slackProvider.refresh();
      await slackProvider.fetchAndRefresh();
    }
  );

  const wsRefreshSlackSearchCommand = vscode.commands.registerCommand(
    'workspace.refreshSlackSearch',
    async () => {
      slackSearchProvider.refresh();
      await slackSearchProvider.fetchAndRefresh();
    }
  );

  const wsReplyToSlackCommand = vscode.commands.registerCommand(
    'workspace.replyToSlack',
    async (item: SlackMentionItem) => {
      if (!(item instanceof SlackMentionItem)) {
        return;
      }
      const channel = item.message.channel;
      const threadTs = item.message.thread_ts || item.message.ts;

      if (!threadTs) {
        vscode.window.showWarningMessage('[Nulab] 返信先のスレッドが見つかりません。');
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: '返信を入力',
        placeHolder: 'メッセージ',
      });
      if (!text) {
        return;
      }

      try {
        await slackApi.postReply(channel, threadTs, text);
        vscode.window.showInformationMessage('[Nulab] 返信を送信しました。');
      } catch (error) {
        vscode.window.showErrorMessage(`[Nulab] 返信の送信に失敗しました: ${error}`);
      }
    }
  );

  const wsOpenSlackThreadCommand = vscode.commands.registerCommand(
    'workspace.openSlackThread',
    async (channel: string, threadTs: string, title: string) => {
      const panelKey = `${channel}-${threadTs}`;
      const existing = openSlackThreadPanels.get(panelKey);
      if (existing) {
        existing.reveal(vscode.ViewColumn.One);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'slackThread',
        title || 'Slack Thread',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        }
      );

      openSlackThreadPanels.set(panelKey, panel);
      panel.onDidDispose(() => openSlackThreadPanels.delete(panelKey));

      try {
        panel.webview.html = '<html><body><p>Loading...</p></body></html>';

        const [messages, channelContext, slackPermalink] = await Promise.all([
          slackApi.getThreadMessages(channel, threadTs),
          slackApi.getChannelContext(channel, threadTs, 3),
          slackApi.getPermalink(channel, threadTs),
        ]);

        panel.webview.html = SlackThreadWebview.getWebviewContent(
          panel.webview,
          context.extensionUri,
          messages,
          title || 'Thread',
          slackPermalink,
          channelContext.before,
          channelContext.after
        );

        panel.webview.onDidReceiveMessage(
          async (message) => {
            if (message.command === 'reply' && message.text) {
              try {
                await slackApi.postReply(channel, threadTs, message.text);
                // Mark related TODO as replied
                todoProvider.markRepliedBySlack(channel, threadTs);
                const updated = await slackApi.getThreadMessages(channel, threadTs);
                panel.webview.html = SlackThreadWebview.getWebviewContent(
                  panel.webview,
                  context.extensionUri,
                  updated,
                  title || 'Thread',
                  slackPermalink,
                  channelContext.before,
                  channelContext.after
                );
              } catch (error) {
                vscode.window.showErrorMessage(`[Nulab] 返信の送信に失敗しました: ${error}`);
              }
            }
            if (message.command === 'openExternal' && message.url) {
              vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            if (message.command === 'addToTodo') {
              const parentMsg = messages[0];
              const sender = parentMsg?.userName || parentMsg?.user || 'Unknown';
              const preview = (parentMsg?.text || '').substring(0, 100);
              const defaultText = `[Slack] ${sender}: ${preview}`;
              const text = await vscode.window.showInputBox({
                prompt: 'TODO を入力',
                value: defaultText,
              });
              if (text) {
                todoProvider.addTodo(text, {
                  source: 'slack-mention',
                  slackChannel: channel,
                  slackThreadTs: threadTs,
                  slackMessageTs: parentMsg?.ts,
                  slackUserName: sender,
                  slackText: parentMsg?.text?.substring(0, 500),
                });
                vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
              }
            }
          },
          undefined,
          context.subscriptions
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        panel.webview.html = `<html><body><p style="color:red;white-space:pre-wrap;">${errMsg}</p></body></html>`;
        vscode.window.showErrorMessage(`[Nulab] スレッド取得に失敗: ${errMsg}`);
      }
    }
  );

  const wsOpenInSlackCommand = vscode.commands.registerCommand(
    'workspace.openInSlack',
    async (item: SlackMentionItem) => {
      if (!(item instanceof SlackMentionItem)) {
        return;
      }
      const channelId = item.message.channel;
      const ts = item.message.thread_ts || item.message.ts;
      let url = `https://app.slack.com/client/${channelId}`;
      try {
        const permalink = await slackApi.getPermalink(channelId, ts);
        if (permalink) {
          url = permalink;
        }
      } catch {
        /* use fallback */
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  );

  // ---- Add TODO from Slack ----
  const wsAddTodoFromSlackCommand = vscode.commands.registerCommand(
    'workspace.addTodoFromSlack',
    async (item: unknown) => {
      const message =
        item && typeof item === 'object' && 'message' in item
          ? ((item as { message: SlackMessage }).message as SlackMessage)
          : undefined;
      if (!message) {
        return;
      }
      const sender = message.userName || message.user || 'Unknown';
      const preview = message.text.substring(0, 100);
      const defaultText = `[Slack] ${sender}: ${preview}`;

      const text = await vscode.window.showInputBox({
        prompt: 'TODO を入力',
        placeHolder: 'タスクの内容',
        value: defaultText,
      });
      if (text) {
        const context: TodoContext = {
          source: 'slack-mention',
          slackChannel: message.channel,
          slackThreadTs: message.thread_ts,
          slackMessageTs: message.ts,
          slackUserName: sender,
          slackText: message.text.substring(0, 500),
        };
        todoProvider.addTodo(text, context);
        vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
      }
    }
  );

  // ---- Edit Slack Search Keywords ----
  const wsEditSlackSearchKeywordsCommand = vscode.commands.registerCommand(
    'workspace.editSlackSearchKeywords',
    async () => {
      const current = configService.getSlackSearchKeywords();
      const action = await vscode.window.showQuickPick(
        [
          { label: '$(add) キーワードを追加', action: 'add' as const },
          ...(current.length > 0
            ? [{ label: '$(trash) キーワードを削除', action: 'remove' as const }]
            : []),
        ],
        { placeHolder: `現在のキーワード: ${current.length > 0 ? current.join(', ') : '(なし)'}` }
      );
      if (!action) {
        return;
      }

      if (action.action === 'add') {
        const keyword = await vscode.window.showInputBox({
          prompt: '追加するキーワードを入力',
          placeHolder: 'キーワード',
        });
        if (!keyword) {
          return;
        }
        if (current.includes(keyword)) {
          vscode.window.showInformationMessage(`[Nulab] "${keyword}" は既に登録されています。`);
          return;
        }
        const updated = [...current, keyword];
        configService.setSlackSearchKeywords(updated);
        vscode.window.showInformationMessage(`[Nulab] キーワード "${keyword}" を追加しました。`);
      } else {
        const toRemove = await vscode.window.showQuickPick(
          current.map((kw) => ({ label: kw })),
          { placeHolder: '削除するキーワードを選択', canPickMany: true }
        );
        if (!toRemove || toRemove.length === 0) {
          return;
        }
        const removeSet = new Set(toRemove.map((item) => item.label));
        const updated = current.filter((kw) => !removeSet.has(kw));
        configService.setSlackSearchKeywords(updated);
        vscode.window.showInformationMessage(
          `[Nulab] ${toRemove.length}件のキーワードを削除しました。`
        );
      }
    }
  );

  // ---- Document Files commands ----
  const wsRefreshDocumentFilesCommand = vscode.commands.registerCommand(
    'workspace.refreshDocumentFiles',
    () => {
      documentFilesProvider.refresh();
    }
  );

  const wsOpenDocumentFileFolderCommand = vscode.commands.registerCommand(
    'workspace.openDocumentFileFolder',
    (item: MappingItem) => {
      if (item instanceof MappingItem) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
          const localDir = path.join(folders[0].uri.fsPath, item.mapping.localPath);
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(localDir));
        }
      }
    }
  );

  // Refresh document files when mapping file changes
  {
    const nulabDir2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (nulabDir2) {
      const docPattern = new vscode.RelativePattern(
        path.join(nulabDir2, '.nulab'),
        'document-sync-mappings.json'
      );
      const docWatcher = vscode.workspace.createFileSystemWatcher(docPattern);
      const refreshDocFiles = () => documentFilesProvider.refresh();
      docWatcher.onDidChange(refreshDocFiles);
      docWatcher.onDidCreate(refreshDocFiles);
      docWatcher.onDidDelete(refreshDocFiles);
      context.subscriptions.push(docWatcher);
    }
  }

  // ---- Export Context for Claude Code ----
  const wsExportContextCommand = vscode.commands.registerCommand(
    'workspace.exportContext',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showWarningMessage('[Nulab] ワークスペースを開いてください。');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const outDir = path.join(rootPath, '.nulab');
      fs.mkdirSync(outDir, { recursive: true });

      const ctx: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        backlog: {
          notifications: [] as unknown[],
          myTasks: [] as unknown[],
          todos: [] as unknown[],
        },
        slack: {
          channels: [] as unknown[],
          mentions: [] as unknown[],
          searchResults: {} as Record<string, unknown[]>,
        },
      };

      const bl = ctx.backlog as Record<string, unknown[]>;
      const sl = ctx.slack as Record<string, unknown>;

      // Backlog notifications
      try {
        const notifications = await backlogApi.getNotifications({ count: 30, order: 'desc' });
        bl.notifications = notifications.map((n: Record<string, unknown>) => ({
          id: n.id,
          sender: (n.sender as Record<string, unknown>)?.name || 'Unknown',
          reason: NOTIFICATION_REASONS[n.reason as number] || `reason:${n.reason}`,
          issueKey: (n.issue as Record<string, unknown>)?.issueKey,
          issueSummary: (n.issue as Record<string, unknown>)?.summary,
          comment: ((n.comment as Record<string, unknown>)?.content as string)?.substring(0, 200),
          alreadyRead: n.alreadyRead,
          created: n.created,
        }));
      } catch {
        /* skip */
      }

      // My tasks
      try {
        const issues = await backlogApi.getMyIssuesAcrossProjects();
        bl.myTasks = issues.map((i) => ({
          issueKey: i.issueKey,
          summary: i.summary,
          status: i.status?.name || '',
          priority: i.priority?.name || '',
          dueDate: i.dueDate,
        }));
      } catch {
        /* skip */
      }

      // TODOs
      bl.todos = configService.getWorkspaceTodos();

      // Slack
      if (await slackApi.isConfigured()) {
        try {
          const channels = await slackApi.getChannels();
          (sl.channels as unknown[]) = channels
            .filter((ch) => ch.unread_count > 0)
            .map((ch) => ({
              id: ch.id,
              name: ch.name,
              unread_count: ch.unread_count,
            }));
        } catch {
          /* skip */
        }

        try {
          const mentions = await slackApi.getMentions();
          (sl.mentions as unknown[]) = mentions.map((m) => ({
            userName: m.userName || m.user,
            text: m.text,
            channel: m.channel,
            ts: m.ts,
          }));
        } catch {
          /* skip */
        }

        const keywords = configService.getSlackSearchKeywords();
        const searchResults: Record<string, unknown[]> = {};
        for (const kw of keywords) {
          try {
            const results = await slackApi.searchMessages(kw);
            searchResults[kw] = results.map((m) => ({
              userName: m.userName || m.user,
              text: m.text,
              channel: m.channel,
              ts: m.ts,
            }));
          } catch {
            /* skip */
          }
        }
        sl.searchResults = searchResults;
      }

      const outPath = path.join(outDir, 'workspace-context.json');
      fs.writeFileSync(outPath, JSON.stringify(ctx, null, 2), 'utf-8');
      vscode.window.showInformationMessage(
        `[Nulab] コンテキストをエクスポートしました: .nulab/workspace-context.json`
      );
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
    filterModifiedDocumentsCommand,
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
    toggleFavoriteCommand,
    setDocumentSyncMappingCommand,
    remoteProviderDisposable,
    localProviderDisposable,
    decorationProviderDisposable,
    syncPullCommand,
    syncStatusCommand,
    syncDiffCommand,
    syncCopyAndOpenCommand,
    syncPushCommand,
    syncPullFileCommand,
    editDocumentSyncMappingCommand,
    documentSyncEditCommand,
    bdocEditorRegistration,
    webviewProvider,
    cacooTreeView,
    cacooRefreshCommand,
    cacooSearchCommand,
    cacooSetApiKeyCommand,
    cacooPreviewSheetCommand,
    cacooOpenInBrowserCommand,
    cacooTogglePinCommand,
    cacooPullCommand,
    cacooSetSyncMappingCommand,
    pollingService,
    todosTreeView,
    myTasksTreeView,
    notificationsTreeView,
    slackTreeView,
    slackSearchTreeView,
    wsAddTodoCommand,
    wsToggleTodoCommand,
    wsEditTodoCommand,
    wsDeleteTodoCommand,
    wsMoveTodoUpCommand,
    wsMoveTodoDownCommand,
    wsClearCompletedCommand,
    wsCycleTodoStatusCommand,
    wsOpenTodoSourceCommand,
    wsOpenTodoDetailCommand,
    wsSetTodoStatusCommand,
    wsEditTodoNotesCommand,
    wsReplyToTodoIssueCommand,
    wsReplyToTodoSlackCommand,
    wsRefreshMyTasksCommand,
    wsRefreshNotificationsCommand,
    wsMarkNotificationReadCommand,
    wsMarkAllNotificationsReadCommand,
    wsToggleNotificationFilterCommand,
    wsNotificationToTodoCommand,
    wsSetSlackTokenCommand,
    wsRefreshSlackCommand,
    wsRefreshSlackSearchCommand,
    wsReplyToSlackCommand,
    wsOpenSlackThreadCommand,
    wsOpenInSlackCommand,
    wsAddTodoFromSlackCommand,
    backlogStatusBar,
    slackStatusBar,
    wsExportContextCommand,
    wsEditSlackSearchKeywordsCommand,
    documentFilesTreeView,
    wsRefreshDocumentFilesCommand,
    wsOpenDocumentFileFolderCommand,
    ...registerGoogleCalendar(context, configService)
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

  checkConfiguration(configService);
}

export function deactivate() {
  console.log('Backlog extension is now deactivated');
}

// ---- Google Calendar ----

const openMeetingNotePanels: Map<string, vscode.WebviewPanel> = new Map();

function registerGoogleCalendar(
  context: vscode.ExtensionContext,
  configService: ConfigService
): vscode.Disposable[] {
  const googleApi = new GoogleApiService(configService);
  const calendarProvider = new GoogleCalendarTreeViewProvider(googleApi);

  const calendarTreeView = vscode.window.createTreeView('workspaceGoogleCalendar', {
    treeDataProvider: calendarProvider,
    showCollapseAll: true,
  });

  const setClientSecretCmd = vscode.commands.registerCommand(
    'nulab.google.setClientSecret',
    async () => {
      const secret = await vscode.window.showInputBox({
        prompt: 'Google OAuth Client Secret を入力してください',
        password: true,
        ignoreFocusOut: true,
      });
      if (secret) {
        await configService.setGoogleClientSecret(secret);
        vscode.window.showInformationMessage('Google Client Secret を保存しました。');
      }
    }
  );

  const authenticateCmd = vscode.commands.registerCommand('nulab.google.authenticate', async () => {
    try {
      await googleApi.authenticate();
      calendarProvider.refresh();
      vscode.window.showInformationMessage('Google アカウントの認証が完了しました。');
    } catch (error) {
      vscode.window.showErrorMessage(
        `Google 認証に失敗: ${error instanceof Error ? error.message : error}`
      );
    }
  });

  const signOutCmd = vscode.commands.registerCommand('nulab.google.signOut', async () => {
    await googleApi.signOut();
    calendarProvider.refresh();
    vscode.window.showInformationMessage('Google アカウントからサインアウトしました。');
  });

  const refreshCmd = vscode.commands.registerCommand('nulab.google.refreshCalendar', () => {
    googleApi.reinitialize();
    calendarProvider.refresh();
  });

  const openMeetingNotesCmd = vscode.commands.registerCommand(
    'nulab.google.openMeetingNotes',
    async (file: GoogleDriveFile, event: GoogleCalendarEvent) => {
      const panelKey = file.id;

      // Reuse existing panel if open
      const existing = openMeetingNotePanels.get(panelKey);
      if (existing) {
        existing.reveal();
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'meetingNotes',
        file.name,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        }
      );

      openMeetingNotePanels.set(panelKey, panel);
      panel.onDidDispose(() => openMeetingNotePanels.delete(panelKey));

      // Show loading
      panel.webview.html = WebviewHelper.getLoadingWebviewContent('議事録を読み込み中...');

      try {
        const htmlContent = await googleApi.getFileContent(file.id);
        panel.webview.html = MeetingNotesWebview.getWebviewContent(
          panel.webview,
          context.extensionUri,
          event,
          file,
          htmlContent
        );

        // Auto-export to .nulab/meeting-notes/ for Claude Code
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          const nulabDir = vscode.Uri.joinPath(workspaceFolder.uri, '.nulab', 'meeting-notes');
          await vscode.workspace.fs.createDirectory(nulabDir);

          const eventDate = (event.start.dateTime || event.start.date || '').split('T')[0];
          const safeName = (event.summary || 'meeting')
            .replace(/[/\\:*?"<>|]/g, '_')
            .substring(0, 60);
          const fileName = `${eventDate}_${safeName}.md`;
          const fileUri = vscode.Uri.joinPath(nulabDir, fileName);

          const attendees = (event.attendees || [])
            .filter((a) => !a.self)
            .map((a) => a.displayName || a.email);

          // Extract plain text from the sanitized HTML
          const plainText = htmlContent
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          let timeStr = '';
          if (event.start.dateTime && event.end.dateTime) {
            const s = new Date(event.start.dateTime);
            const e = new Date(event.end.dateTime);
            const tf = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
            timeStr = `${eventDate} ${tf(s)} - ${tf(e)}`;
          }

          const attendeeYaml =
            attendees.length > 0 ? attendees.map((a) => `  - ${a}`).join('\n') : '  []';

          const fm = [
            '---',
            `event: "${(event.summary || '').replace(/"/g, '\\"')}"`,
            `date: "${timeStr || eventDate}"`,
            'attendees:',
            attendeeYaml,
            file.webViewLink ? `source: "${file.webViewLink}"` : null,
            event.hangoutLink ? `meet: "${event.hangoutLink}"` : null,
            '---',
          ]
            .filter(Boolean)
            .join('\n');

          await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from(`${fm}\n\n${plainText}`, 'utf-8')
          );
        }
      } catch (error) {
        panel.webview.html = WebviewHelper.getErrorWebviewContent(
          `議事録の取得に失敗しました: ${error instanceof Error ? error.message : error}`
        );
      }

      // Handle messages from webview
      panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
          case 'createBacklogIssue': {
            const summary = message.eventSummary || '';
            const content = (message.content || '').substring(0, 5000);
            // Open an issue creation quick-pick: let user type the issue key/project
            const issueTitle = await vscode.window.showInputBox({
              prompt: '課題タイトルを入力してください',
              value: summary,
              ignoreFocusOut: true,
            });
            if (issueTitle) {
              // Copy the content for now; user can paste into the issue
              await vscode.env.clipboard.writeText(
                `## ${issueTitle}\n\n### 会議メモ\n\n${content}`
              );
              vscode.window.showInformationMessage(
                '課題内容をクリップボードにコピーしました。Backlog で課題を作成してください。'
              );
            }
            break;
          }
          case 'copyToClipboard': {
            await vscode.env.clipboard.writeText(message.content || '');
            vscode.window.showInformationMessage('クリップボードにコピーしました。');
            break;
          }
          case 'openExternal': {
            if (message.url) {
              vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            break;
          }
          case 'exportForClaude': {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
              vscode.window.showErrorMessage('ワークスペースが開かれていません。');
              break;
            }
            const nulabDir = vscode.Uri.joinPath(workspaceFolder.uri, '.nulab', 'meeting-notes');
            await vscode.workspace.fs.createDirectory(nulabDir);

            const eventDate = message.eventDate || 'unknown';
            const safeName = (message.eventSummary || 'meeting')
              .replace(/[/\\:*?"<>|]/g, '_')
              .substring(0, 60);
            const fileName = `${eventDate}_${safeName}.md`;
            const fileUri = vscode.Uri.joinPath(nulabDir, fileName);

            const attendeeList = (message.attendees || [])
              .map((a: string) => `  - ${a}`)
              .join('\n');

            const frontmatter = [
              '---',
              `event: "${(message.eventSummary || '').replace(/"/g, '\\"')}"`,
              `date: "${message.eventDateTime || eventDate}"`,
              `attendees:`,
              attendeeList || '  []',
              message.sourceUrl ? `source: "${message.sourceUrl}"` : '',
              message.meetLink ? `meet: "${message.meetLink}"` : '',
              '---',
            ]
              .filter(Boolean)
              .join('\n');

            const mdContent = `${frontmatter}\n\n${message.content || ''}`;
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(mdContent, 'utf-8'));
            vscode.window.showInformationMessage(
              `議事録をエクスポートしました: .nulab/meeting-notes/${fileName}`
            );
            break;
          }
        }
      });
    }
  );

  const openInBrowserCmd = vscode.commands.registerCommand(
    'nulab.google.openInBrowser',
    (item: EventItem | DocumentItem) => {
      if (item instanceof DocumentItem && item.file.webViewLink) {
        vscode.env.openExternal(vscode.Uri.parse(item.file.webViewLink));
      } else if (item instanceof EventItem && item.event.htmlLink) {
        vscode.env.openExternal(vscode.Uri.parse(item.event.htmlLink));
      }
    }
  );

  return [
    calendarTreeView,
    setClientSecretCmd,
    authenticateCmd,
    signOutCmd,
    refreshCmd,
    openMeetingNotesCmd,
    openInBrowserCmd,
  ];
}

async function checkConfiguration(configService: ConfigService) {
  const domain = configService.getDomain();
  const apiKey = await configService.getApiKey();

  if (!domain || !apiKey) {
    vscode.window
      .showWarningMessage(
        '[Nulab] Backlog domain and API Key are required. Please configure them.',
        'Open Settings',
        'Set API Key'
      )
      .then((selection) => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'nulab');
        } else if (selection === 'Set API Key') {
          vscode.commands.executeCommand('nulab.setApiKey');
        }
      });
  }
}
