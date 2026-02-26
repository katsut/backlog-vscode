import * as vscode from 'vscode';
import { BacklogConfig } from './config/backlogConfig';
import { CacooConfig } from './config/cacooConfig';
import { SlackConfig } from './config/slackConfig';
import { GoogleConfig } from './config/googleConfig';
import { WorkspaceFileStore } from './config/workspaceFileStore';
import { BacklogApiService } from './services/backlogApi';
import { SlackApiService } from './services/slackApi';
import { CacooApiService } from './services/cacooApi';
import { SyncService } from './services/syncService';
import { CacooSyncService } from './services/cacooSyncService';
import { SessionFileService } from './services/session/sessionFileService';
import { TodoPersistenceService } from './services/session/todoPersistenceService';
import { SessionReplyService } from './services/session/sessionReplyService';
import { PollingService } from './services/pollingService';
import { BacklogTreeViewProvider } from './providers/treeViewProvider';
import { BacklogIssuesTreeViewProvider } from './providers/issuesTreeViewProvider';
import { BacklogWikiTreeViewProvider } from './providers/wikiTreeViewProvider';
import { BacklogDocumentsTreeViewProvider } from './providers/documentsTreeViewProvider';
import { BacklogProjectsWebviewProvider } from './providers/projectsWebviewProvider';
import { TodoTreeViewProvider } from './providers/todoTreeViewProvider';
import { MyTasksTreeViewProvider } from './providers/myTasksTreeViewProvider';
import { NotificationsTreeViewProvider } from './providers/notificationsTreeViewProvider';
import { SlackTreeViewProvider } from './providers/slackTreeViewProvider';
import { SlackSearchTreeViewProvider } from './providers/slackSearchTreeViewProvider';
import { SlackPostWebviewProvider } from './providers/slackPostWebviewProvider';
import { CacooTreeViewProvider } from './providers/cacooTreeViewProvider';
import { DocumentFilesTreeViewProvider } from './providers/documentFilesTreeViewProvider';
import { SessionCodeLensProvider } from './providers/sessionCodeLensProvider';
import { BacklogRemoteContentProvider } from './providers/backlogRemoteContentProvider';
import { SyncFileDecorationProvider } from './providers/syncFileDecorationProvider';
import { PanelManager } from './panels/panelManager';
import { MarkdownRenderer } from './utils/markdownRenderer';
import { CacooCommands } from './commands/cacooCommands';
import { DocumentSyncCommands } from './commands/documentSyncCommands';

export interface ServiceContainer {
  context: vscode.ExtensionContext;

  // Config
  backlogConfig: BacklogConfig;
  cacooConfig: CacooConfig;
  slackConfig: SlackConfig;
  googleConfig: GoogleConfig;
  fileStore: WorkspaceFileStore;

  // API Services
  backlogApi: BacklogApiService;
  slackApi: SlackApiService;
  cacooApi: CacooApiService;
  syncService: SyncService;
  cacooSyncService: CacooSyncService;
  pollingService: PollingService;

  // Session sub-services
  sessionFileService: SessionFileService;
  todoPersistence: TodoPersistenceService;
  sessionReply: SessionReplyService;

  // Tree View Providers
  backlogTreeViewProvider: BacklogTreeViewProvider;
  backlogIssuesProvider: BacklogIssuesTreeViewProvider;
  backlogWikiProvider: BacklogWikiTreeViewProvider;
  backlogDocumentsProvider: BacklogDocumentsTreeViewProvider;
  backlogProjectsWebviewProvider: BacklogProjectsWebviewProvider;
  todoProvider: TodoTreeViewProvider;
  myTasksProvider: MyTasksTreeViewProvider;
  notificationsProvider: NotificationsTreeViewProvider;
  slackProvider: SlackTreeViewProvider;
  slackSearchProvider: SlackSearchTreeViewProvider;
  slackPostProvider: SlackPostWebviewProvider;
  cacooTreeProvider: CacooTreeViewProvider;
  documentFilesProvider: DocumentFilesTreeViewProvider;
  sessionCodeLensProvider: SessionCodeLensProvider;
  remoteContentProvider: BacklogRemoteContentProvider;
  syncDecorationProvider: SyncFileDecorationProvider;

  // Panel Managers
  issuePanels: PanelManager;
  documentPanels: PanelManager;
  cacooPanels: PanelManager;
  slackThreadPanels: PanelManager;
  documentEditorPanels: PanelManager;

  // Existing command classes
  cacooCommands: CacooCommands;
  documentSyncCommands: DocumentSyncCommands;
  markdownRenderer: MarkdownRenderer;

  log: (message: string) => void;
}
