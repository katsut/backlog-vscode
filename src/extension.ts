import * as vscode from 'vscode';
import * as path from 'path';
import { SecretsConfig } from './config/secretsConfig';
import { BacklogConfig } from './config/backlogConfig';
import { CacooConfig } from './config/cacooConfig';
import { SlackConfig } from './config/slackConfig';
import { GoogleConfig } from './config/googleConfig';
import { WorkspaceFileStore } from './config/workspaceFileStore';
import { BacklogApiService } from './services/backlogApi';
import { BacklogTreeViewProvider } from './providers/treeViewProvider';
import { BacklogProjectsWebviewProvider } from './providers/projectsWebviewProvider';
import { BacklogIssuesTreeViewProvider } from './providers/issuesTreeViewProvider';
import { BacklogWikiTreeViewProvider } from './providers/wikiTreeViewProvider';
import { BacklogDocumentsTreeViewProvider } from './providers/documentsTreeViewProvider';
import { SyncService } from './services/syncService';
import { BacklogRemoteContentProvider } from './providers/backlogRemoteContentProvider';
import { SyncFileDecorationProvider } from './providers/syncFileDecorationProvider';
import { BacklogDocumentEditorProvider } from './providers/backlogDocumentEditorProvider';
import { MarkdownRenderer } from './utils/markdownRenderer';
import { DocumentSyncCommands } from './commands/documentSyncCommands';
import { CacooApiService } from './services/cacooApi';
import { CacooSyncService } from './services/cacooSyncService';
import { CacooCommands } from './commands/cacooCommands';
import { CacooTreeViewProvider } from './providers/cacooTreeViewProvider';
import { TodoTreeViewProvider } from './providers/todoTreeViewProvider';
import { MyTasksTreeViewProvider } from './providers/myTasksTreeViewProvider';
import { NotificationsTreeViewProvider } from './providers/notificationsTreeViewProvider';
import { SlackApiService } from './services/slackApi';
import { SlackTreeViewProvider } from './providers/slackTreeViewProvider';
import { SlackSearchTreeViewProvider } from './providers/slackSearchTreeViewProvider';
import { SlackPostWebviewProvider } from './providers/slackPostWebviewProvider';
import { DocumentFilesTreeViewProvider } from './providers/documentFilesTreeViewProvider';
import { TodoEditorProvider } from './providers/todoEditorProvider';
import { GdocEditorProvider } from './providers/gdocEditorProvider';
import { PollingService } from './services/pollingService';
import { SessionFileService } from './services/session/sessionFileService';
import { SessionContextBuilder } from './services/session/sessionContextBuilder';
import { TodoPersistenceService } from './services/session/todoPersistenceService';
import { SessionReplyService } from './services/session/sessionReplyService';
import { SessionCodeLensProvider } from './providers/sessionCodeLensProvider';
import { PanelManager } from './panels/panelManager';
import { NOTIFICATION_REASONS } from './types/workspace';
import { ServiceContainer } from './container';
import { registerAllCommands } from './commands/registry';
import { registerGoogleCalendar } from './commands/google/googleCommands';
import { registerTreeViewInteraction } from './commands/treeViewInteraction';
import { BUILD_TIME } from './buildInfo';

// Output channel for logging
let outputChannel: vscode.OutputChannel;

function log(message: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Nulab Workspace');
  context.subscriptions.push(outputChannel);
  log(`Nulab extension activating... (built: ${BUILD_TIME})`);
  console.log('Nulab extension activating...');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  statusBar.text = `Nulab ${BUILD_TIME}`;
  statusBar.tooltip = `Nulab extension (built: ${BUILD_TIME})`;
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ---- Config modules ----
  const secretsConfig = new SecretsConfig(context.secrets, context.globalState);
  const fileStore = new WorkspaceFileStore();
  const backlogConfig = new BacklogConfig(secretsConfig);
  const cacooConfig = new CacooConfig(secretsConfig);
  const slackConfig = new SlackConfig(secretsConfig, fileStore);
  const googleConfig = new GoogleConfig(secretsConfig);

  // ---- Core services ----
  let backlogApi: BacklogApiService;
  try {
    backlogApi = new BacklogApiService(backlogConfig);
  } catch (error) {
    console.error('ERROR during extension activation:', error);
    vscode.window.showErrorMessage(`[Nulab] Backlog Extension failed to activate: ${error}`);
    return;
  }

  const syncService = new SyncService();
  const cacooApi = new CacooApiService(cacooConfig);
  const cacooSyncService = new CacooSyncService();
  const slackApi = new SlackApiService(slackConfig, log);
  const pollingService = new PollingService();
  const markdownRenderer = MarkdownRenderer.getInstance();

  const nulabDirPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.nulab')
    : undefined;
  const sessionFileService = new SessionFileService(nulabDirPath);
  const sessionContextBuilder = new SessionContextBuilder();
  const todoPersistence = new TodoPersistenceService(
    sessionFileService,
    sessionContextBuilder,
    null,
    null
  );
  const sessionReply = new SessionReplyService(sessionFileService, null, null);
  todoPersistence.migrateFromTodosJson();
  todoPersistence.migrateMdToTodomd();

  // ---- Providers ----
  const backlogTreeViewProvider = new BacklogTreeViewProvider(backlogApi, backlogConfig);
  const backlogProjectsWebviewProvider = new BacklogProjectsWebviewProvider(
    context.extensionUri,
    backlogApi
  );
  const backlogIssuesProvider = new BacklogIssuesTreeViewProvider(backlogApi);
  const backlogWikiProvider = new BacklogWikiTreeViewProvider(backlogApi);
  const backlogDocumentsProvider = new BacklogDocumentsTreeViewProvider(
    backlogApi,
    fileStore,
    syncService
  );
  const todoProvider = new TodoTreeViewProvider(sessionFileService, todoPersistence, log);
  const myTasksProvider = new MyTasksTreeViewProvider(backlogApi);
  const notificationsProvider = new NotificationsTreeViewProvider(
    backlogApi,
    () => slackConfig.getNotificationFilterUnread(),
    (v) => slackConfig.setNotificationFilterUnread(v)
  );
  const slackProvider = new SlackTreeViewProvider(slackApi, slackConfig);
  const slackSearchProvider = new SlackSearchTreeViewProvider(slackApi, slackConfig);
  const slackPostProvider = new SlackPostWebviewProvider(
    context.extensionUri,
    slackApi,
    slackConfig
  );
  const cacooTreeProvider = new CacooTreeViewProvider(cacooApi, cacooConfig);
  const cacooCommands = new CacooCommands(cacooApi, cacooConfig, cacooSyncService);
  const documentFilesProvider = new DocumentFilesTreeViewProvider(fileStore, syncService);
  const remoteContentProvider = new BacklogRemoteContentProvider(backlogApi);
  const syncDecorationProvider = new SyncFileDecorationProvider(syncService, fileStore);
  const sessionCodeLensProvider = new SessionCodeLensProvider(sessionFileService);
  const documentSyncCommands = new DocumentSyncCommands(
    backlogApi,
    backlogConfig,
    fileStore,
    remoteContentProvider,
    syncDecorationProvider
  );

  // ---- Panel managers ----
  const issuePanels = new PanelManager();
  const documentPanels = new PanelManager();
  const cacooPanels = new PanelManager();
  const slackThreadPanels = new PanelManager();
  const documentEditorPanels = new PanelManager();

  // ---- Service container ----
  const container: ServiceContainer = {
    context,
    backlogConfig,
    cacooConfig,
    slackConfig,
    googleConfig,
    fileStore,
    backlogApi,
    slackApi,
    cacooApi,
    syncService,
    cacooSyncService,
    pollingService,
    sessionFileService,
    todoPersistence,
    sessionReply,
    backlogTreeViewProvider,
    backlogIssuesProvider,
    backlogWikiProvider,
    backlogDocumentsProvider,
    backlogProjectsWebviewProvider,
    todoProvider,
    myTasksProvider,
    notificationsProvider,
    slackProvider,
    slackSearchProvider,
    slackPostProvider,
    cacooTreeProvider,
    documentFilesProvider,
    sessionCodeLensProvider,
    remoteContentProvider,
    syncDecorationProvider,
    issuePanels,
    documentPanels,
    cacooPanels,
    slackThreadPanels,
    documentEditorPanels,
    cacooCommands,
    documentSyncCommands,
    markdownRenderer,
    log,
  };

  // ---- Tree views ----
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
  notificationsProvider.setTodoIssueKeys(todoProvider.getTodoIssueKeys());
  slackProvider.setTodoKeys(todoProvider.getTodoSlackKeys());
  slackSearchProvider.setTodoKeys(todoProvider.getTodoSlackKeys());
  const cacooTreeView = vscode.window.createTreeView('cacooDiagrams', {
    treeDataProvider: cacooTreeProvider,
    showCollapseAll: true,
  });
  const slackTreeView = vscode.window.createTreeView('workspaceSlack', {
    treeDataProvider: slackProvider,
    showCollapseAll: true,
  });
  const slackSearchTreeView = vscode.window.createTreeView('workspaceSlackSearch', {
    treeDataProvider: slackSearchProvider,
    showCollapseAll: true,
    dragAndDropController: slackSearchProvider,
  });
  const documentFilesTreeView = vscode.window.createTreeView('workspaceDocumentFiles', {
    treeDataProvider: documentFilesProvider,
    showCollapseAll: true,
  });
  const slackPostViewDisposable = vscode.window.registerWebviewViewProvider(
    SlackPostWebviewProvider.viewType,
    slackPostProvider
  );

  vscode.commands.executeCommand('setContext', 'nulabExplorer.enabled', true);
  vscode.commands.executeCommand('setContext', 'nulabProjectFocused', false);

  // ---- Content providers ----
  const remoteProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
    'backlog-remote',
    remoteContentProvider
  );
  const localProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
    'backlog-local',
    remoteContentProvider
  );
  const decorationProviderDisposable =
    vscode.window.registerFileDecorationProvider(syncDecorationProvider);

  // ---- Custom editors ----
  const bdocEditorProvider = new BacklogDocumentEditorProvider(
    context,
    syncService,
    backlogConfig,
    markdownRenderer
  );
  const bdocEditorRegistration = vscode.window.registerCustomEditorProvider(
    BacklogDocumentEditorProvider.viewType,
    bdocEditorProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  const todoEditorProvider = new TodoEditorProvider(
    context.extensionUri,
    sessionFileService,
    sessionReply,
    todoProvider,
    backlogConfig,
    slackApi,
    sessionCodeLensProvider,
    todoPersistence,
    outputChannel
  );

  // ---- Session (Claude Code integration) ----
  todoPersistence.setApis(backlogApi, slackApi);
  sessionReply.setApis(backlogApi, slackApi);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/.nulab/todos/todo-*.todomd' },
      sessionCodeLensProvider
    )
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(TodoEditorProvider.viewType, todoEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ---- Google Doc editor ----
  const gdocEditorProvider = new GdocEditorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(GdocEditorProvider.viewType, gdocEditorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ---- Document sync commands (from existing class) ----
  const syncPullCommand = vscode.commands.registerCommand('nulab.documentSync.pull', () =>
    documentSyncCommands.pull()
  );
  const syncStatusCommand = vscode.commands.registerCommand('nulab.documentSync.status', () =>
    documentSyncCommands.status()
  );
  const syncDiffCommand = vscode.commands.registerCommand(
    'nulab.documentSync.diff',
    (filePath?: string) => documentSyncCommands.diff(filePath)
  );
  const syncCopyAndOpenCommand = vscode.commands.registerCommand(
    'nulab.documentSync.copyAndOpen',
    (filePath?: string) => documentSyncCommands.copyAndOpen(filePath)
  );
  const syncPushCommand = vscode.commands.registerCommand(
    'nulab.documentSync.push',
    (filePath?: string) => documentSyncCommands.push(filePath)
  );
  const syncPullFileCommand = vscode.commands.registerCommand(
    'nulab.documentSync.pullFile',
    (filePath?: string) => documentSyncCommands.pullFile(filePath)
  );

  // ---- Cacoo commands (from existing class) ----
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
      cacooCommands.previewSheet(context, cacooPanels, diagramId, sheetUid, title);
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

  // ---- Slack context ----
  slackApi.isConfigured().then((configured) => {
    vscode.commands.executeCommand('setContext', 'nulab.slack.configured', configured);
    if (configured) {
      slackApi.warmUpCaches().catch(() => {});
    }
  });
  const searchKeywords = slackConfig.getSearchKeywords();
  vscode.commands.executeCommand(
    'setContext',
    'nulab.slackSearch.hasKeywords',
    searchKeywords.length > 0
  );

  // ---- Status bars ----
  const backlogStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
  backlogStatusBar.command = 'workspaceNotifications.focus';
  backlogStatusBar.tooltip = 'Backlog 通知';

  const slackStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 199);
  slackStatusBar.command = 'workspaceSlack.focus';
  slackStatusBar.tooltip = 'Slack 未読';

  // ---- Polling ----
  log('Registering polling...');
  let previousBacklogCount = -1;
  pollingService.register(
    'backlog-notifications',
    async () => {
      log('polling: backlog-notifications tick');
      await notificationsProvider.fetchAndRefresh();
      notificationsProvider.setTodoIssueKeys(todoProvider.getTodoIssueKeys());
      const count = await notificationsProvider.getUnreadCount();
      notificationsTreeView.badge = {
        value: count,
        tooltip: `${count} unread notification${count !== 1 ? 's' : ''}`,
      };

      if (count > 0) {
        backlogStatusBar.text = `$(bell) ${count}`;
        backlogStatusBar.show();
      } else {
        backlogStatusBar.hide();
      }

      // Auto-TODO from notifications (fetches full issue context from API)
      log(`polling: count=${count}, autoTodo=${backlogConfig.isAutoTodoEnabled()}`);
      if (backlogConfig.isAutoTodoEnabled()) {
        try {
          const notifications = await backlogApi.getNotifications({ count: 20, order: 'desc' });
          const targetReasons = backlogConfig.getAutoTodoReasons();
          for (const n of notifications) {
            if (n.alreadyRead || !targetReasons.includes(n.reason) || !n.issue) {
              continue;
            }
            try {
              await todoProvider.addFromBacklogNotification({
                id: n.id,
                issueKey: n.issue.issueKey,
                issueId: n.issue.id,
                issueSummary: n.issue.summary,
                reason: NOTIFICATION_REASONS[n.reason] || `reason:${n.reason}`,
                sender: n.sender?.name || 'Unknown',
                commentId: n.comment?.id,
                commentContent: n.comment?.content?.substring(0, 500),
              });
            } catch (e) {
              log(`auto-todo: ${n.issue.issueKey}: ${e}`);
            }
          }
        } catch {
          /* skip auto-todo errors */
        }
      }

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
    backlogConfig.getNotificationPollingInterval() * 1000
  );

  pollingService.register(
    'backlog-myTasks',
    () => {
      myTasksProvider.refresh();
    },
    300_000
  );

  let previousSlackUnread = -1;
  pollingService.register(
    'slack',
    async () => {
      log('polling: slack tick');
      if (!(await slackApi.isConfigured())) {
        log('polling: slack skipped (not configured)');
        return;
      }

      const includeDMs = slackConfig.isIncludeDMs();
      const [slackResult] = await Promise.all([
        slackProvider.fetchAndRefresh({ includeDMs }),
        slackSearchProvider.fetchAndRefresh(),
      ]);
      const { newCount: mentionCount, mentions: slackMentions } = slackResult;
      log(`polling: slack done — ${mentionCount} new, ${slackMentions.length} total`);

      if (slackConfig.isAutoTodoEnabled() && slackMentions.length > 0) {
        const autoTodoDMs = slackConfig.isAutoTodoDMs();
        for (const m of slackMentions) {
          if (m.is_dm && !autoTodoDMs) {
            continue;
          }
          try {
            await todoProvider.addFromSlackMention({
              channel: m.channel,
              threadTs: m.thread_ts || m.ts,
              messageTs: m.ts,
              senderName: m.userName || m.user || 'Unknown',
              messagePreview: m.text.substring(0, 200),
            });
          } catch (e) {
            log(`auto-todo: Slack: ${e}`);
          }
        }
      }

      // Sync TODO keys for both Slack tree views
      const slackTodoKeys = todoProvider.getTodoSlackKeys();
      slackProvider.setTodoKeys(slackTodoKeys);
      slackSearchProvider.setTodoKeys(slackTodoKeys);

      if (mentionCount > 0) {
        slackStatusBar.text = `$(mention) ${mentionCount}`;
        slackStatusBar.show();
      } else {
        slackStatusBar.hide();
      }

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
    slackConfig.getPollingInterval() * 1000
  );

  // ---- File watchers ----
  {
    const nulabDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (nulabDir) {
      // Slack search keywords watcher
      const kwPattern = new vscode.RelativePattern(
        path.join(nulabDir, '.nulab'),
        'slack-search-keywords.json'
      );
      const kwWatcher = vscode.workspace.createFileSystemWatcher(kwPattern);
      const refreshSlackKeywords = () => {
        const kws = slackConfig.getSearchKeywords();
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

      // Document sync mappings watcher
      const docPattern = new vscode.RelativePattern(
        path.join(nulabDir, '.nulab'),
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

  // ---- Google Calendar ----
  let googleCalendar: {
    disposables: vscode.Disposable[];
    treeViews: vscode.TreeView<any>[];
  } | null = null;
  try {
    googleCalendar = registerGoogleCalendar(
      context,
      googleConfig,
      log,
      todoProvider,
      todoPersistence
    );
    log('Google Calendar registered successfully');
  } catch (error) {
    log(`Failed to register Google Calendar: ${error}`);
    console.error('Failed to register Google Calendar:', error);
  }

  // ---- Register all extracted commands ----
  const allCommandDisposables = registerAllCommands(container, {
    todosTreeView,
    notificationsTreeView,
    slackTreeView,
    slackSearchTreeView,
  });

  // ---- Tree view interaction (click guard + enter key) ----
  const allTreeViews: vscode.TreeView<any>[] = [
    projectsTreeView,
    issuesTreeView,
    wikiTreeView,
    documentsTreeView,
    todosTreeView,
    myTasksTreeView,
    notificationsTreeView,
    cacooTreeView,
    documentFilesTreeView,
    slackTreeView,
    slackSearchTreeView,
    ...(googleCalendar ? googleCalendar.treeViews : []),
  ];

  const treeViewHandlers = [
    {
      view: todosTreeView,
      handler: (item: any) =>
        item.todo && vscode.commands.executeCommand('workspace.openTodoDetail', item.todo.id),
    },
    {
      view: myTasksTreeView,
      handler: (item: any) =>
        item.issue && vscode.commands.executeCommand('nulab.openIssue', item.issue),
    },
    {
      view: notificationsTreeView,
      handler: (item: any) =>
        item.notification?.issue &&
        vscode.commands.executeCommand('nulab.openIssue', item.notification.issue),
    },
    {
      view: issuesTreeView,
      handler: (item: any) =>
        item.issue && vscode.commands.executeCommand('nulab.openIssue', item.issue),
    },
    {
      view: wikiTreeView,
      handler: (item: any) =>
        item.wiki && vscode.commands.executeCommand('nulab.openWiki', item.wiki),
    },
    {
      view: documentsTreeView,
      handler: (item: any) => {
        if (item.document) {
          vscode.commands.executeCommand('nulab.openDocument', item.document);
        } else if (item.node) {
          vscode.commands.executeCommand(
            'nulab.openDocumentFromNode',
            item.node.id,
            item.projectId
          );
        }
      },
    },
    {
      view: projectsTreeView,
      handler: (item: any) => {
        if (item.project) {
          vscode.commands.executeCommand('nulab.focusProject', item.project.id);
        } else if (item.issue) {
          vscode.commands.executeCommand('nulab.openIssue', item.issue);
        } else if (item.wiki) {
          vscode.commands.executeCommand('nulab.openWiki', item.wiki);
        } else if (item.document) {
          vscode.commands.executeCommand('nulab.openDocument', item.document);
        } else if (item.node) {
          vscode.commands.executeCommand(
            'nulab.openDocumentFromNode',
            item.node.id,
            item.projectId
          );
        }
      },
    },
    {
      view: cacooTreeView,
      handler: (item: any) =>
        item.sheet &&
        item.diagram &&
        vscode.commands.executeCommand(
          'cacoo.previewSheet',
          item.diagram.diagramId,
          item.sheet.uid,
          `${item.diagram.title} / ${item.sheet.name}`
        ),
    },
    {
      view: documentFilesTreeView,
      handler: (item: any) =>
        item.resourceUri &&
        vscode.commands.executeCommand('vscode.openWith', item.resourceUri, 'nulab.bdocEditor'),
    },
    {
      view: slackTreeView,
      handler: (item: any) => {
        if (item.message) {
          const m = item.message;
          vscode.commands.executeCommand(
            'workspace.openSlackThread',
            m.channel,
            m.thread_ts || m.ts,
            `Thread: ${m.userName || m.user}`
          );
        }
      },
    },
    {
      view: slackSearchTreeView,
      handler: (item: any) => {
        if (item.message) {
          const m = item.message;
          vscode.commands.executeCommand(
            'workspace.openSlackThread',
            m.channel,
            m.thread_ts || m.ts,
            `Thread: ${m.userName || m.user}`
          );
        }
      },
    },
  ];

  const treeViewInteractionDisposables = registerTreeViewInteraction(
    allTreeViews,
    treeViewHandlers
  );

  // ---- Auto-refresh ----
  if (backlogConfig.isAutoRefreshEnabled()) {
    const interval = backlogConfig.getRefreshInterval();
    const timer = setInterval(() => {
      backlogTreeViewProvider.refresh();
    }, interval * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }

  // ---- Register all disposables ----
  context.subscriptions.push(
    // Tree views
    projectsTreeView,
    issuesTreeView,
    wikiTreeView,
    documentsTreeView,
    todosTreeView,
    myTasksTreeView,
    notificationsTreeView,
    cacooTreeView,
    slackTreeView,
    slackSearchTreeView,
    documentFilesTreeView,
    slackPostViewDisposable,
    // Content providers
    remoteProviderDisposable,
    localProviderDisposable,
    decorationProviderDisposable,
    bdocEditorRegistration,
    // Document sync commands
    syncPullCommand,
    syncStatusCommand,
    syncDiffCommand,
    syncCopyAndOpenCommand,
    syncPushCommand,
    syncPullFileCommand,
    // Cacoo commands
    cacooRefreshCommand,
    cacooSearchCommand,
    cacooSetApiKeyCommand,
    cacooPreviewSheetCommand,
    cacooOpenInBrowserCommand,
    cacooTogglePinCommand,
    cacooPullCommand,
    cacooSetSyncMappingCommand,
    // Status bars
    backlogStatusBar,
    slackStatusBar,
    // Services
    pollingService,
    // Panel managers
    issuePanels,
    documentPanels,
    cacooPanels,
    slackThreadPanels,
    documentEditorPanels,
    // Extracted commands
    ...allCommandDisposables,
    ...treeViewInteractionDisposables,
    ...(googleCalendar?.disposables ?? [])
  );

  checkConfiguration(backlogConfig);
  log('Extension activated successfully');
}

export function deactivate() {
  log('Extension deactivated');
  console.log('Backlog extension is now deactivated');
}

async function checkConfiguration(backlogConfig: BacklogConfig) {
  const domain = backlogConfig.getDomain();
  const apiKey = await backlogConfig.getApiKey();

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
